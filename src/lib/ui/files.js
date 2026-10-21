// Reading a text file: find the encoding, refuse binary files, strip the byte order mark.

export const BINARY_MSG = 'This looks like a Word, PDF or image file. Copy the text out and paste it here.';

/** True when the bytes look like a binary file (PDF, Office, image, program, or many control bytes). */
export function looksBinary(bytes) {
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

/**
 * Decode file bytes to text. The byte order mark is a marker for the encoding, not part of the text, so it is removed.
 * Returns { text } or { binary: true }, with a `note` when the file was not valid UTF-8.
 */
export function decodeText(bytes) {
  let enc = 'utf-8';
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) enc = 'utf-16le';
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) enc = 'utf-16be';
  else if (looksBinary(bytes)) return { binary: true };
  try {
    return { text: new TextDecoder(enc, { fatal: true }).decode(bytes) };
  } catch {
    // Not valid UTF-8 (for example an old Windows file). Read it as Windows-1252.
    return { text: new TextDecoder('windows-1252').decode(bytes), note: 'This file is not UTF-8. It was read as Windows-1252.' };
  }
}
