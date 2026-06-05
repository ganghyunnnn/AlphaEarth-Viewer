// Shared helper for attaching the AlphaEarth dynamic mosaic raster layer to a map instance.
// Used by both the single viewer (viewer.js) and the compare-mode B map (compare.js).
import { mosaicTileUrl } from "./titiler.js";

export const AEF_SRC = "aef";
// COG resolution is 10 m, so z14–15 is native. At low zoom, COG count per tile explodes → blocked by minzoom.
export const AEF_MINZOOM = 7;
export const AEF_MAXZOOM = 15;

// Minimal style (basemap only). Shared by map A and B.
export function baseStyle(basemapTiles) {
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: basemapTiles, tileSize: 256, attribution: "© CARTO" },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

// Execute fn once the style is ready for source/layer manipulation.
// Note: once("load") fires only once, so calling after load means the callback never fires.
// isStyleLoaded() can also return false while sources are loading, so poll via styledata until ready.
export function whenStyleReady(map, fn) {
  // The styledata event fires only while isStyleLoaded=false, and may not fire at the final
  // ready moment, causing the callback to be missed. Use short-interval polling to catch it reliably.
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

// Basemap switch: recreate the base source/layer to ensure new tiles are loaded.
// (RasterTileSource.setTiles may not immediately refresh already-loaded tiles in all browsers,
//  which can cause A and B to show different basemaps. Using the same helper for both maps A and B
//  keeps them always in sync.)
// The base layer is always re-inserted below the aef layer.
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

// Apply the AEF source/layer to the map (create if absent, otherwise swap tile URL only).
//   render = {year, triple, range:{min,max}}
export function applyAef(map, render) {
  const { year, triple, range } = render;
  if (!triple) return;
  const url = mosaicTileUrl(year, triple, range);
  const src = map.getSource(AEF_SRC);
  if (src) {
    src.setTiles([url]); // band/year/contrast change — swap URL only
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
