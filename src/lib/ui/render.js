// HTML builders for the result views. Pure functions: no DOM access, so node can test them.
import { hiddenParts } from '../diff/unicode-names.js';

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RUN = 8; // runs of the same hidden character longer than this collapse
const LONG = 1400; // unchanged text longer than this is folded in the middle
const KEEP = 300;

/** Text with optional hidden-character marks. */
export function fragHtml(text, hidden) {
  if (!text) return '';
  if (!hidden) return esc(text);
  let out = '';
  for (const p of hiddenParts(text)) {
    if (p.k === 'text') { out += esc(p.s); continue; }
    const n = p.n;
    const long = n > RUN;
    switch (p.k) {
      case 'space':
        out += long ? `<span class="hc hc-sp" title="${n} spaces">·×${n}</span>` : `<span class="hc hc-sp">${'·'.repeat(n)}</span>`;
        break;
      case 'tab':
        out += long
          ? `<span class="hc hc-tab" title="${n} tabs">→×${n}</span>`
          : `<span class="hc hc-tab">→</span>`.repeat(n);
        break;
      case 'cr': out += `<span class="hc hc-eol" title="Carriage return (CR)">␍</span>`.repeat(Math.min(n, RUN)); break;
      case 'lf': out += `<span class="hc hc-eol" title="Line feed (LF)">␊</span>`.repeat(Math.min(n, RUN)); break;
      case 'nbsp': out += `<span class="hc hc-box" title="${esc(p.label)} U+${p.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}">${esc(p.label)}</span>`.repeat(Math.min(n, RUN)); break;
      default:
        out += `<span class="hc hc-chip" title="U+${p.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}">${esc(p.label)}</span>`.repeat(Math.min(n, RUN));
    }
  }
  return out;
}

/**
 * Render text split into ranges. ranges: [[start, end, pieceIndex or -1, kind]]
 * kind: 'del' | 'ins' for marked ranges. `expandKey` is the entry index for the "show more" button.
 */
export function rangesHtml(text, ranges, hidden, expandKey, expanded, ci0) {
  let out = '';
  for (const [s, e, p, kind, gi, small] of ranges) {
    const part = text.slice(s, e);
    if (p < 0) {
      if (part.length > LONG && !expanded) {
        const hide = part.length - 2 * KEEP;
        out += fragHtml(part.slice(0, KEEP), hidden)
          + `<button type="button" class="more" data-more="${expandKey}">… ${hide.toLocaleString('en-US')} more characters …</button>`
          + fragHtml(part.slice(-KEEP), hidden);
      } else out += fragHtml(part, hidden);
    } else {
      const ci = ci0 >= 0 ? ` data-ci="${ci0 + gi}"` : '';
      out += `<mark class="m-${kind}${small ? ' can' : ''}" data-p="${p}"${ci}>${fragHtml(part, hidden) || '​'}</mark>`;
    }
  }
  return out;
}

/** Ranges for one side from a row's segs. side: 'a' | 'b'. */
export function sideRanges(segs, side, row) {
  const out = [];
  let gi = -1;
  let inGroup = false;
  segs.forEach((p, i) => {
    if (p[0] === 0) { inGroup = false; const s = side === 'a' ? p[1] : p[3]; const e = side === 'a' ? p[2] : p[4]; if (e > s) out.push([s, e, -1, null, 0]); return; }
    if (!inGroup) { gi++; inGroup = true; }
    if (side === 'a' && p[0] === 1 && p[2] > p[1]) out.push([p[1], p[2], i, 'del', gi, isSmall(row, i)]);
    if (side === 'b' && p[0] === 2 && p[4] > p[3]) out.push([p[3], p[4], i, 'ins', gi, isSmall(row, i)]);
  });
  return out;
}

/** A change of 1 to 3 characters can be inspected. */
export function isSmall(row, i) {
  const g = groupTexts(row, i);
  if (!g || (!g.x && !g.y)) return false;
  return Array.from(g.x).length <= 3 && Array.from(g.y).length <= 3;
}

/** Number of change groups in a row. */
export function groupCount(segs) {
  let n = 0;
  let inGroup = false;
  for (const p of segs) {
    if (p[0] === 0) inGroup = false;
    else if (!inGroup) { n++; inGroup = true; }
  }
  return n;
}

const plain = (text) => (text.length ? [[0, text.length, -1, null, 0]] : []);

/** Cell HTML for one side of a row. */
function sideHtml(row, side, hidden, key, expanded, ci0) {
  const text = side === 'a' ? row.at : row.bt;
  if (text == null) return '';
  if (row.segs) return rangesHtml(text, sideRanges(row.segs, side, row), hidden, key, expanded, ci0);
  // whole line removed or added
  return `<mark class="m-${side === 'a' ? 'del' : 'ins'} m-line" data-p="-1">${rangesHtml(text, plain(text), hidden, key, expanded, -1) || '​'}</mark>`;
}

function lnText(first, count) {
  if (first < 0 || count < 1) return '';
  return count > 1 ? `${first + 1}–${first + count}` : `${first + 1}`;
}

function ariaFor(row) {
  const a = row.at == null ? '' : row.at;
  const b = row.bt == null ? '' : row.bt;
  const cut = (s) => (s.length > 160 ? s.slice(0, 160) + '…' : s);
  const line = row.al >= 0 ? row.al + 1 : row.bl + 1;
  if (row.at != null && row.bt != null) return `Line ${line}, changed: from ${cut(a) || 'empty'} to ${cut(b) || 'empty'}`;
  if (row.at != null) return `Line ${line}, removed: ${cut(a) || 'empty'}`;
  return `Line ${line}, added: ${cut(b) || 'empty'}`;
}

/**
 * Build the entry list for a view.
 * view: 'split' | 'unified' | 'inline'. Returns { entries, changes }.
 * changes: entry index for each change, in order (a change is a block in lines mode, a group in words and characters mode).
 */
export function flatten(res, view, hide, folds, ctx = 3) {
  const entries = [];
  const changes = [];
  const lines = res.mode === 'lines';
  let blkIdx = 0;
  let grpIdx = 0;
  const blocks = res.blocks;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.t === 'eq') {
      const prevChange = bi > 0 && blocks[bi - 1].t !== 'eq';
      const nextChange = bi + 1 < blocks.length && blocks[bi + 1].t !== 'eq';
      if (hide && (prevChange || nextChange) && b.n > 2 * ctx + 1) {
        const lead = prevChange ? ctx : 0;
        const tail = nextChange ? ctx : 0;
        const key = b.a;
        for (let q = 0; q < lead; q++) entries.push({ k: 'eq', a: b.a + q, b: b.b + q });
        const hiddenN = b.n - lead - tail;
        if (folds && folds.has(key)) {
          for (let q = lead; q < b.n - tail; q++) entries.push({ k: 'eq', a: b.a + q, b: b.b + q });
        } else entries.push({ k: 'fold', key, n: hiddenN });
        for (let q = b.n - tail; q < b.n; q++) entries.push({ k: 'eq', a: b.a + q, b: b.b + q });
      } else if (hide && !prevChange && !nextChange && b.n > 0) {
        // the whole text is equal
        const key = b.a;
        if (folds && folds.has(key)) for (let q = 0; q < b.n; q++) entries.push({ k: 'eq', a: b.a + q, b: b.b + q });
        else entries.push({ k: 'fold', key, n: b.n });
      } else {
        for (let q = 0; q < b.n; q++) entries.push({ k: 'eq', a: b.a + q, b: b.b + q });
      }
    } else if (b.t === 'ign') {
      entries.push({ k: 'ign', side: b.side, i: b.i });
    } else if (b.t === 'x') {
      entries.push({ k: 'x', row: b.row });
    } else {
      const first = entries.length;
      if (lines) {
        changes.push(first);
        const ci = blkIdx++;
        if (view === 'unified') {
          for (const r of b.rows) if (r.al >= 0) entries.push({ k: 'u', t: '-', row: r, ci });
          for (const r of b.rows) if (r.bl >= 0) entries.push({ k: 'u', t: '+', row: r, ci });
        } else {
          for (const r of b.rows) entries.push({ k: view === 'inline' ? 'il' : 'row', row: r, ci, ci0: -1 });
        }
      } else {
        for (const r of b.rows) {
          const ng = r.segs ? groupCount(r.segs) : 1;
          const ci0 = grpIdx;
          for (let g = 0; g < ng; g++) changes.push(entries.length);
          grpIdx += ng;
          if (view === 'unified') {
            if (r.at != null) entries.push({ k: 'u', t: '-', row: r, ci: -1, ci0 });
            if (r.bt != null) entries.push({ k: 'u', t: '+', row: r, ci: -1, ci0 });
          } else entries.push({ k: view === 'inline' ? 'il' : 'row', row: r, ci: -1, ci0 });
        }
      }
    }
  }
  return { entries, changes };
}

/** Rows of one entry as HTML. `idx` is the entry index. */
export function entryHtml(res, e, idx, view, hidden, expanded) {
  const exp = expanded && expanded.has(idx);
  switch (e.k) {
    case 'fold':
      return `<div class="row fold"><button type="button" class="foldbtn" data-fold="${e.key}">${e.n.toLocaleString('en-US')} unchanged ${e.n === 1 ? 'line' : 'lines'}. Show</button></div>`;
    case 'eq': {
      const a = res.aLines[e.a];
      const b = res.bLines[e.b];
      const same = a === b;
      const ta = rangesHtml(a, plain(a), hidden, idx, exp, -1);
      const tb = same ? ta : rangesHtml(b, plain(b), hidden, idx, exp, -1);
      if (view === 'inline') return `<div class="row il eq"><span class="tx">${ta || '​'}</span></div>`;
      if (view === 'unified') return `<div class="row u eq"><span class="ln">${e.a + 1}</span><span class="ln">${e.b + 1}</span><span class="sg" aria-hidden="true"> </span><span class="tx">${ta || '​'}</span></div>`;
      return `<div class="row eq"><div class="cell"><span class="ln">${e.a + 1}</span><span class="tx">${ta || '​'}</span></div><div class="cell"><span class="ln">${e.b + 1}</span><span class="tx">${tb || '​'}</span></div></div>`;
    }
    case 'ign': {
      const text = e.side === 'a' ? res.aLines[e.i] : res.bLines[e.i];
      const t = fragHtml(text, hidden) || '​';
      if (view === 'inline') return `<div class="row il ign" title="Ignored blank line"><span class="tx">${t}</span></div>`;
      if (view === 'unified') return `<div class="row u ign" title="Ignored blank line"><span class="ln">${e.side === 'a' ? e.i + 1 : ''}</span><span class="ln">${e.side === 'b' ? e.i + 1 : ''}</span><span class="sg" aria-hidden="true"> </span><span class="tx">${t}</span></div>`;
      return `<div class="row ign" title="Ignored blank line"><div class="cell ${e.side === 'a' ? '' : 'none'}"><span class="ln">${e.side === 'a' ? e.i + 1 : ''}</span><span class="tx">${e.side === 'a' ? t : ''}</span></div><div class="cell ${e.side === 'b' ? '' : 'none'}"><span class="ln">${e.side === 'b' ? e.i + 1 : ''}</span><span class="tx">${e.side === 'b' ? t : ''}</span></div></div>`;
    }
    case 'x': {
      const r = e.row;
      const ta = fragHtml(r.at, hidden) || '​';
      const tb = fragHtml(r.bt, hidden) || '​';
      if (view === 'inline') return `<div class="row il eq"><span class="tx">${ta}</span></div>`;
      if (view === 'unified') return `<div class="row u eq"><span class="ln">${lnText(r.al, r.an)}</span><span class="ln">${lnText(r.bl, r.bn)}</span><span class="sg" aria-hidden="true"> </span><span class="tx">${ta}</span></div>`;
      return `<div class="row eq"><div class="cell"><span class="ln">${lnText(r.al, r.an)}</span><span class="tx">${ta}</span></div><div class="cell"><span class="ln">${lnText(r.bl, r.bn)}</span><span class="tx">${tb}</span></div></div>`;
    }
    case 'row': {
      const r = e.row;
      const ci = e.ci >= 0 ? ` data-ci="${e.ci}"` : '';
      const ca = r.at == null ? 'cell none' : 'cell a';
      const cb = r.bt == null ? 'cell none' : 'cell b';
      const cls = r.at != null && r.bt != null ? 'chg' : r.at != null ? 'del' : 'add';
      return `<div class="row ${cls}"${ci} data-e="${idx}" role="group" aria-label="${esc(ariaFor(r))}">`
        + `<div class="${ca}"><span class="ln">${lnText(r.al, r.an)}</span><span class="sg" aria-hidden="true">${r.at != null ? '−' : ''}</span><span class="tx">${sideHtml(r, 'a', hidden, idx, exp, e.ci0)}</span></div>`
        + `<div class="${cb}"><span class="ln">${lnText(r.bl, r.bn)}</span><span class="sg" aria-hidden="true">${r.bt != null ? '+' : ''}</span><span class="tx">${sideHtml(r, 'b', hidden, idx, exp, e.ci0)}</span></div></div>`;
    }
    case 'u': {
      const r = e.row;
      const del = e.t === '-';
      const ci = e.ci >= 0 ? ` data-ci="${e.ci}"` : '';
      return `<div class="row u ${del ? 'del' : 'add'}"${ci} data-e="${idx}" role="group" aria-label="${esc(ariaFor(r))}"><span class="ln">${del ? lnText(r.al, r.an) : ''}</span><span class="ln">${del ? '' : lnText(r.bl, r.bn)}</span><span class="sg" aria-hidden="true">${del ? '−' : '+'}</span><span class="tx">${sideHtml(r, del ? 'a' : 'b', hidden, idx, exp, e.ci0)}</span></div>`;
    }
    case 'il': {
      const r = e.row;
      const ci = e.ci >= 0 ? ` data-ci="${e.ci}"` : '';
      let inner = '';
      if (r.segs) {
        let gi = -1;
        let inGroup = false;
        r.segs.forEach((p, i) => {
          if (p[0] === 0) { inGroup = false; inner += fragHtml(r.at.slice(p[1], p[2]), hidden); return; }
          if (!inGroup) { gi++; inGroup = true; }
          const ca = e.ci0 >= 0 ? ` data-ci="${e.ci0 + gi}"` : '';
          const can = isSmall(r, i) ? ' class="can"' : '';
          if (p[0] === 1) inner += `<del${can} data-p="${i}"${ca}>${fragHtml(r.at.slice(p[1], p[2]), hidden) || '​'}</del>`;
          else inner += `<ins${can} data-p="${i}"${ca}>${fragHtml(r.bt.slice(p[3], p[4]), hidden) || '​'}</ins>`;
        });
      } else if (r.at != null && r.bt == null) inner = `<del data-p="-1">${fragHtml(r.at, hidden) || '​'}</del>`;
      else inner = `<ins data-p="-1">${fragHtml(r.bt, hidden) || '​'}</ins>`;
      return `<div class="row il chg"${ci} data-e="${idx}" role="group" aria-label="${esc(ariaFor(r))}"><span class="tx">${inner || '​'}</span></div>`;
    }
    default:
      return '';
  }
}

/**
 * Text of one change group for the inspector: { x: removed text, y: added text } around piece `p` of a row.
 */
export function groupTexts(row, p) {
  if (!row.segs || p < 0) return null;
  let s = p;
  let e = p;
  while (s > 0 && row.segs[s - 1][0] !== 0) s--;
  while (e + 1 < row.segs.length && row.segs[e + 1][0] !== 0) e++;
  let x = '';
  let y = '';
  for (let i = s; i <= e; i++) {
    const q = row.segs[i];
    if (q[0] === 1) x += (row.at || '').slice(q[1], q[2]);
    else if (q[0] === 2) y += (row.bt || '').slice(q[3], q[4]);
  }
  return { x, y };
}
