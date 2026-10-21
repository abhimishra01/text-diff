# Code review: readability lens (Jessica, 2026-10-21)

Verdict: a new engineer can find their way. Module names match the README, comments explain the why, and tests are labeled with the spec IDs. A few stale comments, cryptic one-letter data keys, and a few copy lines that fit only the desktop layout need fixing. Must-fix: 0. Should-fix: 6.

| Severity | File:line | Finding | Why | Fix |
|---|---|---|---|---|
| should | src/components/Tool.astro:147-151, src/components/Article.astro (step 1), src/lib/ui/tool.js (empty state) | Copy says "left box" and "right box". On a phone (and at tablet widths below 768 px) the boxes are stacked, top and bottom. | A phone user is told to look left. Also the panes are named Original and Changed everywhere else. | "Paste the original text in the Original box. Paste the changed text in the Changed box." |
| should | src/lib/diff/tokens.js:19 | Doc comment for `buildKeys` names `atStart` / `atEnd` parameters that do not exist. | A stale comment misleads the next reader about the function. | Delete the line. |
| should | src/lib/ui/tool.js:396 | `applyResult` has a comment ("Words and characters read best inline...") above code that does nothing of the kind (that logic lives in `autoView`). | Comment and code disagree. | Remove the comment. |
| should | src/lib/diff/compare.js:12-27 | `splitLines` builds `kinds` with keys `crlf`, `lone_cr`, `lf`, then copies them again into `{crlf, cr, lf}`. | Two names for one thing in six lines. | Build the final object once, with `cr`. |
| should | src/lib/diff/compare.js (blocks `'eq' 'chg' 'ign' 'x'`), render.js (`ci`, `ci0`, `gi`, `p`, `sg`, `tx`, `ln`) | Block type `'x'` and the data keys are cryptic. The compare.js header lists `{t:'x', row}` with no meaning. | `x` is "a row that exists on both sides but is not a change, with different line counts". A reader cannot guess that. | Rename `'x'` to `'context'` (or `'plain'`) and add one line to the header doc for `ci` and `ci0` (change index, group index). |
| should | src/lib/ui/tool.js:562-564, Tool.astro `#counter` | The counter reads "0 of 8" before any change is selected. | "0 of 8" reads as an error or as zero changes. | Show "8 changes" until the first press, then "1 of 8". |
| nice | README.md | Accurate. The file table omits `src/lib/ui/sample.js` and `src/lib/url.ts`. It does not mention the 400,000 character read-only preview limit in "Where the logic lives" (it is in Notes). | Minor. | Add two rows. |
| nice | src/lib/diff/chars.js file name | It holds options, cleaning, segmentation and tokens. The name says "chars". | A reader looks for tokens in `tokens.js`, which holds the diff. | Rename to `text.js` or split `options.js` and `segment.js`. |

Text on the site: I read About, Privacy, Terms, Contact, 404, FAQ and article. No placeholder text and no stray template wording. US spelling throughout. No em dashes. No vendor or AI mention beyond the standard credit line. Tone is plain. Two lines read as slightly staged ("Questions or ideas?", "We want to hear about bugs, ideas and anything that is unclear.") but pass.
