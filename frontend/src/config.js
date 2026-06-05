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

// Basemaps: key-free public raster tiles (for demo). Replace in production as needed.
// Switched at runtime via setTiles on the base source (Esri uses {z}/{y}/{x} order).
export const BASEMAPS = {
  dark: {
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
    attribution: "© CARTO",
  },
  satellite: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "© Esri, Maxar, Earthstar Geographics",
  },
  osm: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
  },
};

// Default basemap key (when not stored in localStorage) + initial style tiles for maps A/B.
export const DEFAULT_BASEMAP = "satellite";
export const BASEMAP_TILES = BASEMAPS[DEFAULT_BASEMAP].tiles;
