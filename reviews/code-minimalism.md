# Code review: minimalism lens (Jessica, 2026-10-21)

Verdict: lean. No run-time dependencies and a 12.6 KB gzip page script plus a 9.8 KB worker, far under the 60 KB budget. A little dead code and one unused skin file remain. Must-fix: 0. Should-fix: 4.

| Severity | File:line | Finding | Why | Fix |
|---|---|---|---|---|
| should | src/styles/skin-clay.css (57 lines) | Not imported anywhere. It is the "Soft clay" skin, and the brief chose "Refined minimal". | Dead file from the template that also contradicts the chosen skin. | Delete it. |
| should | src/lib/diff/export.js:101-120 | `redlineLines` has an `if (res.mode === 'lines') {...} else {...}` where both branches are the same loop. | Dead branch that suggests a difference that does not exist. | Keep one loop. |
| should | src/lib/diff/chars.js:132 | `countGraphemes` is exported and never used. `cleanChars` and `applyWs` are exported but only used inside `chars.js`. `fragHtml`, `rangesHtml`, `sideRanges`, `isSmall`, `groupCount`, `redlineLines`, `describeCodePoint` are exported and only used in their own file. | Exports that nobody imports widen the surface for nothing. | Remove `countGraphemes` and drop `export` from the others. |
| should | src/site.config.ts:8-9, 12 | `keywords` and `tagline` are never read by any page. | Config that looks live and does nothing. | Delete, or use them (the tagline pill in the template). |
| nice | src/lib/diff/chars.js:73 | In `cleanWithMap`, `NBSP_RE.lastIndex = 0;` does nothing (the regex is not used after it), and the NBSP class is written out twice more (NBSP_RE, NBSP_ONE, and an inline copy). | Three copies of one character class drift apart. | Use one `NBSP_ONE` and delete the others. |
| nice | src/lib/diff/export.js:123, src/lib/ui/render.js:4 | `esc` is defined twice (the render one also escapes `"`). | Two escapers, two behaviors. | Export one from a small shared file and import it in both. |
| nice | src/lib/diff/compare.js:122-124 | `pairSegs` does `const r = tokenDiff(...); return r;`. | Noise. | Return directly. |
| nice | public/_headers, package.json `wrangler`, scripts/deploy.mjs | Cloudflare deploy files and the `wrangler` dev dependency stay although the tool ships inside Bingemind and on GitHub Pages. | Template pattern (matches cash-drawer-counter), but it pulls a large dev dependency. | Leave for now. Revisit when the deploy target is final. |

Size check: page JS 35.1 KB raw, 12.6 KB gzip. Worker 25.4 KB raw, 9.8 KB gzip. CSS 8.6 KB gzip. Total transfer 103 KiB in 8 requests. Nothing here needs to shrink.
