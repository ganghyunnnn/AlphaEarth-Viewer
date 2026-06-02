// 반사(reflected) n-ary 그레이코드.
// 3채널 × 64밴드 큐브(64^3 = 262,144)를 단일 스크럽 인덱스로 훑되,
// 인접한 인덱스(i, i+1)는 정확히 한 채널에서 ±1밴드만 달라지도록 정렬한다.
// → 스크럽 바를 끌면 화면이 끊김 없이 모핑된다. 변환은 닫힌 수식이라 백엔드 불필요.

export const BANDS = 64; // A00..A63
export const CHANNELS = 3; // R, G, B
export const TOTAL = BANDS ** CHANNELS; // 262144

// 정수 i -> base-64 자릿수(최상위 자리부터, 길이 3)
function toDigits(i) {
  const d = new Array(CHANNELS);
  for (let k = CHANNELS - 1; k >= 0; k--) {
    d[k] = i % BANDS;
    i = Math.floor(i / BANDS);
  }
  return d; // d[0] = MSB
}

// 스크럽 인덱스 -> [r, g, b] (각 0..63)
// 반사 그레이코드: g[k] = a[k]            (a[0..k-1] 합이 짝수)
//                  g[k] = (BANDS-1)-a[k]  (홀수)
export function indexToTriple(i) {
  if (!Number.isInteger(i)) i = Math.round(i);
  i = ((i % TOTAL) + TOTAL) % TOTAL; // 범위로 래핑
  const a = toDigits(i);
  const g = new Array(CHANNELS);
  let sum = 0; // 지금까지의 그레이 자릿수 합(원본 a가 아님 — d>=3 단위거리 보장의 핵심)
  for (let k = 0; k < CHANNELS; k++) {
    g[k] = sum % 2 === 0 ? a[k] : BANDS - 1 - a[k];
    sum += g[k];
  }
  return g;
}

// [r, g, b] -> 스크럽 인덱스 (indexToTriple의 역변환)
export function tripleToIndex(triple) {
  const a = new Array(CHANNELS);
  let sum = 0; // 그레이 자릿수(triple) 합 — forward와 동일 패리티 시퀀스
  for (let k = 0; k < CHANNELS; k++) {
    a[k] = sum % 2 === 0 ? triple[k] : BANDS - 1 - triple[k];
    sum += triple[k];
  }
  let i = 0;
  for (let k = 0; k < CHANNELS; k++) i = i * BANDS + a[k];
  return i;
}

// 밴드 인덱스 -> 데이터셋 밴드명 (A00..A63)
export const bandName = (b) => "A" + String(b).padStart(2, "0");

// TiTiler 밴드는 1-indexed: A_n -> bidx = n+1
export const toBidx = (b) => b + 1;

// 중복 프레임(두 채널이 같은 밴드)인가
export const isDegenerate = (t) => t[0] === t[1] || t[1] === t[2] || t[0] === t[2];

// 스텝 이동(±1). skipDegenerate=true면 중복 프레임을 건너뛴다.
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
