// MapLibre 지도 + AlphaEarth COG 레이어 관리.
// - 뷰 이동/연도 변경: /api/tiles 재질의 후 교차 COG들을 raster source로 동기화
// - 밴드/대비 변경: 기존 source의 타일 URL만 교체(재질의 불필요) → 빠른 스크럽
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_TILES } from "./config.js";
import { cogTileUrl, fetchTiles } from "./titiler.js";

const SRC_PREFIX = "aef-";

export class Viewer {
  constructor(container, initial) {
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          base: { type: "raster", tiles: BASEMAP_TILES, tileSize: 256, attribution: "© CARTO" },
        },
        layers: [{ id: "base", type: "raster", source: "base" }],
      },
      center: [initial.lng, initial.lat],
      zoom: initial.zoom,
    });
    this.map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    this.year = initial.year;
    this.triple = null;
    this.range = { min: initial.min, max: initial.max };
    this.activeCogs = new Map(); // cogUrl -> sourceId
    this._seq = 0;

    this.onMove = null; // (centerZoom) => void
    this.map.on("moveend", () => {
      this.refreshTiles();
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

  viewBbox() {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  setYear(year) {
    this.year = year;
    this.refreshTiles();
  }

  // 밴드 조합/대비만 변경: source 타일 URL 교체 (빠름)
  setRender(triple, range) {
    this.triple = triple;
    this.range = range;
    for (const [cogUrl, sourceId] of this.activeCogs) {
      const src = this.map.getSource(sourceId);
      if (src) src.setTiles([cogTileUrl(cogUrl, triple, range)]);
    }
  }

  // 현재 뷰의 교차 COG 목록을 질의해 레이어 동기화
  async refreshTiles() {
    if (!this.triple) return;
    const seq = ++this._seq;
    let tiles;
    try {
      tiles = await fetchTiles(this.viewBbox(), this.year);
    } catch (e) {
      console.warn("fetchTiles 실패:", e.message);
      return;
    }
    if (seq !== this._seq) return; // 더 최신 요청이 진행 중

    const wanted = new Set(tiles.map((t) => t.path));

    // 제거: 더 이상 보이지 않는 COG
    for (const [cogUrl, sourceId] of [...this.activeCogs]) {
      if (!wanted.has(cogUrl)) {
        if (this.map.getLayer(sourceId)) this.map.removeLayer(sourceId);
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
        this.activeCogs.delete(cogUrl);
      }
    }

    // 추가: 새로 보이는 COG
    let idx = 0;
    for (const t of tiles) {
      if (this.activeCogs.has(t.path)) continue;
      const sourceId = `${SRC_PREFIX}${seq}-${idx++}`;
      this.map.addSource(sourceId, {
        type: "raster",
        tiles: [cogTileUrl(t.path, this.triple, this.range)],
        tileSize: 256,
        bounds: t.bbox,
      });
      this.map.addLayer({ id: sourceId, type: "raster", source: sourceId });
      this.activeCogs.set(t.path, sourceId);
    }
  }
}
