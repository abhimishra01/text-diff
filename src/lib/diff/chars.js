// Character helpers: cleaning, segmentation and tokens. Pure functions, no DOM.

export const DEFAULT_OPTIONS = Object.freeze({
  mode: 'lines',          // 'lines' | 'words' | 'chars'
  ignoreCase: false,
  ws: 'off',              // 'off' | 'trim' | 'collapse' | 'all'
  ignoreBlank: false,
  eolEqual: true,         // CRLF, LF and CR count as equal
  finalNewlineEqual: true,
  nfc: false,             // Unicode NFC
  quotes: false,          // smart quotes and long dashes as plain
  nbspzw: false,          // non-breaking spaces as spaces, zero-width characters ignored
});

export function withDefaults(o) {
  return { ...DEFAULT_OPTIONS, ...(o || {}) };
}

// ---- cleaning (shared by the string path and the map path)
const ZW_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u200E\u200F]/g;
const ZW_ONE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u200E\u200F]/;
const NBSP_RE = /[\u00A0\u202F\u2007\u2009\u200A\u2008\u2005\u2004\u2003\u2002\u2006\u205F\u3000\u1680]/g;
const NBSP_ONE = /^[\u00A0\u202F\u2007\u2009\u200A\u2008\u2005\u2004\u2003\u2002\u2006\u205F\u3000\u1680]$/;
const QUOTE_RE = /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2026]/g;
const QUOTE_ONE = /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2026]/;

function quoteMap(ch) {
  switch (ch) {
    case '\u2018': case '\u2019': case '\u201A': case '\u201B': case '\u2032': return "'";
    case '\u201C': case '\u201D': case '\u201E': case '\u201F': case '\u2033': return '"';
    case '\u2026': return '...';
    default: return '-'; // hyphens, dashes, minus
  }
}

/** Character-level cleaning that does not depend on whitespace modes. */
export function cleanChars(s, o) {
  if (o.nbspzw) s = s.replace(ZW_RE, '').replace(NBSP_RE, ' ');
  if (o.quotes) s = s.replace(QUOTE_RE, quoteMap);
  if (o.nfc) s = s.normalize('NFC');
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

/** Whitespace mode applied to a whole line (string path). */
export function applyWs(s, ws) {
  switch (ws) {
    case 'trim': return s.replace(/^\s+|\s+$/g, '');
    case 'collapse': return s.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    case 'all': return s.replace(/\s+/g, '');
    default: return s;
  }
}

/** Key used to compare two lines (or any string) under the options. */
export function normalizeString(s, o) {
  return applyWs(cleanChars(s, o), o.ws);
}

/** Cleaned string plus a map back to the original text. map arrays hold the original [start, end) of each cleaned UTF-16 unit. */
export function cleanWithMap(s, o) {
  if (!o.nbspzw && !o.quotes) return { text: s, mapS: null, mapE: null };
  let out = '';
  const ms = [];
  const me = [];
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    let rep = ch;
    if (o.nbspzw) {
      if (ZW_ONE.test(ch)) { i += len; continue; }
      NBSP_RE.lastIndex = 0;
      if (len === 1 && /[\u00A0\u202F\u2007\u2009\u200A\u2008\u2005\u2004\u2003\u2002\u2006\u205F\u3000\u1680]/.test(ch)) rep = ' ';
    }
    if (o.quotes && QUOTE_ONE.test(rep)) rep = quoteMap(rep);
    for (let k = 0; k < rep.length; k++) { ms.push(i); me.push(i + len); }
    out += rep;
    i += len;
  }
  return { text: out, mapS: Int32Array.from(ms), mapE: Int32Array.from(me) };
}

// ---- segmentation
const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
let graphemeSeg = null;
let wordSeg = null;

const NEEDS_SEGMENTER = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u0600-\u0605\u064B-\u065F\u0900-\u0DFF\u0E00-\u0EFF\u1100-\u11FF\u1AB0-\u1AFF\u1DC0-\u1DFF\u200C\u200D\u20D0-\u20FF\u3099\u309A\uFE00-\uFE0F\uFE20-\uFE2F\uD800-\uDFFF\r]/;
const COMBINING = /[\p{M}\u200D\uFE0F]/u;

/** Split a string into grapheme clusters. Returns an array of [start, end) pairs flattened: [s0,e0,s1,e1,...]. */
export function graphemeRanges(str) {
  const out = [];
  if (!NEEDS_SEGMENTER.test(str)) {
    for (let i = 0; i < str.length; i++) out.push(i, i + 1);
    return out;
  }
  if (hasSegmenter) {
    if (!graphemeSeg) graphemeSeg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const seg of graphemeSeg.segment(str)) out.push(seg.index, seg.index + seg.segment.length);
    return out;
  }
  // Fallback: code points, joined with combining marks, ZWJ sequences and CRLF.
  let i = 0;
  while (i < str.length) {
    const start = i;
    let cp = str.codePointAt(i);
    i += cp > 0xffff ? 2 : 1;
    if (cp === 13 && str.charCodeAt(i) === 10) { i++; out.push(start, i); continue; }
    // regional indicator pair
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff && i < str.length) {
      const n = str.codePointAt(i);
      if (n >= 0x1f1e6 && n <= 0x1f1ff) i += 2;
    }
    for (;;) {
      if (i >= str.length) break;
      const n = str.codePointAt(i);
      const nch = String.fromCodePoint(n);
      if (COMBINING.test(nch) || (n >= 0x1f3fb && n <= 0x1f3ff)) {
        i += nch.length;
        if (n === 0x200d && i < str.length) { const j = str.codePointAt(i); i += j > 0xffff ? 2 : 1; }
        continue;
      }
      break;
    }
    out.push(start, i);
  }
  return out;
}

export function countGraphemes(str) {
  return graphemeRanges(str).length / 2;
}

// ---- word tokens
// kinds: 1 word, 2 horizontal whitespace, 3 newline, 4 other (punctuation, symbols, emoji)
export const K_WORD = 1, K_WS = 2, K_NL = 3, K_OTHER = 4;
const PICT = '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*';
const WORD_CLASS = "[\\p{L}\\p{N}\\p{M}_\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]";
const TOKEN_RE = new RegExp(
  `(${WORD_CLASS}+(?:['\\u2019]${WORD_CLASS}+)*)|(\\r\\n|\\n|\\r)|([^\\S\\r\\n]+)|(\\p{Regional_Indicator}{2}|${PICT}|[^\\s]\\p{M}*)`,
  'gu',
);
const SEGMENTER_SCRIPTS = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/;

/**
 * Tokenize text into words, whitespace, newlines and other symbols.
 * Returns { s: Int32Array starts, e: Int32Array ends, k: Uint8Array kinds }.
 */
export function wordTokens(text) {
  const s = [];
  const e = [];
  const k = [];
  if (SEGMENTER_SCRIPTS.test(text) && hasSegmenter) {
    if (!wordSeg) wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const seg of wordSeg.segment(text)) {
      const str = seg.segment;
      const a = seg.index;
      if (seg.isWordLike) { s.push(a); e.push(a + str.length); k.push(K_WORD); continue; }
      // Non-word segments: split with the regex so whitespace and symbols stay separate.
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(str)) !== null) {
        if (m[0].length === 0) { TOKEN_RE.lastIndex++; continue; }
        s.push(a + m.index); e.push(a + m.index + m[0].length);
        k.push(m[1] ? K_WORD : m[2] ? K_NL : m[3] ? K_WS : K_OTHER);
      }
    }
  } else {
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m[0].length === 0) { TOKEN_RE.lastIndex++; continue; }
      s.push(m.index); e.push(m.index + m[0].length);
      k.push(m[1] ? K_WORD : m[2] ? K_NL : m[3] ? K_WS : K_OTHER);
    }
  }
  return { s: Int32Array.from(s), e: Int32Array.from(e), k: Uint8Array.from(k) };
}

/** Grapheme tokens in the same shape as wordTokens. Newlines get kind K_NL, whitespace K_WS. */
export function graphemeTokens(text) {
  const r = graphemeRanges(text);
  const n = r.length / 2;
  const s = new Int32Array(n);
  const e = new Int32Array(n);
  const k = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = r[2 * i]; e[i] = r[2 * i + 1];
    const c = text.charCodeAt(s[i]);
    if (c === 10 || c === 13) k[i] = K_NL;
    else if (/^\s/.test(text.slice(s[i], e[i]))) k[i] = K_WS;
    else k[i] = /^[\p{L}\p{N}_]/u.test(text.slice(s[i], e[i])) ? K_WORD : K_OTHER;
  }
  return { s, e, k };
}

/** Count word-like tokens in a text. */
export function countWords(text) {
  const t = wordTokens(text);
  let n = 0;
  for (let i = 0; i < t.k.length; i++) if (t.k[i] === K_WORD) n++;
  return n;
}
