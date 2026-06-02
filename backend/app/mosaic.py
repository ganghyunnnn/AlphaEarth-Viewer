"""인덱스 기반 동적 모자이크 타일 렌더링.

거대한 MosaicJSON을 사전 빌드하지 않고, 타일마다 공간 인덱스(DuckDB)로 교차 COG를
찾아 rio_tiler.mosaic으로 즉석 병합한다. 우리 인덱스 질의가 ~10ms라 가능.
프론트는 단일 소스(/api/mosaic/tiles)만 쓰므로 전 지구 줌이 매끄럽다.

타일 읽기 전략(중요):
  rio_tiler의 기본 Reader.tile()은 COG마다 WarpedVRT(UTM→3857)를 만들어 읽는데,
  원격 COG에서 콜드 z11 타일 한 장이 ~19s 걸린다(과도한 블록/오버뷰 읽기). 실측 비교
  결과 "네이티브 오버뷰에서 타일 윈도우만 데시메이트 읽기 → 메모리에서 reproject"가
  동일 타일을 ~5s로 ~4배 빠르게 처리한다(재투영 연산 자체는 0.006s, 비용은 네트워크 read).
  CPU 스레드 증설은 오히려 악화(네트워크 병목)되어, 이 software-only 경로가 최적이다.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import morecantile
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window
from rio_tiler.errors import EmptyMosaicError, TileOutsideBounds
from rio_tiler.models import ImageData
from rio_tiler.mosaic import mosaic_reader

from .index import tiles_for_bbox

TMS = morecantile.tms.get("WebMercatorQuad")
DST_CRS = CRS.from_epsg(3857)
TILESIZE = 256
NODATA = -128  # AEF int8 nodata

# 저줌(넓은 타일)에서 수백~수천 COG를 모자이크하면 매우 느려진다.
# 한 타일이 이보다 많은 COG를 덮으면 빈 타일 처리(프론트는 minzoom으로 저줌 차단).
MAX_COGS_PER_TILE = 24


def _read_tile(asset: str, x: int, y: int, z: int, indexes: Sequence[int]) -> ImageData:
    """COG에서 타일 영역만 네이티브 오버뷰로 읽어 메모리에서 3857로 재투영.

    rio_tiler.Reader.tile()(WarpedVRT)보다 ~4배 빠르다. 교차하지 않으면
    TileOutsideBounds를 던져 mosaic_reader가 다음 COG로 넘어가게 한다.
    """
    tile = morecantile.commons.Tile(x, y, z)
    xb = TMS.xy_bounds(tile)  # 3857 (left, bottom, right, top)
    w, s, e, n = xb.left, xb.bottom, xb.right, xb.top
    nb = len(indexes)

    with rasterio.open(asset) as ds:
        # 타일 3857 경계를 소스 CRS(UTM)로 변환해 읽을 윈도우 결정
        b = transform_bounds(DST_CRS, ds.crs, w, s, e, n, densify_pts=21)
        t_w, t_e = min(b[0], b[2]), max(b[0], b[2])
        t_s, t_n = min(b[1], b[3]), max(b[1], b[3])

        # 교차 검사 — ds.bounds도 부호 가정 없이 정규화(이 COG들은 y가 뒤집혀 옴)
        db = ds.bounds
        d_w, d_e = min(db.left, db.right), max(db.left, db.right)
        d_s, d_n = min(db.bottom, db.top), max(db.bottom, db.top)
        if t_e <= d_w or t_w >= d_e or t_n <= d_s or t_s >= d_n:
            raise TileOutsideBounds(f"{asset} 가 타일 {z}/{x}/{y} 와 교차하지 않음")

        inv = ~ds.transform
        c0, r0 = inv * (t_w, t_n)
        c1, r1 = inv * (t_e, t_s)
        win = Window(min(c0, c1), min(r0, r1), abs(c1 - c0), abs(r1 - r0))

        # out_shape로 데시메이트 → GDAL이 적합한 오버뷰를 골라 소량만 읽음
        data = ds.read(
            list(indexes),
            window=win,
            out_shape=(nb, TILESIZE, TILESIZE),
            resampling=Resampling.bilinear,
            boundless=True,
            fill_value=NODATA,
        )
        # 데시메이트된 256² 배열의 변환: 윈도우의 실제 transform을 배율 스케일
        # (window_transform이 부호·방향을 보존하므로 north-up/south-up 가정 불필요).
        wt = ds.window_transform(win)
        src_t = wt * Affine.scale(win.width / TILESIZE, win.height / TILESIZE)
        src_crs = ds.crs

    dst_t = transform_from_bounds(w, s, e, n, TILESIZE, TILESIZE)

    out = np.full((nb, TILESIZE, TILESIZE), NODATA, dtype=data.dtype)
    reproject(
        data,
        out,
        src_transform=src_t,
        src_crs=src_crs,
        dst_transform=dst_t,
        dst_crs=DST_CRS,
        resampling=Resampling.bilinear,
        src_nodata=NODATA,
        dst_nodata=NODATA,
        num_threads=2,
    )

    mask2d = np.all(out == NODATA, axis=0)  # 모든 밴드가 nodata인 픽셀
    arr = np.ma.MaskedArray(out, mask=np.broadcast_to(mask2d, out.shape))
    return ImageData(arr, crs=DST_CRS, bounds=(w, s, e, n))


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
    """RGB PNG 타일을 렌더. 덮는 COG가 없으면 None(빈 타일)."""
    cogs = cogs_for_tile(z, x, y, year)
    if not cogs or len(cogs) > MAX_COGS_PER_TILE:
        return None
    try:
        img, _ = mosaic_reader(cogs, _read_tile, x, y, z, indexes=list(indexes))
    except EmptyMosaicError:
        return None
    img = img.rescale(in_range=[tuple(rescale)] * len(indexes))
    return img.render(img_format="PNG")
