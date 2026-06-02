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
import threading

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


# --- single-flight: 동일 타일의 동시 중복 렌더 합치기 -----------------------
# 스크럽 시 같은 타일이 취소·재요청되며 같은 렌더가 여러 번 시작되면 느린 콜드
# 렌더가 브라우저 연결(호스트당 6개)을 중복 점유해 일부 타일이 끝까지 안 뜬다.
# 리더 1개만 렌더하고, 후속 동일 요청은 리더 완료를 기다렸다 캐시에서 공유한다.
_INFLIGHT: dict = {}
_INFLIGHT_LOCK = threading.Lock()


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

    # single-flight: 이미 같은 타일을 렌더 중이면 그 완료를 기다린다(리더/팔로워).
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
            return Response(shared, media_type="image/png", headers={"X-Cache": "FOLLOW"})
        return Response(status_code=204, headers={"X-Cache": "EMPTY"})

    # 리더: 실제 렌더(동기 블로킹 — def 라우트라 스레드풀에서 실행)
    from .mosaic import render_tile

    try:
        png = render_tile(z, x, y, year, bidx, (rmin, rmax))
    except Exception as e:  # noqa: BLE001 — 개별 타일 실패는 빈 타일로 처리
        print(f"render_tile 실패 z{z}/{x}/{y}: {e}")
        png = None
    finally:
        if png is not None:
            TILE_CACHE.put(key, png)
        with _INFLIGHT_LOCK:
            _INFLIGHT.pop(key, None)
        event.set()  # 대기 중인 팔로워 깨우기

    if png is None:
        return Response(status_code=204, headers={"X-Cache": "EMPTY"})
    return Response(png, media_type="image/png", headers={"X-Cache": "MISS"})


@app.get("/api/tiles", response_model=list[Tile])
def api_tiles(
    bbox: str = Query(..., description="west,south,east,north (WGS84)"),
    year: int = Query(2024, ge=MIN_YEAR, le=MAX_YEAR),
) -> list[Tile]:
    """현재 뷰 bbox와 연도를 덮는 공개 COG 목록을 반환."""
    w, s, e, n = (float(x) for x in bbox.split(","))
    return tiles_for_bbox(year, w, s, e, n)
