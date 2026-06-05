"""Self-healing PROJ/GDAL data paths.

On some Windows setups the global PROJ_LIB/GDAL_DATA point at PostgreSQL/PostGIS's
(older) proj.db, which clashes with rasterio's bundled PROJ (`DATABASE.LAYOUT.VERSION` error).
Import this module before rasterio so the bundled data paths win.
"""

from __future__ import annotations

import importlib.util
import os


def _fix() -> None:
    # Locate rasterio without "running" it. The env vars must be fixed before PROJ
    # caches a wrong path at import time.
    spec = importlib.util.find_spec("rasterio")
    if not spec or not spec.origin:
        return
    rio_dir = os.path.dirname(spec.origin)
    proj_data = os.path.join(rio_dir, "proj_data")
    gdal_data = os.path.join(rio_dir, "gdal_data")

    if os.path.exists(os.path.join(proj_data, "proj.db")):
        # Force the bundled path even if global env vars point elsewhere
        os.environ["PROJ_LIB"] = proj_data
        os.environ["PROJ_DATA"] = proj_data
    if os.path.isdir(gdal_data):
        os.environ["GDAL_DATA"] = gdal_data


# COG-over-HTTP performance tuning (recommended by rio-tiler/titiler). Respect already-set values.
_GDAL_HTTP_TUNING = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",  # skip needless directory listing (key)
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_HTTP_VERSION": "2",
    "GDAL_BAND_BLOCK_CACHE": "HASHSET",
    "GDAL_CACHEMAX": "256",  # MB
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "10000000",  # 10MB/file
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff",
    "CPL_VSIL_CURL_CACHE_SIZE": "200000000",  # 200MB global range cache
    # Stall prevention (key): without timeout/retry, a remote connection that stalls
    # under concurrent bursts makes a tile render hang forever -> holds a browser
    # connection -> "some tiles never finish loading".
    "GDAL_HTTP_TIMEOUT": "30",  # total timeout per HTTP request (seconds)
    "GDAL_HTTP_CONNECTTIMEOUT": "10",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "0.5",
    "GDAL_HTTP_LOW_SPEED_LIMIT": "1000",  # below 1KB/s
    "GDAL_HTTP_LOW_SPEED_TIME": "8",  # for 8s -> drop and retry (kills trickling stalls)
}


def _tune_gdal() -> None:
    for k, v in _GDAL_HTTP_TUNING.items():
        os.environ.setdefault(k, v)


_fix()
_tune_gdal()
