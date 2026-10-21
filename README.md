# Text Diff Checker

A free browser tool that compares two texts by line, word or character. It runs fully in the browser: the compare happens in a Web Worker, and no request carries the text. Astro (static) and Tailwind 4. Published as part of Bingemind at https://bingemind.com/text-diff/.

## Commands

```
npm run dev            # work on the site (port 4321, or pass --port)
npm test               # known-answer and property tests for the compare engine
npm run build          # build to dist/
npm run build:bingemind  # tests, build to dist-bingemind/ for bingemind.com/text-diff/, then the browser tests on that build
npm run test:ui        # browser tests (needs a build, Google Chrome and playwright-core)
```

## Where the logic lives

| File | What it does |
|---|---|
| `src/lib/diff/myers.js` | Myers diff on integer arrays, with a cost cap and an approximate fallback (anchors, then a furthest-point split) |
| `src/lib/diff/chars.js` | Options, character cleaning, tokens (words, graphemes with `Intl.Segmenter`) |
| `src/lib/diff/tokens.js` | Word and character diff with ranges that point back into the original text |
| `src/lib/diff/compare.js` | Lines, words and characters modes, line pairing, stats, notes |
| `src/lib/diff/export.js` | Unified diff, redline (plain and HTML), stats text |
| `src/lib/diff/unicode-names.js` | Small table of look-alike characters, hidden-character parts, inspector reasons |
| `src/lib/diff/worker.js` | Worker wrapper |
| `src/lib/esc.js` | HTML escape, shared by the views and the redline export |
| `src/lib/url.ts` | Builds internal URLs that work under a base path |
| `src/lib/ui/files.js` | Reads a file: encoding, byte order mark, binary check |
| `src/lib/ui/clipboard.js` | Rich and plain copy |
| `src/lib/ui/sample.js` | Text for the Sample button |
| `src/lib/ui/render.js` | HTML for the split, unified and inline views, and the entry list for the virtual list |
| `src/lib/ui/tool.js` | Page behavior: panes, options, worker, virtual list, copy, inspector |
| `scripts/test-diff.mjs` | Tests T1 to T27, S1 to S4 and S7 from the spec, plus property tests |
| `scripts/test-ui.mjs` | Browser tests: no request carries the text, controls, layout at 5 widths |

## Notes

- The page keeps only the options and the theme choice in `localStorage` (`bm.textdiff.opts.v1`). It never saves the texts.
- A textarea turns CRLF and CR into LF. An opened file keeps its exact text in memory so the line ending notes work.
- Text over 400,000 characters is kept in memory and the box shows a read-only preview. This keeps typing fast.
- Set `SITE_MODE=bingemind` for the bingemind.com build. `PAGES_BASE` and `PAGES_SITE` build the GitHub Pages copy (noindex).
- Libraries: none at run time. The diff engine is our own code.

## GitHub Pages
`.github/workflows/pages.yml` builds on every push to `main` and serves the site at https://abhimishra01.github.io/text-diff/ (noindex). The build sets `PAGES_BASE=/text-diff/` and `PAGES_SITE=https://abhimishra01.github.io`. Canonical URLs always name https://bingemind.com/text-diff/. Internal links use `src/lib/url.ts`.
