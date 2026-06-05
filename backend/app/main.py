"""AlphaEarth Viewer backend.

- /api/tiles : query intersecting COGs by bbox+year (DuckDB remote index)
- /cog/*     : TiTiler single-COG dynamic RGB tiles (bidx + rescale)
- /mosaicjson/* : TiTiler mosaic tiles (phase-2 seamless global zoom)

Band combo and rescale are all passed as TiTiler query parameters:
  /cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png
      ?url={cog}&bidx={r+1}&bidx={g+1}&bidx={b+1}&rescale=-0.3,0.3
"""

from __future__ import annotations

import contextlib
import os
import threading

from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .cache import TileCache
from .index import MAX_YEAR, MIN_YEAR, Tile, tiles_for_bbox, warmup

# Tile cache (memory LRU + disk). A front CDN is recommended in production.
TILE_CACHE = TileCache(
    mem_max=2048,
    disk_dir=os.environ.get("AEF_TILE_CACHE", os.path.join(os.getcwd(), "tiles_cache")),
)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the index table at startup (~4s). Removes the first-request latency.
    with contextlib.suppress(Exception):
        warmup()
    yield


app = FastAPI(title="AlphaEarth Viewer", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# --- mount TiTiler dynamic tile endpoints --------------------------------
# Guarded so the app still boots without titiler installed (e.g. index-query-only testing).
try:
    from titiler.core.factory import TilerFactory

    cog = TilerFactory(router_prefix="/cog")
    app.include_router(cog.router, prefix="/cog", tags=["COG"])

    try:
        from titiler.mosaic.factory import MosaicTilerFactory

        mosaic = MosaicTilerFactory(router_prefix="/mosaicjson")
        app.include_router(mosaic.router, prefix="/mosaicjson", tags=["Mosaic"])
    except Exception:  # titiler.mosaic not installed
        pass

    _TITILER = True
except Exception:  # titiler.core not installed
    _TITILER = False


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "titiler": _TITILER,
        "years": [MIN_YEAR, MAX_YEAR],
        "cache": TILE_CACHE.stats(),
    }


# --- single-flight: collapse concurrent duplicate renders of the same tile ----
# While scrubbing, the same tile gets cancelled/re-requested and the same render may
# start several times; a slow cold render then double-occupies browser connections
# (6 per host) and some tiles never finish. Only one leader renders; later identical
# requests wait for the leader and share from the cache.
_INFLIGHT: dict = {}
_INFLIGHT_LOCK = threading.Lock()

# The tile URL encodes z/x/y + year + bidx + rescale, so content is immutable per URL.
# -> safe to cache long-term. When the prefetcher's fetch() fills the browser cache with
# this header, later MapLibre <img> loads cost zero network (browser cache HIT). Use a CDN in prod too.
_CACHE_CONTROL = "public, max-age=86400, immutable"


def _tile_headers(x_cache: str) -> dict:
    return {"X-Cache": x_cache, "Cache-Control": _CACHE_CONTROL}


@app.get("/api/mosaic/tiles/{z}/{x}/{y}.png")
def mosaic_tile(
    z: int,
    x: int,
    y: int,
    year: int = Query(2024, ge=MIN_YEAR, le=MAX_YEAR),
    bidx: list[int] = Query(..., description="R,G,B bands (1-indexed) -- repeated 3x"),
    rescale: str = Query("-50,50", description="min,max (int8 scale)"),
) -> Response:
    """Index-based dynamic mosaic RGB tile. Responds instantly on cache hit."""
    rmin, rmax = (float(v) for v in rescale.split(","))
    key = TileCache.key("m", z, x, y, year, tuple(bidx), rmin, rmax)

    cached = TILE_CACHE.get(key)
    if cached is not None:
        return Response(cached, media_type="image/png", headers=_tile_headers("HIT"))

    # single-flight: if the same tile is already rendering, wait for it (leader/follower).
    with _INFLIGHT_LOCK:
        event = _INFLIGHT.get(key)
        leader = event is None
        if leader:
            event = threading.Event()
            _INFLIGHT[key] = event

    if not leader:
        event.wait(timeout=90)
        shared = TILE_CACHE.get(key)
        if shared is not None:
            return Response(shared, media_type="image/png", headers=_tile_headers("FOLLOW"))
        return Response(status_code=204, headers={"X-Cache": "EMPTY"})

    # leader: do the actual render (synchronous blocking -- runs in the threadpool since it's a def route)
    from .mosaic import render_tile

    try:
        png = render_tile(z, x, y, year, bidx, (rmin, rmax))
    except Exception as e:  # noqa: BLE001 -- a single tile failure becomes an empty tile
        print(f"render_tile failed z{z}/{x}/{y}: {e}")
        png = None
    finally:
        if png is not None:
            TILE_CACHE.put(key, png)
        with _INFLIGHT_LOCK:
            _INFLIGHT.pop(key, None)
        event.set()  # wake waiting followers

    if png is None:
        return Response(status_code=204, headers={"X-Cache": "EMPTY"})
    return Response(png, media_type="image/png", headers=_tile_headers("MISS"))


@app.get("/api/tiles", response_model=list[Tile])
def api_tiles(
    bbox: str = Query(..., description="west,south,east,north (WGS84)"),
    year: int = Query(2024, ge=MIN_YEAR, le=MAX_YEAR),
) -> list[Tile]:
    """Return the public COGs covering the current view bbox and year."""
    w, s, e, n = (float(x) for x in bbox.split(","))
    return tiles_for_bbox(year, w, s, e, n)
