# 아키텍처

## 1. 목표와 차별점

| 항목 | 기존 도구(geoai/leafmap, edgeoinnovations) | 본 서비스 |
|------|------|------|
| 백엔드 | Google Earth Engine | 공개 COG (source.coop) |
| 사용자 인증 | EE 계정 필수 | **불필요** |
| 실행 환경 | Jupyter/Colab ipywidgets | 배포형 standalone 웹앱 |
| 밴드 선택 | R/G/B 드롭다운 3개 | **단일 그레이코드 스크럽 바** |
| 조합 공유 | 없음 | URL permalink |

## 2. 데이터 계층

AlphaEarth COG는 Source Cooperative `tge-labs/aef`에 공개되어 있다.

- 베이스 URL: `https://data.source.coop/tge-labs/aef/v1/annual`
- 공간 인덱스: `{base}/aef_index.parquet` (≈77.8MB, CORS `*`, HTTP Range 지원)
- 인덱스 스키마(주요): `path`(s3 URI), `year`(2017–2025), `utm_zone`, `crs`(EPSG:326xx),
  `wgs84_{west,south,east,north}`, `geom`(폴리곤). 행 302,466개.
- COG: 64밴드(A00=band1 … A63=band64), 8192×8192px, 10m, UTM 투영. 오버뷰 내장.
  - **저장 dtype = int8**(-128..127), `scales=1/offsets=0`, **nodata=-128**.
    EE float `±0.3` ≈ int8 `±38`. 라이브 검증 결과 `-0.3,0.3`을 그대로 쓰면 고유 픽셀값이
    3개뿐(포화) → **기본 rescale `-50,50`**(고유값 ~100, 디테일 최상). 슬라이더도 int8 범위.
- COG URL 변환: `s3://us-west-2.opendata.source.coop` → `https://data.source.coop`.

### bbox 질의
공간 확장 없이 bbox 컬럼만으로 충분:
```sql
SELECT path, utm_zone, wgs84_west, wgs84_south, wgs84_east, wgs84_north
FROM read_parquet('{index}')
WHERE year = ?
  AND wgs84_west  < :east  AND wgs84_east  > :west
  AND wgs84_south < :north AND wgs84_north > :south
```
DuckDB httpfs가 parquet를 원격 range 읽기로 질의하므로 인덱스를 로컬에 둘 필요가 없다.
운영 시에는 연도별 슬림 인덱스(GeoParquet/FlatGeobuf)로 캐시해 지연을 줄인다.

## 3. 타일 렌더링 계층 (TiTiler)

각 COG는 UTM 투영이므로, Web Mercator 타일 요청 시 TiTiler가 즉석에서 재투영한다.

- 단일 COG: `GET /cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url={cog}&bidx={r}&bidx={g}&bidx={b}&rescale={min},{max}`
  - TiTiler 밴드는 **1-indexed**: A_n → `bidx = n + 1`.
- 전 지구 모자이크: 연도별 MosaicJSON을 인덱스에서 생성하여
  `GET /mosaicjson/tiles/{z}/{x}/{y}.png?...&bidx=...` 로 타일별로 적합한 COG를 선택.
  - 밴드 조합(bidx)과 rescale은 쿼리 파라미터이므로 모자이크 자체는 연도당 1회만 빌드/캐시하면 된다.

### 단계적 구현
- **MVP(1단계)**: 현재 뷰 bbox+year로 `/api/tiles` 질의 → 교차 COG들을 MapLibre raster source로 추가. 저줌(전세계)에서는 타일 수 제한.
- **2단계**: 연도별 MosaicJSON 빌드 + TiTiler mosaic 엔드포인트로 전 지구 매끄러운 줌.

## 4. 밴드 스크럽 (그레이코드)

`frontend/src/graycode.js` 가 단일 스크럽 인덱스 `i ∈ [0, 64³)` 와 RGB 밴드 트리플 `(r,g,b)` 사이를
양방향 변환한다. 반사(reflected) n-ary 그레이코드라 `i`와 `i+1`은 정확히 한 채널에서 ±1밴드만 다르다.

- 백엔드 사전계산 불필요 — 변환이 닫힌 수식.
- 중복 프레임(R=G 등)은 기본 허용(최대 부드러움), "건너뛰기" 토글로 스텝 시 제외.
- 보조 UI: 썸네일 필름스트립(점프), 📌북마크(비교/공유), ▶재생(자동 모핑), URL permalink.

### 성능
스크럽 중 매 프레임 타일 재요청을 막기 위해: 드래그 중 디바운스(~150ms) + 저해상도 프리뷰,
손을 떼면 풀해상도. CDN/타일 캐시로 반복 조합 가속.

## 5. URL 상태 (permalink)

`?i=<scrub>&year=<Y>&min=<m>&max=<M>&lng=<>&lat=<>&z=<zoom>` 형태로 전체 상태를 직렬화 →
조합 공유·재현. 기본값 생략으로 URL 간결화.
