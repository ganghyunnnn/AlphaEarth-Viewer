"""alphaearth-vis 백엔드.

- /api/tiles : bbox+year로 교차 COG 목록 질의 (DuckDB 원격 인덱스)
- /cog/*     : TiTiler 단일 COG 동적 RGB 타일 (bidx + rescale)
- /mosaicjson/* : TiTiler 모자이크 타일 (2단계 전 지구 매끄러운 줌)

밴드 조합과 rescale은 모두 TiTiler 쿼리 파라미터로 전달된다:
  /cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png
      ?url={cog}&bidx={r+1}&bidx={g+1}&bidx={b+1}&rescale=-0.3,0.3
"""

from __future__ import annotations

import contextlib
import os

from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .cache import TileCache
from .index import MAX_YEAR, MIN_YEAR, Tile, tiles_for_bbox, warmup

# 타일 캐시(메모리 LRU + 디스크). 운영 시 앞단 CDN 권장.
TILE_CACHE = TileCache(
    mem_max=2048,
    disk_dir=os.environ.get("AEF_TILE_CACHE", os.path.join(os.getcwd(), "tiles_cache")),
)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시 인덱스 테이블 적재(≈4s). 첫 사용자 요청 지연 제거.
    with contextlib.suppress(Exception):
        warmup()
    yield


app = FastAPI(title="alphaearth-vis", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# --- TiTiler 동적 타일 엔드포인트 마운트 ---------------------------------
# titiler 미설치 환경(예: 인덱스 질의만 테스트)에서도 앱이 뜨도록 가드.
try:
    from titiler.core.factory import TilerFactory

    cog = TilerFactory(router_prefix="/cog")
    app.include_router(cog.router, prefix="/cog", tags=["COG"])

    try:
        from titiler.mosaic.factory import MosaicTilerFactory

        mosaic = MosaicTilerFactory(router_prefix="/mosaicjson")
        app.include_router(mosaic.router, prefix="/mosaicjson", tags=["Mosaic"])
    except Exception:  # titiler.mosaic 미설치
        pass

    _TITILER = True
except Exception:  # titiler.core 미설치
    _TITILER = False


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "titiler": _TITILER,
        "years": [MIN_YEAR, MAX_YEAR],
        "cache": TILE_CACHE.stats(),
    }


@app.get("/api/mosaic/tiles/{z}/{x}/{y}.png")
def mosaic_tile(
    z: int,
    x: int,
    y: int,
    year: int = Query(2024, ge=MIN_YEAR, le=MAX_YEAR),
    bidx: list[int] = Query(..., description="R,G,B 밴드(1-indexed) — 3회 반복"),
    rescale: str = Query("-50,50", description="min,max (int8 스케일)"),
) -> Response:
    """인덱스 기반 동적 모자이크 RGB 타일. 캐시 적중 시 즉시 응답."""
    rmin, rmax = (float(v) for v in rescale.split(","))
    key = TileCache.key("m", z, x, y, year, tuple(bidx), rmin, rmax)

    cached = TILE_CACHE.get(key)
    if cached is not None:
        return Response(cached, media_type="image/png", headers={"X-Cache": "HIT"})

    # 렌더는 동기(블로킹) — 스레드풀에서 실행되도록 def 라우트 사용
    from .mosaic import render_tile

    try:
        png = render_tile(z, x, y, year, bidx, (rmin, rmax))
    except Exception as e:  # noqa: BLE001 — 개별 타일 실패는 빈 타일로 처리
        print(f"render_tile 실패 z{z}/{x}/{y}: {e}")
        png = None

    if png is None:
        # 데이터 없는 타일: 204 → MapLibre가 빈 타일로 처리
        return Response(status_code=204, headers={"X-Cache": "EMPTY"})

    TILE_CACHE.put(key, png)
    return Response(png, media_type="image/png", headers={"X-Cache": "MISS"})


@app.get("/api/tiles", response_model=list[Tile])
def api_tiles(
    bbox: str = Query(..., description="west,south,east,north (WGS84)"),
    year: int = Query(2024, ge=MIN_YEAR, le=MAX_YEAR),
) -> list[Tile]:
    """현재 뷰 bbox와 연도를 덮는 공개 COG 목록을 반환."""
    w, s, e, n = (float(x) for x in bbox.split(","))
    return tiles_for_bbox(year, w, s, e, n)
