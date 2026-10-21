// Myers diff on integer arrays, with prefix and suffix trim, a cost cap and an approximate fallback.
// An edit script is a list of runs: { t: 0 equal | 1 delete (from a) | 2 add (from b), a, b, n }.
// For equal runs a and b are the start of the run in each array. For deletes only a counts, for adds only b.

export const EQ = 0, DEL = 1, ADD = 2;

const DEFAULT_MAX_D = 3000;
const DEFAULT_BUDGET = 80_000_000; // snake comparisons per call tree

function pushRun(out, t, a, b, n) {
  if (n <= 0) return;
  const last = out[out.length - 1];
  if (last && last.t === t) {
    if (t === EQ && last.a + last.n === a && last.b + last.n === b) { last.n += n; return; }
    if (t === DEL && last.a + last.n === a) { last.n += n; return; }
    if (t === ADD && last.b + last.n === b) { last.n += n; return; }
  }
  out.push({ t, a, b, n });
}

/** Plain Myers on a[aS..aE) and b[bS..bE). Returns an array of runs, or null if cost passes maxD or the budget. */
function myers(a, aS, aE, b, bS, bE, maxD, state) {
  const N = aE - aS;
  const M = bE - bS;
  if (N === 0 && M === 0) return [];
  if (N === 0) return [{ t: ADD, a: aS, b: bS, n: M }];
  if (M === 0) return [{ t: DEL, a: aS, b: bS, n: N }];
  const cap = Math.min(maxD, N + M);
  const off = cap + 1;
  const V = new Int32Array(2 * cap + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= cap && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
      else x = V[off + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < N && y < M && a[aS + x] === b[bS + y]) { x++; y++; }
      state.budget -= x - x0 + 1;
      V[off + k] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    if (found >= 0) break;
    if (state.budget < 0) return null;
    trace.push(V.slice(off - d, off + d + 1));
  }
  if (found < 0) return null;
  // Backtrack.
  const rev = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const prev = trace[d - 1]; // covers k in [-(d-1), d-1], index k + (d-1)
    const pOff = d - 1;
    let prevK;
    if (k === -d || (k !== d && prev[pOff + k - 1] < prev[pOff + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = prev[pOff + prevK];
    const prevY = prevX - prevK;
    // snake from the edit point to (x, y)
    let sx = prevK === k + 1 ? prevX : prevX + 1; // after the edit
    let sy = sx - k;
    const n = x - sx;
    if (n > 0) rev.push({ t: EQ, a: aS + sx, b: bS + sy, n });
    if (prevK === k + 1) rev.push({ t: ADD, a: aS + prevX, b: bS + prevY, n: 1 });
    else rev.push({ t: DEL, a: aS + prevX, b: bS + prevY, n: 1 });
    x = prevX;
    y = prevY;
  }
  if (x > 0) rev.push({ t: EQ, a: aS, b: bS, n: x });
  const out = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    pushRun(out, r.t, r.a, r.b, r.n);
  }
  return out;
}

/** Longest increasing subsequence of values; returns indices into the input. */
function lis(vals) {
  const n = vals.length;
  const tails = [];
  const tailIdx = [];
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < vals[i]) lo = mid + 1; else hi = mid;
    }
    tails[lo] = vals[i];
    tailIdx[lo] = i;
    if (lo > 0) prev[i] = tailIdx[lo - 1];
  }
  const out = [];
  let k = tailIdx[tails.length - 1];
  while (k !== undefined && k >= 0) { out.push(k); k = prev[k]; }
  return out.reverse();
}

/** Anchors: lines that occur exactly once in both ranges, kept in order. Returns pairs [ia, ib]. */
function uniqueAnchors(a, aS, aE, b, bS, bE) {
  const posA = new Map();
  for (let i = aS; i < aE; i++) {
    const v = a[i];
    posA.set(v, posA.has(v) ? -1 : i);
  }
  const posB = new Map();
  for (let j = bS; j < bE; j++) {
    const v = b[j];
    posB.set(v, posB.has(v) ? -1 : j);
  }
  const pairs = [];
  for (let i = aS; i < aE; i++) {
    const v = a[i];
    if (posA.get(v) !== i) continue;
    const j = posB.get(v);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }
  if (pairs.length === 0) return pairs;
  const idx = lis(pairs.map((p) => p[1]));
  return idx.map((i) => pairs[i]);
}

function diffRange(a, aS, aE, b, bS, bE, o, state, out, depth) {
  // trim common prefix and suffix
  let ps = 0;
  while (aS + ps < aE && bS + ps < bE && a[aS + ps] === b[bS + ps]) ps++;
  if (ps) pushRun(out, EQ, aS, bS, ps);
  aS += ps; bS += ps;
  let ss = 0;
  while (aE - ss > aS && bE - ss > bS && a[aE - ss - 1] === b[bE - ss - 1]) ss++;
  const tailA = aE - ss;
  const tailB = bE - ss;
  aE = tailA; bE = tailB;
  if (aS === aE && bS === bE) { /* nothing in the middle */ }
  else if (aS === aE) pushRun(out, ADD, aS, bS, bE - bS);
  else if (bS === bE) pushRun(out, DEL, aS, bS, aE - aS);
  else {
    const res = myers(a, aS, aE, b, bS, bE, o.maxD, state);
    if (res) { for (const r of res) pushRun(out, r.t, r.a, r.b, r.n); }
    else {
      state.approximate = true;
      const anchors = depth < 6 && state.budget > 0 ? uniqueAnchors(a, aS, aE, b, bS, bE) : [];
      if (anchors.length === 0) {
        pushRun(out, DEL, aS, bS, aE - aS);
        pushRun(out, ADD, aE, bS, bE - bS);
      } else {
        let pa = aS;
        let pb = bS;
        for (const [ia, ib] of anchors) {
          diffRange(a, pa, ia, b, pb, ib, o, state, out, depth + 1);
          pushRun(out, EQ, ia, ib, 1);
          pa = ia + 1; pb = ib + 1;
        }
        diffRange(a, pa, aE, b, pb, bE, o, state, out, depth + 1);
      }
    }
  }
  if (ss) pushRun(out, EQ, tailA, tailB, ss);
}

/**
 * Diff two integer arrays. Returns { runs, approximate }.
 * Exact (shortest) unless the cost passes opts.maxD; then approximate with anchors.
 * Applying the runs to a always gives b.
 */
export function diffInts(a, b, opts = {}) {
  const o = { maxD: opts.maxD ?? DEFAULT_MAX_D };
  const state = { budget: opts.budget ?? DEFAULT_BUDGET, approximate: false };
  const out = [];
  diffRange(a, 0, a.length, b, 0, b.length, o, state, out, 0);
  return { runs: out, approximate: state.approximate };
}

/** Apply runs to array a, reading added items from b. Used by tests. */
export function applyRuns(runs, a, b) {
  const out = [];
  for (const r of runs) {
    if (r.t === EQ) for (let i = 0; i < r.n; i++) out.push(a[r.a + i]);
    else if (r.t === ADD) for (let i = 0; i < r.n; i++) out.push(b[r.b + i]);
  }
  return out;
}
