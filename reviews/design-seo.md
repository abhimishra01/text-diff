# Design and SEO review (Jessica, 2026-10-21)

Method: built to my own folder, served on 4976 (Pages-style build) and checked the `/text-diff/` Bingemind build with the builder's UI suite. Viewed in Chrome at 1280, 820, 390 and 320, light and dark, through my own playwright session plus scripted probes. Clicked every control (list at the end). Checklists: web-design-guidelines (rules applied from memory; I did not fetch them, since nothing may be sent out), taste-skill and awesome-design-md (applied as a judgment, see "Design judgment").

## Scores (Lighthouse, Google Chrome headless, local static server without compression or cache headers)
| Run | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Mobile (default throttling) | 99 | 100 | 100 | 100 |
| Desktop | 100 | 100 | 100 | 100 |

Mobile LCP 1.7 s (spec target 1.5 s; the local server sends no gzip, which Lighthouse says costs 70 KiB, so real hosting should pass), CLS 0, TBT 0 ms, 103 KiB over 8 requests (spec: under 12). Lighthouse only scans the empty page, so I checked the result view by hand (contrast, focus, labels) and found no issue beyond the table below.

Must-fix: 2. Should-fix: 9.

## Findings
| Sev | Area | Finding | Fix |
|---|---|---|---|
| must | Fake affordance: Inspect button | "Inspect" (next to the change arrows) enables after you pick a change, but clicking it shows nothing. The button opens the card, then the page-wide click handler (tool.js:354) closes it, because the button is not inside the card and not a mark. Key `i` works, so the keyboard path hides the bug. Reproduced with real clicks in a named session. | In the document click handler, ignore clicks on `#btn-inspect`, or open the card in a `setTimeout`. Add a UI test that clicks the button. |
| must | Fake affordance: Wrap toggle | With Wrap off in Split view (the default view on desktop) long lines are cut off at the column edge. No horizontal scroll exists (`#list` scrollWidth equals clientWidth, measured). Cause: the rule `#tool .vlist[data-view="split"] .vrows {min-width:100%}` (Tool.astro:285) has the same specificity as, and comes after, the `.nowrap` rule that gives the width. Unified and Inline work. The same clipping hits the forced "compact view" above 20,000 rows. | Put the split rule before the `.nowrap` rules or raise specificity of the `.nowrap` ones. Test scrollWidth for all three views. |
| should | Inspector card | The card sits 8 px under the mark and covers the rows below it. A real click on the next change is swallowed by the card (scripted click timed out). The user must close it first. | Close the card on any outside press (a mark click should re-open at the new place), or put the card beside the mark. |
| should | Phone result visibility | After pasting on a phone the result is about 700 px below. Nothing near the boxes says that a result exists. The sticky bar has Edit, Result and arrows but no Compare (builder note confirmed) and the counter shows "0 of 8". | Make the bar show "8 changes" and make "Result" the primary button once a result exists. A Compare button is not needed because the compare is live. |
| should | Phone copy | Empty state and article say "left box" and "right box". The boxes are stacked on a phone. | Use "Original box" and "Changed box". |
| should | Tablet 820 px | Panes are two columns of about 390 px each and the toolbar wraps to three rows with Compare and "Hide texts" on their own right-aligned row. It works but looks unfinished. | Move the one-column breakpoint to 900 px, or put Compare next to Options. |
| should | Copy redline for Word and Docs | I could test only Chrome. The clipboard has `text/html` with `<del>` and `<ins>` plus inline colors and `text/plain` `[-x-]{+y+}`. Pasted into a Chrome editable area the colors stayed, the inline `text-decoration` was dropped, and the tags stayed. Whether Word, Google Docs, Gmail or Apple Mail show strike-through and underline from `<del>` and `<ins>` I could not test (no such apps). The font is forced to Consolas 14 px. | Wrap changes in `<s>` and `<u>` as well, since every editor knows those. Do not force a font. Test in Word, Docs, Gmail. Until then the article claim "The reader sees the same marks" is untested. |
| should | Text size limit | Over 400,000 characters the box becomes a read-only preview. Neither the FAQ nor the article says so. | State the limit in the FAQ answer on size. |
| should | Header and toggles | Theme button is 40 x 40 px (spec: 44). On phone the View segment is cut off at the right edge of the scrolling toolbar and no arrow hints that it scrolls. | 44 px target. Add a fade on the right edge of `.td-scroll`. |
| should | SEO: internal links | The article tells the reader to use a JSON-aware tool and a list compare tool but does not link to any. The "More free tools" block lists Markdown to PDF, Column to comma and DPI changer, which do not relate to text compare. The spec asks for a `json-diff` link. | Link the closest sibling tools in the article and in the block when they exist. |
| should | No-JS | With JavaScript off, the tool shows two inert boxes and the line "Paste or type text in both boxes to compare." | Add a `<noscript>` line. |
| nice | Rows marked ignored | `.row.ign {opacity:.6}` brings the ink near 4.5:1 on white. | Use a dashed tint, not opacity. |
| nice | Counter | "0 of 8" before a change is selected. | "8 changes". |
| nice | Compare button | Live compare makes the primary "Compare" button look like it does nothing. | Keep it (the spec wants it) and flash "Updated" in the summary. |

## Design judgment (taste-skill and awesome-design-md)
- **Better than the rivals?** Yes on the points that matter to the target user. The result is in view at 1280 x 800 without scrolling, there is no modal and no ad slot in the tool, the hidden-character view and inspector have no rival, and the redline copy is rare. Diffchecker.com and text-compare.com load ads, limits or a server round trip. The diff colors are not color alone: bar, sign, strike-through, underline.
- **Visual language.** Quiet, tool-first, one slate accent, system fonts, tight toolbar, 44 px targets, good dark mode. It matches the "Refined minimal" brief. It avoids template slop (no gradient hero, no cards in cards, no icon grid). Hierarchy: small H1, one primary button, clear counts. Spacing is consistent. The red and green are calm and pass contrast (light del 7.2:1, dark ink on tint above 7:1).
- **Weaker points.** The toolbar has two rows of eight or more controls at 1280 and a third row at 820. The mono font is used for all prose results, so the paragraph view in Words mode feels like code. Offer a proportional font toggle for prose (nice).
- **Logo and icons.** The favicon (two panes with a red and a green line) reads at 16 px and as an app icon. OG image is a real, correct result (I recounted its numbers), 1200 x 630. Manifest, apple-touch icon and 192 and 512 icons exist.
- **Empty and error states.** Empty state has three steps and a Sample link. Identical gives a check and a list of what was ignored. Binary files give the exact spec message. One empty pane still compares. No red error text anywhere. A Cancel leaves a wrong message (see the maintainer report).
- **Layout shift.** CLS 0. The tool has a reserved 30 rem min-height.
- **Accessibility.** Lighthouse 100. Skip link, labels on both textareas, fieldset legends, live summary, buttons for every action, visible 3 px focus ring, `prefers-reduced-motion` respected, rows have an aria-label that reads the change in words. Keyboard-only run: 40 tab stops in a sensible order, radios arrow-key inside their group, Escape closes the options card and the inspector, `n`, `p`, `i` work outside text boxes.

## SEO
- Title (50 chars), meta description (147), single H1, 12 H2 in a clean outline, canonical self at https://bingemind.com/text-diff/. About, Privacy, 404 get index or noindex as the template says. Contact and Terms are noindex and not in the sitemap. Titles all under 60. Descriptions on the legal pages are 139, 145, 153, 155 characters (spec band 120 to 155).
- JSON-LD parsed: `WebApplication` (free offer, screenshot, author, publisher), `BreadcrumbList` (3 items), `FAQPage` (8 questions). No `aggregateRating`. FAQ answers are plain text, 40 to 80 words, and also visible in the page.
- OG and Twitter tags present, OG image 1200 x 630.
- Article depth: about 1,270 words including FAQ and footer blocks. All spec sections are there, with two tables, a worked example whose numbers I verified, and no hype. Gap: no mention of the 400,000 character preview, no "Keyboard shortcuts" line.
- Sitemap in Bingemind mode lists /, /about/, /privacy/ with the right base. Robots.txt is intentionally absent in Bingemind mode (the Bingemind root owns it).

## Controls clicked in a real browser
Sample, Swap, Clear (all and per box), Lines, Words, Characters, Split, Unified, Inline, Options (open, every checkbox, all four whitespace radios, Reset, close by Escape and by outside click), Show hidden characters, Hide unchanged lines (and the fold button), Wrap, Compare, Hide texts and Edit texts, Open file (both boxes, UTF-16, UTF-8, Latin-1, a fake .docx), drop a file, previous and next, keys `n`, `p`, `i`, Inspect (broken, above), clicking changed marks, Copy diff (Lines and Words), Copy redline, Copy stats, option chips, "Compare strictly", "Use Words mode", "try the sample", Cancel, theme toggle (with `localStorage` blocked), FAQ items, phone bar Edit, Result and arrows. Everything works except the two must-fix items. Nothing that looks clickable is fake otherwise: pointer cursor only on marks that open the card, no hover on static text, the disabled buttons are visibly disabled. The text boxes show no picture-of-UI.

Servers stopped, session closed, temp folders deleted.
