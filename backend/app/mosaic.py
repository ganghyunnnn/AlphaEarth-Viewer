"""인덱스 기반 동적 모자이크 타일 렌더링.

거대한 MosaicJSON을 사전 빌드하지 않고, 타일마다 공간 인덱스(DuckDB)로 교차 COG를
찾아 즉석 병합한다. 우리 인덱스 질의가 ~10ms라 가능. 프론트는 단일 소스
(/api/mosaic/tiles)만 쓰므로 전 지구 줌이 매끄럽다.

성능 전략(실측으로 확정):
  1) WarpedVRT 회피 — rio_tiler.Reader.tile()은 COG마다 WarpedVRT(UTM→3857)를 만들어
     콜드 z11 타일 한 장이 ~19s. "네이티브 오버뷰에서 타일 윈도우만 데시메이트 읽기 →
     메모리 reproject"가 ~5s로 ~4배 빠르다(재투영 연산 0.006s, 비용은 네트워크 read).
     CPU 스레드 증설은 오히려 악화(네트워크 병목) → software-only 경로가 최적.
  2) 밴드-타일 캐시(핵심) — 병목은 원격 COG 오버뷰 블록 HTTP fetch(대역폭 한계 ~3.4MB/s).
     그레이코드 스크럽은 한 스텝에 3밴드 중 1밴드만 바뀐다. 밴드별로 따로 읽어
     (cog,band,z,x,y)로 캐시하면 스텝당 2밴드는 HIT·1밴드만 fetch → 스크럽 비용 ~3× 절감.
     첫 렌더는 미캐시 밴드를 한 번의 ds.read로 묶어 읽어 개별 open 비용을 피한다.
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
NODATA = -128  # AEF int8 nodata (정상 데이터는 이 값을 갖지 않음)

# 저줌(넓은 타일)에서 수백~수천 COG를 모자이크하면 매우 느려진다.
# 한 타일이 이보다 많은 COG를 덮으면 빈 타일 처리(프론트는 minzoom으로 저줌 차단).
MAX_COGS_PER_TILE = 24

# --- 밴드-타일 메모리 캐시 -------------------------------------------------
# key=(cog_url, band, z, x, y) → 256² int8 배열(재투영 완료) | None(교차 안 함)
# 유효 마스크는 arr != NODATA로 유도(별도 저장 안 함 → 64KB/엔트리).
_BAND_CACHE: "OrderedDict[tuple, Optional[np.ndarray]]" = OrderedDict()
_BAND_CACHE_MAX = 3000  # ≈192MB
_BAND_LOCK = threading.Lock()
_MISS = object()  # 캐시 미존재 표식


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
    """타일의 소스 CRS 경계로 읽기 윈도우 계산. 교차 안 하면 None."""
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
    """COG에서 여러 밴드를 한 번에 네이티브 오버뷰로 읽어 3857로 재투영.

    반환: {band: 256² int8 배열}. 타일과 교차하지 않으면 None.
    네트워크 비용을 한 번의 ds.read로 묶기 위해 여러 밴드를 동시에 처리.
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
        # 데시메이트된 256² 배열의 변환: window_transform을 배율 스케일(부호·방향 보존).
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
    """해당 웹머케이터 타일을 덮는 COG URL 목록(인덱스 질의)."""
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
    """RGB PNG 타일을 렌더. 덮는 COG가 없으면 None(빈 타일).

    밴드별로 (cog,band,z,x,y) 캐시를 조회하고, 미캐시 밴드만 COG에서 읽는다.
    여러 COG가 한 타일을 덮으면 밴드별로 first-valid 합성(모자이크).
    """
    cogs = cogs_for_tile(z, x, y, year)
    if not cogs or len(cogs) > MAX_COGS_PER_TILE:
        return None

    uniq = list(dict.fromkeys(indexes))  # 중복 밴드 제거(채널이 같은 밴드 공유 가능)
    composited: Dict[int, np.ndarray] = {b: np.full((TILESIZE, TILESIZE), NODATA, np.int8) for b in uniq}
    covered: Dict[int, np.ndarray] = {b: np.zeros((TILESIZE, TILESIZE), bool) for b in uniq}

    for cog in cogs:
        pending = [b for b in uniq if not covered[b].all()]
        if not pending:
            break

        # 캐시 조회 → 미스 밴드만 한 번에 읽기
        avail: Dict[int, Optional[np.ndarray]] = {}
        miss: List[int] = []
        for b in pending:
            v = _cache_get((cog, b, z, x, y))
            if v is _MISS:
                miss.append(b)
            else:
                avail[b] = v  # ndarray or None(교차 안 함)
        if miss:
            read = _read_bands(cog, miss, x, y, z)
            for b in miss:
                arr = None if read is None else read[b]
                _cache_put((cog, b, z, x, y), arr)
                avail[b] = arr

        # 밴드별 first-valid 합성
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

    stack = np.stack([composited[b] for b in indexes])  # (nb, 256, 256) — indexes 순서
    mask2d = np.all(stack == NODATA, axis=0)
    arr = np.ma.MaskedArray(stack, mask=np.broadcast_to(mask2d, stack.shape))

    tile = morecantile.commons.Tile(x, y, z)
    xb = TMS.xy_bounds(tile)
    img = ImageData(arr, crs=DST_CRS, bounds=(xb.left, xb.bottom, xb.right, xb.top))
    img = img.rescale(in_range=[tuple(rescale)] * len(indexes))
    return img.render(img_format="PNG")
