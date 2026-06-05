// Single gray-code scrub bar + chips / filmstrip / bookmarks / playback controls.
import { indexToTriple, tripleToIndex, bandName, isDegenerate, step, TOTAL } from "./graycode.js";
import { t, onLangChange } from "./i18n.js";

const FILMSTRIP_N = 9; // number of filmstrip preview thumbnails

export class ScrubControl {
  constructor(els, { onChange, makePreviewUrl }) {
    this.els = els; // {scrub, bandR,bandG,bandB, idxIn, idxDup, play, skipDeg, bookmark, filmstrip, bookmarks}
    this.onChange = onChange; // (index, triple, {commit}) => void
    this.makePreviewUrl = makePreviewUrl; // (triple) => string|null  (filmstrip thumbnail URL)
    this.skipDegenerate = false;
    this.playing = false;
    this._timer = null;
    this.marks = [];

    const e = els;
    // While dragging: commit=false (preview); on release: commit=true (full resolution)
    e.scrub.addEventListener("input", () => this.set(Number(e.scrub.value), false));
    e.scrub.addEventListener("change", () => this.set(Number(e.scrub.value), true));
    e.play.addEventListener("click", () => this.togglePlay());
    e.skipDeg.addEventListener("click", () => {
      this.skipDegenerate = !this.skipDegenerate;
      e.skipDeg.classList.toggle("on", this.skipDegenerate);
    });
    e.bookmark.addEventListener("click", () => this.addBookmark());

    // Direct R/G/B band number input → invert triple to gray-code index, then jump (commit).
    // Only applied on change (Enter / blur / spinner) to avoid mid-entry jumps.
    for (const inp of [e.bandR, e.bandG, e.bandB]) {
      inp.addEventListener("change", () => this._onBandInput());
    }

    // Direct combo index (#) input → jump to the corresponding gray-code index (out-of-range values wrap).
    e.idxIn.addEventListener("change", () => {
      if (e.idxIn.value === "" || Number.isNaN(Number(e.idxIn.value))) return;
      this.set(Number(e.idxIn.value), true);
    });

    // Left/right arrow keys step one frame at a time (respects skip-degenerate setting)
    window.addEventListener("keydown", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      if (ev.key === "ArrowRight") this.set(step(this.index, +1, this.skipDegenerate), true);
      if (ev.key === "ArrowLeft") this.set(step(this.index, -1, this.skipDegenerate), true);
    });

    this.index = 0;
    e.play.textContent = t("play");
    // Refresh dynamic strings (play/pause, dup label) when the language changes
    onLangChange(() => this.refreshI18n());
  }

  // After a language toggle, re-render only JS-owned text (static text is handled by applyI18n).
  refreshI18n() {
    this.els.play.textContent = this.playing ? t("pause") : t("play");
    this._renderChips();
  }

  get triple() {
    return indexToTriple(this.index);
  }

  // Inject an initial index from an external source (e.g. URL restore)
  init(index) {
    this.index = ((index % TOTAL) + TOTAL) % TOTAL;
    this.els.scrub.value = String(this.index);
    this._renderChips();
    this._renderFilmstrip();
    this.onChange(this.index, this.triple, { commit: true });
  }

  set(index, commit) {
    this.index = ((Math.round(index) % TOTAL) + TOTAL) % TOTAL;
    this.els.scrub.value = String(this.index);
    this._renderChips();
    if (commit) this._renderFilmstrip();
    this.onChange(this.index, this.triple, { commit });
  }

  // Update the display (slider, chips, filmstrip) without firing onChange.
  // Used when switching the active side (A/B) to reload the already-rendered value into controls.
  show(index) {
    this.index = ((Math.round(index) % TOTAL) + TOTAL) % TOTAL;
    this.els.scrub.value = String(this.index);
    this._renderChips();
    this._renderFilmstrip();
  }

  togglePlay() {
    this.playing = !this.playing;
    this.els.play.textContent = this.playing ? t("pause") : t("play");
    if (this.playing) {
      this._timer = setInterval(() => {
        this.set(step(this.index, +1, this.skipDegenerate), true);
      }, 120);
    } else {
      clearInterval(this._timer);
    }
  }

  addBookmark() {
    if (this.marks.includes(this.index)) return;
    this.marks.push(this.index);
    this._renderBookmarks();
  }

  // Normalize a band input value to an integer 0..63 (empty / non-integer → null = still typing).
  _readBand(el) {
    const v = Number(el.value);
    if (el.value === "" || Number.isNaN(v)) return null;
    return Math.min(63, Math.max(0, Math.round(v)));
  }

  _onBandInput() {
    const r = this._readBand(this.els.bandR);
    const g = this._readBand(this.els.bandG);
    const b = this._readBand(this.els.bandB);
    if (r === null || g === null || b === null) return;
    this.set(tripleToIndex([r, g, b]), true);
  }

  _renderChips() {
    const [r, g, b] = this.triple;
    // Programmatic .value assignment does not fire input/change events, so no feedback loop.
    this.els.bandR.value = r;
    this.els.bandG.value = g;
    this.els.bandB.value = b;
    this.els.idxIn.value = this.index;
    this.els.idxDup.textContent = isDegenerate(this.triple) ? t("dup") : "";
  }

  _renderFilmstrip() {
    const strip = this.els.filmstrip;
    strip.innerHTML = "";
    const span = Math.floor(TOTAL / FILMSTRIP_N);
    for (let k = 0; k < FILMSTRIP_N; k++) {
      const idx = (this.index + (k - (FILMSTRIP_N >> 1)) * span + TOTAL) % TOTAL;
      const cell = document.createElement("button");
      cell.className = "thumb";
      const [r, g, b] = indexToTriple(idx);
      cell.title = `${bandName(r)} ${bandName(g)} ${bandName(b)}`;
      const url = this.makePreviewUrl?.(indexToTriple(idx));
      if (url) cell.style.backgroundImage = `url("${url}")`;
      cell.addEventListener("click", () => this.set(idx, true));
      strip.appendChild(cell);
    }
  }

  _renderBookmarks() {
    const box = this.els.bookmarks;
    box.innerHTML = "";
    for (const m of this.marks) {
      const [r, g, b] = indexToTriple(m);
      const chip = document.createElement("button");
      chip.className = "markchip";
      chip.textContent = `${bandName(r)}·${bandName(g)}·${bandName(b)}`;
      chip.addEventListener("click", () => this.set(m, true));
      box.appendChild(chip);
    }
  }
}

export { tripleToIndex };
