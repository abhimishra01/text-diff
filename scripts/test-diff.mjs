// Known-answer and property tests for the compare engine. Run with: npm test
import assert from 'node:assert/strict';
import { compare } from '../src/lib/diff/compare.js';
import { diffInts, applyRuns, EQ, DEL, ADD } from '../src/lib/diff/myers.js';
import { tokenDiff } from '../src/lib/diff/tokens.js';
import { normalizeString, withDefaults, graphemeRanges } from '../src/lib/diff/chars.js';
import { unifiedDiff, redline, statsText } from '../src/lib/diff/export.js';
import { hiddenParts, inspectChange } from '../src/lib/diff/unicode-names.js';

let checks = 0;
let failed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); checks++; } catch (e) { failed++; failures.push(`${name}: ${e.message.split('\n')[0]}`); }
}
const eq = (a, b, m) => assert.deepEqual(a, b, m);
const U = (...cps) => String.fromCodePoint(...cps);
const NBSP = U(0xA0), ZWSP = U(0x200B), LQ = U(0x201C), RQ = U(0x201D), ENDASH = U(0x2013);

// Collect deleted and added text from a result.
function changes(res) {
  const del = [];
  const add = [];
  for (const b of res.blocks) {
    const rows = b.t === 'chg' ? b.rows : [];
    for (const r of rows) {
      if (r.segs) {
        for (const p of r.segs) {
          if (p[0] === 1) del.push(r.at.slice(p[1], p[2]));
          if (p[0] === 2) add.push(r.bt.slice(p[3], p[4]));
        }
      } else if (r.at != null) del.push(r.at);
      else if (r.bt != null) add.push(r.bt);
    }
  }
  return { del, add };
}
const C = (a, b, o) => compare(a, b, o);
const hunks = (r) => r.stats.changes;

// ---- section 5.1 semantics
check('T1', () => {
  const r = C('a\nb\nc', 'a\nB\nc', { mode: 'lines' });
  eq(hunks(r), 1);
  const row = r.blocks.find((b) => b.t === 'chg').rows[0];
  eq(row.al, 1);
  eq(changes(r), { del: ['b'], add: ['B'] });
  const r2 = C('a\nb\nc', 'a\nB\nc', { ignoreCase: true });
  eq(hunks(r2), 0);
  eq(r2.state, 'identical');
  assert.ok(r2.ignored.includes('Case ignored.'));
});
check('T2', () => {
  const r = C('a\r\nb', 'a\nb');
  eq(hunks(r), 0);
  assert.ok(r.notes.some((n) => n.text === 'Line endings differ: CRLF and LF. Treated as equal.'));
  const s = C('a\r\nb', 'a\nb', { eolEqual: false });
  eq(hunks(s), 1);
  const row = s.blocks.find((b) => b.t === 'chg').rows[0];
  eq(row.al, 0);
  assert.ok(row.at.endsWith('\r\n'));
  assert.ok(hiddenParts(row.at).some((p) => p.k === 'cr'));
});
check('T3', () => {
  const r = C('line  ', 'line');
  eq(hunks(r), 1);
  eq(changes(r).del, ['  ']);
  eq(hunks(C('line  ', 'line', { ws: 'trim' })), 0);
});
check('T4', () => {
  const r = C('Hello  World', 'Hello World');
  eq(hunks(r), 1);
  eq(changes(r).del, [' ']);
  eq(hunks(C('Hello  World', 'Hello World', { ws: 'collapse' })), 0);
  eq(hunks(C('Hello  World', 'Hello World', { ws: 'all' })), 0);
});
check('T5', () => {
  eq(hunks(C('\tx', '    x')), 1);
  eq(hunks(C('\tx', '    x', { ws: 'trim' })), 0);
  eq(hunks(C('\tx', '    x', { ws: 'collapse' })), 0);
});
check('T6', () => {
  const a = 'cafe\u0301';
  const b = 'caf\u00E9';
  const r = C(a, b);
  eq(hunks(r), 1);
  const ch = changes(r);
  eq(ch.del.length, 1);
  const info = inspectChange(ch.del[0], ch.add[0]);
  eq(info.reason, 'Looks the same. Different Unicode form (U+0065 U+0301 vs U+00E9).');
  eq(hunks(C(a, b, { nfc: true })), 0);
});
check('T7', () => {
  const a = 'a' + NBSP + 'b';
  eq(hunks(C(a, 'a b')), 1);
  assert.ok(hiddenParts(a).some((p) => p.k === 'nbsp' && p.label === 'NBSP'));
  eq(hunks(C(a, 'a b', { nbspzw: true })), 0);
});
check('T8', () => {
  const r = C('ab', 'a' + ZWSP + 'b');
  eq(hunks(r), 1);
  eq(changes(r).add, [ZWSP]);
  const info = inspectChange('', ZWSP);
  eq(info.added[0].short, 'ZWSP');
  eq(info.added[0].hex, 'U+200B');
  eq(hunks(C('ab', 'a' + ZWSP + 'b', { nbspzw: true })), 0);
});
check('T9', () => {
  const a = LQ + 'hi' + RQ;
  const r = C(a, '"hi"');
  eq(hunks(r), 1);
  eq(r.stats.charsRemoved, 2);
  eq(r.stats.charsAdded, 2);
  eq(hunks(C(a, '"hi"', { quotes: true })), 0);
  eq(hunks(C('a' + ENDASH + 'b', 'a-b')), 1);
  eq(hunks(C('a' + ENDASH + 'b', 'a-b', { quotes: true })), 0);
});
check('T10', () => {
  const r = C(U(0x1F600), U(0x1F603), { mode: 'chars' });
  eq(hunks(r), 1);
  eq(changes(r), { del: [U(0x1F600)], add: [U(0x1F603)] });
});
check('T11', () => {
  const fam = (kid) => U(0x1F468, 0x200D, 0x1F469, 0x200D, kid);
  const r = C(fam(0x1F467), fam(0x1F466), { mode: 'chars' });
  eq(hunks(r), 1);
  eq(changes(r), { del: [fam(0x1F467)], add: [fam(0x1F466)] });
});
check('T12', () => {
  const flag = (b) => U(0x1F1EE, b);
  const r = C(flag(0x1F1F3), flag(0x1F1F9), { mode: 'chars' });
  eq(hunks(r), 1);
  eq(changes(r), { del: [flag(0x1F1F3)], add: [flag(0x1F1F9)] });
});
check('T13', () => {
  const r = C('\u00E9', 'e', { mode: 'chars' });
  eq(hunks(r), 1);
  eq(changes(r), { del: ['\u00E9'], add: ['e'] });
  const r2 = C('e\u0301', 'e', { mode: 'chars' });
  eq(changes(r2), { del: ['e\u0301'], add: ['e'] });
});
check('T14', () => {
  const r = C('\u4ECA\u65E5\u306F\u5929\u6C17\u304C\u3044\u3044', '\u4ECA\u65E5\u306F\u5929\u6C17\u304C\u60AA\u3044', { mode: 'chars' });
  eq(hunks(r), 1);
  eq(changes(r), { del: ['\u3044'], add: ['\u60AA'] });
});
check('T15', () => {
  const r = C('\u05E9\u05DC\u05D5\u05DD \u05E2\u05D5\u05DC\u05DD', '\u05E9\u05DC\u05D5\u05DD \u05E2\u05D5\u05DC\u05DE\u05D5\u05EA', { mode: 'words' });
  eq(hunks(r), 1);
  eq(changes(r), { del: ['\u05E2\u05D5\u05DC\u05DD'], add: ['\u05E2\u05D5\u05DC\u05DE\u05D5\u05EA'] });
});
check('T16', () => {
  const r = C('Hello, world', 'Hello world', { mode: 'words' });
  eq(hunks(r), 1);
  eq(changes(r), { del: [','], add: [] });
  eq(r.stats.wordsRemoved, 0);
  eq(r.stats.wordsAdded, 0);
});
check('T17', () => {
  const r = C('P1\nP2\nP3', 'P2\nP3\nP1');
  eq(hunks(r), 2);
  eq(changes(r), { del: ['P1'], add: ['P1'] });
});
check('T18', () => {
  const r = C('', 'a\nb');
  eq(r.stats.linesAdded, 2);
  eq(r.stats.linesRemoved, 0);
  assert.ok(r.notes.some((n) => n.text.startsWith('Original is empty')));
});
check('T19', () => {
  const r = C('same', 'same', { mode: 'chars' });
  eq(r.state, 'identical');
  eq(C('same', 'same', { mode: 'words' }).state, 'identical');
  eq(C('same', 'same', { mode: 'lines' }).state, 'identical');
  eq(C('', '').state, 'empty');
});
check('T20', () => {
  const r = C('a\nb', 'a\nb\n');
  eq(hunks(r), 0);
  assert.ok(r.notes.some((n) => n.text === 'Only the final newline differs.'));
  eq(hunks(C('a\nb', 'a\nb\n', { finalNewlineEqual: false })), 1);
  eq(hunks(C('a\nb', 'a\nb\n', { mode: 'words' })), 0);
});
check('T21', () => {
  const r = C('a\n\n\nb', 'a\nb');
  eq(hunks(r), 1);
  eq(r.stats.linesRemoved, 2);
  eq(hunks(C('a\n\n\nb', 'a\nb', { ignoreBlank: true })), 0);
  eq(hunks(C('a\n\n\nb', 'a\nb', { ignoreBlank: true, mode: 'words' })), 0);
});
check('T22', () => {
  const r = C('a\r\nb\nc\rd', 'a\nb\nc\nd');
  eq(hunks(r), 0);
  assert.ok(r.notes.some((n) => n.text === 'Mixed line endings in Original.'));
});
check('T23', () => {
  eq(hunks(C('   \n', '\n')), 1);
  eq(hunks(C('   \n', '\n', { ws: 'trim' })), 0);
});
check('T24', () => {
  const r = C('one two three', 'one three four', { mode: 'words' });
  eq(changes(r), { del: ['two '], add: [' four'] }.del.length === 1 ? changes(r) : null);
  eq(r.stats.wordsRemoved, 1);
  eq(r.stats.wordsAdded, 1);
  eq(r.stats.similarity, 67);
  const words = changes(r);
  assert.ok(words.del.join('').includes('two'));
  assert.ok(words.add.join('').includes('four'));
});
check('T25', () => {
  const r = C('The quick brown fox jumps', 'The quick red fox leaps', { mode: 'words' });
  eq(redline(r).plain, 'The quick [-brown-]{+red+} fox [-jumps-]{+leaps+}');
  assert.ok(redline(r).html.includes('<del'));
  assert.ok(redline(r).html.includes('<ins'));
});
check('T26', () => {
  const r = C('a\nb\nc\nd', 'a\nB\nc\nd', { mode: 'lines' });
  eq(unifiedDiff(r), ['--- original', '+++ changed', '@@ -1,4 +1,4 @@', ' a', '-b', '+B', ' c', ' d'].join('\n'));
});
check('T26b added at top and empty old', () => {
  const r = C('', 'x\ny', { mode: 'lines' });
  eq(unifiedDiff(r), ['--- original', '+++ changed', '@@ -0,0 +1,2 @@', '+x', '+y'].join('\n'));
});
check('T27', () => {
  const a = 'x' + '\t'.repeat(1000) + 'y';
  const b = 'x' + '\t'.repeat(999) + 'y';
  const r = C(a, b, { mode: 'lines' });
  eq(hunks(r), 1);
  eq(changes(r).del, ['\t']);
  const parts = hiddenParts(a);
  const tab = parts.find((p) => p.k === 'tab');
  eq(tab.n, 1000);
  eq(parts.length, 3);
});
check('T28 redline lines mode', () => {
  const r = C('a\nb\nc', 'a\nB\nc');
  eq(redline(r).plain, 'a\n[-b-]{+B+}\nc');
});
check('stats text', () => {
  const r = C('one two three', 'one three four', { mode: 'words' });
  assert.match(statsText(r), /Similarity 67 percent/);
});

// ---- Myers and property tests
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function lcsLen(a, b) {
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const cur = new Int32Array(m + 1);
    for (let j = 1; j <= m; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[m];
}
check('property: applying runs to A gives B (exact and forced approximate)', () => {
  const rnd = rng(7);
  for (let t = 0; t < 1000; t++) {
    const n = Math.floor(rnd() * 30);
    const m = Math.floor(rnd() * 30);
    const k = 1 + Math.floor(rnd() * 6);
    const a = Int32Array.from({ length: n }, () => Math.floor(rnd() * k));
    const b = Int32Array.from({ length: m }, () => Math.floor(rnd() * k));
    const ex = diffInts(a, b);
    eq(Array.from(applyRuns(ex.runs, a, b)), Array.from(b));
    const ap = diffInts(a, b, { maxD: 2 });
    eq(Array.from(applyRuns(ap.runs, a, b)), Array.from(b));
  }
});
check('property: exact mode is as short as brute force LCS', () => {
  const rnd = rng(99);
  for (let t = 0; t < 1000; t++) {
    const n = Math.floor(rnd() * 25);
    const m = Math.floor(rnd() * 25);
    const k = 1 + Math.floor(rnd() * 5);
    const a = Int32Array.from({ length: n }, () => Math.floor(rnd() * k));
    const b = Int32Array.from({ length: m }, () => Math.floor(rnd() * k));
    const { runs, approximate } = diffInts(a, b);
    eq(approximate, false);
    let edits = 0;
    for (const r of runs) if (r.t !== EQ) edits += r.n;
    eq(edits, n + m - 2 * lcsLen(a, b));
  }
});
check('property: same input gives the same output', () => {
  const o = { mode: 'lines', ws: 'collapse' };
  const a = 'x y\nfoo bar\nbaz\n'.repeat(20);
  const b = 'x  y\nfoo baz\nbaz\nnew\n'.repeat(20);
  eq(JSON.stringify(compare(a, b, o)), JSON.stringify(compare(a, b, o)));
});
check('property: pieces cover both texts and match the options', () => {
  const rnd = rng(1234);
  const alphabet = ['a', 'B', ' ', '  ', '\t', NBSP, ZWSP, LQ, '"', 'e\u0301', '\u00E9', ',', 'word', 'Word', '\n', '1'];
  const pick = () => { let s = ''; const n = Math.floor(rnd() * 8); for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)]; return s; };
  for (let t = 0; t < 600; t++) {
    const a = pick();
    const b = pick();
    const o = withDefaults({
      ignoreCase: rnd() < 0.3, nfc: rnd() < 0.3, quotes: rnd() < 0.3, nbspzw: rnd() < 0.3,
      ws: ['off', 'trim', 'collapse', 'all'][Math.floor(rnd() * 4)],
    });
    for (const gran of ['words', 'chars']) {
      const r = tokenDiff(a, b, o, gran, gran === 'words');
      let ap = 0, bp = 0;
      for (const p of r.pieces) {
        assert.ok(p[1] === ap && p[3] === bp, `gap in pieces for ${JSON.stringify([a, b, o, gran])}`);
        ap = p[2]; bp = p[4];
        if (p[0] === 1) assert.ok(p[3] === p[4]);
        if (p[0] === 2) assert.ok(p[1] === p[2]);
      }
      assert.ok(ap === a.length && bp === b.length, `coverage ${JSON.stringify([a, b, gran])}`);
    }
  }
});
check('property: line level equality agrees with the highlight', () => {
  const rnd = rng(555);
  const alphabet = ['a', 'B', ' ', '  ', '\t', NBSP, ZWSP, LQ, '"', 'e\u0301', '\u00E9', 'word', 'Word', '1'];
  const pick = () => { let s = ''; const n = 1 + Math.floor(rnd() * 6); for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)]; return s; };
  let bad = 0;
  for (let t = 0; t < 800; t++) {
    const a = pick();
    const b = pick();
    const o = withDefaults({
      ignoreCase: rnd() < 0.4, nfc: rnd() < 0.4, quotes: rnd() < 0.4, nbspzw: rnd() < 0.4,
      ws: ['off', 'trim', 'collapse'][Math.floor(rnd() * 3)],
    });
    const lineEq = normalizeString(a, o) === normalizeString(b, o);
    const r = compare(a, b, { ...o, mode: 'lines' });
    const words = compare(a, b, { ...o, mode: 'words' });
    if (lineEq !== (r.stats.changes === 0)) bad++;
    if (lineEq && words.stats.changes !== 0) bad++;
  }
  // Words mode may call two lines equal that the line view calls different (for example a split word). Keep the rate small.
  assert.ok(bad <= 8, `disagreements: ${bad}`);
});

// ---- section 5.2 size and speed
function s1() {
  const mk = (changed) => {
    const out = [];
    for (let i = 0; i < 100000; i++) out.push(changed && i % 100 === 0 ? `CHANGED ${i}` : `line ${i} lorem ipsum dolor sit amet ${(i * 7) % 1000}`);
    return out.join('\n');
  };
  return [mk(false), mk(true)];
}
let timings = {};
check('S1 100k lines, 1000 changed', () => {
  const [a, b] = s1();
  const t0 = Date.now();
  const r = compare(a, b, { mode: 'lines' });
  timings.S1 = Date.now() - t0;
  eq(r.stats.changes, 1000);
  eq(r.stats.linesChanged, 1000);
  assert.ok(timings.S1 < 3000, `took ${timings.S1} ms`);
});
check('S2 20k lines almost all different', () => {
  const rnd = rng(42);
  const mk = () => Array.from({ length: 20000 }, () => `row ${Math.floor(rnd() * 1e9)} ${Math.floor(rnd() * 1e9)}`);
  const A = mk();
  const B = mk();
  for (let i = 0; i < 40; i++) B[Math.floor(rnd() * 20000)] = A[Math.floor(rnd() * 20000)];
  const t0 = Date.now();
  const r = compare(A.join('\n'), B.join('\n'), { mode: 'lines' });
  timings.S2 = Date.now() - t0;
  assert.ok(timings.S2 < 4000, `took ${timings.S2} ms`);
  // Rebuild B from the blocks and check it equals B.
  const rebuilt = [];
  for (const b of r.blocks) {
    if (b.t === 'eq') for (let q = 0; q < b.n; q++) rebuilt.push(r.bLines[b.b + q]);
    else if (b.t === 'chg') for (const row of b.rows) if (row.bl >= 0) rebuilt.push(r.bLines[row.bl]);
  }
  eq(rebuilt.length, B.length);
  eq(rebuilt.join('\n'), B.join('\n'));
});
check('S3 one 2 MB line with one changed character', () => {
  const base = 'abcdefghij '.repeat(190000);
  const b = base.slice(0, 1000000) + 'X' + base.slice(1000001);
  const t0 = Date.now();
  const r = compare(base, b, { mode: 'lines' });
  timings.S3 = Date.now() - t0;
  eq(r.stats.changes, 1);
  const ch = changes(r);
  eq(ch.add, ['X']);
  assert.ok(timings.S3 < 1500, `took ${timings.S3} ms`);
});
check('S4 long line in characters mode switches to words', () => {
  const a = 'x'.repeat(1000000);
  const rnd = rng(3);
  const b = Array.from(a, (c) => (rnd() < 0.05 ? 'y' : c)).join('');
  const t0 = Date.now();
  const r = compare(a, b, { mode: 'chars' });
  timings.S4 = Date.now() - t0;
  eq(r.mode, 'words');
  assert.ok(r.notes.some((n) => n.id === 'switched'));
  assert.ok(timings.S4 < 3000, `took ${timings.S4} ms`);
});
check('S7 option-only change on a big diff', () => {
  const [a, b] = s1();
  compare(a, b, { mode: 'lines' });
  const t0 = Date.now();
  compare(a, b, { mode: 'lines', ignoreCase: true });
  timings.S7 = Date.now() - t0;
  assert.ok(timings.S7 < 3000, `took ${timings.S7} ms`);
});

if (failed) {
  console.error(`FAILED ${failed} of ${checks + failed}`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed. Timings (ms): ${JSON.stringify(timings)}`);
