// MapLibre 지도 + AlphaEarth 단일 모자이크 레이어(맵 A).
// 백엔드 /api/mosaic/tiles 가 타일마다 인덱스로 교차 COG를 찾아 병합하므로,
// 프론트는 단 하나의 raster 소스만 관리한다(전 지구 줌). 밴드/연도/대비 변경 시
// 타일 URL만 교체(setTiles)하면 되고, 뷰 이동 시 별도 재질의가 필요 없다.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_TILES } from "./config.js";
import { applyAef, baseStyle, setBasemap as setMapBasemap, AEF_MINZOOM, AEF_MAXZOOM } from "./aeflayer.js";

// 프리페처가 동일 줌 범위를 써야 하므로 재노출(기존 import 경로 호환).
export { AEF_MINZOOM, AEF_MAXZOOM };

export class Viewer {
  constructor(container, initial) {
    this.year = initial.year;
    this.triple = null; // scrub.init에서 확정
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
    // idle = 요청한 모든 타일 렌더 완료 + 정적 상태. 프리페치를 이 신호로 구동하면
    // 보이는 타일 로드가 끝난 뒤에만 실행돼 콜드 로드와 대역폭 경쟁을 하지 않는다.
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
    // 레이어 재적용(setTiles)은 속성을 유지하지만, 최초 생성 직후엔 명시 적용 필요.
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

  // 밴드 조합/대비 변경 → 타일 URL 교체
  setRender(triple, range) {
    this.triple = triple;
    this.range = range;
    this._apply();
  }

  // 베이스맵 전환 → base 소스/레이어 재생성(AEF 레이어는 그대로 위에 유지).
  setBasemapTiles(tiles, attribution) {
    setMapBasemap(this.map, tiles, attribution);
  }

  // AlphaEarth 레이어 투명도(0..1) — base 위 raster-opacity.
  setOpacity(v) {
    this._opacity = v;
    if (this.map.getLayer && this.map.getLayer("aef")) {
      this.map.setPaintProperty("aef", "raster-opacity", v);
    }
  }

  // AlphaEarth 레이어 on/off — visibility(none이면 타일 요청도 중단).
  setVisible(on) {
    this._visible = on;
    if (this.map.getLayer && this.map.getLayer("aef")) {
      this.map.setLayoutProperty("aef", "visibility", on ? "visible" : "none");
    }
  }
}
