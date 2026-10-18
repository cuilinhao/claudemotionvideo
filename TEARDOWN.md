# Tellcut public-site teardown

## Scope and evidence standard

Reference: [tellcut.app](https://tellcut.app/), including its public [pricing page](https://tellcut.app/pricing) and [Studio entry](https://tellcut.app/studio). The saved public comparison images are [`RECON/screenshots/original-home.jpg`](RECON/screenshots/original-home.jpg) and [`RECON/screenshots/original-studio.jpg`](RECON/screenshots/original-studio.jpg). They document the visible layout at capture time, not a complete design system or backend.

**Evidence labels:** `SOURCE` means directly visible in this repository or a reproducible local artifact; `PARTIAL` means public-page/UI observation only; `GUESS` means an inference about an inaccessible original service. Original server implementation, customer count, revenue, and provider request logs were not available, so this teardown makes no claims about them.

## Product essence

The recognizable user journey is: select an idea and reference image, describe motion, generate a short animation, refine the result, preview it in a timeline, then export MP4. Public Tellcut pages provide evidence for the product framing and page hierarchy (`PARTIAL`); our working implementation documents its actual behavior below (`SOURCE`). The clone's implementation is independent; see `CLONE_AUDIT.md` for scope and asset boundaries.

## Page and interaction map

| Area | Public reference evidence | This project's implementation |
|---|---|---|
| Home | Dark canvas, warm accent, oversized compressed headline, central navigation and Studio/video demonstration are visible in the public homepage and saved screenshot (`PARTIAL`). | `src/Marketing.tsx` and `src/styles.css`; right-hand demo uses `public/demos/orbit-demo.mp4` and original uploaded input preview. |
| Pricing / FAQ | Plan comparison and product questions appear on the public pricing page (`PARTIAL`). Original live prices should be rechecked before any commercial comparison. | `src/lib/content.ts`, `src/Marketing.tsx`; checkout is backed by Stripe only when Worker billing configuration is complete. |
| Studio | Studio route and editor framing are public-facing; reference screenshot records visible columns and preview area (`PARTIAL`). Login-only service behavior and backend details are not asserted from that screenshot. | `src/Studio.tsx`, `worker/app.ts`, `worker/jobs.ts`, `worker/workflow-runner.ts`. Project list, brief, prompt, uploads, jobs, versions, storyboard/shot selection, preview and MP4 export. |
| Examples / Effects / Blogs | Public navigation and pages are visual reference material (`PARTIAL`). | `src/Marketing.tsx`, `src/lib/content.ts`; geometric study artwork and templates are original UI content. Only the orbit example is backed by a verified generated MP4. |
| Legal / Contact | These are clone operator content, not reproduced Tellcut policy. | `src/Marketing.tsx` legal/contact copy. Billing and privacy statements require business/legal owner review before production. |

## Verified implementation pillars

| Pillar | Evidence | Status |
|---|---|---|
| Account and session | `worker/app.ts` stores password hashes, creates HTTP-only sessions, checks session ownership and rate limits auth endpoints; `worker/auth.ts`. | `SOURCE` |
| Image upload and private storage | `worker/app.ts` checks PNG/JPEG/WebP signatures, size and per-user quota; stores bytes in R2 and returns a user-scoped image endpoint. | `SOURCE` |
| Prompt-to-animation request | `worker/ai.ts` sends text plus image base64 to `https://api.apimart.ai/v1/messages`, validates a single canvas document, and requires `window.seek`, `window.DURATION`, and image rendering for uploaded assets. | `SOURCE` |
| Durable job and credit accounting | `worker/jobs.ts` writes a job and ledger debit transactionally, honors per-user idempotency, launches the Cloudflare Workflow; `worker/workflow-runner.ts` reads images, calls the provider once, stores a version, and returns job credits on failure/timeout. | `SOURCE` |
| Preview isolation | `src/lib/renderer.ts` builds a restrictive CSP document, mounted in a sandbox iframe with `allow-scripts` but no `allow-same-origin`; messages require matching iframe source and random channel. | `SOURCE` |
| MP4 export | `src/lib/renderer.ts` requests deterministic frames and encodes H.264 at 30 fps plus an optional AAC soundtrack through Mediabunny/WebCodecs; `worker/app.ts` accepts an authenticated MP4 upload up to 64 MiB and stores it in R2. | `SOURCE` |
| One actual generation artifact | `RECON/live-generation.json` contains a 1920×1080, 10-second Canvas document and 4-entry storyboard. Parent's recorded run: 72 seconds for one APIMart generation, exported H.264 MP4, 5,380,655 bytes. | `SOURCE` for the saved document; observed result is one sample, not a performance guarantee. |

## What the public reference does not establish

The original site's public UI does not reveal its model/provider, prompt construction, segmentation method, generation backend, render service, storage provider, or actual cost (`GUESS` if speculated). This clone uses the implementation described above; that is evidence about this repository only and must not be projected onto Tellcut.

The clone's prompt and code explicitly preserve reference image pixels and allow movement, scale, rotation, masks and rectangular crops. There is no automated subject segmentation or separate extracted subject layer (`SOURCE`: `worker/ai.ts`). Music presets, audio uploads and APIMart AI narration are implemented separately in the parent page (`src/lib/audio-engine.ts`, `worker/audio.ts`). One uploaded image-to-video success proves neither repeatable output quality nor broad input compatibility.

## Claims cross-check

| Claim that could be repeated from a second-hand analysis | Check |
|---|---|
| “The clone uses the same backend as Tellcut.” | Unsupported. This project's APIMart/Cloudflare path is visible in its code; no original backend evidence was obtained. |
| “Tellcut automatically cuts a subject out into layers.” | Not established from public observations. This project does not offer automatic subject segmentation. |
| “The demo proves all templates produce distinct videos.” | False. The verified output is one orbit sample only; templates are prompts/UI presets. |
| “Video export happens on the server.” | False for this implementation. Browser frames are encoded locally, then the MP4 is uploaded to R2. |
| “A particular latency, price, revenue, traffic, or user count is established.” | Not established. A single approximately 72-second provider run is not an SLA or business metric. |

## Transferable product method

The useful product pattern is a constrained, inspectable loop: collect structured format options and a brief; attach optional references; create an idempotent job with visible status and usage cost; preserve every output as a version; let the user refine either the whole version or a selected shot; then preview and export with explicit browser capability checks. It keeps creative iteration legible and avoids presenting a generic image generation as a finished editable video.

## Tellcut audio spot check — 2026-10-18

Downloaded and inspected four publicly served official MP4 files with ffprobe: `/demo/studio-demo.mp4` (23.8 s), `/scenarios/launch.mp4` (15 s), `/scenarios/game.mp4` (10 s), and `/scenarios/showreel.mp4` (15 s). Each contained one H.264 video stream and no audio stream. The public Studio example exposed no audio controls at inspection time. This does not establish every paid export is silent. The homepage Examples collection explicitly credits external Claude users; its music-related examples are not evidence of Tellcut built-in audio generation.
