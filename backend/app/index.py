"""AlphaEarth COG 공간 인덱스(aef_index.parquet) 질의.

source.coop의 원격 parquet를 DuckDB httpfs로 직접(HTTP range) 질의한다.
인덱스를 로컬에 둘 필요가 없으며, 연결/extension 로드는 1회만 수행한다.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import List

import duckdb
from pydantic import BaseModel

AEF_BASE_URL = "https://data.source.coop/tge-labs/aef/v1/annual"
AEF_INDEX_URL = f"{AEF_BASE_URL}/aef_index.parquet"

# COG URL 변환용 (s3 -> https)
_S3_PREFIX = "s3://us-west-2.opendata.source.coop"
_HTTPS_PREFIX = "https://data.source.coop"

MIN_YEAR, MAX_YEAR = 2017, 2025

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()


def _connection() -> duckdb.DuckDBPyConnection:
    """필요한 컬럼만 로컬 테이블로 1회 적재한 단일 연결(스레드 세이프).

    원격 parquet를 매 질의 스캔하면 콜드 지연이 ~5s에 달한다. 시작 시
    필요한 컬럼(~302k행)만 메모리 테이블로 적재(≈4s)하면 이후 bbox 질의가 ~10ms.
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
    """인덱스 테이블을 미리 적재(앱 startup에서 호출). 행 수 반환."""
    return _connection().execute("SELECT count(*) FROM aef_index").fetchone()[0]


def to_https(path: str) -> str:
    """인덱스의 s3:// path를 공개 https COG URL로 변환."""
    return path.replace(_S3_PREFIX, _HTTPS_PREFIX)


class Tile(BaseModel):
    path: str  # 공개 https COG URL
    utm_zone: str
    crs: str
    bbox: List[float]  # [west, south, east, north] (WGS84)


@lru_cache(maxsize=512)
def _query(year: int, west: float, south: float, east: float, north: float) -> tuple:
    """bbox(WGS84) + year로 교차하는 COG 행을 질의. 결과는 캐시."""
    sql = """
        SELECT path, utm_zone, crs,
               wgs84_west, wgs84_south, wgs84_east, wgs84_north
        FROM aef_index
        WHERE year = ?
          AND wgs84_west  < ? AND wgs84_east  > ?
          AND wgs84_south < ? AND wgs84_north > ?
    """
    rows = _connection().execute(sql, [year, east, west, north, south]).fetchall()
    return tuple(rows)


def tiles_for_bbox(
    year: int, west: float, south: float, east: float, north: float
) -> List[Tile]:
    """주어진 bbox/연도를 덮는 COG 타일 목록."""
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
