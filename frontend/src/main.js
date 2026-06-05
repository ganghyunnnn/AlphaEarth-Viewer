import { Viewer } from "./viewer.js";
import { ScrubControl } from "./scrubbar.js";
import { Prefetcher } from "./prefetch.js";
import { CompareController } from "./compare.js";
import { SearchControl } from "./search.js";
import { readState, pushState, shareUrl } from "./state.js";
import { TOTAL, indexToTriple } from "./graycode.js";
import { applyI18n, setLang, getLang, onLangChange, t } from "./i18n.js";
import { BASEMAPS } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = readState();

// --- 지도 뷰어(맵 A) ----------------------------------------------------
const viewer = new Viewer("map", state);

// --- 비교 모드(스와이프) 컨트롤러 --------------------------------------
const compare = new CompareController({
  mapA: viewer.map,
  containerB: $("mapB"),
  divider: $("divider"),
});

// --- 분할면 A/B 파라미터 -----------------------------------------------
// A는 최상위 state(year/scrub/min/max)를 그대로 사용(permalink 호환).
// B는 state.b* 필드로 프록시한다. 두 측 모두 {year,scrub,min,max} 인터페이스.
const B = {
  get year() { return state.bYear; }, set year(v) { state.bYear = v; },
  get scrub() { return state.bScrub; }, set scrub(v) { state.bScrub = v; },
  get min() { return state.bMin; }, set min(v) { state.bMin = v; },
  get max() { return state.bMax; }, set max(v) { state.bMax = v; },
};
const sideParams = { A: state, B };
let activeSide = "A"; // 패널이 편집하는 분할면
let bSeeded = !!state.compare; // permalink로 B 값이 들어왔으면 A 복제 생략

// --- 유휴 예측 프리페치(맵 A 기준) -------------------------------------
const prefetcher = new Prefetcher(viewer.map);
function pfCtx() {
  return {
    year: state.year,
    index: state.scrub,
    range: { min: state.min, max: state.max },
    skipDegenerate: scrub.skipDegenerate,
  };
}
function pfSettle() {
  prefetcher.update(pfCtx());
  prefetcher.schedule();
}

// --- 활성 분할면 렌더(드래그=프리뷰 디바운스, 손 뗌=즉시 풀해상도) ------
let renderTimer = null;
function renderActive(commit) {
  const p = sideParams[activeSide];
  const triple = indexToTriple(p.scrub);
  const range = { min: p.min, max: p.max };
  const doIt = () => {
    if (activeSide === "A") viewer.setRender(triple, range);
    else compare.setRenderB({ year: p.year, triple, range });
  };
  clearTimeout(renderTimer);
  if (commit) doIt();
  else renderTimer = setTimeout(doIt, 150);
}

// --- 스크럽 바 ----------------------------------------------------------
const scrub = new ScrubControl(
  {
    scrub: $("scrub"),
    bandR: $("bandR"),
    bandG: $("bandG"),
    bandB: $("bandB"),
    idxIn: $("idxIn"),
    idxDup: $("idxDup"),
    play: $("play"),
    skipDeg: $("skipDeg"),
    bookmark: $("bookmark"),
    filmstrip: $("filmstrip"),
    bookmarks: $("bookmarks"),
  },
  {
    onChange: (index, _triple, { commit }) => {
      sideParams[activeSide].scrub = index;
      if (activeSide === "A") prefetcher.cancel(); // 스크럽 중 프리페치 중단(대역폭 양보)
      renderActive(commit);
      if (commit) pushState(state);
    },
    makePreviewUrl: () => null, // TODO: TiTiler /cog/preview 기반 썸네일
  },
);

// --- 연도 슬라이더 ------------------------------------------------------
$("year").value = String(state.year);
$("yearOut").textContent = String(state.year);
$("year").addEventListener("input", () => {
  const p = sideParams[activeSide];
  p.year = Number($("year").value);
  $("yearOut").textContent = String(p.year);
  if (activeSide === "A") {
    prefetcher.cancel();
    viewer.setYear(p.year);
  } else {
    compare.setRenderB({ year: p.year, triple: indexToTriple(p.scrub), range: { min: p.min, max: p.max } });
  }
  pushState(state);
});

// --- 대비(min/max): 슬라이더 + 키보드 숫자 입력(양방향 동기화) -----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 현재 측 값으로 슬라이더·숫자입력 4개를 모두 맞춘다.
function setRangeUI(p) {
  $("rmin").value = String(p.min);
  $("rmax").value = String(p.max);
  $("rminNum").value = String(p.min);
  $("rmaxNum").value = String(p.max);
}

function commitRange(commit) {
  if (activeSide === "A") prefetcher.cancel(); // 대비 조정 중 프리페치 중단
  renderActive(true); // 대비는 즉시 반영(라이브)
  if (commit) pushState(state);
}

// 슬라이더 드래그 → 값(드래그=프리뷰, 손 뗌=커밋).
function onRangeSlider(commit) {
  const p = sideParams[activeSide];
  p.min = Number($("rmin").value);
  p.max = Number($("rmax").value);
  $("rminNum").value = String(p.min);
  $("rmaxNum").value = String(p.max);
  commitRange(commit);
}

// 숫자 직접 입력 → 슬라이더 도메인으로 클램프 후 반영. change(Enter/blur)에서만.
function onRangeNum() {
  const p = sideParams[activeSide];
  const mn = Number($("rminNum").value);
  const mx = Number($("rmaxNum").value);
  if (Number.isNaN(mn) || Number.isNaN(mx)) return;
  p.min = clamp(Math.round(mn), -127, 0);
  p.max = clamp(Math.round(mx), 0, 127);
  setRangeUI(p);
  commitRange(true);
}

setRangeUI(state);
$("rmin").addEventListener("input", () => onRangeSlider(false));
$("rmax").addEventListener("input", () => onRangeSlider(false));
$("rmin").addEventListener("change", () => onRangeSlider(true));
$("rmax").addEventListener("change", () => onRangeSlider(true));
$("rminNum").addEventListener("change", onRangeNum);
$("rmaxNum").addEventListener("change", onRangeNum);

// --- 편집 대상(A/B) 전환 ------------------------------------------------
// 선택한 측의 저장값을 컨트롤에 되불러온다(렌더는 이미 돼 있으므로 silent).
function setActiveSide(side) {
  activeSide = side;
  $("tabA").classList.toggle("on", side === "A");
  $("tabB").classList.toggle("on", side === "B");
  const p = sideParams[side];
  $("year").value = String(p.year);
  $("yearOut").textContent = String(p.year);
  setRangeUI(p);
  scrub.show(p.scrub);
}
$("tabA").addEventListener("click", () => setActiveSide("A"));
$("tabB").addEventListener("click", () => setActiveSide("B"));

// --- 비교 모드 토글 -----------------------------------------------------
function setCompare(on) {
  state.compare = on ? 1 : 0;
  document.body.classList.toggle("compare-on", on);
  $("compare").classList.toggle("on", on);
  $("sideTabs").hidden = !on;
  if (on) {
    // 켜는 순간 B를 현재 A로 복제(같은 화면에서 시작 → 한쪽만 바꿔 비교).
    // 단, permalink로 B 값이 복원된 경우엔 유지.
    if (!bSeeded) {
      B.year = state.year;
      B.scrub = state.scrub;
      B.min = state.min;
      B.max = state.max;
      bSeeded = true;
    }
    compare.enable({ year: B.year, triple: indexToTriple(B.scrub), range: { min: B.min, max: B.max } });
    compare.setSwipe(state.swipe);
  } else {
    compare.disable();
    setActiveSide("A"); // 단일 뷰 → A 편집으로 복귀
  }
  pushState(state);
}
$("compare").addEventListener("click", () => setCompare(state.compare ? false : true));
compare.onSwipeEnd = (t) => {
  state.swipe = t;
  pushState(state);
};

// --- 패널 접기/펼치기 ---------------------------------------------------
$("collapse").addEventListener("click", () => {
  const collapsed = $("panel").classList.toggle("collapsed");
  $("collapse").setAttribute("aria-expanded", String(!collapsed));
});

// --- 공유 버튼 ----------------------------------------------------------
$("share").addEventListener("click", async () => {
  const url = shareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    flash($("share"), t("copied"));
  } catch {
    prompt("공유 URL", url);
  }
});

// --- 지도 이동 → 상태 갱신 ---------------------------------------------
viewer.onMoveStart = () => prefetcher.cancel(); // 팬/줌 시작 → 프리페치 중단
viewer.onMove = ({ lng, lat, zoom }) => {
  state.lng = lng;
  state.lat = lat;
  state.zoom = zoom;
  pushState(state);
};

// idle = 보이는 타일 로드 완료 → 그때 비로소 이웃·마진 프리페치(콜드 로드와 비경쟁).
viewer.onIdle = () => pfSettle();

// --- 초기화 -------------------------------------------------------------
viewer.whenReady(() => {
  scrub.init(state.scrub); // triple 확정 → onChange → viewer.setRender → 모자이크 소스 생성
  setBasemap(currentBasemap); // 저장된 베이스맵 복원(다크 외일 때 base 타일 교체)
  setOpacity(currentOpacity, false); // 저장된 투명도 적용(레이어 생성 후)
  if (state.compare) setCompare(true); // permalink 복원
});

// --- 다국어(i18n) + 언어 토글 -------------------------------------------
applyI18n(); // 정적 텍스트(data-i18n) 적용
function syncLangUI() {
  document.title = t("appTitle");
  // 토글 버튼은 '전환 대상' 언어를 표시
  $("langToggle").textContent = getLang() === "en" ? "한국어" : "EN";
}
syncLangUI();
onLangChange(syncLangUI);
$("langToggle").addEventListener("click", () => setLang(getLang() === "en" ? "ko" : "en"));

// --- 지명/좌표 검색 + 접기 토글 ----------------------------------------
new SearchControl({
  form: $("searchForm"),
  input: $("searchInput"),
  results: $("searchResults"),
  map: viewer.map,
});
$("searchToggle").addEventListener("click", () => {
  const collapsed = $("searchBox").classList.toggle("collapsed");
  if (!collapsed) $("searchInput").focus();
});

// --- 베이스맵 전환(다크/위성/OSM) — 전역 뷰 설정, 맵 A·B 동시 적용 -------
let currentBasemap = localStorage.getItem("aef_basemap") || "dark";
if (!BASEMAPS[currentBasemap]) currentBasemap = "dark";
function setBasemap(key) {
  if (!BASEMAPS[key]) return;
  currentBasemap = key;
  try {
    localStorage.setItem("aef_basemap", key);
  } catch {
    /* private mode 등 — 무시 */
  }
  const tiles = BASEMAPS[key].tiles;
  viewer.setBasemapTiles(tiles);
  compare.setBasemapTiles(tiles);
  document
    .querySelectorAll("#basemapTabs .seg-btn")
    .forEach((b) => b.classList.toggle("on", b.dataset.bm === key));
}
document
  .querySelectorAll("#basemapTabs .seg-btn")
  .forEach((b) => b.addEventListener("click", () => setBasemap(b.dataset.bm)));

// --- AlphaEarth 레이어 투명도 — 전역 뷰 설정, 맵 A·B 동시 적용 ----------
let currentOpacity = parseFloat(localStorage.getItem("aef_opacity"));
if (Number.isNaN(currentOpacity)) currentOpacity = 1;
function setOpacity(v, commit) {
  currentOpacity = v;
  viewer.setOpacity(v);
  compare.setOpacity(v);
  $("opacityOut").textContent = Math.round(v * 100) + "%";
  if (commit) {
    try {
      localStorage.setItem("aef_opacity", String(v));
    } catch {
      /* private mode 등 — 무시 */
    }
  }
}
$("opacity").value = String(currentOpacity);
$("opacityOut").textContent = Math.round(currentOpacity * 100) + "%";
$("opacity").addEventListener("input", () => setOpacity(Number($("opacity").value), false));
$("opacity").addEventListener("change", () => setOpacity(Number($("opacity").value), true));

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}

console.log(`AlphaEarth 탐색기 준비. 총 조합 ${TOTAL.toLocaleString()}개.`);
