// Copy to the clipboard. Tries rich copy, then plain text, then the old way. Returns the message to show.
/**
 * items: { 'text/html': Blob, 'text/plain': Blob } for rich copy, or null for plain text only.
 * Returns a status message for the user.
 */
export async function writeClipboard(items, plain, okMsg, fallbackMsg) {
  try {
    if (items && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return okMsg;
    }
    await navigator.clipboard.writeText(plain);
    return items ? fallbackMsg : okMsg;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = plain;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok ? (items ? fallbackMsg : okMsg) : 'Your browser blocked copying. Select the text and copy it by hand.';
  }
}
