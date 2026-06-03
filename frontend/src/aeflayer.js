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
