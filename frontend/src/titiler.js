// Build TiTiler dynamic RGB tile URLs.
import { TITILER_BASE, API_BASE } from "./config.js";
import { toBidx } from "./graycode.js";

// Tile URL template for a single COG, for a MapLibre raster source.
//   triple = [r, g, b] (band indices 0..63), range = {min, max}
export function cogTileUrl(cogUrl, triple, range) {
  const [r, g, b] = triple;
  const p = new URLSearchParams();
  p.set("url", cogUrl);
  p.append("bidx", String(toBidx(r)));
  p.append("bidx", String(toBidx(g)));
  p.append("bidx", String(toBidx(b)));
  // a single rescale -> applied to all three bands
  p.append("rescale", `${range.min},${range.max}`);
  // PNG to represent the embedding's negative values (sign handled by rescale -> 0..255 mapping)
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${p.toString()}`;
}

// Tile URL template for the index-based dynamic mosaic (single global source).
//   triple = [r,g,b] (0..63), range = {min,max} (int8 scale)
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

// Query the COGs covering the current view bbox + year (for the single-COG path; debug/alternative)
export async function fetchTiles(bbox, year) {
  const [w, s, e, n] = bbox;
  const u = `${API_BASE}/api/tiles?bbox=${w},${s},${e},${n}&year=${year}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`/api/tiles ${res.status}`);
  return res.json(); // [{path, utm_zone, crs, bbox}]
}
