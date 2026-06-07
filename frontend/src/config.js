// Backend endpoints (Vite dev proxy forwards to port 8000) and default values
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const TITILER_BASE = import.meta.env.VITE_TITILER_BASE ?? "";

export const DEFAULTS = {
  year: 2024,
  scrub: 7158, // gray-code index → [A01,A16,A09] (EE example combo, colorful default)
  // source.coop COG is int8 (-128..127, nodata=-128). EE float ±0.3 ≈ int8 ±38.
  // Empirically ±50 yields the richest detail (most distinct pixel values).
  min: -50,
  max: 50,
  // Initial view: Seoul (confirmed to have data in the index)
  lng: 126.98,
  lat: 37.56,
  zoom: 10,
  // Compare (swipe) mode state — serialized to URL only when different from defaults.
  compare: 0, // 0/1
  swipe: 0.5, // split divider position (0..1)
  bYear: 2024, // side B: year
  bScrub: 7158, // side B: band combo (gray-code index)
  bMin: -50, // side B: contrast min
  bMax: 50, // side B: contrast max
};

export const YEAR_RANGE = [2017, 2025];

// Esri World Imagery Wayback: map each AEF year to the latest Wayback release in that
// calendar year, so the satellite basemap can track the selected year.
// Hardcoded (past releases are immutable) to avoid a runtime config fetch + CORS.
// Source: https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
const WAYBACK_RELEASE = {
  2017: 25521, 2018: 23448, 2019: 4756, 2020: 29260,
  2021: 26120, 2022: 45134, 2023: 56102, 2024: 16453, 2025: 13192,
};
const WAYBACK_YEARS = Object.keys(WAYBACK_RELEASE).map(Number);

function waybackRelease(year) {
  if (WAYBACK_RELEASE[year]) return WAYBACK_RELEASE[year];
  // out of range → nearest available year
  const nearest = WAYBACK_YEARS.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
  return WAYBACK_RELEASE[nearest];
}

// Satellite tiles for a given year (per-tile redirect to the deduped release is handled by the server).
export function satelliteTiles(year) {
  const rel = waybackRelease(year);
  return [
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/{z}/{y}/{x}`,
  ];
}

// Basemaps: key-free public raster tiles (for demo). Replace in production as needed.
// Switched at runtime via setTiles on the base source (Esri uses {z}/{y}/{x} order).
// satellite is yearAware: its tiles are resolved per selected year via satelliteTiles().
export const BASEMAPS = {
  dark: {
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
    attribution: "© CARTO",
  },
  satellite: {
    tiles: satelliteTiles(DEFAULTS.year), // initial-frame fallback; refined per year at runtime
    attribution: "© Esri Wayback · Maxar, Earthstar Geographics",
    yearAware: true,
  },
  voyager: {
    tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors, © CARTO",
  },
};

// Default basemap key (when not stored in localStorage) + initial style tiles for maps A/B.
export const DEFAULT_BASEMAP = "satellite";
export const BASEMAP_TILES = BASEMAPS[DEFAULT_BASEMAP].tiles;
