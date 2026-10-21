// Text exports built from a compare result: unified diff, redline (plain and HTML), stats.
import { esc } from '../esc.js';

/** Flatten a lines-mode result into diff items: { k: ' ' | '-' | '+', text, a, b }. a and b are 1-based line numbers (0 = none). */
function lineItems(res) {
  const items = [];
  for (const b of res.blocks) {
    if (b.t === 'eq') {
      for (let q = 0; q < b.n; q++) items.push({ k: ' ', text: res.aLines[b.a + q], a: b.a + q + 1, b: b.b + q + 1 });
    } else if (b.t === 'chg') {
      // Blank lines that an option ignores (block 'ign') are left out: they are not differences.
      for (const r of b.rows) if (r.al >= 0) items.push({ k: '-', text: res.aLines[r.al], a: r.al + 1, b: 0 });
      for (const r of b.rows) if (r.bl >= 0) items.push({ k: '+', text: res.bLines[r.bl], a: 0, b: r.bl + 1 });
    }
  }
  return items;
}

function range(start, len) {
  if (len === 1) return `${start}`;
  return `${start},${len}`;
}

/**
 * Git style unified diff with 3 lines of context. Needs a result from mode 'lines'.
 * Lines are joined with "\n" and there is no final newline.
 */
export function unifiedDiff(res, context = 3) {
  const out = ['--- original', '+++ changed'];
  if (res.mode !== 'lines') return out.join('\n');
  const items = lineItems(res);
  const changed = [];
  items.forEach((it, i) => { if (it.k !== ' ') changed.push(i); });
  if (changed.length === 0) return out.join('\n');
  const strictFinal = res.options && !res.options.finalNewlineEqual;
  // group changed items into hunks, merging when the gap is small
  const groups = [];
  let start = changed[0];
  let end = changed[0];
  for (let i = 1; i < changed.length; i++) {
    if (changed[i] - end - 1 <= context * 2) end = changed[i];
    else { groups.push([start, end]); start = end = changed[i]; }
  }
  groups.push([start, end]);
  const lastA = res.aLines.length;
  const lastB = res.bLines.length;
  for (const [s, e] of groups) {
    const from = Math.max(0, s - context);
    const to = Math.min(items.length - 1, e + context);
    let aStart = 0;
    let bStart = 0;
    let aLen = 0;
    let bLen = 0;
    const body = [];
    for (let i = from; i <= to; i++) {
      const it = items[i];
      if (it.k !== '+') { if (!aStart) aStart = it.a; aLen++; }
      if (it.k !== '-') { if (!bStart) bStart = it.b; bLen++; }
      body.push(it.k + it.text);
      if (strictFinal) {
        if (it.k === '-' && it.a === lastA && !res.aFinal) body.push('\\ No newline at end of file');
        if (it.k === '+' && it.b === lastB && !res.bFinal) body.push('\\ No newline at end of file');
        // A last line that is the same on both sides, and has no newline on either side, needs the mark too, or `patch` rejects the diff.
        if (it.k === ' ' && it.a === lastA && it.b === lastB && !res.aFinal && !res.bFinal) body.push('\\ No newline at end of file');
      }
    }
    if (!aStart) {
      // no old lines: the start is the line before the first new one
      let prev = 0;
      for (let i = from - 1; i >= 0; i--) if (items[i].a) { prev = items[i].a; break; }
      aStart = prev;
    }
    if (!bStart) {
      let prev = 0;
      for (let i = from - 1; i >= 0; i--) if (items[i].b) { prev = items[i].b; break; }
      bStart = prev;
    }
    out.push(`@@ -${range(aStart, aLen)} +${range(bStart, bLen)} @@`);
    out.push(...body);
  }
  return out.join('\n');
}

// ---- redline
function rowParts(row) {
  // Returns [{t, text}] with t = 0 equal, 1 deleted, 2 added
  if (row.segs) {
    const parts = [];
    for (const p of row.segs) {
      if (p[0] === 0) parts.push({ t: 0, text: (row.at || '').slice(p[1], p[2]) });
      else if (p[0] === 1) parts.push({ t: 1, text: (row.at || '').slice(p[1], p[2]) });
      else parts.push({ t: 2, text: (row.bt || '').slice(p[3], p[4]) });
    }
    return parts;
  }
  if (row.at != null && row.bt == null) return [{ t: 1, text: row.at }];
  if (row.bt != null && row.at == null) return [{ t: 2, text: row.bt }];
  return [{ t: 0, text: row.at || '' }];
}

/** Redline as a list of lines, each a list of parts. */
function redlineLines(res) {
  const lines = [];
  for (const b of res.blocks) {
    if (b.t === 'eq') {
      for (let q = 0; q < b.n; q++) lines.push([{ t: 0, text: res.aLines[b.a + q] }]);
    } else if (b.t === 'ign') {
      if (b.side === 'a') lines.push([{ t: 0, text: res.aLines[b.i] }]); // a blank line that an option ignores
    } else if (b.t === 'context') {
      lines.push([{ t: 0, text: b.row.at }]);
    } else {
      for (const r of b.rows) lines.push(rowParts(r));
    }
  }
  return lines;
}

/** { plain, html }: plain uses [-removed-]{+added+}; html uses <del> and <ins> with inline styles. */
export function redline(res) {
  const lines = redlineLines(res);
  const plain = lines.map((parts) => parts.map((p) => (p.t === 0 ? p.text : p.t === 1 ? `[-${p.text}-]` : `{+${p.text}+}`)).join('')).join('\n');
  // <s> and <u> go inside <del> and <ins> because every editor knows them. No font is forced, so the text takes the font of the page it lands in.
  const DEL_STYLE = 'color:#b42318;background:#fee4e2;text-decoration:line-through;';
  const INS_STYLE = 'color:#067647;background:#d1fadf;text-decoration:underline;';
  const html = '<div>' + lines.map((parts) => {
    const inner = parts.map((p) => {
      // An added or removed empty line has no text. A non-breaking space keeps its line from collapsing.
      const t = (p.text === '' && p.t !== 0 ? '&nbsp;' : esc(p.text)).replace(/\r\n|\r|\n/g, '<br>').replace(/ {2,}/g, (m) => '&nbsp;'.repeat(m.length - 1) + ' ').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
      if (p.t === 0) return t;
      return p.t === 1 ? `<del style="${DEL_STYLE}"><s>${t}</s></del>` : `<ins style="${INS_STYLE}"><u>${t}</u></ins>`;
    }).join('');
    return `<p style="margin:0;">${inner || '&nbsp;'}</p>`;
  }).join('') + '</div>';
  return { plain, html };
}

/** One line of stats for the clipboard. */
export function statsText(res) {
  const s = res.stats;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [
    plural(s.changes, 'change'),
    `${plural(s.wordsAdded, 'word')} added, ${s.wordsRemoved} removed`,
    `${plural(s.charsAdded, 'character')} added, ${s.charsRemoved} removed`,
    `Lines: ${s.linesAdded} added, ${s.linesRemoved} removed, ${s.linesChanged} changed`,
  ];
  if (s.similarity !== null) parts.push(`Similarity ${s.similarity} percent`);
  return parts.join('. ') + '.';
}
