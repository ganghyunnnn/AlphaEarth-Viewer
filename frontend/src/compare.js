// Compare (swipe) mode.
//
// Overlays a second map B on top of map A at full size, with cameras synced bidirectionally.
// B's container is clipped using clip-path (inset) at the swipe boundary so only the right
// portion of B is visible — left = A / right = B — allowing two combinations side by side.
//
// clip-path clips both rendering and hit-testing (pointer events on the left area pass through
// B down to A), so both sides are naturally interactive without extra pointer-events handling.
// Only the divider handle moves the boundary via its own drag handler at the top level.
import maplibregl from "maplibre-gl";
import { BASEMAP_TILES } from "./config.js";
import { applyAef, baseStyle, setBasemap as setMapBasemap, whenStyleReady } from "./aeflayer.js";

export class CompareController {
  constructor({ mapA, containerB, divider }) {
    this.mapA = mapA;
    this.containerB = containerB; // #mapB
    this.divider = divider; // #divider (including handle)
    this.mapB = null;
    this.active = false;
    this.swipe = 0.5; // 0..1, horizontal position of the boundary
    this._syncing = false;
    this._renderB = null; // {year, triple, range}
    this._basemapTiles = null; // current basemap tiles (used when creating/switching map B)
    this._opacity = null; // current AEF layer opacity (applied after map B is created)
    this._visible = null; // current AEF layer on/off state (applied after map B is created)
    this.onSwipeEnd = null; // (swipe) => void — called on drag end (for state persistence)

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this.divider.addEventListener("mousedown", this._onDown);
    this.divider.addEventListener("touchstart", this._onDown, { passive: false });
  }

  // Create map B once on first entry, then attach camera sync (reused thereafter).
  _ensureMapB() {
    if (this.mapB) return;
    const c = this.mapA.getCenter();
    this.mapB = new maplibregl.Map({
      container: this.containerB,
      style: baseStyle(this._basemapTiles || BASEMAP_TILES),
      center: [c.lng, c.lat],
      zoom: this.mapA.getZoom(),
      bearing: this.mapA.getBearing(),
      pitch: this.mapA.getPitch(),
      attributionControl: false,
    });
    this._link(this.mapA, this.mapB);
    this._link(this.mapB, this.mapA);
  }

  // Mirror src camera changes onto dst (with feedback loop prevention guard).
  _link(src, dst) {
    src.on("move", () => {
      if (this._syncing) return;
      this._syncing = true;
      dst.jumpTo({
        center: src.getCenter(),
        zoom: src.getZoom(),
        bearing: src.getBearing(),
        pitch: src.getPitch(),
      });
      this._syncing = false;
    });
  }

  // Enable: create/show map B → sync to A's camera → apply B render → update clip.
  enable(renderB) {
    this._renderB = renderB;
    this.active = true;
    this.containerB.classList.add("on");
    this.divider.classList.add("on");
    this._ensureMapB();
    this.mapB.resize();
    this._syncing = true;
    this.mapB.jumpTo({
      center: this.mapA.getCenter(),
      zoom: this.mapA.getZoom(),
      bearing: this.mapA.getBearing(),
      pitch: this.mapA.getPitch(),
    });
    this._syncing = false;
    this.setRenderB(renderB);
    this.setSwipe(this.swipe);
  }

  disable() {
    this.active = false;
    this.containerB.classList.remove("on");
    this.divider.classList.remove("on");
  }

  // Update map B's year/band combination/contrast.
  setRenderB(render) {
    this._renderB = render;
    if (!this.mapB) return;
    const run = () => {
      applyAef(this.mapB, render);
      if (this.mapB.getLayer("aef")) {
        if (this._opacity != null) this.mapB.setPaintProperty("aef", "raster-opacity", this._opacity);
        if (this._visible != null) {
          this.mapB.setLayoutProperty("aef", "visibility", this._visible ? "visible" : "none");
        }
      }
    };
    whenStyleReady(this.mapB, run);
  }

  // AEF layer opacity (0..1) — applied to map B (deferred to next render if not yet created).
  setOpacity(v) {
    this._opacity = v;
    if (this.mapB && this.mapB.getLayer && this.mapB.getLayer("aef")) {
      this.mapB.setPaintProperty("aef", "raster-opacity", v);
    }
  }

  // AEF layer on/off — applied to map B (deferred to next render if not yet created).
  setVisible(on) {
    this._visible = on;
    if (this.mapB && this.mapB.getLayer && this.mapB.getLayer("aef")) {
      this.mapB.setLayoutProperty("aef", "visibility", on ? "visible" : "none");
    }
  }

  // Basemap switch → recreate map B's base source/layer (deferred to next creation if not yet created).
  setBasemapTiles(tiles, attribution) {
    this._basemapTiles = tiles;
    if (!this.mapB) return;
    setMapBasemap(this.mapB, tiles, attribution);
  }

  // Set boundary position (0..1) → clip B from the left by swipe amount, exposing only the right portion.
  setSwipe(t) {
    this.swipe = Math.min(1, Math.max(0, t));
    const pct = (this.swipe * 100).toFixed(2) + "%";
    this.containerB.style.clipPath = `inset(0 0 0 ${pct})`;
    this.divider.style.left = pct;
  }

  _onDown(ev) {
    ev.preventDefault();
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("touchmove", this._onMove, { passive: false });
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("touchend", this._onUp);
  }

  _onMove(ev) {
    if (ev.cancelable) ev.preventDefault();
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const rect = this.mapA.getContainer().getBoundingClientRect();
    this.setSwipe((x - rect.left) / rect.width);
  }

  _onUp() {
    window.removeEventListener("mousemove", this._onMove);
    window.removeEventListener("touchmove", this._onMove);
    window.removeEventListener("mouseup", this._onUp);
    window.removeEventListener("touchend", this._onUp);
    this.onSwipeEnd?.(this.swipe);
  }
}
