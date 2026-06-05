// 맵 인스턴스에 AlphaEarth 동적 모자이크 raster 레이어를 얹는 공유 헬퍼.
// 단일 뷰어(viewer.js)와 비교 모드의 B 맵(compare.js)이 같은 로직을 공유한다.
import { mosaicTileUrl } from "./titiler.js";

export const AEF_SRC = "aef";
// COG가 10m라 z14~15가 native. 저줌은 타일당 COG 수 폭증 → minzoom으로 차단.
export const AEF_MINZOOM = 7;
export const AEF_MAXZOOM = 15;

// 빈 스타일(베이스맵만). 맵 A/B 공통.
export function baseStyle(basemapTiles) {
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: basemapTiles, tileSize: 256, attribution: "© CARTO" },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

// 스타일이 소스/레이어 조작 가능한 상태가 되면 fn 실행.
// 주의: once("load")는 최초 1회뿐이라, 로드 후 호출 시 콜백이 영영 안 불린다.
// isStyleLoaded()도 소스 로딩 중 false가 될 수 있으므로 styledata로 준비될 때까지 폴링.
export function whenStyleReady(map, fn) {
  // styledata 이벤트는 로딩 중(isStyleLoaded=false)에만 발생하고 최종 준비 순간엔
  // 다시 안 뜨는 경우가 있어 콜백을 놓친다. 짧은 타이머 폴링으로 확실히 잡는다.
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const id = setInterval(() => {
    if (!map.isStyleLoaded()) return;
    clearInterval(id);
    fn();
  }, 50);
}

// 베이스맵 전환: base 소스/레이어를 재생성해 확실히 새 타일을 로드한다.
// (RasterTileSource.setTiles는 브라우저에 따라 이미 로드된 타일을 즉시 새로고침하지
//  않아 A/B가 서로 다른 베이스맵으로 보일 수 있다. 맵 A·B가 같은 헬퍼를 쓰므로 항상 일치.)
// base 레이어는 항상 aef 레이어 아래에 재삽입한다.
export function setBasemap(map, tiles, attribution = "") {
  const run = () => {
    if (map.getLayer("base")) map.removeLayer("base");
    if (map.getSource("base")) map.removeSource("base");
    map.addSource("base", { type: "raster", tiles, tileSize: 256, attribution });
    map.addLayer(
      { id: "base", type: "raster", source: "base" },
      map.getLayer("aef") ? "aef" : undefined,
    );
  };
  whenStyleReady(map, run);
}

// 맵에 AEF 소스/레이어를 적용(없으면 생성, 있으면 타일 URL만 교체).
//   render = {year, triple, range:{min,max}}
export function applyAef(map, render) {
  const { year, triple, range } = render;
  if (!triple) return;
  const url = mosaicTileUrl(year, triple, range);
  const src = map.getSource(AEF_SRC);
  if (src) {
    src.setTiles([url]); // 밴드/연도/대비 변경 — URL만 교체
    return;
  }
  map.addSource(AEF_SRC, {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    minzoom: AEF_MINZOOM,
    maxzoom: AEF_MAXZOOM,
    attribution: "AlphaEarth / Source Cooperative (tge-labs/aef)",
  });
  map.addLayer({ id: AEF_SRC, type: "raster", source: AEF_SRC });
}
