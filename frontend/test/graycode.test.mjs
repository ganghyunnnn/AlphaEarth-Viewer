// Dependency-free test runner: `node frontend/test/graycode.test.mjs`
// Exits with a non-zero code on failure.
import {
  BANDS,
  CHANNELS,
  TOTAL,
  indexToTriple,
  tripleToIndex,
  bandName,
  toBidx,
  isDegenerate,
  step,
} from "../src/graycode.js";

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log("  ok  -", name);
  } else {
    console.error("  FAIL -", name);
    failed++;
  }
}

// 1) round-trip: for every index, tripleToIndex(indexToTriple(i)) === i
{
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    if (tripleToIndex(indexToTriple(i)) !== i) {
      ok = false;
      console.error("    round-trip failed @", i, indexToTriple(i));
      break;
    }
  }
  check("round-trip conversion (all 262144)", ok);
}

// 2) bijection: every triple appears exactly once
{
  const seen = new Uint8Array(TOTAL);
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    const [r, g, b] = indexToTriple(i);
    if (r < 0 || r >= BANDS || g < 0 || g >= BANDS || b < 0 || b >= BANDS) {
      ok = false;
      break;
    }
    const key = (r * BANDS + g) * BANDS + b;
    if (seen[key]) {
      ok = false;
      console.error("    duplicate triple @", i, [r, g, b]);
      break;
    }
    seen[key] = 1;
  }
  check("bijection: every (r,g,b) exactly once", ok);
}

// 3) gray-code adjacency: consecutive indices differ by ±1 band in exactly one channel
{
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    const a = indexToTriple(i);
    const b = indexToTriple((i + 1) % TOTAL); // skip checking the last->first wrap
    if (i === TOTAL - 1) continue;
    let diffs = 0;
    let maxDelta = 0;
    for (let c = 0; c < CHANNELS; c++) {
      const d = Math.abs(a[c] - b[c]);
      if (d !== 0) {
        diffs++;
        maxDelta = Math.max(maxDelta, d);
      }
    }
    if (diffs !== 1 || maxDelta !== 1) {
      ok = false;
      console.error("    adjacency violation @", i, a, "->", b);
      break;
    }
  }
  check("adjacent frames: only one channel changes by ±1 band", ok);
}

// 4) band name / bidx helpers
check("bandName(0)=A00", bandName(0) === "A00");
check("bandName(9)=A09", bandName(9) === "A09");
check("bandName(63)=A63", bandName(63) === "A63");
check("toBidx(0)=1 (1-indexed)", toBidx(0) === 1);
check("toBidx(63)=64", toBidx(63) === 64);

// 5) degenerate-frame detection + skip step
check("isDegenerate([5,5,9]) true", isDegenerate([5, 5, 9]) === true);
check("isDegenerate([1,16,41]) false", isDegenerate([1, 16, 41]) === false);
{
  // skipDegenerate steps always land on a non-degenerate frame
  let ok = true;
  let i = 0;
  for (let n = 0; n < 1000; n++) {
    i = step(i, +1, true);
    if (isDegenerate(indexToTriple(i))) {
      ok = false;
      break;
    }
  }
  check("step(skipDegenerate) result is always non-degenerate", ok);
}

// 6) out-of-range index wrapping
check("indexToTriple(-1) === indexToTriple(TOTAL-1)", JSON.stringify(indexToTriple(-1)) === JSON.stringify(indexToTriple(TOTAL - 1)));
check("indexToTriple(TOTAL) === indexToTriple(0)", JSON.stringify(indexToTriple(TOTAL)) === JSON.stringify(indexToTriple(0)));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
