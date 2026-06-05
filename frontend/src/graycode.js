// Reflected n-ary gray code.
// Sweep the 3-channel x 64-band cube (64^3 = 262,144) with a single scrub index,
// ordered so adjacent indices (i, i+1) differ by exactly ±1 band in one channel.
// -> Dragging the scrub bar morphs the map smoothly. The conversion is closed-form, no backend.

export const BANDS = 64; // A00..A63
export const CHANNELS = 3; // R, G, B
export const TOTAL = BANDS ** CHANNELS; // 262144

// integer i -> base-64 digits (most-significant first, length 3)
function toDigits(i) {
  const d = new Array(CHANNELS);
  for (let k = CHANNELS - 1; k >= 0; k--) {
    d[k] = i % BANDS;
    i = Math.floor(i / BANDS);
  }
  return d; // d[0] = MSB
}

// scrub index -> [r, g, b] (each 0..63)
// reflected gray code: g[k] = a[k]            (sum of a[0..k-1] is even)
//                      g[k] = (BANDS-1)-a[k]  (odd)
export function indexToTriple(i) {
  if (!Number.isInteger(i)) i = Math.round(i);
  i = ((i % TOTAL) + TOTAL) % TOTAL; // wrap into range
  const a = toDigits(i);
  const g = new Array(CHANNELS);
  let sum = 0; // running sum of gray digits (not original a -- key to unit-distance for d>=3)
  for (let k = 0; k < CHANNELS; k++) {
    g[k] = sum % 2 === 0 ? a[k] : BANDS - 1 - a[k];
    sum += g[k];
  }
  return g;
}

// [r, g, b] -> scrub index (inverse of indexToTriple)
export function tripleToIndex(triple) {
  const a = new Array(CHANNELS);
  let sum = 0; // sum of gray digits (triple) -- same parity sequence as forward
  for (let k = 0; k < CHANNELS; k++) {
    a[k] = sum % 2 === 0 ? triple[k] : BANDS - 1 - triple[k];
    sum += triple[k];
  }
  let i = 0;
  for (let k = 0; k < CHANNELS; k++) i = i * BANDS + a[k];
  return i;
}

// band index -> dataset band name (A00..A63)
export const bandName = (b) => "A" + String(b).padStart(2, "0");

// TiTiler bands are 1-indexed: A_n -> bidx = n+1
export const toBidx = (b) => b + 1;

// is this a degenerate frame (two channels share a band)?
export const isDegenerate = (t) => t[0] === t[1] || t[1] === t[2] || t[0] === t[2];

// step move (±1). If skipDegenerate=true, skip degenerate frames.
export function step(i, dir, skipDegenerate = false) {
  let j = (((i + dir) % TOTAL) + TOTAL) % TOTAL;
  if (!skipDegenerate) return j;
  let guard = 0;
  while (isDegenerate(indexToTriple(j)) && guard < TOTAL) {
    j = (((j + dir) % TOTAL) + TOTAL) % TOTAL;
    guard++;
  }
  return j;
}
