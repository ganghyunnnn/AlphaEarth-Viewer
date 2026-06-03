// MapLibre 지도 + AlphaEarth 단일 모자이크 레이어.
// 백엔드 /api/mosaic/tiles 가 타일마다 인덱스로 교차 COG를 찾아 병합하므로,
// 프론트는 단 하나의 raster 소스만 관리한다(전 지구 줌). 밴드/연도/대비 변경 시
// 타일 URL만 교체(setTiles)하면 되고, 뷰 이동 시 별도 재질의가 필요 없다.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_TILES } from "./config.js";
import { mosaicTileUrl } from "./titiler.js";

const AEF_SRC = "aef";
// COG가 10m라 z14~15가 native. 저줌은 타일당 COG 수 폭증 → minzoom으로 차단.
// 프리페처도 동일 줌 범위를 써야 하므로 export.
export const AEF_MINZOOM = 7;
export const AEF_MAXZOOM = 15;

export class Viewer {
  constructor(container, initial) {
    this.year = initial.year;
    this.triple = null; // scrub.init에서 확정
    this.range = { min: initial.min, max: initial.max };

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
    if (!this.triple) return;
    const url = mosaicTileUrl(this.year, this.triple, this.range);
    const src = this.map.getSource(AEF_SRC);
    if (src) {
      src.setTiles([url]); // 밴드/연도/대비 변경 — URL만 교체
      return;
    }
    this.map.addSource(AEF_SRC, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      minzoom: AEF_MINZOOM,
      maxzoom: AEF_MAXZOOM,
      attribution: "AlphaEarth / Source Cooperative (tge-labs/aef)",
    });
    this.map.addLayer({ id: AEF_SRC, type: "raster", source: AEF_SRC });
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
}
