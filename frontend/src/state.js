// URL permalink: serializes/restores the full viewer state as a query string.
import { DEFAULTS } from "./config.js";

const KEYS = [
  "year", "scrub", "min", "max", "lng", "lat", "zoom",
  "compare", "swipe", "bYear", "bScrub", "bMin", "bMax",
];

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

// Only include entries that differ from defaults, keeping the URL concise.
export function toQuery(s) {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    let v = s[k];
    if (k === "lng" || k === "lat") v = round(v, 5);
    else if (k === "swipe") v = round(v, 3);
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
