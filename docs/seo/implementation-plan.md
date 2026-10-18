# Text animation SEO implementation — 2026-10-18

Source: the user's supplied claudemotionvideo.com task brief. Execute all ten tasks in the five requested commit groups; commit messages are Chinese per the user's AGENTS.md.

## Constraints and implementation decisions

- Keep the Vite/static HTML + Cloudflare Worker architecture. Transform the existing homepage at build time and generate the ten added documents alongside the existing thirteen pages.
- Preserve the in-progress example player changes and all existing URLs, robots.txt, pricing, checkout and generation logic. Work in the requested checkout on `codex/text-animation-seo`; the pre-existing diff is recorded outside the repository at `/tmp/cmv-seo-baseline/preexisting.patch`.
- New SEO modules use Node built-ins and the existing pricing source. No runtime parsing dependency or new product dependency.
- Exact metadata and first FAQ from the brief; eight effect prompts from the existing effects library. Never invent example dates, ratings or match claims.
- A plain language example caption must distinguish an exact demonstrated effect from a related example when the existing gallery does not establish a one-to-one match.
- Preserve FAQPage and HowTo as requested; Google's retired rich-result features cannot be used as a current pass/fail criterion. Record actual external test availability separately.

## Commit sequence and checks

1. Homepage metadata, linked effect list, eight FAQ entries, SoftwareApplication with prices read from `src/lib/content.ts`, FAQPage and HowTo. Test exact text, price derivation, visible/schema agreement and preserved product details.
2. Two tool pages generated with unique copy, ordered steps, specifications, five FAQs and real trial terms; register routes with the Worker. Test route resolution and metadata/content parity.
3. Eight effect pages with source prompts, real example video and poster metadata, truthful provenance and VideoObject. Test every route and media reference.
4. `public/llms.txt` and deterministic `llms-full.txt` from the same homepage/effect content; copied at build time. Test readable complete English corpus.
5. Eleven 1200×630 PNG share cards, sitemap of 23 URLs with dates/frequency, breadcrumbs and cross-links. README reminders and acceptance report. Test all built documents, local Worker HTTP status/content types, internal links, image dimensions, typecheck, suite, build and Lighthouse SEO. Independent code review before finish.

## Review focus

- New Worker paths must remain indexable and unknown paths remain 404/noindex.
- Generated schema must match visible text and use current actual prices.
- No fabricated dates or video-effect relationship; preserve author attribution.
- PNG metadata and llms content must survive a clean build.
- Existing dirty files must not enter the SEO commits.

## Progress

- Baseline: thirteen public pages, eight homepage FAQs, 470 gallery examples. Original robots checksum captured.
