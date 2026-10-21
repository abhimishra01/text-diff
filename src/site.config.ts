// ONE config file. Change values here; every page reads from it.
// Keep this file plain (no type-only syntax): scripts/deploy.mjs imports it directly.
const cfg = {
  name: 'Text Diff Checker',                 // shown in header, title, footer
  domain: 'bingemind.com/text-diff',            // no https://, no www. Used for canonical, sitemap, robots
  cloudflareProject: 'text-diff',    // Cloudflare Pages project name (used by npm run deploy)
  keyword: 'text diff checker',            // main keyword: goes in the H1 and title
  keywords: ['compare two texts online', 'text compare', 'find difference between two texts', 'diff checker', 'compare text ignore whitespace', 'hidden characters finder'], // supporting keywords
  tagline: 'Free, no limits, stays in your browser',  // short line shown in the pill above the H1
  description:
    'Paste two texts and see every difference by line, word or character. Ignore whitespace and case. Your text stays in your browser. Free, no sign-up.',
  email: '',       // contact email (shown on the Contact, Privacy and Terms pages)
  ga4: '',                            // GA4 measurement ID, e.g. 'G-XXXXXXXXXX'. Empty = Google Analytics off
  adsense: '',                        // AdSense publisher ID, e.g. 'ca-pub-1234567890123456'. Empty = ads off
  brand: '#475569',                   // brand color (hex)
  locale: 'en-US',                    // BCP 47 language tag
  ogImage: '/og.png',                        // e.g. '/og.png' (1200x630 file in public/). Empty = no image
  category: 'UtilitiesApplication',   // schema.org applicationCategory
  owner: 'Text Diff Checker',                // name used in legal pages (person or business)
};

// Bingemind mode (SITE_MODE=bingemind): the tool lives at bingemind.com/text-diff/.
// Canonical links always name that address. Legal pages name Bingemind as the owner.
const bingemind = process.env.SITE_MODE === 'bingemind';
export default {
  ...cfg,
  domain: 'bingemind.com/text-diff',
  origin: 'https://bingemind.com/text-diff',
  bingemind,
  owner: bingemind ? 'Bingemind' : cfg.owner,
  contactWord: 'Contact',
  contactHref: 'https://bingemind.com/#contact',
  contactLabel: 'bingemind.com/#contact',
};
