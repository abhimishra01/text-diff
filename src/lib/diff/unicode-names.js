// Names for the characters that most often make two texts look the same but differ.
// A small table on purpose: no big Unicode database.

const NAMES = {
  0x0009: ['TAB', 'Tab'],
  0x000A: ['LF', 'Line feed'],
  0x000D: ['CR', 'Carriage return'],
  0x00A0: ['NBSP', 'No-break space'],
  0x00AD: ['SHY', 'Soft hyphen'],
  0x1680: ['OGHAM', 'Ogham space mark'],
  0x180E: ['MVS', 'Mongolian vowel separator'],
  0x2000: ['NQSP', 'En quad'],
  0x2001: ['MQSP', 'Em quad'],
  0x2002: ['ENSP', 'En space'],
  0x2003: ['EMSP', 'Em space'],
  0x2004: ['3/EM', 'Three-per-em space'],
  0x2005: ['4/EM', 'Four-per-em space'],
  0x2006: ['6/EM', 'Six-per-em space'],
  0x2007: ['FIGSP', 'Figure space'],
  0x2008: ['PUNCSP', 'Punctuation space'],
  0x2009: ['THSP', 'Thin space'],
  0x200A: ['HAIRSP', 'Hair space'],
  0x200B: ['ZWSP', 'Zero width space'],
  0x200C: ['ZWNJ', 'Zero width non-joiner'],
  0x200D: ['ZWJ', 'Zero width joiner'],
  0x200E: ['LRM', 'Left-to-right mark'],
  0x200F: ['RLM', 'Right-to-left mark'],
  0x2010: ['HYPHEN', 'Hyphen'],
  0x2011: ['NBHY', 'Non-breaking hyphen'],
  0x2012: ['FIGDASH', 'Figure dash'],
  0x2013: ['EN DASH', 'En dash'],
  0x2014: ['EM DASH', 'Em dash'],
  0x2015: ['HBAR', 'Horizontal bar'],
  0x2018: ['LSQUO', 'Left single quotation mark'],
  0x2019: ['RSQUO', 'Right single quotation mark'],
  0x201A: ['SBQUO', 'Single low-9 quotation mark'],
  0x201C: ['LDQUO', 'Left double quotation mark'],
  0x201D: ['RDQUO', 'Right double quotation mark'],
  0x201E: ['BDQUO', 'Double low-9 quotation mark'],
  0x2026: ['ELLIPSIS', 'Horizontal ellipsis'],
  0x2028: ['LS', 'Line separator'],
  0x2029: ['PS', 'Paragraph separator'],
  0x202F: ['NNBSP', 'Narrow no-break space'],
  0x205F: ['MMSP', 'Medium mathematical space'],
  0x2060: ['WJ', 'Word joiner'],
  0x2212: ['MINUS', 'Minus sign'],
  0x3000: ['IDSP', 'Ideographic space'],
  0xFEFF: ['BOM', 'Byte order mark (zero width no-break space)'],
  0x0301: ['ACUTE', 'Combining acute accent'],
  0x0300: ['GRAVE', 'Combining grave accent'],
  0x0308: ['DIAERESIS', 'Combining diaeresis'],
  0x0327: ['CEDILLA', 'Combining cedilla'],
  0x0303: ['TILDE', 'Combining tilde'],
  0xFE0F: ['VS16', 'Variation selector 16 (emoji style)'],
  0xFE0E: ['VS15', 'Variation selector 15 (text style)'],
  0x0020: ['SPACE', 'Space'],
  0x0022: ['"', 'Straight double quote'],
  0x0027: ["'", 'Straight single quote'],
  0x002D: ['-', 'Hyphen-minus'],
  0x00B4: ['ACUTE', 'Acute accent (spacing)'],
  0x0060: ['`', 'Grave accent'],
  0x2032: ['PRIME', 'Prime'],
  0x2033: ['DPRIME', 'Double prime'],
  0x00D7: ['TIMES', 'Multiplication sign'],
  0x0131: ['DOTLESS I', 'Latin small letter dotless i'],
  0x0430: ['CYR A', 'Cyrillic small letter a (looks like Latin a)'],
  0x043E: ['CYR O', 'Cyrillic small letter o (looks like Latin o)'],
  0x0435: ['CYR E', 'Cyrillic small letter ie (looks like Latin e)'],
};

const FORMAT_OR_CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const SPACE_LIKE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;

export function hex(cp) {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/** Describe one code point: { cp, hex, short, name, ch }. `short` is a label such as ZWSP, or the hex code. */
export function describeCodePoint(cp) {
  const e = NAMES[cp];
  const ch = String.fromCodePoint(cp);
  return { cp, hex: hex(cp), short: e ? e[0] : hex(cp), name: e ? e[1] : null, ch };
}

/** Is this character one that is hard or impossible to see? */
export function isHidden(ch) {
  if (ch === ' ') return true;
  return FORMAT_OR_CONTROL.test(ch) || SPACE_LIKE.test(ch);
}

/**
 * Turn text into display parts for the hidden-characters view.
 * Parts: { k: 'text'|'space'|'tab'|'cr'|'lf'|'nbsp'|'zw'|'other', s: text, label?, n? }
 * Long runs of the same hidden character collapse into one part with n.
 */
export function hiddenParts(text) {
  const parts = [];
  let buf = '';
  const flush = () => { if (buf) { parts.push({ k: 'text', s: buf }); buf = ''; } };
  const pushHidden = (k, ch, label) => {
    flush();
    const last = parts[parts.length - 1];
    if (last && last.k === k && last.ch === ch) { last.n++; return; }
    parts.push({ k, ch, label, n: 1 });
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === ' ') pushHidden('space', ch, '\u00B7');
    else if (ch === '\t') pushHidden('tab', ch, '\u2192');
    else if (ch === '\r') pushHidden('cr', ch, 'CR');
    else if (ch === '\n') pushHidden('lf', ch, 'LF');
    else if (cp === 0xA0 || cp === 0x202F) pushHidden('nbsp', ch, describeCodePoint(cp).short);
    else if (cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0x2060 || cp === 0xFEFF || cp === 0xAD || cp === 0x200E || cp === 0x200F) pushHidden('zw', ch, describeCodePoint(cp).short);
    else if (FORMAT_OR_CONTROL.test(ch) || SPACE_LIKE.test(ch)) pushHidden('other', ch, describeCodePoint(cp).short);
    else buf += ch;
  }
  flush();
  return parts;
}

/**
 * Explain a small change for the inspector card.
 * x: the deleted text (may be ''), y: the added text (may be ''). Returns { chars: [...], reason }.
 */
export function inspectChange(x, y) {
  const list = (s) => Array.from(s).slice(0, 8).map((c) => describeCodePoint(c.codePointAt(0)));
  const reason = explain(x, y);
  return { removed: list(x), added: list(y), reason };
}

function explain(x, y) {
  if (x && y) {
    const nx = x.normalize('NFC');
    const ny = y.normalize('NFC');
    if (x !== y && nx === ny) {
      const cps = (s) => Array.from(s).map((c) => hex(c.codePointAt(0))).join(' ');
      return `Looks the same. Different Unicode form (${cps(x)} vs ${cps(y)}).`;
    }
    if (x.toLowerCase() === y.toLowerCase()) return 'Same letters. Only the case differs.';
    const sx = x.replace(/[\u00A0\u202F\u2009\u3000\u2000-\u200A]/g, ' ');
    if (sx === y.replace(/[\u00A0\u202F\u2009\u3000\u2000-\u200A]/g, ' ')) return 'Looks the same. One text has a special space.';
  }
  if (!x && y && /^[\u200B-\u200F\u2060\uFEFF\u00AD]+$/.test(y)) return 'An invisible character. It takes no space on screen.';
  if (!y && x && /^[\u200B-\u200F\u2060\uFEFF\u00AD]+$/.test(x)) return 'An invisible character. It takes no space on screen.';
  if (/^[\u2018\u2019\u201C\u201D]$/.test(x) && /^['"]$/.test(y)) return 'Smart quote and straight quote look alike but are different characters.';
  if (/^['"]$/.test(x) && /^[\u2018\u2019\u201C\u201D]$/.test(y)) return 'Straight quote and smart quote look alike but are different characters.';
  if (/^[\u2010-\u2015\u2212]$/.test(x) && y === '-') return 'A long dash or minus sign instead of a plain hyphen.';
  if (x === '-' && /^[\u2010-\u2015\u2212]$/.test(y)) return 'A plain hyphen instead of a long dash or minus sign.';
  const one = (s) => (s.length === 1 || (s.length === 2 && s.codePointAt(0) > 0xffff)) && (SPACE_LIKE.test(s));
  if (one(x) || one(y)) return 'A special space. It looks like a normal space.';
  if (/\t/.test(x + y)) return 'A tab character. Spaces and tabs look alike.';
  if (/\r/.test(x + y)) return 'A carriage return. Windows line endings use it.';
  return null;
}
