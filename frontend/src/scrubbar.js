// 단일 그레이코드 스크럽 바 + 칩/필름스트립/북마크/재생 제어.
import { indexToTriple, tripleToIndex, bandName, isDegenerate, step, TOTAL } from "./graycode.js";

const FILMSTRIP_N = 9; // 필름스트립 미리보기 개수

export class ScrubControl {
  constructor(els, { onChange, makePreviewUrl }) {
    this.els = els; // {scrub, bandR,bandG,bandB, idxOut, play, skipDeg, bookmark, filmstrip, bookmarks}
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

    // R/G/B 밴드 번호 직접 입력 → triple→그레이코드 인덱스 역산 후 점프(commit).
    // change(Enter/blur/스피너)에서만 반영해 여러 자리 입력 중 튀지 않게 한다.
    for (const inp of [e.bandR, e.bandG, e.bandB]) {
      inp.addEventListener("change", () => this._onBandInput());
    }

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

  // 화면(슬라이더·칩·필름스트립)만 갱신하고 onChange는 호출하지 않는다.
  // 편집 대상(A/B) 전환 시 이미 렌더된 측의 값을 컨트롤에 되불러올 때 사용.
  show(index) {
    this.index = ((Math.round(index) % TOTAL) + TOTAL) % TOTAL;
    this.els.scrub.value = String(this.index);
    this._renderChips();
    this._renderFilmstrip();
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

  // 밴드 입력값 → 정수 0..63로 보정(빈 값/비정수는 null = 입력 중으로 간주).
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
    // 프로그램적 .value 설정은 input/change 이벤트를 발생시키지 않아 피드백 루프 없음.
    this.els.bandR.value = r;
    this.els.bandG.value = g;
    this.els.bandB.value = b;
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
