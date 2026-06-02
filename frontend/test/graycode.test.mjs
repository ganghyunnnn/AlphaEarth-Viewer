// 의존성 없는 테스트 러너: `node frontend/test/graycode.test.mjs`
// 실패 시 비0 종료코드.
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

// 1) 왕복 변환(round-trip): 모든 인덱스에 대해 tripleToIndex(indexToTriple(i)) === i
{
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    if (tripleToIndex(indexToTriple(i)) !== i) {
      ok = false;
      console.error("    round-trip 실패 @", i, indexToTriple(i));
      break;
    }
  }
  check("round-trip 변환 (전체 262144개)", ok);
}

// 2) 전단사(bijection): 모든 트리플이 정확히 한 번씩 등장
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
      console.error("    중복 트리플 @", i, [r, g, b]);
      break;
    }
    seen[key] = 1;
  }
  check("전단사: 모든 (r,g,b) 정확히 1회", ok);
}

// 3) 그레이코드 인접성: 연속 인덱스는 정확히 한 채널에서 ±1밴드만 차이
{
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    const a = indexToTriple(i);
    const b = indexToTriple((i + 1) % TOTAL); // 마지막→처음 래핑은 검사 제외
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
      console.error("    인접성 위반 @", i, a, "->", b);
      break;
    }
  }
  check("인접 프레임: 한 채널 ±1밴드만 변화", ok);
}

// 4) 밴드명 / bidx 헬퍼
check("bandName(0)=A00", bandName(0) === "A00");
check("bandName(9)=A09", bandName(9) === "A09");
check("bandName(63)=A63", bandName(63) === "A63");
check("toBidx(0)=1 (1-indexed)", toBidx(0) === 1);
check("toBidx(63)=64", toBidx(63) === 64);

// 5) 중복 프레임 판정 + 건너뛰기 스텝
check("isDegenerate([5,5,9]) true", isDegenerate([5, 5, 9]) === true);
check("isDegenerate([1,16,41]) false", isDegenerate([1, 16, 41]) === false);
{
  // skipDegenerate 스텝은 항상 비중복 프레임에 도달
  let ok = true;
  let i = 0;
  for (let n = 0; n < 1000; n++) {
    i = step(i, +1, true);
    if (isDegenerate(indexToTriple(i))) {
      ok = false;
      break;
    }
  }
  check("step(skipDegenerate) 결과는 항상 비중복", ok);
}

// 6) 범위 밖 인덱스 래핑
check("indexToTriple(-1) === indexToTriple(TOTAL-1)", JSON.stringify(indexToTriple(-1)) === JSON.stringify(indexToTriple(TOTAL - 1)));
check("indexToTriple(TOTAL) === indexToTriple(0)", JSON.stringify(indexToTriple(TOTAL)) === JSON.stringify(indexToTriple(0)));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
