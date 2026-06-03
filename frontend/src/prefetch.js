// 유휴 예측 프리페치(idle predictive prefetch).
//
// 대역폭 바닥(태평양 ~3.4MB/s)은 못 바꾸므로 '체감 속도'를 올린다. 핵심은 그레이코드:
// 스크럽 ±1 스텝은 3밴드 중 1밴드만 바뀐다 → 이웃 프레임 타일은 타일당 1밴드만 콜드라
// 저렴하다. 사용자가 멈춘(유휴) 동안 이웃 프레임 타일을 미리 요청해 두면 서버 TILE_CACHE
// (+Cache-Control로 브라우저 캐시)가 채워져, 실제 스크럽 시 0.6~1.0s → ~0(HIT)이 된다.
//
// 안전장치: 상호작용이 시작되면 즉시 abort(스크럽/팬과 대역폭 경쟁 금지), 낮은 우선순위
// fetch, 동시성·총량 제한, 세션 중복 제거.
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
    this.ctrl = null; // 진행 중 프리페치 AbortController
    this.done = new Set(); // 이미 프리페치한 URL(세션 중복 방지)
    this.ctx = null; // {year, index, range, skipDegenerate}
    // idle 이벤트가 이미 '보이는 타일 로드 완료'를 보장하므로 짧은 디바운스면 충분.
    this.IDLE_MS = 300;
    this.CONCURRENCY = 4; // 브라우저 6연결 중 4개(실 요청 여지 남김), idle이라 경쟁 적음
    this.MAX_PER_CYCLE = 90; // 양쪽 이웃(±1) 가시타일 ~60 + 팬 마진 ~22 수용
  }

  update(ctx) {
    this.ctx = ctx;
  }

  // 사용자 상호작용 시작 → 진행 중 프리페치 즉시 취소(대역폭 양보)
  cancel() {
    clearTimeout(this.idleTimer);
    if (this.ctrl) {
      this.ctrl.abort();
      this.ctrl = null;
    }
  }

  // 상호작용 종료 후 유휴 진입 예약
  schedule() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._run(), this.IDLE_MS);
  }

  // MapLibre는 256px 소스를 round(zoom)+1 레벨로 요청한다(512px 기준 정의).
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
        out.push([((x % n) + n) % n, y]); // 경도 래핑
      }
    }
    return out;
  }

  _targets() {
    const { year, index, range, skipDegenerate } = this.ctx;
    const z = this._tileZoom();
    const vis = this._visibleTiles(z, 0);
    const urls = [];

    // 스크럽 이웃(±1) — 보이는 타일만. 타일당 1밴드만 콜드(2밴드는 밴드캐시 HIT)라
    // 3밴드 콜드 대비 ~3배 싸고, 데워지면 다음 스크럽이 곧바로 캐시 HIT이 된다.
    // +1을 먼저(재생/순방향 스크럽이 가장 흔함) → -1 순으로 채운다.
    // 비싼 팬-마진(현재 프레임 3밴드 콜드)은 이 한정된 유휴 대역폭을 잡아먹으므로
    // 의도적으로 제외 — MapLibre가 기존 타일을 유지하므로 팬은 이미 견딜 만하다.
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
          // priority:'low' — 브라우저가 실제 타일 <img> 로드를 우선 처리하도록 양보.
          await fetch(u, { signal, priority: "low" });
        } catch {
          // abort/네트워크 오류는 무시(다음 유휴에 재시도 가능)
        }
      }
    };
    const ws = [];
    for (let k = 0; k < this.CONCURRENCY; k++) ws.push(worker());
    await Promise.all(ws);
  }
}
