// Page logic for the Text Diff Checker: panes, options, worker, virtual result list, copy, inspector.
import { redline, unifiedDiff, statsText } from '../diff/export.js';
import { DEFAULT_OPTIONS } from '../diff/chars.js';
import { inspectChange, isHidden } from '../diff/unicode-names.js';
import { flatten, entryHtml, groupTexts, esc } from './render.js';
import { SAMPLE_A, SAMPLE_B } from './sample.js';

const STORE_KEY = 'bm.textdiff.opts.v1';
const ROW_EST = 24;
const MAX_ROWS_WRAP = 20000;

const $ = (id) => document.getElementById(id);
const root = $('tool');
if (root) init();

function init() {
  const phoneQuery = window.matchMedia('(max-width: 767px)');
  const state = {
    opts: { ...DEFAULT_OPTIONS },
    view: phoneQuery.matches ? 'unified' : 'split',
    viewChosen: false,
    hidden: false,
    hide: false,
    wrap: true,
    result: null,
    flat: { entries: [], changes: [] },
    cur: -1,
    folds: new Set(),
    expanded: new Set(),
    compact: false,
  };

  // ---- saved options (optional: the tool works without storage)
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (saved.opts) state.opts = { ...DEFAULT_OPTIONS, ...saved.opts };
      if (['split', 'unified', 'inline'].includes(saved.view)) { state.view = saved.view; state.viewChosen = !!saved.viewChosen; }
      state.hidden = !!saved.hidden;
      state.hide = !!saved.hide;
      if (saved.wrap === false) state.wrap = false;
    }
  } catch { /* storage is blocked: ignore */ }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ opts: state.opts, view: state.view, viewChosen: state.viewChosen, hidden: state.hidden, hide: state.hide, wrap: state.wrap }));
    } catch { /* ignore */ }
  };

  // ---- elements
  const taA = $('ta-a');
  const taB = $('ta-b');
  const gutA = $('gut-a');
  const gutB = $('gut-b');
  const list = $('list');
  const rowsEl = $('vrows');
  const padTop = $('vpad-top');
  const padBottom = $('vpad-bottom');
  const summary = $('summary');
  const notesEl = $('notes');
  const chipsEl = $('chips');
  const counter = $('counter');
  const progress = $('progress');
  const toast = $('toast');
  const emptyEl = $('empty');
  const identicalEl = $('identical');
  const resultBody = $('result-body');
  const inspector = $('inspector');
  const optsPanel = $('opts-panel');
  const btnOpts = $('btn-opts');
  const phoneNote = $('phone-note');
  const panes = $('panes');

  // A textarea turns CRLF and CR into LF, and it gets slow past about 1 MB. So the page keeps the exact text here:
  // - an opened file keeps its CR and CRLF until the user edits that box;
  // - a large text lives only here, and the box shows a read-only preview.
  const LARGE = 600000;
  const PREVIEW_LINES = 300;
  const raw = { a: null, b: null };
  const large = { a: false, b: false };
  const textOf = (side) => {
    if (large[side]) return raw[side];
    const ta = side === 'a' ? taA : taB;
    return raw[side] !== null && raw[side].replace(/\r\n|\r/g, '\n') === ta.value ? raw[side] : ta.value;
  };

  // ---- helpers
  const say = (msg) => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(say.t);
    say.t = setTimeout(() => { toast.hidden = true; toast.textContent = ''; }, 4500);
  };
  const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

  // ---- worker
  let worker = null;
  let jobId = 0;
  let busy = false;
  let progressTimer = 0;
  let debounceTimer = 0;
  const startWorker = () => {
    worker = new Worker(new URL('../diff/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => { busy = false; hideProgress(); say('The compare failed. Try again with different options.'); };
  };
  const showProgress = () => { progress.hidden = false; };
  const hideProgress = () => { clearTimeout(progressTimer); progress.hidden = true; };

  function runCompare() {
    clearTimeout(debounceTimer);
    const a = textOf('a');
    const b = textOf('b');
    if (!worker) startWorker();
    else if (busy) { worker.terminate(); startWorker(); }
    busy = true;
    const id = ++jobId;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(showProgress, 400);
    worker.postMessage({ id, type: 'compare', a, b, options: { ...state.opts } });
  }
  function onWorkerMessage(ev) {
    const m = ev.data;
    if (m.id !== jobId) return;
    busy = false;
    hideProgress();
    if (m.error) { say('The compare failed: ' + m.error); return; }
    applyResult(m.result);
  }
  $('cancel').addEventListener('click', () => {
    if (!busy) return;
    worker.terminate();
    worker = null;
    busy = false;
    hideProgress();
    say('Compare cancelled. Change the texts or options to run it again.');
  });

  const schedule = (ms = 300) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCompare, ms);
  };

  // ---- panes
  // One pass over the text: lines, words and characters, without making big arrays.
  function countText(v) {
    const n = v.length;
    if (n === 0) return { lines: 0, words: 0, chars: 0 };
    let lines = 1;
    let words = 0;
    let inWord = false;
    for (let i = 0; i < n; i++) {
      const c = v.charCodeAt(i);
      if (c === 10) lines++;
      else if (c === 13) { if (v.charCodeAt(i + 1) !== 10) lines++; }
      const space = c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x2028 || c === 0x2029 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0xfeff;
      if (space) inWord = false;
      else if (!inWord) { inWord = true; words++; }
    }
    return { lines, words, chars: n };
  }
  const gutterPending = new Map();
  function updateGutter(ta, gut) {
    if (gutterPending.has(gut)) return;
    gutterPending.set(gut, requestAnimationFrame(() => {
      gutterPending.delete(gut);
      const v = ta.value;
      let n = 1;
      for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
      if (gut.dataset.n !== String(n)) {
        gut.dataset.n = String(n);
        let s = '';
        for (let i = 1; i <= n; i++) s += i + '\n';
        gut.textContent = s;
      }
      gut.scrollTop = ta.scrollTop;
    }));
  }
  let countTimer = 0;
  function updateCounts() {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      for (const [side, id] of [['a', 'cnt-a'], ['b', 'cnt-b']]) {
        const c = countText(textOf(side));
        $(id).textContent = `${c.lines.toLocaleString('en-US')} lines, ${c.words.toLocaleString('en-US')} words, ${c.chars.toLocaleString('en-US')} characters`;
        $('pane-' + side).classList.toggle('is-large', large[side]);
        $('large-' + side).hidden = !large[side];
      }
    }, 120);
  }
  function leaveLarge(side) {
    if (!large[side]) return;
    const ta = side === 'a' ? taA : taB;
    large[side] = false;
    raw[side] = null;
    ta.readOnly = false;
    ta.value = '';
  }
  for (const [side, ta, gut] of [['a', taA, gutA], ['b', taB, gutB]]) {
    ta.addEventListener('input', () => { raw[side] = null; updateGutter(ta, gut); updateCounts(); schedule(300); });
    ta.addEventListener('paste', (e) => {
      const clip = e.clipboardData && e.clipboardData.getData('text/plain');
      if (clip && clip.length > LARGE) {
        // Too big for a text box. Keep it in memory and show a preview.
        e.preventDefault();
        setText(ta, gut, clip);
        runCompare();
        return;
      }
      if (large[side]) leaveLarge(side);
      setTimeout(() => { raw[side] = null; updateGutter(ta, gut); updateCounts(); runCompare(); }, 0);
    });
    ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
  }
  function setText(ta, gut, value) {
    const side = ta === taA ? 'a' : 'b';
    raw[side] = value;
    if (value.length > LARGE) {
      large[side] = true;
      let end = 0;
      let lines = 0;
      while (lines < PREVIEW_LINES && end >= 0) { end = value.indexOf('\n', end + 1); lines++; }
      ta.value = value.slice(0, end < 0 || end > 20000 ? 20000 : end).replace(/\r\n|\r/g, '\n');
      ta.readOnly = true;
    } else {
      large[side] = false;
      ta.readOnly = false;
      ta.value = value;
    }
    updateGutter(ta, gut);
    updateCounts();
  }

  // ---- files
  const BINARY_MSG = 'This looks like a Word, PDF or image file. Copy the text out and paste it here.';
  function looksBinary(bytes) {
    const n = Math.min(bytes.length, 8192);
    if (n >= 4) {
      const sig = (s) => s.split('').every((c, i) => bytes[i] === c.charCodeAt(0));
      if (sig('%PDF') || sig('PK\u0003\u0004') || sig('\u0089PNG') || sig('GIF8') || sig('\u007fELF')) return true;
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
      if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return true;
    }
    let ctrl = 0;
    for (let i = 0; i < n; i++) {
      const c = bytes[i];
      if (c === 0) return true;
      if (c < 9 || (c > 13 && c < 32 && c !== 27)) ctrl++;
    }
    return n > 0 && ctrl / n > 0.1;
  }
  async function openFile(file, ta, gut, label) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { say('This file is over 50 MB. Open a smaller one.'); return; }
    if (file.size > 25 * 1024 * 1024) say('Large file. Comparing may take a while. You can cancel.');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let enc = 'utf-8';
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) enc = 'utf-16le';
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) enc = 'utf-16be';
    else if (looksBinary(bytes)) { say(BINARY_MSG); return; }
    const text = new TextDecoder(enc, { ignoreBOM: true }).decode(bytes);
    setText(ta, gut, text);
    say(`${label}: opened ${file.name}.`);
    runCompare();
  }
  for (const [side, ta, gut] of [['a', taA, gutA], ['b', taB, gutB]]) {
    const input = $('file-' + side);
    const label = side === 'a' ? 'Original' : 'Changed';
    $('open-' + side).addEventListener('click', () => input.click());
    input.addEventListener('change', () => { openFile(input.files[0], ta, gut, label); input.value = ''; });
    const pane = $('pane-' + side);
    pane.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); pane.classList.add('drop'); } });
    pane.addEventListener('dragleave', () => pane.classList.remove('drop'));
    pane.addEventListener('drop', (e) => {
      pane.classList.remove('drop');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); openFile(f, ta, gut, label); }
    });
    $('clear-' + side).addEventListener('click', () => { setText(ta, gut, ''); runCompare(); ta.focus(); });
  }

  $('btn-sample').addEventListener('click', () => { setText(taA, gutA, SAMPLE_A); setText(taB, gutB, SAMPLE_B); runCompare(); });
  $('btn-swap').addEventListener('click', () => {
    const a = textOf('a');
    setText(taA, gutA, textOf('b'));
    setText(taB, gutB, a);
    runCompare();
  });
  $('btn-clear').addEventListener('click', () => { setText(taA, gutA, ''); setText(taB, gutB, ''); runCompare(); taA.focus(); });
  $('btn-compare').addEventListener('click', () => runCompare());
  $('btn-panes').addEventListener('click', () => {
    const collapsed = panes.classList.toggle('collapsed');
    $('btn-panes').setAttribute('aria-expanded', String(!collapsed));
    $('btn-panes').textContent = collapsed ? 'Edit texts' : 'Hide texts';
  });

  // ---- toolbar controls
  function syncControls() {
    for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === state.opts.mode;
    for (const r of document.querySelectorAll('input[name="view"]')) r.checked = r.value === state.view;
    for (const r of document.querySelectorAll('input[name="ws"]')) r.checked = r.value === state.opts.ws;
    for (const k of ['ignoreCase', 'ignoreBlank', 'eolEqual', 'finalNewlineEqual', 'nfc', 'quotes', 'nbspzw']) {
      const el = $('opt-' + k);
      if (el) el.checked = !!state.opts[k];
    }
    $('tog-hidden').checked = state.hidden;
    $('tog-hide').checked = state.hide;
    $('tog-wrap').checked = state.wrap;
    renderChips();
  }
  const autoView = () => {
    if (state.viewChosen) return;
    state.view = state.opts.mode === 'lines' ? (phoneQuery.matches ? 'unified' : 'split') : 'inline';
  };
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', () => { state.opts.mode = r.value; autoView(); syncControls(); save(); runCompare(); });
  }
  for (const r of document.querySelectorAll('input[name="view"]')) {
    r.addEventListener('change', () => { state.view = r.value; state.viewChosen = true; syncControls(); save(); rebuild(false); });
  }
  for (const r of document.querySelectorAll('input[name="ws"]')) {
    r.addEventListener('change', () => { state.opts.ws = r.value; syncControls(); save(); runCompare(); });
  }
  for (const k of ['ignoreCase', 'ignoreBlank', 'eolEqual', 'finalNewlineEqual', 'nfc', 'quotes', 'nbspzw']) {
    $('opt-' + k).addEventListener('change', (e) => { state.opts[k] = e.target.checked; syncControls(); save(); runCompare(); });
  }
  $('tog-hidden').addEventListener('change', (e) => { state.hidden = e.target.checked; save(); relayout(); });
  $('tog-hide').addEventListener('change', (e) => { state.hide = e.target.checked; save(); rebuild(false); });
  $('tog-wrap').addEventListener('change', (e) => { state.wrap = e.target.checked; save(); relayout(); });
  $('opt-reset').addEventListener('click', () => {
    state.opts = { ...DEFAULT_OPTIONS, mode: state.opts.mode };
    syncControls(); save(); runCompare();
  });

  // options popover
  function toggleOpts(open) {
    const show = open ?? optsPanel.hidden;
    optsPanel.hidden = !show;
    btnOpts.setAttribute('aria-expanded', String(show));
    if (show) {
      optsPanel.style.left = '0px';
      const r = optsPanel.getBoundingClientRect();
      if (r.right > window.innerWidth - 8 && window.innerWidth > 767) optsPanel.style.left = (window.innerWidth - 8 - r.right) + 'px';
      const first = optsPanel.querySelector('input'); if (first) first.focus();
    }
  }
  btnOpts.addEventListener('click', () => toggleOpts());
  document.addEventListener('click', (e) => {
    if (!optsPanel.hidden && !optsPanel.contains(e.target) && !btnOpts.contains(e.target)) toggleOpts(false);
    if (!inspector.hidden && !inspector.contains(e.target) && !e.target.closest('mark.can, ins.can, del.can')) closeInspector();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!optsPanel.hidden) { toggleOpts(false); btnOpts.focus(); }
      if (!inspector.hidden) closeInspector();
    }
  });

  const OPT_LABELS = {
    ignoreCase: 'Ignore case',
    ignoreBlank: 'Ignore blank lines',
    nfc: 'Same Unicode form',
    quotes: 'Plain quotes and dashes',
    nbspzw: 'Special spaces ignored',
  };
  function renderChips() {
    const o = state.opts;
    const chips = [];
    for (const k of Object.keys(OPT_LABELS)) if (o[k]) chips.push({ label: OPT_LABELS[k], off: () => { o[k] = false; } });
    if (o.ws !== 'off') chips.push({ label: { trim: 'Ignore leading and trailing spaces', collapse: 'Ignore amount of whitespace', all: 'Ignore all whitespace' }[o.ws], off: () => { o.ws = 'off'; } });
    if (!o.eolEqual) chips.push({ label: 'Strict line endings', off: () => { o.eolEqual = true; } });
    if (!o.finalNewlineEqual) chips.push({ label: 'Strict final newline', off: () => { o.finalNewlineEqual = true; } });
    chipsEl.innerHTML = '';
    chipsEl.hidden = chips.length === 0;
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-label', `${c.label}. Press to turn off.`);
      b.innerHTML = `${esc(c.label)} <span aria-hidden="true">×</span>`;
      b.addEventListener('click', () => { c.off(); syncControls(); save(); runCompare(); });
      chipsEl.appendChild(b);
    }
  }

  // ---- result
  function applyResult(res) {
    state.result = res;
    state.cur = -1;
    state.folds = new Set();
    state.expanded = new Set();
    // Words and characters read best inline. Lines read best split or unified.
    renderStatus();
    rebuild(true);
  }

  function renderStatus() {
    const res = state.result;
    const s = res.stats;
    notesEl.innerHTML = '';
    resultBody.dataset.state = res.state;
    emptyEl.hidden = res.state !== 'empty';
    identicalEl.hidden = res.state !== 'identical';
    list.hidden = res.state !== 'changed';
    $('sumbar').dataset.state = res.state;
    if (res.state === 'empty') {
      summary.textContent = 'Paste or type text in both boxes to compare.';
    } else if (res.state === 'identical') {
      summary.textContent = 'No differences.';
      const ul = $('ignored-list');
      ul.innerHTML = res.ignored.map((t) => `<li>${esc(t)}</li>`).join('');
      $('ignored-head').hidden = res.ignored.length === 0;
    } else {
      summary.textContent = `${plural(s.changes, 'change')}. ${plural(s.wordsAdded, 'word')} added, ${s.wordsRemoved.toLocaleString('en-US')} removed. Similarity ${s.similarity} percent.`;
    }
    const sl = $('stats-line');
    if (res.state === 'changed') {
      const n = (v) => v.toLocaleString('en-US');
      sl.textContent = `Lines: ${n(s.linesAdded)} added, ${n(s.linesRemoved)} removed, ${n(s.linesChanged)} changed. Characters: ${n(s.charsAdded)} added, ${n(s.charsRemoved)} removed.`;
      sl.hidden = false;
    } else sl.hidden = true;
    for (const n of res.notes) {
      const el = document.createElement('p');
      el.className = 'note';
      el.textContent = n.text + ' ';
      if (n.strictLink) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'link'; b.textContent = 'Compare strictly';
        b.addEventListener('click', () => { state.opts.eolEqual = false; syncControls(); save(); runCompare(); });
        el.appendChild(b);
      }
      if (n.suggestMode) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'link'; b.textContent = 'Use Words mode';
        b.addEventListener('click', () => { state.opts.mode = n.suggestMode; autoView(); syncControls(); save(); runCompare(); });
        el.appendChild(b);
      }
      notesEl.appendChild(el);
    }
    const hasChanges = res.state === 'changed';
    for (const id of ['copy-diff', 'copy-redline', 'copy-stats']) $(id).disabled = res.state === 'empty';
    for (const id of ['prev', 'next', 'prev-m', 'next-m']) $(id).disabled = !hasChanges;
    phoneNote.hidden = !(phoneQuery.matches && state.view === 'split' && hasChanges);
  }

  // ---- virtual list
  let heights = new Float32Array(0);
  let prefix = new Float64Array(1);
  let prefixDirty = true;
  let rendered = { first: -1, last: -1 };
  let fixed = false;
  let rafId = 0;

  function rebuild(reset) {
    const res = state.result;
    if (!res || res.state !== 'changed') { rowsEl.innerHTML = ''; rendered = { first: -1, last: -1 }; updateCounter(); return; }
    state.flat = flatten(res, state.view, state.hide, state.folds);
    const n = state.flat.entries.length;
    state.compact = n > MAX_ROWS_WRAP;
    $('compact-note').hidden = !state.compact;
    heights = new Float32Array(n).fill(ROW_EST);
    prefixDirty = true;
    rendered = { first: -1, last: -1 };
    applyLayoutClasses(res);
    if (reset) list.scrollTop = 0;
    if (state.cur >= state.flat.changes.length) state.cur = -1;
    renderWindow(true);
    updateCounter();
    phoneNote.hidden = !(phoneQuery.matches && state.view === 'split');
  }
  function applyLayoutClasses(res) {
    const nowrap = !state.wrap || state.compact;
    fixed = nowrap;
    list.classList.toggle('nowrap', nowrap);
    list.dataset.view = state.view;
    if (nowrap) {
      let max = 0;
      for (const l of res.aLines) if (l.length > max) max = l.length;
      for (const l of res.bLines) if (l.length > max) max = l.length;
      list.style.setProperty('--maxch', String(Math.min(max + 8, 4000)));
    }
  }
  function relayout() {
    if (!state.result || state.result.state !== 'changed') return;
    heights.fill(ROW_EST);
    prefixDirty = true;
    rendered = { first: -1, last: -1 };
    applyLayoutClasses(state.result);
    renderWindow(true);
  }
  function computePrefix() {
    const n = heights.length;
    if (prefix.length !== n + 1) prefix = new Float64Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) { prefix[i] = acc; acc += heights[i]; }
    prefix[n] = acc;
    prefixDirty = false;
  }
  function findIndex(y) {
    let lo = 0;
    let hi = heights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (prefix[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function renderWindow(force) {
    const entries = state.flat.entries;
    const n = entries.length;
    if (n === 0) { rowsEl.innerHTML = ''; return; }
    if (prefixDirty) computePrefix();
    const top = list.scrollTop;
    const view = list.clientHeight || 400;
    let first = Math.max(0, findIndex(top) - 8);
    let last = Math.min(n - 1, findIndex(top + view) + 8);
    if (!force && first >= rendered.first && last <= rendered.last && rendered.first >= 0) {
      // still covered: only refresh if we are near the edge
      if (first - rendered.first > 4 || rendered.last - last > 4 || (first === 0 && rendered.first === 0)) return;
    }
    let html = '';
    for (let i = first; i <= last; i++) html += entryHtml(state.result, entries[i], i, state.view, state.hidden, state.expanded);
    padTop.style.height = prefix[first] + 'px';
    rowsEl.innerHTML = html;
    rendered = { first, last };
    // measure
    if (!fixed) {
      let changed = false;
      const kids = rowsEl.children;
      for (let k = 0; k < kids.length; k++) {
        const h = kids[k].offsetHeight;
        const i = first + k;
        if (h && Math.abs(heights[i] - h) > 0.5) { heights[i] = h; changed = true; }
      }
      if (changed) {
        computePrefix();
        padTop.style.height = prefix[first] + 'px';
      }
    }
    padBottom.style.height = Math.max(0, prefix[n] - prefix[last + 1]) + 'px';
    markCurrent();
  }
  list.addEventListener('scroll', () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; renderWindow(false); });
  }, { passive: true });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!fixed) relayout(); }, 150);
  });

  // ---- change navigation
  function updateCounter() {
    const total = state.flat.changes.length;
    const txt = total ? `${state.cur >= 0 ? state.cur + 1 : 0} of ${total}` : '0 of 0';
    counter.textContent = txt;
    $('counter-m').textContent = txt;
    $('btn-inspect').disabled = !total || state.cur < 0;
  }
  function markCurrent() {
    for (const el of rowsEl.querySelectorAll('.cur')) el.classList.remove('cur');
    if (state.cur < 0) return;
    for (const el of rowsEl.querySelectorAll(`[data-ci="${state.cur}"]`)) el.classList.add('cur');
  }
  function goto(i) {
    const total = state.flat.changes.length;
    if (!total) return;
    state.cur = ((i % total) + total) % total;
    const idx = state.flat.changes[state.cur];
    if (prefixDirty) computePrefix();
    list.scrollTop = Math.max(0, prefix[idx] - list.clientHeight / 3);
    renderWindow(true);
    markCurrent();
    updateCounter();
    const el = rowsEl.querySelector(`[data-ci="${state.cur}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      if (r.top < lr.top || r.bottom > lr.bottom) list.scrollTop += r.top - lr.top - lr.height / 3;
    }
    $('live').textContent = `Change ${state.cur + 1} of ${total}.`;
  }
  const next = () => goto(state.cur + 1);
  const prev = () => goto(state.cur < 0 ? -1 : state.cur - 1);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('next-m').addEventListener('click', next);
  $('prev-m').addEventListener('click', prev);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'n') { e.preventDefault(); next(); }
    else if (e.key === 'p') { e.preventDefault(); prev(); }
    else if (e.key === 'i') { e.preventDefault(); inspectCurrent(); }
  });

  // ---- clicks inside the list
  list.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold]');
    if (fold) { state.folds.add(Number(fold.dataset.fold)); rebuild(false); return; }
    const more = e.target.closest('[data-more]');
    if (more) { state.expanded.add(Number(more.dataset.more)); relayout(); return; }
    const m = e.target.closest('mark.can, ins.can, del.can');
    if (m) inspectElement(m);
  });

  // ---- inspector
  function closeInspector() { inspector.hidden = true; }
  const glyph = (c) => (c.cp === 32 ? '\u2423' : isHidden(c.ch) || c.cp < 32 ? c.short : c.ch);
  function charHtml(list2) {
    if (!list2.length) return '<li class="none">nothing</li>';
    return list2.map((c) => `<li><span class="g" aria-hidden="true">${esc(glyph(c))}</span> <code>${c.hex}</code> ${c.name ? esc(c.name) : ''}</li>`).join('');
  }
  function inspectElement(el) {
    const entryEl = el.closest('[data-e]');
    if (!entryEl) return;
    const entry = state.flat.entries[Number(entryEl.dataset.e)];
    const p = Number(el.dataset.p);
    if (!entry || !entry.row) return;
    const g = p >= 0 ? groupTexts(entry.row, p) : null;
    if (!g) { closeInspector(); return; }
    const count = (s) => Array.from(s).length;
    if (count(g.x) > 3 || count(g.y) > 3 || (!g.x && !g.y)) { closeInspector(); return; }
    const info = inspectChange(g.x, g.y);
    inspector.innerHTML = `<button type="button" class="x" id="insp-close" aria-label="Close">×</button>
      <p class="h">Changed characters</p>
      <p class="s">Original</p><ul>${charHtml(info.removed)}</ul>
      <p class="s">Changed</p><ul>${charHtml(info.added)}</ul>
      ${info.reason ? `<p class="why">${esc(info.reason)}</p>` : ''}`;
    inspector.hidden = false;
    const r = el.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const w = inspector.offsetWidth;
    let left = r.left - host.left;
    left = Math.max(8, Math.min(left, host.width - w - 8));
    inspector.style.left = left + 'px';
    inspector.style.top = (r.bottom - host.top + 8) + 'px';
    $('insp-close').addEventListener('click', closeInspector);
    inspector.focus();
  }
  function inspectCurrent() {
    const n = state.cur;
    const el = n >= 0 && rowsEl.querySelector(`.can[data-ci="${n}"], [data-ci="${n}"] .can`);
    if (el) inspectElement(el);
    else say(n < 0 ? 'Pick a change with the arrows first.' : 'This change is longer than 3 characters. The card shows changes of 1 to 3 characters.');
  }
  $('btn-inspect').addEventListener('click', inspectCurrent);

  // ---- copy
  async function writeClipboard(items, plainFallback, okMsg, fallbackMsg) {
    try {
      if (items && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem(items)]);
        say(okMsg);
        return;
      }
      await navigator.clipboard.writeText(plainFallback);
      say(items ? fallbackMsg : okMsg);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = plainFallback;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      say(ok ? (items ? fallbackMsg : okMsg) : 'Your browser blocked copying. Select the text and copy it by hand.');
    }
  }
  const blob = (s, type) => new Blob([s], { type });
  $('copy-redline').addEventListener('click', () => {
    const res = state.result;
    if (!res) return;
    const { plain, html } = redline(res);
    writeClipboard({ 'text/html': blob(html, 'text/html'), 'text/plain': blob(plain, 'text/plain') }, plain,
      'Redline copied. Paste it into Word, Google Docs or an email.',
      'Copied as plain text with [-removed-] and {+added+}. Your browser cannot copy colors.');
  });
  $('copy-stats').addEventListener('click', () => {
    if (!state.result) return;
    const t = statsText(state.result);
    writeClipboard(null, t, 'Stats copied.');
  });
  $('copy-diff').addEventListener('click', async () => {
    const res = state.result;
    if (!res) return;
    if (res.mode === 'lines') { writeClipboard(null, unifiedDiff(res), 'Unified diff copied.'); return; }
    const w = new Worker(new URL('../diff/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => { w.terminate(); if (ev.data.error) say('Could not build the diff.'); else writeClipboard(null, ev.data.unified, 'Unified diff copied.'); };
    w.postMessage({ id: 1, type: 'export', a: textOf('a'), b: textOf('b'), options: { ...state.opts } });
  });

  // ---- phone bar and keyboard space
  $('m-edit').addEventListener('click', () => { panes.classList.remove('collapsed'); $('btn-panes').textContent = 'Hide texts'; $('btn-panes').setAttribute('aria-expanded', 'true'); panes.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('m-result').addEventListener('click', () => $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (window.visualViewport) {
    const fit = () => {
      const vv = window.visualViewport;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', inset + 'px');
    };
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
    fit();
  }
  phoneQuery.addEventListener && phoneQuery.addEventListener('change', () => { autoView(); syncControls(); rebuild(false); });

  // ---- start
  syncControls();
  updateCounts();
  updateGutter(taA, gutA);
  updateGutter(taB, gutB);
  applyResult({ mode: 'lines', aLines: [], bLines: [], blocks: [], stats: { changes: 0, wordsAdded: 0, wordsRemoved: 0, similarity: 100 }, notes: [], ignored: [], state: 'empty' });

}
