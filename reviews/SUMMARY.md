# Fix pass summary (Bruce, 2026-10-21)

Source: the six reports in this folder (4 code lenses, design and SEO, mock customers).

## Fixed (musts, each with a test)
| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Characters mode counted letters as words (summary, Copy stats, similarity) | `tokens.js`: in chars mode, word numbers come from the word tokens of the texts and the ranges that changed | `characters mode counts words, not letters` (node); UI check on the summary |
| 2 | BOM kept when opening a file (UTF-16 vs UTF-8 showed a change) | New `src/lib/ui/files.js`: decoder strips the BOM. UTF-8 BOM, UTF-16 LE and BE handled. Files that are not UTF-8 are read as Windows-1252 with a note | `files: BOM is stripped...` (node), UI check with a UTF-16 and a UTF-8 file |
| 3 | Ignored blank lines leaked into Copy diff and Copy redline | `export.js` skips ignored blank lines. Copy buttons are disabled when there are no differences, and while a new compare is pending or running. Copy diff says that options-ignored differences are not in it | `ignored blank lines are not in Copy diff or Copy redline` (node), UI check that the buttons are disabled |
| 4 | Inspect button did nothing on click | The page click handler no longer closes the card for `#btn-inspect` | UI check that clicks the button |
| 5 | Wrap off clipped long lines in Split (and in compact mode) | Explicit `.nowrap[data-view="split"]` width rule | UI check: scrollWidth greater than clientWidth in split, unified and inline |

## Fixed (shoulds and cheap items)
- 400,000 character preview is now in the FAQ (size answer) and the article (Large texts).
- Redline HTML: `<s>` inside `<del>` and `<u>` inside `<ins>`, plus the same inline colors and text-decoration. No forced font or size. Test added. The article and FAQ claims now say what was tested (Chrome keeps colors and marks; check your own app). The Copy redline toast says the same.
- Phone: counter shows "8 changes" until a change is picked (all sizes). The Result button turns primary when there is a result. A short line "N changes found. Show result" sits under the boxes on phones. Boxes are named "Original box" and "Changed box" in the empty state and article.
- Cancel now shows "Cancelled. Press Compare to run again." and clears the old result.
- Copy diff in Words and Characters mode: worker error is handled with a message.
- Similarity is hidden when neither text has words (emoji only); a note under the stats says it counts shared words and does not check for copying.
- Approximate-mode note now says some unchanged text may be marked as changed.
- Layout: one-column boxes up to 899 px (tablet), 44 px theme button, scroll shadows on the phone toolbar row, noscript line, ignored-blank-line rows use a pattern instead of opacity.
- Links: article links to the JSON diff tool, and the More tools block shows JSON diff instead of DPI changer.
- Readability and minimalism: removed `skin-clay.css`, unused config keys (`keywords`, `tagline`), `countGraphemes`, dead branch in `redlineLines`, stale comments, duplicate escape function (now `src/lib/esc.js`), shared global regex, double NBSP class, unneeded exports; block type `'x'` renamed `'context'` and the result model is documented in the `compare.js` header; `splitLines` builds `kinds` once; README file table updated; Myers memory note added.
- Maintainer: file reading and clipboard code moved out of `tool.js` into `files.js` and `clipboard.js`.
- Release gate: `build:bingemind` now runs `npm test`, builds, then the browser tests (including the SECRET-MARKER network test and the link crawl) on `dist-bingemind` under `/text-diff/`. `deploy` runs them too.

## Rejected or left, with reasons
- Split `tool.js` fully into more files: no behavior change, risk for no user gain. Two pieces moved out; the rest is marked by section comments.
- Inspector card covers rows below the mark: it closes on Escape or any outside click, and a click on a mark opens it at the new place. Moving it is a nice, not a bug.
- Proportional font for prose, "Updated" flash on Compare, `.patch` download, sticky ignore-whitespace chip: new features. Single purpose first; listed for the owner.
- Rename `chars.js`: cosmetic, would touch every import.
- Wrangler and Cloudflare deploy files: same as the other sites; revisit when the deploy target is final.
- Real Word, Google Docs, Gmail and Apple Mail paste of the redline: still untested. Needs a person with those apps.

## Status
- `npm test`: 47 checks pass. `npm run build`, `build:bingemind` (runs the browser tests) and the Pages build all pass. `npm run test:ui` passes on dist, dist-bingemind and dist-pages (about 38 checks each).
- Screenshots at 1280 and 390, light and dark, are in `screenshots/`.
- Lighthouse was run by the reviewer (mobile 99/100/100/100, desktop 100/100/100/100). Not re-run after this pass.

## For the owner
- Test the redline paste in Word, Google Docs and Gmail, then keep or change the article line about the marks.
- Decide on the nice items above.
- The first 7 commits lack the Co-Authored-By trailer (history rewrite was blocked); later commits have it.
