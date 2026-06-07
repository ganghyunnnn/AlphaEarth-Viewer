# AlphaEarth Viewer

English | [한국어](README.ko.md)

Explore the 64-dimensional **AlphaEarth** satellite embeddings (Google Satellite Embedding V1) as RGB imagery, right in the browser — **no Google Earth Engine, no login**. One Docker command and you're exploring.

![AlphaEarth Viewer](docs/screenshot.png)

## What it does

Each pixel carries 64 embedding bands (A00–A63). Pick any 3 for R/G/B — but instead of three dropdowns, drag **one scrub bar** that sweeps all 64³ = 262,144 combinations in **reflected gray-code** order, so neighboring frames differ by a single band and the map morphs smoothly. A discovery tool and a presentation tool in one.

## Quick start

```bash
docker compose up --build      # → http://localhost:8080
```

nginx serves the frontend and proxies a FastAPI + TiTiler backend that renders RGB tiles on the fly from public COGs on Source Cooperative (`tge-labs/aef`). Rendered tiles are cached to a named volume.

> Built for **local / intranet** use. Before exposing it publicly, restrict the raw `/cog/*` endpoint (arbitrary-URL SSRF) and cap the disk tile cache (no eviction).

## Features

| | |
|---|---|
| 🎚️ **Gray-code scrub** | Sweep 262k band combos; or type R/G/B bands or the combo index directly |
| 🪟 **Compare mode** | Split-screen swipe — two combos/years side by side |
| 🔍 **Search** | Place name (OSM / Nominatim) or `lat, lng` |
| 🗺️ **Basemaps** | Satellite (default, year-aware via Esri Wayback) / Dark / OSM |
| 🌫️ **Opacity & on/off** | Blend the embedding over the basemap, or hide it entirely |
| 🌐 **EN / 한국어** · 🔗 **Permalink** | Language toggle and shareable URL state |

## Data

AlphaEarth Foundations Satellite Embeddings (`tge-labs/aef`) — annual 2017–2025, 10 m, 64 bands, global (302,466 COG tiles). Stored as **int8**; default contrast `−50…50` (≈ EE float `±0.4`).

## Development

```bash
# frontend
cd frontend && npm install && npm run dev      # vite proxies /api → :8000

# backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000

# gray-code tests (no deps)
node frontend/test/graycode.test.mjs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## License

[MIT](LICENSE)
