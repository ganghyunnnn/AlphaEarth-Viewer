"""Query the AlphaEarth COG spatial index (aef_index.parquet).

Queries source.coop's remote parquet directly (HTTP range) via DuckDB httpfs.
No need to keep the index locally; the connection/extension load happens once.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import List

import duckdb
from pydantic import BaseModel

AEF_BASE_URL = "https://data.source.coop/tge-labs/aef/v1/annual"
AEF_INDEX_URL = f"{AEF_BASE_URL}/aef_index.parquet"

# For COG URL rewriting (s3 -> https)
_S3_PREFIX = "s3://us-west-2.opendata.source.coop"
_HTTPS_PREFIX = "https://data.source.coop"

MIN_YEAR, MAX_YEAR = 2017, 2025

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()
# A single DuckDB connection is not safe for concurrent .execute() calls (result sets
# overwrite each other -> empty result -> cogs=0 -> empty tile). Queries hit an in-memory
# table (~10ms), so serializing them is harmless (the bottleneck is network tile reads).
# All queries are guarded by this lock.
_query_lock = threading.Lock()


def _connection() -> duckdb.DuckDBPyConnection:
    """A single connection that loads only the needed columns once into a local table (thread-safe).

    Scanning the remote parquet on every query costs ~5s cold. Loading just the needed
    columns (~302k rows) into an in-memory table at startup (~4s) makes subsequent bbox
    queries ~10ms.
    """
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                c = duckdb.connect()
                c.execute("INSTALL httpfs; LOAD httpfs;")
                c.execute(
                    f"""
                    CREATE TABLE aef_index AS
                    SELECT path, utm_zone, crs, year,
                           wgs84_west, wgs84_south, wgs84_east, wgs84_north
                    FROM read_parquet('{AEF_INDEX_URL}')
                    """
                )
                _conn = c
    return _conn


def warmup() -> int:
    """Preload the index table (call from app startup). Returns the row count."""
    return _connection().execute("SELECT count(*) FROM aef_index").fetchone()[0]


def to_https(path: str) -> str:
    """Rewrite the index's s3:// path to a public https COG URL."""
    return path.replace(_S3_PREFIX, _HTTPS_PREFIX)


class Tile(BaseModel):
    path: str  # public https COG URL
    utm_zone: str
    crs: str
    bbox: List[float]  # [west, south, east, north] (WGS84)


@lru_cache(maxsize=512)
def _query(year: int, west: float, south: float, east: float, north: float) -> tuple:
    """Query COG rows intersecting bbox (WGS84) + year. Result is cached."""
    sql = """
        SELECT path, utm_zone, crs,
               wgs84_west, wgs84_south, wgs84_east, wgs84_north
        FROM aef_index
        WHERE year = ?
          AND wgs84_west  < ? AND wgs84_east  > ?
          AND wgs84_south < ? AND wgs84_north > ?
    """
    conn = _connection()
    with _query_lock:
        rows = conn.execute(sql, [year, east, west, north, south]).fetchall()
    return tuple(rows)


def tiles_for_bbox(
    year: int, west: float, south: float, east: float, north: float
) -> List[Tile]:
    """List of COG tiles covering the given bbox/year."""
    if not (MIN_YEAR <= year <= MAX_YEAR):
        raise ValueError(f"year must be in [{MIN_YEAR}, {MAX_YEAR}]")
    out: List[Tile] = []
    for path, utm_zone, crs, w, s, e, n in _query(year, west, south, east, north):
        out.append(
            Tile(
                path=to_https(path),
                utm_zone=utm_zone,
                crs=crs,
                bbox=[w, s, e, n],
            )
        )
    return out
