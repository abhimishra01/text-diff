// Browser tests: privacy (no request carries the text), controls, layout. Run after a build:
//   npm run build && npm run test:ui
// Needs playwright-core (found in node_modules, or in the global playwright CLI) and Google Chrome.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, process.env.DIST || 'dist');
const PORT = Number(process.env.PORT || 4972);
const MARKER = 'SECRET-MARKER-7f3a';
const BASE = process.env.BASE_PATH || '/'; // for a build served under a path, for example /text-diff/

async function loadPlaywright() {
  const tries = [
    'playwright-core',
    process.env.PLAYWRIGHT_CORE,
    path.join(os.homedir(), '.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs'),
  ].filter(Boolean);
  for (const t of tries) {
    try { return await import(t.startsWith('/') ? 'file://' + t : t); } catch { /* try the next one */ }
  }
  throw new Error('playwright-core not found. Install it or set PLAYWRIGHT_CORE to its index.mjs.');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (BASE !== '/' && p.startsWith(BASE)) p = '/' + p.slice(BASE.length);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const pw = await loadPlaywright();
const chromium = (pw.default || pw).chromium;
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, 'ok']); } catch (e) { results.push([name, 'FAIL: ' + String(e.message).split('\n')[0]]); }
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const consoleProblems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => consoleProblems.push('pageerror: ' + e.message));
const requests = [];
page.on('request', (r) => requests.push({ url: r.url(), headers: r.headers(), body: r.postData() || '' }));

const base = `http://127.0.0.1:${PORT}${BASE}`;
await page.goto(base);
await page.waitForSelector('#tool');
const fill = async (a, b) => { await page.fill('#ta-a', a); await page.fill('#ta-b', b); await page.click('#btn-compare'); await settle(); };
const settle = async () => { await page.waitForFunction(() => document.getElementById('tool').dataset.busy === '0'); await page.waitForTimeout(80); };
const summary = () => page.textContent('#summary');

// ---- every internal link, script, image, icon and manifest icon resolves under the base path
await check('crawl: every internal href and src returns 200', async () => {
  const htmlFiles = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const full = path.join(d, f); if (fs.statSync(full).isDirectory()) walk(full); else if (f.endsWith('.html')) htmlFiles.push(full); } };
  walk(dist);
  assert.ok(htmlFiles.length >= 5, 'pages found: ' + htmlFiles.length);
  const origin = new URL(base).origin;
  const seen = new Set();
  const bad = [];
  const get = async (u) => { if (seen.has(u)) return; seen.add(u); const r = await fetch(u); if (r.status !== 200) bad.push(`${r.status} ${u}`); return r; };
  for (const f of htmlFiles) {
    const rel = path.relative(dist, f).replace(/index\.html$/, '');
    const pageUrl = new URL(rel, base).href;
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      const v = m[1];
      if (/^(mailto:|tel:|data:|javascript:)/.test(v)) continue;
      const u = new URL(v, pageUrl);
      if (u.origin !== origin) continue; // outside links are not fetched
      if (!u.pathname.startsWith(BASE)) { bad.push('outside base path: ' + v + ' on ' + pageUrl); continue; }
      await get(u.href);
    }
  }
  const man = await (await fetch(new URL('site.webmanifest', base))).json();
  for (const i of man.icons) await get(new URL(i.src, new URL('site.webmanifest', base)).href);
  assert.deepEqual(bad, []);
});

// ---- 5.4 privacy: no request carries the text
await check('privacy: nothing leaves the page', async () => {
  await fill(`one ${MARKER} two\nline two`, `one ${MARKER} three\nline two`);
  for (const id of ['copy-diff', 'copy-redline', 'copy-stats']) { await page.click('#' + id); await settle(); }
  await page.click('#btn-opts'); await page.check('#opt-ignoreCase'); await page.check('input[name=ws][value=collapse]'); await page.keyboard.press('Escape');
  await page.click('input[name=mode][value=words]', { force: true }); await settle();
  await page.click('input[name=view][value=unified]', { force: true }); await settle();
  await page.click('#btn-swap'); await settle();
  const origin = new URL(base).origin;
  for (const r of requests) {
    const u = new URL(r.url);
    if (u.origin !== origin && !r.url.startsWith('data:') && !r.url.startsWith('blob:')) throw new Error('request to ' + r.url);
    const hay = r.url + JSON.stringify(r.headers) + r.body;
    if (hay.includes(MARKER) || hay.includes(encodeURIComponent(MARKER))) throw new Error('marker found in request ' + r.url);
  }
});
await check('page makes only a few requests', async () => { assert.ok(requests.length < 12, 'requests: ' + requests.length); });

// ---- semantics through the page
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#tool');
await check('empty state shows the steps', async () => { assert.match(await page.textContent('#empty'), /Paste the original/); });
await check('sample compare', async () => { await page.click('#btn-sample'); await page.waitForFunction(() => /change/.test(document.getElementById('summary').textContent)); assert.match(await summary(), /1 change\./); });
await check('result is above the fold at 1280x800', async () => {
  const top = await page.evaluate(() => document.getElementById('list').getBoundingClientRect().top);
  assert.ok(top < 560, 'list top ' + top);
});
await check('identical shows no differences and what was ignored', async () => {
  await fill('Same', 'same');
  await page.click('#btn-opts'); await page.check('#opt-ignoreCase'); await page.keyboard.press('Escape'); await settle();
  assert.equal((await summary()).trim(), 'No differences.');
  assert.match(await page.textContent('#identical'), /Case ignored/);
  await page.click('#btn-opts'); await page.uncheck('#opt-ignoreCase'); await page.keyboard.press('Escape');
});
await check('one empty pane still compares', async () => {
  await fill('', 'a\nb'); await settle();
  assert.match(await page.textContent('#notes'), /Original is empty/);
});
await check('line ending chip and Compare strictly (from files)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
  fs.writeFileSync(path.join(tmp, 'crlf.txt'), 'a\r\nb');
  fs.writeFileSync(path.join(tmp, 'lf.txt'), 'a\nb');
  await page.click('#btn-clear'); await settle();
  await page.setInputFiles('#file-a', path.join(tmp, 'crlf.txt')); await settle();
  await page.setInputFiles('#file-b', path.join(tmp, 'lf.txt')); await settle();
  assert.match(await page.textContent('#notes'), /Line endings differ: CRLF and LF\. Treated as equal\./);
  await page.click('#notes button.link'); await settle();
  assert.match(await summary(), /1 change/);
  await page.click('.chip'); await settle();
  assert.match(await summary(), /No differences/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check('hidden characters view shows NBSP and ZWSP', async () => {
  await fill('a b', 'a b');
  await page.check('#tog-hidden'); await settle();
  assert.ok(await page.locator('.hc-box', { hasText: 'NBSP' }).count() > 0);
  await fill('ab', 'a​b');
  assert.ok(await page.locator('.hc-chip', { hasText: 'ZWSP' }).count() > 0);
  await page.uncheck('#tog-hidden');
});
await check('character inspector card', async () => {
  await fill('café', 'café');
  await page.locator('#vrows mark').first().click();
  await page.waitForSelector('#inspector:not([hidden])');
  assert.match(await page.textContent('#inspector'), /Different Unicode form \(U\+00E9 vs U\+0065 U\+0301\)/);
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#inspector').isHidden());
});
await check('next and previous change, keys n and p', async () => {
  await fill('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk', 'a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\nk');
  assert.equal((await page.textContent('#counter')).trim(), '2 changes');
  await page.click('#next'); assert.equal((await page.textContent('#counter')).trim(), '1 of 2');
  await page.click('body'); await page.keyboard.press('n'); assert.equal((await page.textContent('#counter')).trim(), '2 of 2');
  await page.keyboard.press('p'); assert.equal((await page.textContent('#counter')).trim(), '1 of 2');
});
await check('hide unchanged lines folds and expands', async () => {
  await fill(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n'), Array.from({ length: 40 }, (_, i) => (i === 20 ? 'CHANGED' : 'line ' + i)).join('\n'));
  await page.check('#tog-hide'); await settle();
  const fold = page.locator('.foldbtn').first();
  assert.ok(await fold.count() > 0);
  await fold.click(); await settle();
  await page.uncheck('#tog-hide');
});
await check('views and modes switch without errors', async () => {
  await fill('The quick brown fox', 'The quick red fox');
  for (const m of ['lines', 'words', 'chars']) for (const v of ['split', 'unified', 'inline']) {
    await page.click(`input[name=mode][value=${m}]`, { force: true }); await page.click(`input[name=view][value=${v}]`, { force: true }); await settle();
    assert.ok(await page.locator('#vrows .row').count() > 0, `${m}/${v} has rows`);
  }
});
await check('copy redline writes html and plain text', async () => {
  await fill('The quick brown fox jumps', 'The quick red fox leaps');
  await page.click('input[name=mode][value=words]', { force: true }); await settle();
  await page.click('#copy-redline'); await settle();
  const clip = await page.evaluate(async () => { const items = await navigator.clipboard.read(); const out = {}; for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return out; });
  assert.equal(clip['text/plain'], 'The quick [-brown-]{+red+} fox [-jumps-]{+leaps+}');
  assert.match(clip['text/html'], /<del/);
  assert.match(clip['text/html'], /<ins/);
});
await check('copy diff gives the unified diff', async () => {
  await fill('a\nb\nc\nd', 'a\nB\nc\nd');
  await page.click('input[name=mode][value=lines]', { force: true }); await settle();
  await page.click('#copy-diff'); await settle();
  const t = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(t, ['--- original', '+++ changed', '@@ -1,4 +1,4 @@', ' a', '-b', '+B', ' c', ' d'].join('\n'));
});
await check('open a text file and refuse a binary file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello\nworld');
  fs.writeFileSync(path.join(tmp, 'b.bin'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0, 1, 2, 3]));
  await page.click('#btn-clear'); await settle();
  await page.setInputFiles('#file-a', path.join(tmp, 'a.txt')); await settle();
  assert.equal(await page.inputValue('#ta-a'), 'hello\nworld');
  await page.setInputFiles('#file-b', path.join(tmp, 'b.bin')); await settle();
  assert.match(await page.textContent('#toast'), /Word, PDF or image file/);
  assert.equal(await page.inputValue('#ta-b'), '');
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check('options popover opens, closes with Escape, reset works', async () => {
  await page.click('#btn-opts'); assert.ok(await page.locator('#opts-panel').isVisible());
  await page.keyboard.press('Escape'); assert.ok(await page.locator('#opts-panel').isHidden());
  await page.click('#btn-opts'); await page.check('#opt-nfc'); await page.click('#opt-reset'); assert.equal(await page.isChecked('#opt-nfc'), false);
  await page.keyboard.press('Escape');
});
await check('options are remembered', async () => {
  await page.click('#btn-opts'); await page.check('#opt-ignoreCase'); await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('#tool');
  await page.click('#btn-opts'); assert.equal(await page.isChecked('#opt-ignoreCase'), true);
  await page.uncheck('#opt-ignoreCase'); await page.keyboard.press('Escape');
});
const pasteBig = (a, b) => page.evaluate(async ([a, b]) => {
  const fire = (id, text) => { const ta = document.getElementById(id); const dt = new DataTransfer(); dt.setData('text/plain', text); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
  fire('ta-a', a); fire('ta-b', b);
  const sum = document.getElementById('summary');
  const t0 = performance.now();
  while ((document.getElementById('list').hidden || !/change/.test(sum.textContent)) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 150));
  return sum.textContent;
}, [a, b]);
await check('S3: one 2 MB line, one changed character, folded and expandable', async () => {
  await page.click('input[name=mode][value=lines]', { force: true });
  const base = 'abcdefghij '.repeat(190000);
  const t = await pasteBig(base, base.slice(0, 1000000) + 'X' + base.slice(1000001));
  assert.match(t, /^1 change\./);
  assert.ok(await page.locator('#large-a').isVisible(), 'large text tag');
  assert.ok(await page.locator('#vrows .more').count() > 0, 'fold button');
  await page.locator('#vrows .more').first().click(); await settle();
  assert.ok(await page.locator('#vrows mark.m-ins, #vrows ins', { hasText: 'X' }).count() > 0, 'X is marked');
});
await check('S1: 100k lines, 1,000 changes, first paint under 2 s', async () => {
  const mk = (changed) => { const out = []; for (let i = 0; i < 100000; i++) out.push(changed && i % 100 === 0 ? 'CHANGED ' + i : 'line ' + i + ' lorem ipsum dolor sit amet ' + ((i * 7) % 1000)); return out.join('\n'); };
  const t0 = Date.now();
  const t = await pasteBig(mk(false), mk(true));
  const ms = Date.now() - t0;
  assert.match(t, /^1,000 changes\./);
  assert.ok(ms < 2000, 'took ' + ms + ' ms');
  for (const view of ['unified', 'inline']) { await page.click(`input[name=view][value=${view}]`, { force: true }); await settle(); assert.ok(await page.locator('#vrows .row').count() > 0); }
  await page.click('input[name=view][value=split]', { force: true });
  await page.evaluate(() => { document.getElementById('list').scrollTop = 1e9; });
  await settle();
  assert.ok(await page.locator('#vrows .row').count() > 0, 'rows at the end');
});
await check('S2: over 20,000 changed rows gives a compact view', async () => {
  let s = 42; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const mk = () => Array.from({ length: 22000 }, () => 'row ' + Math.floor(rnd() * 1e9)).join('\n');
  await page.click('#btn-clear'); await settle();
  const [A, B] = [mk(), mk()];
  await page.evaluate(([a, b]) => { for (const [id, v] of [['ta-a', a], ['ta-b', b]]) { const ta = document.getElementById(id); ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, [A, B]);
  await page.click('#btn-compare');
  await page.waitForFunction(() => /change/.test(document.getElementById('summary').textContent), null, { timeout: 20000 });
  await settle();
  assert.ok(await page.locator('#compact-note').isVisible(), 'compact note');
  assert.match(await page.textContent('#notes'), /Large change/);
});
await check('wrap off, ignore blank lines, hide unchanged', async () => {
  await page.click('#btn-clear'); await settle();
  await page.uncheck('#tog-wrap');
  await fill('a\n\n\nb\nc', 'a\nb\nX');
  assert.ok(await page.locator('#list.nowrap').count() === 1);
  await page.click('#btn-opts'); await page.check('#opt-ignoreBlank'); await page.keyboard.press('Escape'); await settle();
  assert.ok(await page.locator('#vrows .row.ign').count() > 0, 'ignored blank rows shown');
  await page.click('#btn-opts'); await page.uncheck('#opt-ignoreBlank'); await page.keyboard.press('Escape');
  await page.check('#tog-wrap');
});
await check('hide and show the text boxes, swap, clear one box', async () => {
  await page.click('#btn-clear'); await settle();
  await fill('left text', 'right text');
  await page.click('#btn-panes'); assert.ok(await page.locator('#ta-a').isHidden());
  assert.equal((await page.textContent('#btn-panes')).trim(), 'Edit texts');
  await page.click('#btn-panes'); assert.ok(await page.locator('#ta-a').isVisible());
  await page.click('#btn-swap'); await settle();
  assert.equal(await page.inputValue('#ta-a'), 'right text');
  await page.click('#clear-a'); await settle();
  assert.equal(await page.inputValue('#ta-a'), '');
  assert.match(await page.textContent('#notes'), /Original is empty/);
});
await check('real paste: over the limit into an empty box, and into the preview box', async () => {
  await page.click('#btn-clear'); await page.waitForTimeout(200);
  const big = Array.from({ length: 30000 }, (_, i) => 'line ' + i + ' lorem ipsum dolor sit amet').join('\n');
  await page.evaluate((t) => navigator.clipboard.writeText(t), big);
  await page.click('#ta-a'); await page.keyboard.press('ControlOrMeta+V'); await page.waitForTimeout(600);
  assert.ok(await page.locator('#large-a').isVisible(), 'tag after first paste');
  assert.match(await page.textContent('#cnt-a'), /30,000 lines/);
  await page.evaluate((t) => navigator.clipboard.writeText(t), big.replace(/line/g, 'LINE'));
  await page.click('#ta-a'); await page.keyboard.press('ControlOrMeta+V'); await page.waitForTimeout(600);
  assert.match(await page.inputValue('#ta-a'), /^LINE 0 /);
  await page.click('#clear-a'); await page.waitForTimeout(200);
  assert.equal(await page.locator('#large-a').isVisible(), false);
  await page.fill('#ta-a', 'typing works again'); assert.equal(await page.inputValue('#ta-a'), 'typing works again');
});
await check('Inspect button opens the card when clicked', async () => {
  await fill('caf\u00e9', 'cafe\u0301');
  await page.click('#next'); await settle();
  await page.click('#btn-inspect');
  await page.waitForSelector('#inspector:not([hidden])', { timeout: 2000 });
  assert.match(await page.textContent('#inspector'), /Unicode form/);
  await page.keyboard.press('Escape');
});
await check('wrap off scrolls sideways in split, unified and inline, and in compact mode', async () => {
  const long = 'word '.repeat(400);
  await page.uncheck('#tog-wrap');
  await fill(long + 'one', long + 'two');
  for (const v of ['split', 'unified', 'inline']) {
    await page.click(`input[name=view][value=${v}]`, { force: true }); await page.waitForTimeout(200);
    const m = await page.evaluate(() => { const l = document.getElementById('list'); return [l.scrollWidth, l.clientWidth]; });
    assert.ok(m[0] > m[1], `${v}: scrollWidth ${m[0]} clientWidth ${m[1]}`);
  }
  await page.check('#tog-wrap');
});
await check('no differences: nothing to copy; cancel leaves a true message', async () => {
  await fill('same', 'same');
  for (const id of ['copy-diff', 'copy-redline', 'copy-stats']) assert.equal(await page.isDisabled('#' + id), true, id);
});
await check('UTF-16 file with BOM against the same UTF-8 text: no difference', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
  const text = 'caf\u00e9\nline two';
  fs.writeFileSync(path.join(tmp, 'u16.txt'), Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]));
  fs.writeFileSync(path.join(tmp, 'u8.txt'), '\uFEFF' + text);
  await page.click('#btn-clear'); await settle();
  await page.setInputFiles('#file-a', path.join(tmp, 'u16.txt')); await settle();
  await page.setInputFiles('#file-b', path.join(tmp, 'u8.txt')); await settle();
  assert.match(await summary(), /No differences/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check('characters mode summary counts words, not letters', async () => {
  await fill('hello brave new world', 'hello new world');
  await page.click('input[name=mode][value=chars]', { force: true }); await settle();
  assert.match(await summary(), /0 words added, 1 removed/);
});
await check('no console errors or warnings', async () => { assert.deepEqual(consoleProblems, []); });

// ---- layout
for (const [w, h] of [[320, 700], [390, 844], [820, 900], [1280, 800], [1920, 1000]]) {
  await check(`no sideways page scroll at ${w}`, async () => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto(base); await p.waitForSelector('#tool');
    await p.click('#btn-sample'); await p.waitForTimeout(500);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    await p.close();
    assert.ok(m.sw <= m.cw, `scrollWidth ${m.sw} > ${m.cw}`);
  });
}
await check('phone: every visible button and control is at least 44 px tall', async () => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base); await p.waitForSelector('#tool');
  await p.click('#btn-sample'); await p.waitForTimeout(500);
  await p.check('#tog-hide'); await p.waitForTimeout(300);
  await p.click('#btn-opts'); await p.waitForTimeout(100);
  const small = await p.evaluate(() => {
    const out = [];
    const root = document.getElementById('tool');
    for (const el of root.querySelectorAll('button, .seg label, .tog, .chk, .rad, a')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      if (el.closest('[hidden]') || el.closest('.sr-only')) continue;
      if (r.height < 43.5) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.height));
    }
    return out;
  });
  await p.close();
  assert.deepEqual(small, []);
});
await check('dark mode has no errors', async () => {
  const c2 = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await c2.newPage();
  const errs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
  await p.goto(base); await p.click('#btn-sample'); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.deepEqual(errs, []);
  await c2.close();
});

await browser.close();
server.close();
let bad = 0;
for (const [n, r] of results) { if (r !== 'ok') bad++; console.log((r === 'ok' ? 'ok   ' : 'FAIL ') + n + (r === 'ok' ? '' : '  ' + r)); }
console.log(bad ? `${bad} failed` : 'all ui checks passed');
process.exit(bad ? 1 : 0);
