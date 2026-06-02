"""PROJ/GDAL 데이터 경로 자가치유.

일부 윈도우 환경은 전역 PROJ_LIB/GDAL_DATA가 PostgreSQL/PostGIS의 (구버전)
proj.db를 가리켜 rasterio 번들 PROJ와 충돌한다(`DATABASE.LAYOUT.VERSION` 에러).
rasterio를 import하기 전에 이 모듈을 먼저 import하여, 번들된 데이터 경로로 덮어쓴다.
"""

from __future__ import annotations

import importlib.util
import os


def _fix() -> None:
    # rasterio를 "실행"하지 않고 위치만 찾는다. import 시점에 PROJ가 잘못된
    # 경로를 캐시하기 전에 환경변수를 먼저 바로잡아야 하기 때문.
    spec = importlib.util.find_spec("rasterio")
    if not spec or not spec.origin:
        return
    rio_dir = os.path.dirname(spec.origin)
    proj_data = os.path.join(rio_dir, "proj_data")
    gdal_data = os.path.join(rio_dir, "gdal_data")

    if os.path.exists(os.path.join(proj_data, "proj.db")):
        # 전역 환경변수가 다른 곳을 가리켜도 번들 경로를 강제
        os.environ["PROJ_LIB"] = proj_data
        os.environ["PROJ_DATA"] = proj_data
    if os.path.isdir(gdal_data):
        os.environ["GDAL_DATA"] = gdal_data


# COG-over-HTTP 성능 튜닝(rio-tiler/titiler 권장). 이미 설정된 값은 존중.
_GDAL_HTTP_TUNING = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",  # 불필요한 디렉터리 조회 제거(핵심)
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_HTTP_VERSION": "2",
    "GDAL_BAND_BLOCK_CACHE": "HASHSET",
    "GDAL_CACHEMAX": "256",  # MB
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "10000000",  # 10MB/파일
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff",
    "CPL_VSIL_CURL_CACHE_SIZE": "200000000",  # 200MB 전역 range 캐시
    # 멈춤 방지(핵심): 타임아웃/재시도가 없으면 원격 연결이 동시 burst에서 멎을 때
    # 타일 렌더가 무한 대기 → 브라우저 연결을 점유 → "일부 타일이 끝까지 안 뜸".
    "GDAL_HTTP_TIMEOUT": "30",  # 개별 HTTP 요청 총 타임아웃(초)
    "GDAL_HTTP_CONNECTTIMEOUT": "10",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "0.5",
    "GDAL_HTTP_LOW_SPEED_LIMIT": "1000",  # 1KB/s 미만이
    "GDAL_HTTP_LOW_SPEED_TIME": "8",  # 8초 지속되면 끊고 재시도(트리클 멈춤 차단)
}


def _tune_gdal() -> None:
    for k, v in _GDAL_HTTP_TUNING.items():
        os.environ.setdefault(k, v)


_fix()
_tune_gdal()
