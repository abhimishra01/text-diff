# Mock-customer test (Jessica, 2026-10-21)

Five personas used the live page for a real task. Two on phones (iPhone 13 profile with touch, 390 x 844), three on desktop. Real values typed or opened as files.

## 1. Dana, paralegal, desktop (expert on contracts, new to this tool)
Task: two versions of a lease clause pasted from Word, with curly quotes and a non-breaking space. She chose Words, Inline.
Story: She found the result at once and liked the strike and underline, and the summary "2 changes. 6 words added, 1 removed." She pressed Copy redline and pasted it into an email. In Chrome the colors came across. She then wanted to know why two quotes showed as a change, turned on hidden characters, picked "Next", pressed Inspect and nothing appeared. She pressed `i` after reading the tooltip and it worked.
Voice: "I would click this over Diffchecker because of the local-only line. Done fast, apart from the Inspect button. The Inspect button is broken. Does the redline keep its marks in Word? I cannot tell, and it is the whole reason I am here. I trust the answer for plain text. I would come back if the Word paste works. Please say the 400,000 character limit somewhere. Our contracts are longer than that."

## 2. Marcus, backend developer, desktop (expert)
Task: two config files from a Windows build box (one saved UTF-8 with BOM, one without), CRLF versus LF.
Story: The tool (reading the first file as UTF-16 or UTF-8 with a BOM, checked by opening real files) said "Line endings differ: CRLF and LF. Treated as equal." which he liked. It then showed a change on line 1 of the config. Same text. With hidden characters on he saw the BOM chip. The option "Treat non-breaking spaces as spaces, ignore zero-width characters" should clear it (a BOM counts as zero-width in the code), but he has to guess that.
Voice: "I would pick this over Diffchecker (no five-use limit). Under 30 seconds? No, because of the BOM. I do not want a tool to tell me that identical text differs because of a marker. Missing: a sticky 'Ignore trailing whitespace' chip near the top, download as .patch. I trust the diff, since it matches `diff -u` on my terminal output. I would bookmark it."
Fix wanted: strip the BOM when opening a file (3 of 5 personas who open files hit this class of issue, 1 hit the bug itself).

## 3. Priya, graduate student, phone (beginner)
Task: compare two paragraphs of her essay, typed in Notes, pasted into the boxes.
Story: She pasted the first paragraph into the top box, then the second into the lower box. Nothing seemed to happen: the result was a screen and a half below. The empty-state steps said "left box" and "right box" and she looked sideways. The bar at the bottom showed "0 of 8", which she read as no changes. After tapping Result she saw the unified view and liked the red and green lines. She switched to Words and Inline. The paragraph was in monospace and harder to read.
Voice: "I would click it on Google if it were not Diffchecker's ad page. It took me a while to find the answer. Make the bar say '8 changes' and bring me to the result. The Inline words view is what I wanted, but it should look like my essay, not code. Do I trust it? Yes. Would I come back? Yes if it jumps to the result."

## 4. Luis, translator, desktop (intermediate)
Task: a Spanish source and its revised translation, then a Japanese pair, in Characters mode.
Story: Words mode was perfect: accents handled, `café` with an accent mark in two parts was flagged, and the card said why. In Characters mode the summary said "501 words added, 501 removed" for a one-word swap. The similarity looked low and wrong.
Voice: "The highlights are great, the numbers in Characters mode are nonsense. I check the numbers in my reports, so I would stop trusting the summary. Missing: a counter for 'characters changed' as the headline in this mode. I would bookmark it if the stats were right."

## 5. Mrs. Okafor, teacher, phone (beginner)
Task: two students' answers to compare, on a phone in the staff room (390 px wide).
Story: Sample first, then her own text. Unified is the default on a phone, so the result read well, with minus and plus signs. The toolbar cuts the View choice off at the right edge, so a user who wants Split has no hint it exists. Split, when chosen, scrolls sideways inside its box with a note, and works (measured 640 px wide inside a 356 px box). Her worry was the words "Similarity 84 percent" on student work. The FAQ says it is not a plagiarism check, but she would only learn that by opening the FAQ.
Voice: "I like that nothing is uploaded, because I put student names in. The number scares me. Add one line right under it." (Tested separately: on desktop, Wrap off in Split view cuts long lines with no scroll. A teacher on a tablet in landscape would hit it.)

## Ranked change list
| Rank | Level | Change | Personas asking |
|---|---|---|---|
| 1 | must | Fix the Inspect button (click does nothing, only key `i` works) | 1 of 5 hit it (Dana); any QA or paralegal user will |
| 2 | must | Strip the BOM when opening a file so identical text shows no difference | 1 of 5 hit it, 3 of 5 open files |
| 3 | must | Characters mode must show correct word counts and similarity | 1 of 5 (Luis), all who use that mode |
| 4 | should | Phone: say "N changes" on the bar and bring the user to the result after a paste or a tap; fix "left/right box" copy | 2 of 5 |
| 5 | should | Proven redline paste into Word, Google Docs, Gmail (add `<s>` and `<u>`); do not force a font | 1 of 5 (Dana), it is the main promise |
| 6 | should | Wrap off in Split cuts text with no scroll | 1 of 5 (tested on desktop) |
| 7 | should | Short note under Similarity: "Counts shared words. Not a plagiarism check." | 1 of 5 |
| 8 | should | State the 400,000 character preview limit in the FAQ | 1 of 5 |
| 9 | nice | Proportional font option for prose in Words and Inline | 1 of 5 |
| 10 | nice | Download as .patch, sticky ignore-whitespace chip | 1 of 5 |

Would they click it on Google over the others? 4 of 5 would (my reading) (the local-only claim and no limits). Would they return? 4 of 5 likely, after the three must-fix items.

Top 5 changes: (1) Inspect button, (2) BOM on file open, (3) Characters mode stats, (4) phone result guidance and wording, (5) Word and Docs redline proof.

Note: personas are my simulation. I typed the personas' tasks into the real page and read the real output. The voices are my judgment of how that session would feel, not interviews.
