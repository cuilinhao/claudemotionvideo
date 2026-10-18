# Clone and release audit

Audit scope: repository files, public demo assets, and current UI copy. `RECON/private/`, `.dev.vars`, `.secrets/`, and credentials were not opened. Findings are for the source tree as of 2026-10-18; repeat checks against the final release build and production domain before launch.

## Reference and copied-material boundary

- Reference site: [Tellcut](https://tellcut.app/), with public [pricing](https://tellcut.app/pricing) and [Studio](https://tellcut.app/studio) pages. Local screenshots under `RECON/screenshots/` were used to assess visible layout only.
- No complete, authorized original source repository was available. Public HTML/browser-visible behavior is evidence only; this codebase is an independent React/Worker implementation. No original user posts or third-party customer projects are represented as our work.
- `public/demos/orbit-demo.mp4`, its poster and input image are the local verified example; `RECON/live-generation.json` records the generated Canvas source. Confirm rights to any future uploaded demo input before release.
- The brand name and favicon are original to this project. Check that final domain, logos, page metadata, policies, and billing statement descriptor consistently identify the operating business and do not imply Tellcut affiliation.

## Tracking, network, and third-party services

- Static-source search for common analytics identifiers (`gtag`, Google Tag Manager, Meta/Facebook Pixel, Hotjar) found no matches in `src`, `public`, `index.html`, or `worker`. This is a source scan, not a network-panel proof that no runtime telemetry exists; recheck the built site in DevTools before launch.
- Explicit third-party network references found: Google Fonts CSS in `src/styles.css`; APIMart Messages endpoint in `worker/ai.ts`; Stripe SDK calls in `worker/billing.ts`; Cloudflare Worker/D1/R2/Workflows bindings in `wrangler.jsonc`. The Google Fonts import sends ordinary browser requests to Google; self-host fonts if avoiding that external request is a requirement.
- User uploads are delivered to APIMart for generation and stored in private R2. Privacy copy should accurately name service providers, retention, deletion and operator contact before public use; legal review is still appropriate.

## Release blockers and verification notes

| Finding | Evidence | Action |
|---|---|---|
| Domain routing verified. | Root HTTPS returns 200; www `/studio?x=1` returns 301 to the same root path/query. Production image generation and private MP4 retrieval were exercised. | Routes intercept the proxied DNS hostnames; do not remove the Worker routes without replacing the deployment. |
| Live Stripe Checkout and Customer Portal are configured and verified. | The account holder completed onboarding and passkey verification. Six live prices and a versioned enabled webhook are installed with a restricted key. Signed health event returned 200; invalid signature returned 400. | No actual card charge was made. Production charge-to-webhook delivery and bank payouts have not been exercised. Refund/dispute credit adjustment remains manual. |
| Contact address needed to be reachable. | `src/Marketing.tsx` contact page was updated to the user-provided business address `cuilinhao2015@gmail.com`. | Confirm delivery and keep this address aligned with support procedures. |
| Refund wording must match actual behavior. | `worker/credits.ts` and `worker/workflow-runner.ts` refund failed generation credits; no general unused-subscription-cash refund workflow exists. Public copy was updated to say failed jobs return credits and to contact support about subscription charges. | Do not advertise a blanket cash-refund entitlement without an implemented and approved policy. Test the final copy in the deployed site. |
| Password recovery relies on configured email delivery. | `worker/password-reset.ts` responds 503 when the EMAIL binding or EMAIL_FROM is missing. | Test delivery, link expiry/one-time behavior and reset completion with a non-production account. |
| Desktop and mobile homepage checked. | Saved 1512px desktop and 390×844 mobile screenshots; mobile document width equals viewport width with no horizontal overflow. | Other browsers, portrait exports and a full device matrix remain outside this check. |

## Content and repository hygiene

- Search for `TODO`, `FIXME`, known tracking IDs, `Tellcut` and stale `support@claudemotionvideo.com` references before release. Current contact copy uses the user-provided support address. Mention Tellcut only in internal comparison documents, not public product copy.
- `.gitignore` excludes `.dev.vars*`, `.env*` (except `.env.example`), `.secrets/`, `.wrangler/` and `RECON/private/`. Keep these exclusions intact; inspect `git status` before staging.
- Never commit real API keys, Stripe identifiers copied from a private dashboard if considered sensitive, user inputs, generated private projects or reset tokens. Do not paste secret values into shell logs.
- Confirm terms, privacy, billing disclosures, email sender ownership and customer support response process with the business owner. Current UI language is not legal advice or a verified service commitment.
