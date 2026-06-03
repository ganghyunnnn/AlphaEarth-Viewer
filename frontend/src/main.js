import { Viewer } from "./viewer.js";
import { ScrubControl } from "./scrubbar.js";
import { Prefetcher } from "./prefetch.js";
import { readState, pushState, shareUrl } from "./state.js";
import { TOTAL } from "./graycode.js";

const $ = (id) => document.getElementById(id);

const state = readState();

// --- 지도 뷰어 ----------------------------------------------------------
const viewer = new Viewer("map", state);

// --- 유휴 예측 프리페치 -------------------------------------------------
// 사용자가 멈춘 동안 스크럽 ±1 이웃 프레임(타일당 1밴드만 콜드)과 팬 마진을 미리
// 당겨와 캐시를 데운다. 상호작용 시작 시 즉시 취소해 실 요청에 대역폭을 양보.
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

// --- 스크럽 바 ----------------------------------------------------------
let renderTimer = null;
function debouncedRender(triple, commit) {
  if (commit) {
    clearTimeout(renderTimer);
    viewer.setRender(triple, { min: state.min, max: state.max });
    return;
  }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(
    () => viewer.setRender(triple, { min: state.min, max: state.max }),
    150,
  );
}

const scrub = new ScrubControl(
  {
    scrub: $("scrub"),
    chipR: $("chipR"),
    chipG: $("chipG"),
    chipB: $("chipB"),
    idxOut: $("idxOut"),
    play: $("play"),
    skipDeg: $("skipDeg"),
    bookmark: $("bookmark"),
    filmstrip: $("filmstrip"),
    bookmarks: $("bookmarks"),
  },
  {
    onChange: (index, triple, { commit }) => {
      state.scrub = index;
      prefetcher.cancel(); // 스크럽 중엔 프리페치 중단(대역폭 양보) — idle 후 재개
      debouncedRender(triple, commit);
      if (commit) pushState(state);
    },
    makePreviewUrl: () => null, // TODO: TiTiler /cog/preview 기반 썸네일
  },
);

// --- 연도 슬라이더 ------------------------------------------------------
$("year").value = String(state.year);
$("yearOut").textContent = String(state.year);
$("year").addEventListener("input", () => {
  state.year = Number($("year").value);
  $("yearOut").textContent = String(state.year);
  prefetcher.cancel(); // 연도 변경 중단 — idle 후 재개
  viewer.setYear(state.year);
  pushState(state);
});

// --- 대비(min/max) ------------------------------------------------------
function syncRange(commit) {
  state.min = Number($("rmin").value);
  state.max = Number($("rmax").value);
  $("rOut").textContent = `${state.min} ~ ${state.max}`;
  prefetcher.cancel(); // 대비 조정 중엔 프리페치 중단 — idle 후 재개
  viewer.setRender(scrub.triple, { min: state.min, max: state.max });
  if (commit) pushState(state);
}
$("rmin").value = String(state.min);
$("rmax").value = String(state.max);
$("rmin").addEventListener("input", () => syncRange(false));
$("rmax").addEventListener("input", () => syncRange(false));
$("rmin").addEventListener("change", () => syncRange(true));
$("rmax").addEventListener("change", () => syncRange(true));
$("rOut").textContent = `${state.min.toFixed(2)} ~ ${state.max.toFixed(2)}`;

// --- 공유 버튼 ----------------------------------------------------------
$("share").addEventListener("click", async () => {
  const url = shareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    flash($("share"), "복사됨!");
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
});

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}

console.log(`AlphaEarth 탐색기 준비. 총 조합 ${TOTAL.toLocaleString()}개.`);
