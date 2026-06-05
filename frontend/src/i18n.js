// 경량 i18n. 기본 영어, localStorage에 선택 언어 저장.
// 정적 텍스트는 HTML의 data-i18n / data-i18n-title / data-i18n-ph 속성으로,
// 동적 텍스트는 t(key)로 처리한다. setLang() 시 applyI18n() + 구독자 통지.

const STORE = "aef_lang";

const DICT = {
  en: {
    appTitle: "AlphaEarth Embedding Explorer",
    appSub: "64 bands → RGB · gray-code scrub",
    searchPlaceholder: "Search place or lat, lng",
    searchTitle: "Search",
    searching: "Searching…",
    noResults: "No results",
    panelTitle: "Controls",
    collapseTitle: "Collapse / expand panel",
    year: "Year",
    bandCombo: "Band combo",
    contrast: "Contrast (min/max)",
    basemap: "Basemap",
    bmDark: "Dark",
    bmSatellite: "Satellite",
    opacity: "Opacity",
    play: "▶ Play",
    pause: "⏸ Pause",
    playTitle: "Auto morph",
    skipDup: "Skip duplicates",
    skipDupTitle: "Skip degenerate frames",
    compare: "⇆ Compare",
    compareTitle: "Side-by-side compare",
    bookmark: "📌 Bookmark",
    bookmarkTitle: "Pin current combo",
    share: "🔗 Share",
    shareTitle: "Copy current state URL",
    copied: "Copied!",
    dup: " (dup)",
  },
  ko: {
    appTitle: "AlphaEarth 임베딩 탐색기",
    appSub: "64밴드 → RGB · 그레이코드 스크럽",
    searchPlaceholder: "지명 또는 위도, 경도 검색",
    searchTitle: "검색",
    searching: "검색 중…",
    noResults: "결과 없음",
    panelTitle: "컨트롤",
    collapseTitle: "패널 접기 / 펼치기",
    year: "연도",
    bandCombo: "밴드 조합",
    contrast: "대비(min/max)",
    basemap: "베이스맵",
    bmDark: "다크",
    bmSatellite: "위성",
    opacity: "투명도",
    play: "▶ 재생",
    pause: "⏸ 정지",
    playTitle: "자동 모핑",
    skipDup: "중복 건너뛰기",
    skipDupTitle: "중복 프레임 건너뛰기",
    compare: "⇆ 비교 모드",
    compareTitle: "좌우 분할 비교",
    bookmark: "📌 북마크",
    bookmarkTitle: "현재 조합 고정",
    share: "🔗 공유",
    shareTitle: "현재 상태 URL 복사",
    copied: "복사됨!",
    dup: " (중복)",
  },
};

let lang = localStorage.getItem(STORE) === "ko" ? "ko" : "en";
document.documentElement.lang = lang;

const subs = new Set();

export function getLang() {
  return lang;
}

export function t(key) {
  return (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
}

export function setLang(next) {
  next = next === "ko" ? "ko" : "en";
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORE, lang);
  } catch {
    /* private mode 등 — 무시 */
  }
  document.documentElement.lang = lang;
  applyI18n(document);
  subs.forEach((fn) => fn(lang));
}

// 언어 변경 시 동적 컴포넌트 갱신용. 해지 함수 반환.
export function onLangChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// 정적 텍스트 일괄 적용.
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}
