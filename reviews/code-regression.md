# Code review: regression lens, are the answers correct? (Jessica, 2026-10-21)

Verdict: the line engine, the unified diff and the known-answer cases are right and match real tools. Three answers are wrong or misleading and must be fixed: word counts in Characters mode, a fake first-line difference from a file BOM, and ignored blank lines that leak into Copy diff and Copy redline. Must-fix: 3. Should-fix: 4.

## What I recomputed (all by an independent method)
| Check | Method | Result |
|---|---|---|
| Line add/remove totals | Brute-force LCS oracle on 5,000 random pairs, Lines mode | 5,000 of 5,000 match |
| Unified diff format (hunk headers, `,1` omitted, `-0,0`, context 3, hunk merge gap) | Compared to real `diff -u --minimal` on 1,432 random pairs | 1,432 of 1,432 identical, hunk for hunk. Applying each diff to Original also gave Changed |
| Segments rebuild their text | Fuzz: 3,000 random pairs x 12 option sets x 3 modes (emoji, NBSP, ZWSP, NFC, CJK, mixed line endings) | 0 throws, 0 mismatches, 0 false "changed" |
| Article worked example (lease, 12 to 24) | Hand count: removed 1, added 24 + with an option to renew = 6, similarity 1 - 7/17 = 59 percent. Page shows "2 changes. 6 words added, 1 removed. Similarity 59 percent." | correct |
| OG image text (4 changes, 8 added, 3 removed) | Hand count of first/1st, 50/75, 12/24, new clause | correct |
| Spec T24 | `one two three` vs `one three four`, Words: 67 percent | correct |
| Spec T25 plain redline | `The quick [-brown-]{+red+} fox [-jumps-]{+leaps+}` | correct (also checked live in the Copy redline output) |
| Spec T10-T14 (emoji, family, flag, e vs accent, CJK) in the real page | One whole grapheme marked each time, no lone surrogate | correct |
| Spec T15 Hebrew, T16 comma | 1 changed word; comma only gives 0 words changed, similarity 100 | correct |
| Sample text similarity | 36 and 44 words, 5 removed, 13 added: (80-18)/80 = 77.5, shown 78 | correct |
| Speed (node, same machine) | 100k lines 155 ms; 20k unrelated lines 838 ms; 200k words 30% changed 1.1 s; in the browser a 21 MB pair with every line different finished in 9 s, Cancel took 33 ms, main thread stayed free | meets S1, S2, S5 |
| Template rules | Built Bingemind mode and GitHub Pages mode. Canonical is bingemind.com/text-diff/ in both. Pages copy has `noindex, follow`. Bingemind mode has `index,follow`, no robots.txt (by design), sitemap lists /, /about/, /privacy/ only. Contact and Terms noindex. 404 page present. GA and AdSense empty give no scripts and no ad box. `_headers` has the pages.dev noindex rules | all hold |

## Findings
| Severity | File:line | Finding | Why | Fix |
|---|---|---|---|---|
| must | src/lib/diff/tokens.js:165, 203-204 (word counts use grapheme tokens in chars mode); summary text at src/lib/ui/tool.js:418 | Characters mode counts every letter as a "word". `hello brave new world` to `hello new world` says "5 words removed" and similarity 84 percent (Words mode: 1 removed, 86 percent). A 500-letter string swap says "501 words added, 501 removed". | The summary, "Copy stats" and similarity are wrong in one of the three main modes. | In chars mode count words with `wordTokens` on the original text, or hide the word numbers and show characters only. Add a test. |
| must | src/lib/ui/tool.js:265 | `new TextDecoder(enc, { ignoreBOM: true })` keeps the BOM. A UTF-16 file (BOM is only an encoding marker) or a Windows UTF-8-BOM file shows a fake difference on line 1 against the same text without a BOM. Reproduced: UTF-16 file vs UTF-8 file with the same text gave "1 change". | Wrong answer on a P0 feature (open file). Developers and lawyers on Windows meet BOM files daily. | Remove `ignoreBOM:true` so the decoder strips the BOM. Optionally add a note chip "File had a BOM" when it differs. |
| must | src/lib/diff/export.js:9 (`lineItems`) and :106 (`redlineLines`), both treat `ign` blocks as changes | With "Ignore blank lines" on, the page says "No differences" but Copy diff gives a hunk (`@@ -1,3 +1,2 @@`, a `-` empty line) and Copy redline gives `a\n[--]\nb`. Same for `{++}`. Checked: `a\n\nb` vs `a\nb`. | The export disagrees with what the user sees and with the option they chose. A user pastes a redline full of empty markers into an email. | Treat `ign` blocks as equal context in `lineItems` and `redlineLines` (show them as normal lines). |
| should | src/lib/diff/export.js:4-15 (`lineItems`) | When whitespace or case is ignored, Copy diff prints the Original version of equal lines as context. For a Changed-side line that differs only in case, the diff does not reproduce Changed. | Not a valid patch for Changed. The spec only promises git style output, so this is a label problem. | Say so in the Copy diff toast when options are on: "Ignored differences are not shown." |
| should | src/lib/ui/tool.js:445 | Copy diff, Copy redline and Copy stats stay enabled when the result is "No differences". Copy diff then copies only the two header lines. | An empty file on the clipboard. | Disable or say "Nothing to copy." |
| should | src/lib/diff/compare.js:174 (`pct`) and tool.js:418 | Emoji or punctuation-only text has no words. A one-emoji change shows "Similarity 0 percent" and "0 words added, 0 removed". | A confusing line for a valid input. | If there are no words in either text, hide the similarity or base it on characters. |
| should | src/lib/ui/tool.js:132-140 (Cancel) and :410-411 | After Cancel, the panel says "Paste or type text in both boxes" although both boxes have text. | Wrong status text. | See maintainer report. |
| nice | compare.js:`LONG_LINE` | Lines over 6,000 characters get a trimmed highlight (40 characters of context). Correct, but the "Every change shown is real" note on approximate mode can show equal words as removed and added when the text has no unique anchors (random vocabulary test: similarity 30 percent where about 70 was expected). | Only the approximate path, and not for normal prose with distinct words (10,000 words, 20 to 40 percent edited: within 1 point of true). | Change the note to "...may mark some unchanged text as changed." |

Not tested here: Safari and Firefox paste and clipboard (only Chrome available); real Word, Google Docs and Gmail paste (see design report for what I could test); a real Android phone.
