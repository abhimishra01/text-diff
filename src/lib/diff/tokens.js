// Token level diff for words and characters, with ranges that point back into the original text.
import {
  cleanWithMap, wordTokens, graphemeTokens, graphemeRanges,
  K_WORD, K_WS, K_NL, K_OTHER,
} from './chars.js';
import { diffInts, EQ, DEL, ADD } from './myers.js';

// A piece covers part of both texts: t = 0 equal, 1 deleted (A only), 2 added (B only).
// Equal pieces may have an empty range on one side (ignored characters).

function tokenKey(str, o) {
  if (o.nfc) str = str.normalize('NFC');
  if (o.ignoreCase) str = str.toLowerCase();
  return str;
}

/**
 * Decide the comparison key of every token. A key of '' means the token is not compared.
 * `atStart` / `atEnd`: the text edge counts as a line edge.
 */
function buildKeys(text, tk, o, gran) {
  const n = tk.k.length;
  const keys = new Array(n);
  let i = 0;
  while (i < n) {
    const kind = tk.k[i];
    if (kind !== K_WS && kind !== K_NL) {
      keys[i] = tokenKey(text.slice(tk.s[i], tk.e[i]), o);
      i++;
      continue;
    }
    // A run of whitespace and newline tokens.
    let j = i;
    while (j < n && (tk.k[j] === K_WS || tk.k[j] === K_NL)) j++;
    const runStart = i === 0;
    const runEnd = j === n;
    const rk = new Array(j - i);
    for (let p = i; p < j; p++) {
      const isNl = tk.k[p] === K_NL;
      const raw = text.slice(tk.s[p], tk.e[p]);
      rk[p - i] = isNl ? (o.eolEqual ? '\n' : raw) : raw;
    }
    // Whitespace mode
    if (o.ws === 'all') {
      for (let p = 0; p < rk.length; p++) rk[p] = '';
    } else if (o.ws === 'trim') {
      // drop horizontal whitespace next to a line edge
      for (let p = 0; p < rk.length; p++) {
        if (tk.k[i + p] !== K_WS) continue;
        const prevNl = p > 0 ? tk.k[i + p - 1] === K_NL : runStart;
        const nextNl = p + 1 < rk.length ? tk.k[i + p + 1] === K_NL : runEnd;
        if (prevNl || nextNl) rk[p] = '';
      }
    } else if (o.ws === 'collapse') {
      // A whole run of spaces, tabs and line breaks counts as one space.
      for (let p = 0; p < rk.length; p++) rk[p] = p === 0 ? ' ' : '';
    }
    if (o.ignoreBlank) {
      // Drop newlines that end a blank line, and the blanks inside it.
      let seenContentNl = !runStart; // a newline before this run means we are past the first line
      let lastNl = -1;
      for (let p = 0; p < rk.length; p++) {
        if (tk.k[i + p] !== K_NL) continue;
        if (!seenContentNl) {
          // blank line at the very start of the text
          for (let q = lastNl + 1; q <= p; q++) rk[q] = '';
          lastNl = p;
          continue;
        }
        if (lastNl >= 0) { for (let q = lastNl + 1; q <= p; q++) rk[q] = ''; }
        lastNl = p;
        seenContentNl = true;
      }
    }
    if (runEnd && o.finalNewlineEqual) {
      // The last newline of the text is not a difference.
      for (let p = rk.length - 1; p >= 0; p--) {
        if (tk.k[i + p] === K_NL) { rk[p] = ''; break; }
        if (tk.k[i + p] === K_WS && rk[p] !== '') break;
      }
    }
    for (let p = 0; p < rk.length; p++) keys[i + p] = rk[p];
    i = j;
  }
  return keys;
}

function makeSide(text, o, gran) {
  const cl = cleanWithMap(text, o);
  const tk = gran === 'chars' ? graphemeTokens(cl.text) : wordTokens(cl.text);
  const keys = buildKeys(cl.text, tk, o, gran);
  const idx = [];
  for (let i = 0; i < keys.length; i++) if (keys[i] !== '') idx.push(i);
  return { text, cleaned: cl.text, mapS: cl.mapS, mapE: cl.mapE, tk, keys, idx };
}

function origStart(side, i) {
  const s = side.tk.s[i];
  return side.mapS ? side.mapS[s] : s;
}
function origEnd(side, i) {
  const e = side.tk.e[i];
  return side.mapE ? side.mapE[e - 1] : e;
}

function lcsRatio(x, y) {
  // Ratio of common graphemes (by longest common subsequence) over the longer length.
  const gx = graphemeRanges(x);
  const gy = graphemeRanges(y);
  const nx = gx.length / 2;
  const ny = gy.length / 2;
  if (nx === 0 || ny === 0) return 0;
  if (nx > 80 || ny > 80) return 0;
  const sx = [];
  const sy = [];
  for (let i = 0; i < nx; i++) sx.push(x.slice(gx[2 * i], gx[2 * i + 1]));
  for (let i = 0; i < ny; i++) sy.push(y.slice(gy[2 * i], gy[2 * i + 1]));
  let prev = new Array(ny + 1).fill(0);
  for (let i = 1; i <= nx; i++) {
    const cur = new Array(ny + 1).fill(0);
    for (let j = 1; j <= ny; j++) {
      cur[j] = sx[i - 1] === sy[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[ny] / Math.max(nx, ny);
}

/** Grapheme level diff of two short strings. Returns pieces relative to the strings. */
function charPieces(x, y, o) {
  const gx = graphemeRanges(x);
  const gy = graphemeRanges(y);
  const ids = new Map();
  const id = (str) => { let v = ids.get(str); if (v === undefined) { v = ids.size; ids.set(str, v); } return v; };
  const ax = [];
  const by = [];
  for (let i = 0; i < gx.length; i += 2) ax.push(id(tokenKey(x.slice(gx[i], gx[i + 1]), o)));
  for (let i = 0; i < gy.length; i += 2) by.push(id(tokenKey(y.slice(gy[i], gy[i + 1]), o)));
  const { runs } = diffInts(Int32Array.from(ax), Int32Array.from(by), { maxD: 400 });
  const out = [];
  for (const r of runs) {
    if (r.t === EQ) out.push([0, gx[2 * r.a], gx[2 * (r.a + r.n) - 1], gy[2 * r.b], gy[2 * (r.b + r.n) - 1]]);
    else if (r.t === DEL) out.push([1, gx[2 * r.a], gx[2 * (r.a + r.n) - 1], 0, 0]);
    else out.push([2, 0, 0, gy[2 * r.b], gy[2 * (r.b + r.n) - 1]]);
  }
  return out;
}

/**
 * Diff two texts at word or character level.
 * Returns { pieces, approximate, words: {a, b, removed, added}, chars: {removed, added}, groups }.
 * pieces: [[t, aStart, aEnd, bStart, bEnd], ...] covering both texts completely, in order.
 */
export function tokenDiff(aText, bText, o, gran, refine = false, maxD = 3000) {
  const A = makeSide(aText, o, gran);
  const B = makeSide(bText, o, gran);
  const ids = new Map();
  const id = (str) => { let v = ids.get(str); if (v === undefined) { v = ids.size; ids.set(str, v); } return v; };
  const ia = Int32Array.from(A.idx, (i) => id(A.keys[i]));
  const ib = Int32Array.from(B.idx, (i) => id(B.keys[i]));
  const { runs, approximate } = diffInts(ia, ib, { maxD });

  let wordsA = 0;
  let wordsB = 0;
  for (let i = 0; i < A.tk.k.length; i++) if (A.tk.k[i] === K_WORD) wordsA++;
  for (let i = 0; i < B.tk.k.length; i++) if (B.tk.k[i] === K_WORD) wordsB++;

  const pieces = [];
  let aPos = 0;
  let bPos = 0;
  let wordsRemoved = 0;
  let wordsAdded = 0;
  const itemA = (k) => A.idx[k];
  const itemB = (k) => B.idx[k];

  // Group runs: a replace group is a sequence of non-equal runs between equal runs.
  let r = 0;
  while (r < runs.length) {
    const run = runs[r];
    if (run.t === EQ) {
      for (let q = 0; q < run.n; q++) {
        const ta = itemA(run.a + q);
        const tb = itemB(run.b + q);
        const ae = origEnd(A, ta);
        const be = origEnd(B, tb);
        pieces.push([0, aPos, ae, bPos, be]);
        aPos = ae; bPos = be;
      }
      r++;
      continue;
    }
    // collect the group
    let g = r;
    const dels = [];
    const adds = [];
    while (g < runs.length && runs[g].t !== EQ) {
      const rr = runs[g];
      if (rr.t === DEL) for (let q = 0; q < rr.n; q++) dels.push(itemA(rr.a + q));
      else for (let q = 0; q < rr.n; q++) adds.push(itemB(rr.b + q));
      g++;
    }
    r = g;
    for (const t of dels) if (A.tk.k[t] === K_WORD) wordsRemoved++;
    for (const t of adds) if (B.tk.k[t] === K_WORD) wordsAdded++;
    // gap before the group (ignored characters)
    const aFirst = dels.length ? origStart(A, dels[0]) : aPos;
    const bFirst = adds.length ? origStart(B, adds[0]) : bPos;
    // Refine a one-to-one replace of similar tokens at character level.
    if (refine && gran === 'words' && dels.length === 1 && adds.length === 1) {
      const da = dels[0];
      const ad = adds[0];
      const ka = A.tk.k[da];
      const kb = B.tk.k[ad];
      const xs = origStart(A, da), xe = origEnd(A, da);
      const ys = origStart(B, ad), ye = origEnd(B, ad);
      if (ka === kb && (ka === K_WORD || ka === K_WS) && xe - xs <= (ka === K_WS ? 50000 : 120) && ye - ys <= (ka === K_WS ? 50000 : 120)) {
        const x = aText.slice(xs, xe);
        const y = bText.slice(ys, ye);
        if (ka === K_WS || lcsRatio(x, y) >= 0.6) {
          if (xs > aPos || ys > bPos) pieces.push([0, aPos, xs, bPos, ys]);
          let ca = xs;
          let cb = ys;
          for (const p of charPieces(x, y, o)) {
            if (p[0] === EQ) { pieces.push([0, xs + p[1], xs + p[2], ys + p[3], ys + p[4]]); ca = xs + p[2]; cb = ys + p[4]; }
            else if (p[0] === DEL) { pieces.push([1, xs + p[1], xs + p[2], cb, cb]); ca = xs + p[2]; }
            else { pieces.push([2, ca, ca, ys + p[3], ys + p[4]]); cb = ys + p[4]; }
          }
          aPos = xe; bPos = ye;
          continue;
        }
      }
    }
    if (aFirst > aPos || bFirst > bPos) pieces.push([0, aPos, aFirst, bPos, bFirst]);
    aPos = aFirst; bPos = bFirst;
    if (dels.length) {
      const e = origEnd(A, dels[dels.length - 1]);
      pieces.push([1, aPos, e, bPos, bPos]);
      aPos = e;
    }
    if (adds.length) {
      const e = origEnd(B, adds[adds.length - 1]);
      pieces.push([2, aPos, aPos, bPos, e]);
      bPos = e;
    }
  }
  if (aPos < aText.length || bPos < bText.length) pieces.push([0, aPos, aText.length, bPos, bText.length]);

  // Tidy: drop empty pieces, merge neighbours of the same type.
  const clean = pieces.filter((p) => p[2] > p[1] || p[4] > p[3]);
  const merged = [];
  for (const p of clean) {
    const last = merged[merged.length - 1];
    if (last && last[0] === p[0] && last[2] === p[1] && last[4] === p[3]) {
      last[2] = p[2]; last[4] = p[4];
    } else merged.push(p.slice());
  }

  // Character totals and groups
  let charsRemoved = 0;
  let charsAdded = 0;
  let groups = 0;
  let inGroup = false;
  for (const p of merged) {
    if (p[0] === 0) { inGroup = false; continue; }
    if (!inGroup) { groups++; inGroup = true; }
    if (p[0] === DEL) charsRemoved += countG(aText, p[1], p[2]);
    else charsAdded += countG(bText, p[3], p[4]);
  }
  return {
    pieces: merged,
    approximate,
    words: { a: wordsA, b: wordsB, removed: wordsRemoved, added: wordsAdded },
    chars: { removed: charsRemoved, added: charsAdded },
    groups,
  };
}

function countG(text, s, e) {
  return graphemeRanges(text.slice(s, e)).length / 2;
}

