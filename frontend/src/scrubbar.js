// 단일 그레이코드 스크럽 바 + 칩/필름스트립/북마크/재생 제어.
import { indexToTriple, tripleToIndex, bandName, isDegenerate, step, TOTAL } from "./graycode.js";

const FILMSTRIP_N = 9; // 필름스트립 미리보기 개수

export class ScrubControl {
  constructor(els, { onChange, makePreviewUrl }) {
    this.els = els; // {scrub, chipR,chipG,chipB, idxOut, play, skipDeg, bookmark, filmstrip, bookmarks}
    this.onChange = onChange; // (index, triple, {commit}) => void
    this.makePreviewUrl = makePreviewUrl; // (triple) => string|null  (필름스트립 썸네일)
    this.skipDegenerate = false;
    this.playing = false;
    this._timer = null;
    this.marks = [];

    const e = els;
    // 드래그 중에는 commit=false(프리뷰), 손 떼면 commit=true(풀해상도)
    e.scrub.addEventListener("input", () => this.set(Number(e.scrub.value), false));
    e.scrub.addEventListener("change", () => this.set(Number(e.scrub.value), true));
    e.play.addEventListener("click", () => this.togglePlay());
    e.skipDeg.addEventListener("click", () => {
      this.skipDegenerate = !this.skipDegenerate;
      e.skipDeg.classList.toggle("on", this.skipDegenerate);
    });
    e.bookmark.addEventListener("click", () => this.addBookmark());

    // 키보드 좌우 화살표로 한 프레임씩(중복 건너뛰기 반영)
    window.addEventListener("keydown", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      if (ev.key === "ArrowRight") this.set(step(this.index, +1, this.skipDegenerate), true);
      if (ev.key === "ArrowLeft") this.set(step(this.index, -1, this.skipDegenerate), true);
    });

    this.index = 0;
  }

  get triple() {
    return indexToTriple(this.index);
  }

  // 외부(URL 복원)에서 초기 인덱스 주입
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

  togglePlay() {
    this.playing = !this.playing;
    this.els.play.textContent = this.playing ? "⏸ 정지" : "▶ 재생";
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

  _renderChips() {
    const [r, g, b] = this.triple;
    this.els.chipR.textContent = `R ${bandName(r)}`;
    this.els.chipG.textContent = `G ${bandName(g)}`;
    this.els.chipB.textContent = `B ${bandName(b)}`;
    this.els.idxOut.textContent = `#${this.index}` + (isDegenerate(this.triple) ? " (중복)" : "");
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
