// 백엔드 엔드포인트(개발 시 vite 프록시가 8000으로 전달) 및 기본값
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const TITILER_BASE = import.meta.env.VITE_TITILER_BASE ?? "";

export const DEFAULTS = {
  year: 2024,
  scrub: 7158, // 그레이코드 인덱스 → [A01,A16,A09] (EE 예시 조합, 컬러풀한 기본값)
  // source.coop COG는 int8(-128..127, nodata=-128). EE의 float ±0.3 ≈ int8 ±38.
  // 경험적으로 ±50이 디테일이 가장 풍부(고유 픽셀값 최다).
  min: -50,
  max: 50,
  // 초기 뷰: 서울 (인덱스에 데이터 존재 확인됨)
  lng: 126.98,
  lat: 37.56,
  zoom: 10,
  // 비교(스와이프) 모드 상태 — 기본값과 다를 때만 URL에 직렬화된다.
  compare: 0, // 0/1
  swipe: 0.5, // 분할 경계 위치(0..1)
  bYear: 2024, // 분할면 B: 연도
  bScrub: 7158, // 분할면 B: 밴드조합(그레이코드 인덱스)
  bMin: -50, // 분할면 B: 대비 min
  bMax: 50, // 분할면 B: 대비 max
};

export const YEAR_RANGE = [2017, 2025];

// 베이스맵: 키 불필요한 공개 래스터 타일(데모용). 운영 시 교체 권장.
export const BASEMAP_TILES = [
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
];
