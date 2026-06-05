// MapLibre map + AlphaEarth single mosaic raster layer (map A).
// The backend /api/mosaic/tiles finds and merges intersecting COGs by index per tile,
// so the frontend manages only a single raster source (global zoom). On band/year/contrast
// change, only the tile URL needs to be swapped (setTiles); no re-query is needed on pan/zoom.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_TILES } from "./config.js";
import { applyAef, baseStyle, setBasemap as setMapBasemap, AEF_MINZOOM, AEF_MAXZOOM } from "./aeflayer.js";

// Re-exported so the prefetcher can use the same zoom range (backwards-compatible import path).
export { AEF_MINZOOM, AEF_MAXZOOM };

export class Viewer {
  constructor(container, initial) {
    this.year = initial.year;
    this.triple = null; // resolved in scrub.init
    this.range = { min: initial.min, max: initial.max };

    this.map = new maplibregl.Map({
      container,
      style: baseStyle(BASEMAP_TILES),
      center: [initial.lng, initial.lat],
      zoom: initial.zoom,
    });
    this.map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    this.onMove = null;
    this.onMoveStart = null;
    this.onIdle = null;
    this.map.on("movestart", () => this.onMoveStart?.());
    // idle = all requested tiles rendered + static state. Driving prefetch from this signal
    // ensures it only runs after visible tiles finish loading, avoiding bandwidth competition with cold loads.
    this.map.on("idle", () => this.onIdle?.());
    this.map.on("moveend", () => {
      if (this.onMove) {
        const c = this.map.getCenter();
        this.onMove({ lng: c.lng, lat: c.lat, zoom: this.map.getZoom() });
      }
    });
  }

  whenReady(fn) {
    if (this.map.loaded()) fn();
    else this.map.once("load", fn);
  }

  _apply() {
    applyAef(this.map, { year: this.year, triple: this.triple, range: this.range });
    // Re-applying the layer (setTiles) preserves properties, but explicit application is needed right after initial creation.
    if (this.map.getLayer("aef")) {
      if (this._opacity != null) this.map.setPaintProperty("aef", "raster-opacity", this._opacity);
      if (this._visible != null) {
        this.map.setLayoutProperty("aef", "visibility", this._visible ? "visible" : "none");
      }
    }
  }

  setYear(year) {
    this.year = year;
    this._apply();
  }

  // Band combination/contrast change → swap tile URL
  setRender(triple, range) {
    this.triple = triple;
    this.range = range;
    this._apply();
  }

  // Basemap switch → recreate base source/layer (AEF layer stays on top as-is).
  setBasemapTiles(tiles, attribution) {
    setMapBasemap(this.map, tiles, attribution);
  }

  // AlphaEarth layer opacity (0..1) — raster-opacity above base.
  setOpacity(v) {
    this._opacity = v;
    if (this.map.getLayer && this.map.getLayer("aef")) {
      this.map.setPaintProperty("aef", "raster-opacity", v);
    }
  }

  // AlphaEarth layer on/off — visibility (none also stops tile requests).
  setVisible(on) {
    this._visible = on;
    if (this.map.getLayer && this.map.getLayer("aef")) {
      this.map.setLayoutProperty("aef", "visibility", on ? "visible" : "none");
    }
  }
}
