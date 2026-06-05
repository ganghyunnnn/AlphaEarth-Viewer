// Idle predictive prefetch.
//
// We can't change the bandwidth floor (Pacific ~3.4MB/s), so we improve *perceived* speed.
// The key is the gray code: a ±1 scrub step changes only 1 of the 3 bands, so a neighbor
// frame's tiles are only 1 band cold per tile -> cheap. While the user is idle, pre-request
// the neighbor frame's tiles so the server TILE_CACHE (+ browser cache via Cache-Control)
// fills up, turning the actual scrub from 0.6~1.0s into ~0 (HIT).
//
// Safeguards: abort immediately once interaction starts (don't compete with scrub/pan for
// bandwidth), low-priority fetch, concurrency/total caps, per-session dedupe.
import { step, indexToTriple, toBidx } from "./graycode.js";
import { API_BASE } from "./config.js";
import { AEF_MINZOOM, AEF_MAXZOOM } from "./aeflayer.js";

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return [x, y];
}

function tileUrl(z, x, y, year, triple, range) {
  const [r, g, b] = triple;
  const p = new URLSearchParams();
  p.set("year", String(year));
  p.append("bidx", String(toBidx(r)));
  p.append("bidx", String(toBidx(g)));
  p.append("bidx", String(toBidx(b)));
  p.append("rescale", `${range.min},${range.max}`);
  return `${API_BASE}/api/mosaic/tiles/${z}/${x}/${y}.png?${p.toString()}`;
}

export class Prefetcher {
  constructor(map) {
    this.map = map;
    this.idleTimer = null;
    this.ctrl = null; // in-flight prefetch AbortController
    this.done = new Set(); // already-prefetched URLs (per-session dedupe)
    this.ctx = null; // {year, index, range, skipDegenerate}
    // The idle event already guarantees "visible tiles loaded", so a short debounce is enough.
    this.IDLE_MS = 300;
    this.CONCURRENCY = 4; // 4 of the browser's 6 connections (leaves room for real requests); little contention since idle
    this.MAX_PER_CYCLE = 90; // fits both neighbors' (±1) visible tiles ~60 + pan margin ~22
  }

  update(ctx) {
    this.ctx = ctx;
  }

  // user interaction starts -> cancel in-flight prefetch immediately (yield bandwidth)
  cancel() {
    clearTimeout(this.idleTimer);
    if (this.ctrl) {
      this.ctrl.abort();
      this.ctrl = null;
    }
  }

  // schedule entering idle after interaction ends
  schedule() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._run(), this.IDLE_MS);
  }

  // MapLibre requests 256px sources at round(zoom)+1 (defined relative to 512px).
  _tileZoom() {
    const z = Math.round(this.map.getZoom()) + 1;
    return Math.min(AEF_MAXZOOM, Math.max(AEF_MINZOOM, z));
  }

  _visibleTiles(z, margin) {
    const b = this.map.getBounds();
    const [x0, y0] = lngLatToTile(b.getWest(), b.getNorth(), z);
    const [x1, y1] = lngLatToTile(b.getEast(), b.getSouth(), z);
    const n = 2 ** z;
    const xmin = Math.min(x0, x1) - margin;
    const xmax = Math.max(x0, x1) + margin;
    const ymin = Math.min(y0, y1) - margin;
    const ymax = Math.max(y0, y1) + margin;
    const out = [];
    for (let x = xmin; x <= xmax; x++) {
      for (let y = ymin; y <= ymax; y++) {
        if (y < 0 || y >= n) continue;
        out.push([((x % n) + n) % n, y]); // longitude wrap
      }
    }
    return out;
  }

  _targets() {
    const { year, index, range, skipDegenerate } = this.ctx;
    const z = this._tileZoom();
    const vis = this._visibleTiles(z, 0);
    const urls = [];

    // Scrub neighbors (±1) -- visible tiles only. Only 1 band cold per tile (2 bands hit the
    // band cache), so ~3x cheaper than a 3-band cold render; once warm the next scrub is an
    // immediate cache HIT. Fill +1 first (playback/forward scrub is most common), then -1.
    // The expensive pan margin (current frame, 3 bands cold) would eat this limited idle
    // bandwidth, so it's deliberately excluded -- MapLibre keeps existing tiles, so panning is already bearable.
    for (const dir of [+1, -1]) {
      const t = indexToTriple(step(index, dir, skipDegenerate));
      for (const [x, y] of vis) urls.push(tileUrl(z, x, y, year, t, range));
    }
    return urls;
  }

  async _run() {
    if (!this.ctx) return;
    let urls = this._targets().filter((u) => !this.done.has(u));
    if (urls.length === 0) return;
    urls = urls.slice(0, this.MAX_PER_CYCLE);

    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;
    let i = 0;
    const worker = async () => {
      while (i < urls.length && !signal.aborted) {
        const u = urls[i++];
        this.done.add(u);
        try {
          // priority:'low' -- yield so the browser prioritizes real tile <img> loads.
          await fetch(u, { signal, priority: "low" });
        } catch {
          // ignore abort/network errors (can retry on the next idle)
        }
      }
    };
    const ws = [];
    for (let k = 0; k < this.CONCURRENCY; k++) ws.push(worker());
    await Promise.all(ws);
  }
}
