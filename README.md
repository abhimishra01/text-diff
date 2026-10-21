# Microtool site template

Astro (static) + Tailwind 4. One config file: `src/site.config.ts`. No backend.

## Make a new tool

```
cd ~/Desktop/personal/microtools
template/scripts/new-tool.sh my-tool mytool.com
cd sites/my-tool && npm run dev
```

Then edit, in this order:
1. `src/site.config.ts`: name, main keyword, supporting keywords, description, email, brand colour.
2. `src/components/Tool.astro`: the real tool (replace the demo; keep the fixed height so the page does not jump).
3. `src/components/Article.astro`: about 600 words of plain text. Main keyword in the first paragraph and one heading.
4. `src/data/faq.ts`: 5 to 8 real questions. They also become FAQ schema.
5. Optional: `public/og.png` (1200x630) and set `ogImage: '/og.png'`.
6. Check About, Terms and Privacy text still fit the tool.

Commands: `npm run dev` (work), `npm run build` (make `dist/`), `npm run preview` (check the build), `npm run deploy` (build and upload to Cloudflare Pages).

## Go live (plain steps)

1. **Buy the domain** after the tool works. `.com`, 1 year, auto-renew off. Put it in `site.config.ts` as `domain` (no `www`, no `https://`). Rebuild.
2. **Cloudflare**: add the domain to Cloudflare (free plan) and change the nameservers at the registrar.
3. **First deploy**: run `npx wrangler login` once (you do this, in your browser). Then `npm run deploy`. The first run asks to create the Pages project; use the same name as `cloudflareProject` in the config.
4. **Custom domain**: Cloudflare dashboard > Workers & Pages > your project > Custom domains. Add `mytool.com` and `www.mytool.com`. Then add a redirect rule from `www` to the bare domain (or the reverse) so only one version exists.
5. **No duplicate in Google**: `public/_headers` already sets `X-Robots-Tag: noindex` for the `*.pages.dev` address only. Check it: `curl -sI https://my-tool.pages.dev | grep -i robots` shows noindex; the custom domain does not.
6. **Google Search Console**: add the domain property, verify with the DNS TXT record in Cloudflare, submit `https://mytool.com/sitemap-index.xml`, request indexing of the home page.
7. **Bing Webmaster Tools**: sign in, import from Search Console.
8. **Google Analytics**: create a GA4 property, copy the measurement ID (`G-...`) to `ga4` in the config, rebuild, deploy. Empty means off.
9. **AdSense (later, about 10 visits a day or more)**: apply with the site. When approved, put the publisher ID (`ca-pub-...`) in `adsense`. The build then adds the script and writes `/ads.txt`. Set up the consent message in AdSense (Privacy & messaging) for EU/UK visitors. Then switch on Auto ads. A first rejection is normal; improve content and apply again.
10. Share the tool on Reddit, Quora and social. Rankings take 4 to 6 months. Keep the domain at least a year.

## How things work

- **Dark mode**: follows the system, the toggle saves the choice. A tiny inline script sets it before paint, so there is no flash.
- **SEO**: title, description, canonical (real domain), Open Graph, Twitter, `WebApplication` and `FAQPage` JSON-LD are in `src/layouts/Base.astro` and `src/pages/index.astro`.
- **Sitemap and robots**: `@astrojs/sitemap` makes `/sitemap-index.xml`; `/robots.txt` points to it. The 404 page is excluded.
- **ads.txt**: generated from `adsense`. Empty ID gives a comment line only.
- **Favicon**: `/favicon.svg` is made from the first letter of the name and the brand colour (`src/pages/favicon.svg.ts`). To use your own, put a file at `public/favicon.svg` and delete that `.ts` file. For Apple and old browsers add `public/apple-touch-icon.png` (180x180) and a `<link rel="apple-touch-icon">` line in `Base.astro`.
- **GA4 and AdSense** load only when their IDs are set (`src/components/Analytics.astro`). These are the only outside requests.
- **Fonts**: system font stack, no downloads.
- **Deploy script**: `scripts/deploy.mjs` reads `cloudflareProject` and runs `wrangler pages deploy dist`. It needs Node 22.6 or newer.

## Legal pages

The About, Terms and Privacy pages are good starting text, not legal advice. Read them before you launch and edit what does not match your tool.
