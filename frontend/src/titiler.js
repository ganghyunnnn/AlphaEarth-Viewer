// TiTiler 동적 RGB 타일 URL 구성.
import { TITILER_BASE, API_BASE } from "./config.js";
import { toBidx } from "./graycode.js";

// 단일 COG에 대한 MapLibre raster source용 타일 URL 템플릿.
//   triple = [r, g, b] (밴드 인덱스 0..63), range = {min, max}
export function cogTileUrl(cogUrl, triple, range) {
  const [r, g, b] = triple;
  const p = new URLSearchParams();
  p.set("url", cogUrl);
  p.append("bidx", String(toBidx(r)));
  p.append("bidx", String(toBidx(g)));
  p.append("bidx", String(toBidx(b)));
  // rescale 한 번 지정 → 세 밴드 모두에 적용
  p.append("rescale", `${range.min},${range.max}`);
  // 임베딩 음수값 표현을 위해 PNG(부호 처리는 rescale로 0..255 매핑)
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${p.toString()}`;
}

// 인덱스 기반 동적 모자이크 타일 URL 템플릿(전 지구 단일 소스).
//   triple = [r,g,b] (0..63), range = {min,max} (int8 스케일)
export function mosaicTileUrl(year, triple, range) {
  const [r, g, b] = triple;
  const p = new URLSearchParams();
  p.set("year", String(year));
  p.append("bidx", String(toBidx(r)));
  p.append("bidx", String(toBidx(g)));
  p.append("bidx", String(toBidx(b)));
  p.append("rescale", `${range.min},${range.max}`);
  return `${API_BASE}/api/mosaic/tiles/{z}/{x}/{y}.png?${p.toString()}`;
}

// 현재 뷰 bbox + year를 덮는 COG 목록 질의(단일 COG 경로용, 디버그/대안)
export async function fetchTiles(bbox, year) {
  const [w, s, e, n] = bbox;
  const u = `${API_BASE}/api/tiles?bbox=${w},${s},${e},${n}&year=${year}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`/api/tiles ${res.status}`);
  return res.json(); // [{path, utm_zone, crs, bbox}]
}
