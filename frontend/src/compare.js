// 비교(스와이프) 모드.
//
// 맵 A 위에 두 번째 맵 B를 전체 크기로 겹쳐 띄우고, 카메라를 양방향 동기화한다.
// 분할 경계(swipe) 기준으로 B 컨테이너를 clip-path(inset)로 잘라 오른쪽만 보이게 하면
// 왼쪽=A / 오른쪽=B 로 한 화면에서 두 조합을 나란히 비교할 수 있다.
//
// clip-path 는 렌더링뿐 아니라 히트테스트도 자르므로(좌측 영역의 포인터 이벤트는 B를
// 통과해 아래 A로 전달) 별도 pointer-events 처리 없이 양쪽 모두 자연스럽게 조작된다.
// 디바이더 핸들만 최상단에서 자체 드래그 핸들러로 경계를 옮긴다.
import maplibregl from "maplibre-gl";
import { BASEMAP_TILES } from "./config.js";
import { applyAef, baseStyle, setBasemap as setMapBasemap } from "./aeflayer.js";

export class CompareController {
  constructor({ mapA, containerB, divider }) {
    this.mapA = mapA;
    this.containerB = containerB; // #mapB
    this.divider = divider; // #divider (핸들 포함)
    this.mapB = null;
    this.active = false;
    this.swipe = 0.5; // 0..1, 경계의 가로 위치
    this._syncing = false;
    this._renderB = null; // {year, triple, range}
    this._basemapTiles = null; // 현재 베이스맵 타일(맵 B 생성/전환에 사용)
    this._opacity = null; // 현재 AEF 레이어 투명도(맵 B 생성 후 적용)
    this._visible = null; // 현재 AEF 레이어 on/off(맵 B 생성 후 적용)
    this.onSwipeEnd = null; // (swipe) => void — 드래그 종료 시(상태 저장용)

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this.divider.addEventListener("mousedown", this._onDown);
    this.divider.addEventListener("touchstart", this._onDown, { passive: false });
  }

  // 첫 진입 시 B 맵 1회 생성 후 카메라 동기화 연결(이후 재사용).
  _ensureMapB() {
    if (this.mapB) return;
    const c = this.mapA.getCenter();
    this.mapB = new maplibregl.Map({
      container: this.containerB,
      style: baseStyle(this._basemapTiles || BASEMAP_TILES),
      center: [c.lng, c.lat],
      zoom: this.mapA.getZoom(),
      bearing: this.mapA.getBearing(),
      pitch: this.mapA.getPitch(),
      attributionControl: false,
    });
    this._link(this.mapA, this.mapB);
    this._link(this.mapB, this.mapA);
  }

  // src 카메라 변화를 dst에 반영(피드백 루프 방지 가드).
  _link(src, dst) {
    src.on("move", () => {
      if (this._syncing) return;
      this._syncing = true;
      dst.jumpTo({
        center: src.getCenter(),
        zoom: src.getZoom(),
        bearing: src.getBearing(),
        pitch: src.getPitch(),
      });
      this._syncing = false;
    });
  }

  // 활성화: B 맵 생성/표시 → A 카메라에 동기화 → B 렌더 적용 → 클립 갱신.
  enable(renderB) {
    this._renderB = renderB;
    this.active = true;
    this.containerB.classList.add("on");
    this.divider.classList.add("on");
    this._ensureMapB();
    this.mapB.resize();
    this._syncing = true;
    this.mapB.jumpTo({
      center: this.mapA.getCenter(),
      zoom: this.mapA.getZoom(),
      bearing: this.mapA.getBearing(),
      pitch: this.mapA.getPitch(),
    });
    this._syncing = false;
    this.setRenderB(renderB);
    this.setSwipe(this.swipe);
  }

  disable() {
    this.active = false;
    this.containerB.classList.remove("on");
    this.divider.classList.remove("on");
  }

  // B 맵의 연도/밴드조합/대비 갱신.
  setRenderB(render) {
    this._renderB = render;
    if (!this.mapB) return;
    const run = () => {
      applyAef(this.mapB, render);
      if (this.mapB.getLayer("aef")) {
        if (this._opacity != null) this.mapB.setPaintProperty("aef", "raster-opacity", this._opacity);
        if (this._visible != null) {
          this.mapB.setLayoutProperty("aef", "visibility", this._visible ? "visible" : "none");
        }
      }
    };
    if (this.mapB.loaded()) run();
    else this.mapB.once("load", run);
  }

  // AEF 레이어 투명도(0..1) — 맵 B에 적용(아직 없으면 다음 렌더 시 반영).
  setOpacity(v) {
    this._opacity = v;
    if (this.mapB && this.mapB.getLayer && this.mapB.getLayer("aef")) {
      this.mapB.setPaintProperty("aef", "raster-opacity", v);
    }
  }

  // AEF 레이어 on/off — 맵 B에 적용(아직 없으면 다음 렌더 시 반영).
  setVisible(on) {
    this._visible = on;
    if (this.mapB && this.mapB.getLayer && this.mapB.getLayer("aef")) {
      this.mapB.setLayoutProperty("aef", "visibility", on ? "visible" : "none");
    }
  }

  // 베이스맵 전환 → 맵 B의 base 소스/레이어 재생성(아직 없으면 다음 생성 시 반영).
  setBasemapTiles(tiles, attribution) {
    this._basemapTiles = tiles;
    if (!this.mapB) return;
    setMapBasemap(this.mapB, tiles, attribution);
  }

  // 경계 위치(0..1) 설정 → B를 왼쪽에서 swipe만큼 잘라 오른쪽만 노출.
  setSwipe(t) {
    this.swipe = Math.min(1, Math.max(0, t));
    const pct = (this.swipe * 100).toFixed(2) + "%";
    this.containerB.style.clipPath = `inset(0 0 0 ${pct})`;
    this.divider.style.left = pct;
  }

  _onDown(ev) {
    ev.preventDefault();
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("touchmove", this._onMove, { passive: false });
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("touchend", this._onUp);
  }

  _onMove(ev) {
    if (ev.cancelable) ev.preventDefault();
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const rect = this.mapA.getContainer().getBoundingClientRect();
    this.setSwipe((x - rect.left) / rect.width);
  }

  _onUp() {
    window.removeEventListener("mousemove", this._onMove);
    window.removeEventListener("touchmove", this._onMove);
    window.removeEventListener("mouseup", this._onUp);
    window.removeEventListener("touchend", this._onUp);
    this.onSwipeEnd?.(this.swipe);
  }
}
