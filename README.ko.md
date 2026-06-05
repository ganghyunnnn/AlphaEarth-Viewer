# alphaearth-vis

[English](README.md) | 한국어

AlphaEarth(Google Satellite Embedding V1)의 64차원 임베딩을 **인증 없이** 브라우저에서 자유롭게 RGB 시각화하는 도구. **Docker 한 줄로 누구나 로컬에서 띄워** 쓸 수 있다(호스팅된 공개 인스턴스는 없음).

![스크린샷: 서울 A01·A16·A09](docs/screenshot.png)

> 상태: **MVP 동작 — 브라우저 라이브 검증 완료(Playwright PASS).** 전 지구 모자이크 타일 + 그레이코드 스크럽 + 타일 캐시.

기존 도구(geoai/leafmap `add_alphaearth_gui`, edgeoinnovations 뷰어)는 모두 Google Earth Engine 인증과 Jupyter 환경을 요구한다. 이 프로젝트는 **공개 COG + 자체 타일 서버**로 그 빗장을 없앤다.

## 핵심 아이디어

64밴드(A00–A63) 중 3개를 R/G/B에 배정해 시각화한다. 채널별 드롭다운 대신 **단일 스크럽 바**를 끌면, 3채널×64밴드 큐브(64³=262,144)를 **반사 그레이코드** 순서로 훑는다. 인접 프레임은 한 채널이 ±1밴드만 바뀌므로 화면이 끊김 없이 모핑된다 — 찾기 도구이자 시연 도구.

```
[Vite + MapLibre GL JS (바닐라 ESM)]
   ?scrub=<index>&year=2024&min=-50&max=50
        │  index ↔ (R,G,B)  : graycode.js (닫힌 수식, 백엔드 불필요)
        ▼
[FastAPI]
   ├─ /api/tiles?bbox=&year=   : DuckDB로 aef_index.parquet 질의 → COG URL 목록
   └─ /cog, /mosaicjson        : TiTiler 동적 RGB 타일 (bidx + rescale)
        ▼
[공개 COG: data.source.coop/tge-labs/aef/v1/annual]  (인증·egress 무료, 전 지구)
```

## 기능

- **단일 그레이코드 스크럽**으로 262,144개 밴드 조합 탐색. R/G/B 밴드 번호나 조합 인덱스를 직접 입력 가능.
- **비교(스와이프) 모드** — 맵을 분할하고 경계를 끌어 두 조합/연도를 좌우로 비교.
- **지명·좌표 검색** — 지명(OpenStreetMap / Nominatim) 또는 `위도, 경도`를 입력해 해당 위치로 이동.
- **언어 토글** — English / 한국어 (기본 영어).
- **퍼머링크** — 뷰 상태를 URL에 직렬화해 공유.

## 데이터

- 데이터셋: AlphaEarth Foundations Satellite Embeddings (Source Cooperative `tge-labs/aef`)
- 공간 인덱스: `https://data.source.coop/tge-labs/aef/v1/annual/aef_index.parquet`
- 연 단위 2017–2025, 10m 해상도, 64밴드, 8192px UTM 타일, 총 302,466개
- 저장 형식: **int8**(-128..127, nodata=-128). EE의 float `±0.3`은 int8 `±38`에 해당하며, 경험상 `±50`이 디테일 최상 → 기본 rescale `-50,50`

## 디렉터리

```
backend/   FastAPI + TiTiler + DuckDB 인덱스 질의
frontend/  Vite + MapLibre + 그레이코드 스크럽 바 (바닐라 ESM)
docs/      설계 문서
```

## 실행

### Docker (권장 — 한 줄)

```bash
docker compose up --build      # → http://localhost:8080
```
(nginx가 정적 프론트 서빙 + `/api`를 백엔드로 프록시. 타일 캐시는 named volume에 영속.)

> ⚠️ **로컬/사내용 전제.** 외부 인터넷에 그대로 노출하려면 두 가지를 먼저 손봐야 한다 — (1) `/cog/*`의 raw TiTiler가 임의 `?url=` COG를 렌더하므로 SSRF 방지를 위해 마운트 제거 또는 URL 화이트리스트 적용, (2) 디스크 타일 캐시는 축출이 없어 무한히 커지므로 용량 캡/TTL 또는 앞단 CDN 필요.

### 로컬 개발

```bash
# 백엔드
cd backend && python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 프론트(별 터미널)
cd frontend && npm install && npm run dev   # vite가 /api를 8000으로 프록시

# 그레이코드 단위 테스트(의존성 없이 즉시 실행)
node frontend/test/graycode.test.mjs
```

## 검증 현황

- 그레이코드: 전체 262,144 프레임 단위거리/왕복/전단사 테스트 PASS
- 인덱스 질의: 원격 parquet 실데이터(서울/SF/파리) 검증, 적재 후 ~10ms
- 타일 렌더: 콜드 ~30–40s(원격 COG), 캐시 HIT ~5–10ms
- 브라우저: Playwright 헤드리스 PASS(맵 렌더 + 스크럽 재렌더 + 언어 토글 + 좌표 검색)
- Docker: 두 이미지 빌드 + compose 스택 서비스 확인

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 라이선스

[MIT](LICENSE)
