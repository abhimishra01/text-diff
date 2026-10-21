// Web Worker: all diff work happens here so the page never freezes.
import { compare } from './compare.js';
import { unifiedDiff, redline, statsText } from './export.js';

self.onmessage = (ev) => {
  const { id, type, a, b, options } = ev.data;
  try {
    if (type === 'compare') {
      const t0 = performance.now();
      const result = compare(a, b, options);
      self.postMessage({ id, type, result, ms: Math.round(performance.now() - t0) });
    } else if (type === 'export') {
      // Exports always come from the line view, so the unified diff is the same in every mode.
      const lineRes = compare(a, b, { ...options, mode: 'lines' });
      self.postMessage({ id, type, unified: unifiedDiff(lineRes), stats: statsText(lineRes) });
    } else if (type === 'redline') {
      const res = compare(a, b, options);
      self.postMessage({ id, type, ...redline(res) });
    }
  } catch (err) {
    self.postMessage({ id, type, error: String((err && err.message) || err) });
  }
};
