# AlphaEarth Viewer

[English](README.md) | 한국어

64차원 **AlphaEarth** 위성 임베딩(Google Satellite Embedding V1)을 브라우저에서 RGB로 탐색 — **Google Earth Engine·로그인 불필요**. Docker 한 줄이면 끝.

![AlphaEarth Viewer](docs/screenshot.png)

## 무엇을 하나

픽셀마다 64개 임베딩 밴드(A00–A63)가 있다. 3개를 골라 R/G/B에 매핑하는데, 드롭다운 3개 대신 **스크럽 바 하나**로 64³ = 262,144개 조합을 **반사 그레이코드** 순서로 훑는다. 인접 프레임은 한 밴드만 바뀌어 화면이 매끄럽게 모핑된다 — 탐색 도구이자 시연 도구.

## 빠른 시작

```bash
docker compose up --build      # → http://localhost:8080
```

nginx가 프론트를 서빙하고 FastAPI + TiTiler 백엔드로 프록시하며, 백엔드는 Source Cooperative(`tge-labs/aef`)의 공개 COG에서 RGB 타일을 즉석 렌더한다. 렌더된 타일은 named volume에 캐시된다.

> **로컬/사내용** 전제. 외부 공개 전 raw `/cog/*` 엔드포인트(임의 URL SSRF)를 제한하고, 디스크 타일 캐시(축출 없음)에 상한을 둘 것.

## 기능

| | |
|---|---|
| 🎚️ **그레이코드 스크럽** | 26만 조합 탐색, R/G/B 밴드·조합 인덱스 직접 입력 |
| 🪟 **비교 모드** | 좌우 분할 스와이프 — 두 조합/연도 동시 비교 |
| 🔍 **검색** | 지명(OSM / Nominatim) 또는 `위도, 경도` |
| 🗺️ **베이스맵** | 위성(기본) / 다크 / OSM |
| 🌫️ **투명도·on/off** | 임베딩을 베이스맵 위에 겹치거나 완전히 숨김 |
| 🌐 **EN / 한국어** · 🔗 **퍼머링크** | 언어 토글, 공유 가능한 URL 상태 |

## 데이터

AlphaEarth Foundations Satellite Embeddings (`tge-labs/aef`) — 연 단위 2017–2025, 10m, 64밴드, 전 지구(302,466개 COG 타일). **int8** 저장, 기본 대비 `−50…50`(≈ EE float `±0.4`).

## 개발

```bash
# 프론트
cd frontend && npm install && npm run dev      # vite가 /api → :8000 프록시

# 백엔드
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000

# 그레이코드 테스트(의존성 없음)
node frontend/test/graycode.test.mjs
```

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 라이선스

[MIT](LICENSE)
