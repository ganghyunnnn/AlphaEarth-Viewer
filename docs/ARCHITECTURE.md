# Architecture

## 1. Goals and differentiators

| Aspect | Existing tools (geoai/leafmap, edgeoinnovations) | This project |
|------|------|------|
| Backend | Google Earth Engine | Public COGs (source.coop) |
| User auth | EE account required | **None** |
| Runtime | Jupyter/Colab ipywidgets | Deployable standalone web app |
| Band selection | 3 × R/G/B dropdowns | **Single gray-code scrub bar** |
| Sharing combos | None | URL permalink |

## 2. Data layer

The AlphaEarth COGs are published on Source Cooperative (`tge-labs/aef`).

- Base URL: `https://data.source.coop/tge-labs/aef/v1/annual`
- Spatial index: `{base}/aef_index.parquet` (≈77.8 MB, CORS `*`, HTTP Range supported)
- Index schema (key columns): `path` (s3 URI), `year` (2017–2025), `utm_zone`, `crs` (EPSG:326xx),
  `wgs84_{west,south,east,north}`, `geom` (polygon). 302,466 rows.
- COG: 64 bands (A00 = band 1 … A63 = band 64), 8192×8192 px, 10 m, UTM projection. Internal overviews.
  - **Storage dtype = int8** (−128..127), `scales=1/offsets=0`, **nodata = −128**.
    EE float `±0.3` ≈ int8 `±38`. Live testing showed that using `-0.3,0.3` directly yields only
    3 distinct pixel values (saturated) → **default rescale `-50,50`** (~100 distinct values, richest
    detail). The sliders also use the int8 range.
- COG URL rewrite: `s3://us-west-2.opendata.source.coop` → `https://data.source.coop`.

### bbox query
The bbox columns alone are sufficient (no spatial extension needed):
```sql
SELECT path, utm_zone, wgs84_west, wgs84_south, wgs84_east, wgs84_north
FROM read_parquet('{index}')
WHERE year = ?
  AND wgs84_west  < :east  AND wgs84_east  > :west
  AND wgs84_south < :north AND wgs84_north > :south
```
DuckDB httpfs queries the parquet via remote range reads, so the index doesn't need to be local.
In production, cache a slim per-year index (GeoParquet/FlatGeobuf) to cut latency.

## 3. Tile rendering layer (TiTiler)

Each COG is UTM-projected, so TiTiler reprojects on the fly for Web Mercator tile requests.

- Single COG: `GET /cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url={cog}&bidx={r}&bidx={g}&bidx={b}&rescale={min},{max}`
  - TiTiler bands are **1-indexed**: A_n → `bidx = n + 1`.
- Global mosaic: build a per-year MosaicJSON from the index and serve
  `GET /mosaicjson/tiles/{z}/{x}/{y}.png?...&bidx=...`, picking the right COG per tile.
  - Band combo (bidx) and rescale are query parameters, so the mosaic itself only needs to be built/cached once per year.

### Phased implementation
- **MVP (phase 1)**: query `/api/tiles` with the current view bbox + year → add the intersecting COGs as MapLibre raster sources. Tile count is capped at low (world) zooms.
- **Phase 2**: build per-year MosaicJSON + TiTiler mosaic endpoint for seamless global zoom.

## 4. Band scrub (gray-code)

`frontend/src/graycode.js` converts bidirectionally between a single scrub index `i ∈ [0, 64³)` and an
RGB band triple `(r,g,b)`. It's a reflected n-ary gray code, so `i` and `i+1` differ by exactly ±1 band
in a single channel.

- No backend precomputation — the conversion is a closed-form formula.
- Degenerate frames (R=G, etc.) are allowed by default (maximum smoothness); a "skip" toggle excludes them when stepping.
- Auxiliary UI: thumbnail filmstrip (jump), 📌 bookmarks (compare/share), ▶ play (auto-morph), URL permalink.

### Performance
To avoid re-requesting tiles every frame while scrubbing: debounce during drag (~150 ms) + low-resolution
preview, then full resolution on release. A CDN / tile cache accelerates repeated combos.

## 5. URL state (permalink)

The full state is serialized as `?scrub=<i>&year=<Y>&min=<m>&max=<M>&lng=<>&lat=<>&zoom=<z>`
(plus `compare`, `swipe`, and the `b*` keys for side B) to share and reproduce a view. Default values are
omitted to keep the URL compact.
