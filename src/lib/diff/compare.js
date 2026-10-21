// The compare engine. Input: two strings and options. Output: a result model the page renders.
// Runs in a Web Worker, but has no worker or DOM dependency, so node can test it.
import {
  withDefaults, normalizeString, countWords, wordTokens, graphemeRanges, K_WORD,
} from './chars.js';
import { diffInts, EQ, DEL, ADD } from './myers.js';
import { tokenDiff } from './tokens.js';

const BREAK_RE = /\r\n|\r|\n/g;

/** Split a text into lines. `eols[i]` is the line break after line i ('' for a last line without one). */
export function splitLines(text, wantEols = false) {
  if (text === '') return { lines: [], eols: [], finalNewline: false, kinds: { crlf: false, lf: false, cr: false } };
  const lines = text.split(/\r\n|\r|\n/);
  let finalNewline = false;
  if (lines[lines.length - 1] === '' && /(\r\n|\r|\n)$/.test(text)) { lines.pop(); finalNewline = true; }
  const kinds = {
    crlf: text.indexOf('\r\n') >= 0,
    lone_cr: /\r(?!\n)/.test(text),
    lf: /(?:^|[^\r])\n/.test(text),
  };
  const out = { lines, eols: [], finalNewline, kinds: { crlf: kinds.crlf, cr: kinds.lone_cr, lf: kinds.lf } };
  if (wantEols) {
    const eols = [];
    BREAK_RE.lastIndex = 0;
    let m;
    while ((m = BREAK_RE.exec(text)) !== null) eols.push(m[0]);
    while (eols.length < lines.length) eols.push('');
    out.eols = eols;
  }
  return out;
}

function eolNames(kinds) {
  const n = [];
  if (kinds.crlf) n.push('CRLF');
  if (kinds.lf) n.push('LF');
  if (kinds.cr) n.push('CR');
  return n;
}

function joinNames(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

// ---- line pairing inside a changed block
function wordSet(line, o) {
  const t = wordTokens(line);
  const set = new Map();
  for (let i = 0; i < t.k.length; i++) {
    if (t.k[i] !== K_WORD) continue;
    const w = line.slice(t.s[i], t.e[i]).toLowerCase();
    set.set(w, (set.get(w) || 0) + 1);
  }
  if (set.size === 0) for (const ch of line.toLowerCase()) if (!/\s/.test(ch)) set.set(ch, (set.get(ch) || 0) + 1);
  return set;
}
function dice(x, y) {
  let nx = 0;
  let ny = 0;
  let common = 0;
  for (const [, c] of x) nx += c;
  for (const [w, c] of y) { ny += c; const d = x.get(w); if (d) common += Math.min(c, d); }
  if (nx + ny === 0) return 0;
  return (2 * common) / (nx + ny);
}

/** Order the lines of a changed block into rows. Returns [[aIndex|-1, bIndex|-1], ...]. */
function pairLines(aIdx, bIdx, aLines, bLines, o) {
  const n = aIdx.length;
  const m = bIdx.length;
  if (n === 0) return bIdx.map((j) => [-1, j]);
  if (m === 0) return aIdx.map((i) => [i, -1]);
  if (n === m) return aIdx.map((i, k) => [i, bIdx[k]]);
  if (n > 40 || m > 40) return [...aIdx.map((i) => [i, -1]), ...bIdx.map((j) => [-1, j])];
  const sa = aIdx.map((i) => wordSet(aLines[i], o));
  const sb = bIdx.map((j) => wordSet(bLines[j], o));
  const S = [];
  for (let i = 0; i < n; i++) {
    S.push([]);
    for (let j = 0; j < m; j++) { const d = dice(sa[i], sb[j]); S[i].push(d >= 0.4 ? d : -1); }
  }
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
      if (S[i - 1][j - 1] >= 0) best = Math.max(best, dp[i - 1][j - 1] + S[i - 1][j - 1]);
      dp[i][j] = best;
    }
  }
  const rev = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && S[i - 1][j - 1] >= 0 && dp[i][j] === dp[i - 1][j - 1] + S[i - 1][j - 1]) {
      rev.push([aIdx[i - 1], bIdx[j - 1]]); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j] === dp[i][j - 1])) {
      rev.push([-1, bIdx[j - 1]]); j--;
    } else {
      rev.push([aIdx[i - 1], -1]); i--;
    }
  }
  rev.reverse();
  // Put deletions before additions inside each unmatched stretch.
  const out = [];
  let dels = [];
  let adds = [];
  for (const r of rev) {
    if (r[0] >= 0 && r[1] >= 0) { out.push(...dels, ...adds, r); dels = []; adds = []; }
    else if (r[0] >= 0) dels.push(r);
    else adds.push(r);
  }
  out.push(...dels, ...adds);
  return out;
}

const LONG_LINE = 6000;

/** Word and character highlights for two lines. Long lines are cut to the part that differs. */
function pairSegs(at, bt, o) {
  if (at.length < LONG_LINE && bt.length < LONG_LINE) {
    const r = tokenDiff(at, bt, o, 'words', true);
    return r;
  }
  // Trim the common start and end, but stay on a safe boundary.
  let p = 0;
  const max = Math.min(at.length, bt.length);
  while (p < max && at.charCodeAt(p) === bt.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && at.charCodeAt(at.length - 1 - s) === bt.charCodeAt(bt.length - 1 - s)) s++;
  p = Math.max(0, p - 40);
  s = Math.max(0, s - 40);
  const am = at.slice(p, at.length - s);
  const bm = bt.slice(p, bt.length - s);
  const r = tokenDiff(am, bm, o, 'words', true);
  const pieces = [];
  if (p > 0) pieces.push([0, 0, p, 0, p]);
  for (const x of r.pieces) pieces.push([x[0], x[1] + p, x[2] + p, x[3] + p, x[4] + p]);
  if (s > 0) pieces.push([0, at.length - s, at.length, bt.length - s, bt.length]);
  r.pieces = pieces;
  r.words.a = countWords(at);
  r.words.b = countWords(bt);
  return r;
}

function lineKeyFn(o) {
  const fast = !o.ignoreCase && o.ws === 'off' && !o.nfc && !o.quotes && !o.nbspzw;
  return fast ? (s) => s : (s) => normalizeString(s, o);
}

function ignoredList(o) {
  const l = [];
  if (o.ignoreCase) l.push('Case ignored.');
  if (o.ws === 'trim') l.push('Spaces at line start and end ignored.');
  if (o.ws === 'collapse') l.push('Amount of whitespace ignored.');
  if (o.ws === 'all') l.push('All whitespace ignored.');
  if (o.ignoreBlank) l.push('Blank lines ignored.');
  if (o.eolEqual) l.push('Line endings treated as equal.');
  if (o.finalNewlineEqual) l.push('Final newline ignored.');
  if (o.nfc) l.push('Unicode forms treated as equal.');
  if (o.quotes) l.push('Smart quotes and long dashes treated as plain.');
  if (o.nbspzw) l.push('Non-breaking spaces treated as spaces, zero-width characters ignored.');
  return l;
}

function emptyStats() {
  return {
    changes: 0, linesAdded: 0, linesRemoved: 0, linesChanged: 0,
    wordsAdded: 0, wordsRemoved: 0, charsAdded: 0, charsRemoved: 0, similarity: 100,
  };
}

function pct(wordsA, wordsB, removed, added) {
  const total = wordsA + wordsB;
  if (total === 0) return null;
  return Math.max(0, Math.round((1 - (removed + added) / total) * 100));
}

function eolNotes(A, B, o, notes) {
  const ka = eolNames(A.kinds);
  const kb = eolNames(B.kinds);
  if (ka.length > 1) notes.push({ id: 'mixed-a', text: 'Mixed line endings in Original.' });
  if (kb.length > 1) notes.push({ id: 'mixed-b', text: 'Mixed line endings in Changed.' });
  if (ka.length === 1 && kb.length === 1 && ka[0] !== kb[0]) {
    const text = o.eolEqual
      ? `Line endings differ: ${ka[0]} and ${kb[0]}. Treated as equal.`
      : `Line endings differ: ${ka[0]} and ${kb[0]}.`;
    notes.push({ id: 'eol-differ', text, strictLink: o.eolEqual });
  }
}

// ---- lines mode
function compareLines(aText, bText, o) {
  const strict = !o.eolEqual || !o.finalNewlineEqual;
  const A = splitLines(aText, strict);
  const B = splitLines(bText, strict);
  const aLines = A.lines;
  const bLines = B.lines;
  const keyOf = lineKeyFn(o);
  const eolSuffix = (side, i) => {
    const last = i === side.lines.length - 1;
    const has = !last || side.finalNewline;
    const included = last ? !o.finalNewlineEqual : !o.eolEqual;
    if (!included) return '';
    if (!has) return '\u0001';
    return o.eolEqual ? '\u0002' : '\u0002' + side.eols[i];
  };
  const blank = (s) => /^\s*$/.test(s);
  const ids = new Map();
  const idOf = (k) => { let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } return v; };
  const filtered = (side) => {
    const idx = [];
    const arr = [];
    for (let i = 0; i < side.lines.length; i++) {
      const l = side.lines[i];
      if (o.ignoreBlank && blank(l)) continue;
      idx.push(i);
      arr.push(idOf(keyOf(l) + (strict ? eolSuffix(side, i) : '')));
    }
    return { idx, arr: Int32Array.from(arr) };
  };
  const FA = filtered(A);
  const FB = filtered(B);
  const { runs, approximate } = diffInts(FA.arr, FB.arr);

  // Build ordered units with original indexes, then re-insert ignored blank lines.
  const blocks = [];
  const stats = emptyStats();
  let wordsRemoved = 0;
  let wordsAdded = 0;
  let ptrA = 0;
  let ptrB = 0;

  const pushEq = (a, b, n) => {
    const last = blocks[blocks.length - 1];
    if (last && last.t === 'eq' && last.a + last.n === a && last.b + last.n === b) last.n += n;
    else blocks.push({ t: 'eq', a, b, n });
  };
  const flushBlank = (ia, ib) => {
    // all lines before ia / ib that were not consumed are ignored blank lines
    const ca = ia - ptrA;
    const cb = ib - ptrB;
    const k = Math.min(ca, cb);
    for (let q = 0; q < k; q++) pushEq(ptrA + q, ptrB + q, 1);
    for (let q = k; q < ca; q++) blocks.push({ t: 'ign', side: 'a', i: ptrA + q });
    for (let q = k; q < cb; q++) blocks.push({ t: 'ign', side: 'b', i: ptrB + q });
    ptrA = ia;
    ptrB = ib;
  };

  const lineText = (side, lines, i) => {
    if (!strict) return lines[i];
    const suf = eolSuffix(side, i);
    return suf && suf !== '\u0001' ? lines[i] + side.eols[i] : lines[i];
  };
  const oPair = strict ? { ...o, finalNewlineEqual: false } : o;

  const emitHunk = (aIdx, bIdx) => {
    const order = pairLines(aIdx, bIdx, aLines, bLines, o);
    const rows = [];
    for (const [i, j] of order) {
      if (i >= 0 && j >= 0) {
        const at = lineText(A, aLines, i);
        const bt = lineText(B, bLines, j);
        const r = pairSegs(at, bt, oPair);
        rows.push({ al: i, an: 1, bl: j, bn: 1, at, bt, segs: r.pieces });
        stats.linesChanged++;
        wordsRemoved += r.words.removed;
        wordsAdded += r.words.added;
        stats.charsRemoved += r.chars.removed;
        stats.charsAdded += r.chars.added;
      } else if (i >= 0) {
        rows.push({ al: i, an: 1, bl: -1, bn: 0, at: aLines[i], bt: null, segs: null });
        stats.linesRemoved++;
        wordsRemoved += countWords(aLines[i]);
        stats.charsRemoved += graphemeRanges(aLines[i]).length / 2;
      } else {
        rows.push({ al: -1, an: 0, bl: j, bn: 1, at: null, bt: bLines[j], segs: null });
        stats.linesAdded++;
        wordsAdded += countWords(bLines[j]);
        stats.charsAdded += graphemeRanges(bLines[j]).length / 2;
      }
    }
    blocks.push({ t: 'chg', rows });
    stats.changes++;
  };

  let hunkA = [];
  let hunkB = [];
  const closeHunk = () => {
    if (hunkA.length || hunkB.length) emitHunk(hunkA, hunkB);
    hunkA = []; hunkB = [];
  };
  for (const run of runs) {
    if (run.t === EQ) {
      for (let q = 0; q < run.n; q++) {
        const ia = FA.idx[run.a + q];
        const ib = FB.idx[run.b + q];
        if (ia - ptrA > 0 || ib - ptrB > 0) { closeHunk(); flushBlank(ia, ib); }
        else if (hunkA.length || hunkB.length) closeHunk();
        pushEq(ia, ib, 1);
        ptrA = ia + 1; ptrB = ib + 1;
      }
    } else if (run.t === DEL) {
      for (let q = 0; q < run.n; q++) {
        const ia = FA.idx[run.a + q];
        if (ia - ptrA > 0 && !(hunkA.length || hunkB.length)) flushBlank(ia, ptrB);
        else if (ia - ptrA > 0) { closeHunk(); flushBlank(ia, ptrB); }
        hunkA.push(ia);
        ptrA = ia + 1;
      }
    } else {
      for (let q = 0; q < run.n; q++) {
        const ib = FB.idx[run.b + q];
        if (ib - ptrB > 0 && !(hunkA.length || hunkB.length)) flushBlank(ptrA, ib);
        else if (ib - ptrB > 0) { closeHunk(); flushBlank(ptrA, ib); }
        hunkB.push(ib);
        ptrB = ib + 1;
      }
    }
  }
  closeHunk();
  flushBlank(aLines.length, bLines.length);

  const wordsA = countWords(aText);
  const wordsB = countWords(bText);
  stats.wordsRemoved = wordsRemoved;
  stats.wordsAdded = wordsAdded;
  const sim = pct(wordsA, wordsB, wordsRemoved, wordsAdded);
  stats.similarity = sim === null ? (stats.changes === 0 ? 100 : 0) : sim;
  stats.wordsA = wordsA;
  stats.wordsB = wordsB;

  const notes = [];
  eolNotes(A, B, o, notes);
  if (stats.changes === 0 && aLines.length > 0 && bLines.length > 0 && A.finalNewline !== B.finalNewline && o.finalNewlineEqual) {
    notes.push({ id: 'final-newline', text: 'Only the final newline differs.' });
  }
  return { mode: 'lines', aLines, bLines, blocks, stats, notes, approximate, aFinal: A.finalNewline, bFinal: B.finalNewline };
}

// ---- words and characters mode
function lineStarts(text) {
  const starts = [0];
  BREAK_RE.lastIndex = 0;
  let m;
  while ((m = BREAK_RE.exec(text)) !== null) starts.push(m.index + m[0].length);
  return starts;
}
function lineAt(starts, offset, total) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return Math.min(lo, Math.max(0, total));
}
function countBreaks(s) {
  let n = 0;
  BREAK_RE.lastIndex = 0;
  while (BREAK_RE.exec(s) !== null) n++;
  return n;
}
function stripBreak(s) {
  return s.replace(/(\r\n|\r|\n)$/, '');
}

function compareTokens(aText, bText, o, gran) {
  const A = splitLines(aText);
  const B = splitLines(bText);
  const aLines = A.lines;
  const bLines = B.lines;
  const r = tokenDiff(aText, bText, o, gran, false);
  const aStarts = lineStarts(aText);
  const bStarts = lineStarts(bText);
  const blocks = [];
  const stats = emptyStats();
  const rowsOut = [];

  // Walk the pieces and cut regions where both sides have a matching line break.
  let region = null;
  const open = (aS, bS) => { region = { aS, bS, aE: aS, bE: bS, pieces: [], changed: false }; };
  const addPiece = (p) => {
    if (!region) open(p[1], p[3]);
    region.pieces.push(p);
    region.aE = p[2]; region.bE = p[4];
    if (p[0] !== 0) region.changed = true;
  };
  const closeRegion = () => {
    if (!region) return;
    const reg = region;
    region = null;
    if (reg.pieces.length === 0) return;
    const aSlice = aText.slice(reg.aS, reg.aE);
    const bSlice = bText.slice(reg.bS, reg.bE);
    const an = aSlice === '' ? 0 : countBreaks(aSlice) + (/(\r\n|\r|\n)$/.test(aSlice) ? 0 : 1);
    const bn = bSlice === '' ? 0 : countBreaks(bSlice) + (/(\r\n|\r|\n)$/.test(bSlice) ? 0 : 1);
    const al = an ? lineAt(aStarts, reg.aS, aLines.length - 1) : -1;
    const bl = bn ? lineAt(bStarts, reg.bS, bLines.length - 1) : -1;
    if (!reg.changed) {
      if (an === 1 && bn === 1) {
        const last = blocks[blocks.length - 1];
        if (last && last.t === 'eq' && last.a + last.n === al && last.b + last.n === bl) last.n++;
        else blocks.push({ t: 'eq', a: al, b: bl, n: 1 });
      } else {
        blocks.push({ t: 'x', row: { al, an, bl, bn, at: stripBreak(aSlice), bt: stripBreak(bSlice), segs: null } });
      }
      return;
    }
    const at = stripBreak(aSlice);
    const bt = stripBreak(bSlice);
    const segs = reg.pieces.map((p) => [p[0], Math.min(p[1] - reg.aS, at.length), Math.min(p[2] - reg.aS, at.length), Math.min(p[3] - reg.bS, bt.length), Math.min(p[4] - reg.bS, bt.length)])
      .filter((p) => p[2] > p[1] || p[4] > p[3]);
    const row = { al, an, bl, bn, at: an ? at : null, bt: bn ? bt : null, segs };
    const last = blocks[blocks.length - 1];
    if (last && last.t === 'chg') last.rows.push(row);
    else blocks.push({ t: 'chg', rows: [row] });
    if (an && bn) stats.linesChanged += Math.max(an, bn);
    else if (an) stats.linesRemoved += an;
    else stats.linesAdded += bn;
    rowsOut.push(row);
  };

  const breaks = (s, from, to) => {
    const out = [];
    BREAK_RE.lastIndex = 0;
    const sub = s.slice(from, to);
    let m;
    while ((m = BREAK_RE.exec(sub)) !== null) out.push(from + m.index + m[0].length);
    return out;
  };

  for (const p of r.pieces) {
    if (p[0] !== 0) { addPiece(p); continue; }
    const ba = breaks(aText, p[1], p[2]);
    const bb = breaks(bText, p[3], p[4]);
    if (ba.length === bb.length && ba.length > 0) {
      let ca = p[1];
      let cb = p[3];
      for (let q = 0; q < ba.length; q++) {
        addPiece([0, ca, ba[q], cb, bb[q]]);
        closeRegion();
        ca = ba[q]; cb = bb[q];
      }
      if (ca < p[2] || cb < p[4]) addPiece([0, ca, p[2], cb, p[4]]);
    } else addPiece(p);
  }
  closeRegion();

  stats.changes = r.groups;
  stats.wordsAdded = r.words.added;
  stats.wordsRemoved = r.words.removed;
  stats.charsAdded = r.chars.added;
  stats.charsRemoved = r.chars.removed;
  stats.wordsA = r.words.a;
  stats.wordsB = r.words.b;
  const sim = pct(r.words.a, r.words.b, r.words.removed, r.words.added);
  stats.similarity = sim === null ? (stats.changes === 0 ? 100 : 0) : sim;

  const notes = [];
  eolNotes(A, B, o, notes);
  return { mode: gran === 'chars' ? 'chars' : 'words', aLines, bLines, blocks, stats, notes, approximate: r.approximate };
}

// ---- entry point
/**
 * Compare two texts. Returns a result model:
 * { mode, aLines, bLines, blocks, stats, notes, approximate, state, ignored, aEmpty, bEmpty, switched }
 * blocks: { t:'eq', a, b, n } | { t:'chg', rows } | { t:'ign', side, i } | { t:'x', row }
 * row: { al, an, bl, bn, at, bt, segs } with segs = [[type, aStart, aEnd, bStart, bEnd], ...] (type 0 equal, 1 deleted, 2 added)
 */
export function compare(aText, bText, optsIn) {
  const o = withDefaults(optsIn);
  const aEmpty = aText === '';
  const bEmpty = bText === '';
  if (aEmpty && bEmpty) {
    return { mode: o.mode, aLines: [], bLines: [], blocks: [], stats: emptyStats(), notes: [], approximate: false, state: 'empty', ignored: ignoredList(o), aEmpty, bEmpty, switched: null };
  }
  let mode = o.mode;
  let switched = null;
  if (mode === 'chars') {
    const big = aText.length > 400_000 || bText.length > 400_000;
    let tooLong = big;
    if (!big) {
      // Cheap check: the part that differs is long.
      let p = 0;
      const max = Math.min(aText.length, bText.length);
      while (p < max && aText.charCodeAt(p) === bText.charCodeAt(p)) p++;
      let s = 0;
      while (s < max - p && aText.charCodeAt(aText.length - 1 - s) === bText.charCodeAt(bText.length - 1 - s)) s++;
      tooLong = Math.max(aText.length - p - s, bText.length - p - s) > 20_000;
    }
    if (tooLong) { mode = 'words'; switched = 'Text too long for the character view. Showing Words mode.'; }
  }
  const res = mode === 'lines' ? compareLines(aText, bText, o) : compareTokens(aText, bText, o, mode);
  res.aEmpty = aEmpty;
  res.bEmpty = bEmpty;
  res.switched = switched;
  res.ignored = ignoredList(o);
  res.state = res.stats.changes === 0 ? 'identical' : 'changed';
  if (aEmpty) res.notes.unshift({ id: 'a-empty', text: 'Original is empty. Everything in Changed shows as added.' });
  if (bEmpty) res.notes.unshift({ id: 'b-empty', text: 'Changed is empty. Everything in Original shows as removed.' });
  if (switched) res.notes.push({ id: 'switched', text: switched });
  if (res.approximate) res.notes.push({ id: 'approx', text: 'Large change. Result may not be the shortest set of edits. Every change shown is real.' });
  if (mode === 'lines' && res.aLines.length + res.bLines.length > 0) {
    const sum = res.aLines.reduce((n, l) => n + l.length, 0) + res.bLines.reduce((n, l) => n + l.length, 0);
    const avg = sum / (res.aLines.length + res.bLines.length);
    if (avg > 200) res.notes.push({ id: 'long-lines', text: 'Long lines. Try Words mode for a cleaner view.', suggestMode: 'words' });
  }
  res.options = o;
  return res;
}
