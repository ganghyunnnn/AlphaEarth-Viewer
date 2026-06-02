"""인덱스 기반 동적 모자이크 타일 렌더링.

거대한 MosaicJSON을 사전 빌드하지 않고, 타일마다 공간 인덱스(DuckDB)로 교차 COG를
찾아 rio_tiler.mosaic으로 즉석 병합한다. 우리 인덱스 질의가 ~10ms라 가능.
프론트는 단일 소스(/api/mosaic/tiles)만 쓰므로 전 지구 줌이 매끄럽다.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import morecantile
from rio_tiler.errors import EmptyMosaicError
from rio_tiler.io import Reader
from rio_tiler.models import ImageData
from rio_tiler.mosaic import mosaic_reader

from .index import tiles_for_bbox

TMS = morecantile.tms.get("WebMercatorQuad")

# 저줌(넓은 타일)에서 수백~수천 COG를 모자이크하면 매우 느려진다.
# 한 타일이 이보다 많은 COG를 덮으면 빈 타일 처리(프론트는 minzoom으로 저줌 차단).
MAX_COGS_PER_TILE = 24


def _read_tile(asset: str, x: int, y: int, z: int, indexes: Sequence[int]) -> ImageData:
    with Reader(asset) as r:
        return r.tile(x, y, z, indexes=indexes)


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
