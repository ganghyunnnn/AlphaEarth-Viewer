"""Index-based dynamic mosaic tile rendering.

Instead of pre-building a giant MosaicJSON, find the intersecting COGs per tile via the
spatial index (DuckDB) and merge them on the fly. Feasible because our index query is ~10ms.
The frontend uses a single source (/api/mosaic/tiles), so global zoom is seamless.

Performance strategy (settled by measurement):
  1) Avoid WarpedVRT — rio_tiler.Reader.tile() builds a WarpedVRT (UTM->3857) per COG, so a
     cold z11 tile takes ~19s. "Decimated window read from the native overview -> in-memory
     reproject" is ~5s (~4x faster; reprojection is 0.006s, the cost is the network read).
     Adding CPU threads makes it worse (network-bound) -> a software-only path is optimal.
  2) Band-tile cache (key) — the bottleneck is the remote COG overview-block HTTP fetch
     (bandwidth-limited ~3.4MB/s). A gray-code scrub step changes only 1 of the 3 bands.
     Reading per band and caching by (cog,band,z,x,y) means 2 bands HIT and only 1 is fetched
     per step -> ~3x cheaper scrub. The first render reads the uncached bands in one ds.read
     to avoid per-band open cost.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Dict, List, Optional, Sequence, Tuple

import morecantile
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window
from rio_tiler.models import ImageData

from .index import tiles_for_bbox

TMS = morecantile.tms.get("WebMercatorQuad")
DST_CRS = CRS.from_epsg(3857)
TILESIZE = 256
NODATA = -128  # AEF int8 nodata (valid data never takes this value)

# Mosaicking hundreds~thousands of COGs at low (wide) zooms is very slow.
# If a tile covers more COGs than this, return an empty tile (the frontend blocks low zoom via minzoom).
MAX_COGS_PER_TILE = 24

# --- band-tile memory cache ------------------------------------------------
# key=(cog_url, band, z, x, y) -> 256^2 int8 array (reprojected) | None (no intersection)
# The valid mask is derived from arr != NODATA (not stored separately -> 64KB/entry).
_BAND_CACHE: "OrderedDict[tuple, Optional[np.ndarray]]" = OrderedDict()
_BAND_CACHE_MAX = 3000  # ~=192MB
_BAND_LOCK = threading.Lock()
_MISS = object()  # cache-miss sentinel


def _cache_get(key: tuple):
    with _BAND_LOCK:
        if key in _BAND_CACHE:
            _BAND_CACHE.move_to_end(key)
            return _BAND_CACHE[key]
        return _MISS


def _cache_put(key: tuple, val: Optional[np.ndarray]) -> None:
    with _BAND_LOCK:
        _BAND_CACHE[key] = val
        _BAND_CACHE.move_to_end(key)
        while len(_BAND_CACHE) > _BAND_CACHE_MAX:
            _BAND_CACHE.popitem(last=False)


def _tile_window(ds, t_w, t_s, t_e, t_n) -> Optional[Window]:
    """Compute the read window from the tile's source-CRS bounds. None if no intersection."""
    db = ds.bounds
    d_w, d_e = min(db.left, db.right), max(db.left, db.right)
    d_s, d_n = min(db.bottom, db.top), max(db.bottom, db.top)
    if t_e <= d_w or t_w >= d_e or t_n <= d_s or t_s >= d_n:
        return None
    inv = ~ds.transform
    c0, r0 = inv * (t_w, t_n)
    c1, r1 = inv * (t_e, t_s)
    return Window(min(c0, c1), min(r0, r1), abs(c1 - c0), abs(r1 - r0))


def _read_bands(
    asset: str, bands: Sequence[int], x: int, y: int, z: int
) -> Optional[Dict[int, np.ndarray]]:
    """Read several bands at once from the COG's native overview and reproject to 3857.

    Returns: {band: 256^2 int8 array}. None if it doesn't intersect the tile.
    Reads multiple bands together to bundle the network cost into one ds.read.
    """
    tile = morecantile.commons.Tile(x, y, z)
    xb = TMS.xy_bounds(tile)  # 3857
    w, s, e, n = xb.left, xb.bottom, xb.right, xb.top

    with rasterio.open(asset) as ds:
        b = transform_bounds(DST_CRS, ds.crs, w, s, e, n, densify_pts=21)
        t_w, t_e = min(b[0], b[2]), max(b[0], b[2])
        t_s, t_n = min(b[1], b[3]), max(b[1], b[3])
        win = _tile_window(ds, t_w, t_s, t_e, t_n)
        if win is None:
            return None
        data = ds.read(
            list(bands),
            window=win,
            out_shape=(len(bands), TILESIZE, TILESIZE),
            resampling=Resampling.bilinear,
            boundless=True,
            fill_value=NODATA,
        )
        # Transform of the decimated 256^2 array: scale window_transform (preserves sign/direction).
        wt = ds.window_transform(win)
        src_t = wt * Affine.scale(win.width / TILESIZE, win.height / TILESIZE)
        src_crs = ds.crs

    dst_t = transform_from_bounds(w, s, e, n, TILESIZE, TILESIZE)
    out = np.full((len(bands), TILESIZE, TILESIZE), NODATA, dtype=data.dtype)
    reproject(
        data, out,
        src_transform=src_t, src_crs=src_crs,
        dst_transform=dst_t, dst_crs=DST_CRS,
        resampling=Resampling.bilinear,
        src_nodata=NODATA, dst_nodata=NODATA, num_threads=2,
    )
    return {band: out[i] for i, band in enumerate(bands)}


def cogs_for_tile(z: int, x: int, y: int, year: int) -> List[str]:
    """List of COG URLs covering the given Web Mercator tile (index query)."""
    bb = TMS.bounds(morecantile.commons.Tile(x, y, z))  # WGS84 (left,bottom,right,top)
    return [t.path for t in tiles_for_bbox(year, bb.left, bb.bottom, bb.right, bb.top)]


def render_tile(
    z: int,
    x: int,
    y: int,
    year: int,
    indexes: Sequence[int],
    rescale: Tuple[float, float],
) -> Optional[bytes]:
    """Render an RGB PNG tile. None (empty tile) if no COG covers it.

    Looks up the (cog,band,z,x,y) cache per band and reads only the uncached bands.
    When several COGs cover one tile, composite per band as first-valid (mosaic).
    """
    cogs = cogs_for_tile(z, x, y, year)
    if not cogs or len(cogs) > MAX_COGS_PER_TILE:
        return None

    uniq = list(dict.fromkeys(indexes))  # dedupe bands (channels may share a band)
    composited: Dict[int, np.ndarray] = {b: np.full((TILESIZE, TILESIZE), NODATA, np.int8) for b in uniq}
    covered: Dict[int, np.ndarray] = {b: np.zeros((TILESIZE, TILESIZE), bool) for b in uniq}

    for cog in cogs:
        pending = [b for b in uniq if not covered[b].all()]
        if not pending:
            break

        # Cache lookup -> read only the missing bands in one go
        avail: Dict[int, Optional[np.ndarray]] = {}
        miss: List[int] = []
        for b in pending:
            v = _cache_get((cog, b, z, x, y))
            if v is _MISS:
                miss.append(b)
            else:
                avail[b] = v  # ndarray or None (no intersection)
        if miss:
            read = _read_bands(cog, miss, x, y, z)
            for b in miss:
                arr = None if read is None else read[b]
                _cache_put((cog, b, z, x, y), arr)
                avail[b] = arr

        # First-valid composite per band
        for b in pending:
            arr = avail.get(b)
            if arr is None:
                continue
            valid = arr != NODATA
            fill = (~covered[b]) & valid
            composited[b][fill] = arr[fill]
            covered[b] |= valid

    if not any(covered[b].any() for b in uniq):
        return None

    stack = np.stack([composited[b] for b in indexes])  # (nb, 256, 256) -- in `indexes` order
    mask2d = np.all(stack == NODATA, axis=0)
    arr = np.ma.MaskedArray(stack, mask=np.broadcast_to(mask2d, stack.shape))

    tile = morecantile.commons.Tile(x, y, z)
    xb = TMS.xy_bounds(tile)
    img = ImageData(arr, crs=DST_CRS, bounds=(xb.left, xb.bottom, xb.right, xb.top))
    img = img.rescale(in_range=[tuple(rescale)] * len(indexes))
    return img.render(img_format="PNG")
