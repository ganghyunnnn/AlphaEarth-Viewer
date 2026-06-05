import { Viewer } from "./viewer.js";
import { ScrubControl } from "./scrubbar.js";
import { Prefetcher } from "./prefetch.js";
import { CompareController } from "./compare.js";
import { SearchControl } from "./search.js";
import { readState, pushState, shareUrl } from "./state.js";
import { TOTAL, indexToTriple } from "./graycode.js";
import { applyI18n, setLang, getLang, onLangChange, t } from "./i18n.js";
import { BASEMAPS, DEFAULT_BASEMAP } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = readState();

// --- Map viewer (map A) -------------------------------------------------
const viewer = new Viewer("map", state);

// --- Compare mode (swipe) controller -----------------------------------
const compare = new CompareController({
  mapA: viewer.map,
  containerB: $("mapB"),
  divider: $("divider"),
});

// --- Side A/B parameters -----------------------------------------------
// A uses the top-level state (year/scrub/min/max) as-is (permalink compatible).
// B is proxied via state.b* fields. Both sides share the {year,scrub,min,max} interface.
const B = {
  get year() { return state.bYear; }, set year(v) { state.bYear = v; },
  get scrub() { return state.bScrub; }, set scrub(v) { state.bScrub = v; },
  get min() { return state.bMin; }, set min(v) { state.bMin = v; },
  get max() { return state.bMax; }, set max(v) { state.bMax = v; },
};
const sideParams = { A: state, B };
let activeSide = "A"; // the side currently being edited in the panel
let bSeeded = !!state.compare; // skip cloning A to B if B values were restored from permalink

// --- Idle-prediction prefetch (based on map A) -------------------------
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

// --- Active side render (drag = debounced preview, release = immediate full-res) ------
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

// --- Scrub bar ----------------------------------------------------------
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
      if (activeSide === "A") prefetcher.cancel(); // cancel prefetch during scrub (yield bandwidth)
      renderActive(commit);
      if (commit) pushState(state);
    },
    makePreviewUrl: () => null, // TODO: thumbnail based on TiTiler /cog/preview
  },
);

// --- Year slider --------------------------------------------------------
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

// --- Contrast (min/max): slider + numeric keyboard input (two-way sync) -----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Sync all 4 slider/number inputs to the current side's values.
function setRangeUI(p) {
  $("rmin").value = String(p.min);
  $("rmax").value = String(p.max);
  $("rminNum").value = String(p.min);
  $("rmaxNum").value = String(p.max);
}

function commitRange(commit) {
  if (activeSide === "A") prefetcher.cancel(); // cancel prefetch during contrast adjustment
  renderActive(true); // contrast is applied immediately (live)
  if (commit) pushState(state);
}

// Slider drag → value update (dragging = preview, release = commit).
function onRangeSlider(commit) {
  const p = sideParams[activeSide];
  p.min = Number($("rmin").value);
  p.max = Number($("rmax").value);
  $("rminNum").value = String(p.min);
  $("rmaxNum").value = String(p.max);
  commitRange(commit);
}

// Direct numeric input → clamped to slider domain and applied. Only on change (Enter/blur).
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

// --- Switch active edit side (A/B) -------------------------------------
// Restores the selected side's saved values into the controls (render is already applied, so silent).
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

// --- Compare mode toggle ------------------------------------------------
function setCompare(on) {
  state.compare = on ? 1 : 0;
  document.body.classList.toggle("compare-on", on);
  $("compare").classList.toggle("on", on);
  $("sideTabs").hidden = !on;
  if (on) {
    // On enable, clone current A into B (start from the same view → change one side to compare).
    // Skip if B values were already restored from a permalink.
    if (!bSeeded) {
      B.year = state.year;
      B.scrub = state.scrub;
      B.min = state.min;
      B.max = state.max;
      bSeeded = true;
    }
    compare.enable({ year: B.year, triple: indexToTriple(B.scrub), range: { min: B.min, max: B.max } });
    compare.setSwipe(state.swipe);
    // On enable, explicitly sync B with the current global view settings (basemap/opacity/layer on/off).
    const bm = BASEMAPS[currentBasemap];
    compare.setBasemapTiles(bm.tiles, bm.attribution);
    compare.setOpacity(currentOpacity);
    compare.setVisible(aefOn);
  } else {
    compare.disable();
    setActiveSide("A"); // single view → return to editing A
  }
  pushState(state);
}
$("compare").addEventListener("click", () => setCompare(state.compare ? false : true));
compare.onSwipeEnd = (t) => {
  state.swipe = t;
  pushState(state);
};

// --- Panel collapse/expand ----------------------------------------------
$("collapse").addEventListener("click", () => {
  const collapsed = $("panel").classList.toggle("collapsed");
  $("collapse").setAttribute("aria-expanded", String(!collapsed));
});

// --- Share button -------------------------------------------------------
$("share").addEventListener("click", async () => {
  const url = shareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    flash($("share"), t("copied"));
  } catch {
    prompt("Share URL", url);
  }
});

// --- Map move → state update -------------------------------------------
viewer.onMoveStart = () => prefetcher.cancel(); // pan/zoom start → cancel prefetch
viewer.onMove = ({ lng, lat, zoom }) => {
  state.lng = lng;
  state.lat = lat;
  state.zoom = zoom;
  pushState(state);
};

// idle = visible tiles fully loaded → only then run neighbor/margin prefetch (no competition with cold loads).
viewer.onIdle = () => pfSettle();

// --- Initialization -----------------------------------------------------
viewer.whenReady(() => {
  scrub.init(state.scrub); // resolve triple → onChange → viewer.setRender → create mosaic source
  setBasemap(currentBasemap); // restore saved basemap (swap base tiles if not dark)
  setOpacity(currentOpacity, false); // apply saved opacity (after layer is created)
  setAefOn(aefOn, false); // apply saved layer on/off state
  if (state.compare) setCompare(true); // restore from permalink
});

// --- i18n + language toggle ---------------------------------------------
applyI18n(); // apply static text (data-i18n attributes)
function syncLangUI() {
  document.title = t("appTitle");
  // toggle button shows the language to switch to
  $("langToggle").textContent = getLang() === "en" ? "한국어" : "EN";
}
syncLangUI();
onLangChange(syncLangUI);
$("langToggle").addEventListener("click", () => setLang(getLang() === "en" ? "ko" : "en"));

// --- Place/coordinate search + collapse toggle -------------------------
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

// --- Basemap switch (dark/satellite/OSM) — global view setting, applied to both map A and B -------
let currentBasemap = localStorage.getItem("aef_basemap") || DEFAULT_BASEMAP;
if (!BASEMAPS[currentBasemap]) currentBasemap = "dark";
function setBasemap(key) {
  if (!BASEMAPS[key]) return;
  currentBasemap = key;
  try {
    localStorage.setItem("aef_basemap", key);
  } catch {
    /* private mode etc. — ignore */
  }
  const { tiles, attribution } = BASEMAPS[key];
  viewer.setBasemapTiles(tiles, attribution);
  compare.setBasemapTiles(tiles, attribution);
  document
    .querySelectorAll("#basemapTabs .seg-btn")
    .forEach((b) => b.classList.toggle("on", b.dataset.bm === key));
}
document
  .querySelectorAll("#basemapTabs .seg-btn")
  .forEach((b) => b.addEventListener("click", () => setBasemap(b.dataset.bm)));

// --- AlphaEarth layer opacity — global view setting, applied to both map A and B ----------
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
      /* private mode etc. — ignore */
    }
  }
}
$("opacity").value = String(currentOpacity);
$("opacityOut").textContent = Math.round(currentOpacity * 100) + "%";
$("opacity").addEventListener("input", () => setOpacity(Number($("opacity").value), false));
$("opacity").addEventListener("change", () => setOpacity(Number($("opacity").value), true));

// --- AlphaEarth layer on/off — hide layer when off (tile requests also stop) -------
let aefOn = localStorage.getItem("aef_on");
aefOn = aefOn === null ? true : aefOn === "1";
function setAefOn(on, commit) {
  aefOn = on;
  viewer.setVisible(on);
  compare.setVisible(on);
  const btn = $("aefToggle");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "ON" : "OFF";
  $("opacity").disabled = !on; // disable opacity slider when layer is off
  if (commit) {
    try {
      localStorage.setItem("aef_on", on ? "1" : "0");
    } catch {
      /* private mode etc. — ignore */
    }
  }
}
$("aefToggle").addEventListener("click", () => setAefOn(!aefOn, true));

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}

console.log(`AlphaEarth Viewer ready. Total combinations: ${TOTAL.toLocaleString()}.`);
