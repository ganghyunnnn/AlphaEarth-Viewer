// URL permalink: 전체 뷰어 상태를 쿼리스트링으로 직렬화/복원.
import { DEFAULTS } from "./config.js";

const KEYS = ["year", "scrub", "min", "max", "lng", "lat", "zoom"];

export function readState() {
  const p = new URLSearchParams(location.search);
  const s = { ...DEFAULTS };
  for (const k of KEYS) {
    if (p.has(k)) {
      const v = Number(p.get(k));
      if (!Number.isNaN(v)) s[k] = v;
    }
  }
  return s;
}

// 기본값과 다른 항목만 URL에 담아 간결하게 유지
export function toQuery(s) {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = k === "lng" || k === "lat" ? round(s[k], 5) : s[k];
    if (v !== DEFAULTS[k]) p.set(k, String(v));
  }
  return p.toString();
}

export function pushState(s, { replace = true } = {}) {
  const q = toQuery(s);
  const url = q ? `?${q}` : location.pathname;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}

export function shareUrl(s) {
  const q = toQuery(s);
  return `${location.origin}${location.pathname}${q ? "?" + q : ""}`;
}

const round = (v, d) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
