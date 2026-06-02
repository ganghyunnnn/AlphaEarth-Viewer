# alphaearth-vis

AlphaEarth(Google Satellite Embedding V1)의 64차원 임베딩을 **인증 없이** 브라우저에서 자유롭게 RGB 시각화하는 공개 웹 서비스.

기존 도구(geoai/leafmap `add_alphaearth_gui`, edgeoinnovations 뷰어)는 모두 Google Earth Engine 인증과 Jupyter 환경을 요구한다. 이 프로젝트는 **공개 COG + 자체 타일 서버**로 그 빗장을 없앤다.

## 핵심 아이디어

64밴드(A00–A63) 중 3개를 R/G/B에 배정해 시각화한다. 채널별 드롭다운 대신 **단일 스크럽 바**를 끌면, 3채널×64밴드 큐브(64³=262,144)를 **반사 그레이코드** 순서로 훑는다. 인접 프레임은 한 채널이 ±1밴드만 바뀌므로 화면이 끊김 없이 모핑된다 — 찾기 도구이자 시연 도구.

```
[Vite + MapLibre GL JS (바닐라 ESM)]
   ?i=<scrub index>&year=2024&min=-0.3&max=0.3
        │  i ↔ (R,G,B)  : graycode.js (닫힌 수식, 백엔드 불필요)
        ▼
[FastAPI]
   ├─ /api/tiles?bbox=&year=   : DuckDB로 aef_index.parquet 질의 → COG URL 목록
   └─ /cog, /mosaicjson        : TiTiler 동적 RGB 타일 (bidx + rescale)
        ▼
[공개 COG: data.source.coop/tge-labs/aef/v1/annual]  (인증·egress 무료, 전 지구)
```

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

## 개발 시작

```bash
# 백엔드
cd backend && python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 프론트
cd frontend && npm install && npm run dev

# 그레이코드 단위 테스트(의존성 없이 즉시 실행)
node frontend/test/graycode.test.mjs
```

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.
