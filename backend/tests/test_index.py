"""인덱스 질의 검증. 네트워크(원격 parquet) 필요 — 없으면 자동 skip."""

import pytest

from app.index import MAX_YEAR, MIN_YEAR, to_https, tiles_for_bbox


def test_to_https():
    s3 = "s3://us-west-2.opendata.source.coop/tge-labs/aef/v1/annual/2024/52S/x.tiff"
    assert to_https(s3) == (
        "https://data.source.coop/tge-labs/aef/v1/annual/2024/52S/x.tiff"
    )


def test_year_bounds():
    with pytest.raises(ValueError):
        tiles_for_bbox(MIN_YEAR - 1, 126, 37, 127, 38)
    with pytest.raises(ValueError):
        tiles_for_bbox(MAX_YEAR + 1, 126, 37, 127, 38)


@pytest.mark.network
def test_seoul_bbox_returns_cogs():
    # 서울 주변 작은 bbox, 2024
    tiles = tiles_for_bbox(2024, 126.9, 37.5, 127.0, 37.6)
    assert len(tiles) >= 1
    for t in tiles:
        assert t.path.startswith("https://data.source.coop/")
        assert t.path.endswith(".tiff")
        assert len(t.bbox) == 4
