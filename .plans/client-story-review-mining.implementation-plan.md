# Client Story Review Mining — Implementation Plan

Status: **implemented, ON HOLD pending verified-GBP access** (2026-07-10). All 7 phases shipped and
deployed to staging — schema, discovery route, onboarding UI, browser capture + vision
transcription, fingerprinting, triage prompt, story selection/pipeline injection, spider job +
narrow auto-generate cron, and the generation gate on `POST /content-plan/generate`. Live testing
proved the full chain works mechanically end-to-end, but **review-capture yield is unreliable**
(Google anti-scraping) and a **GHL-based ingestion pivot** was investigated the same day that may
replace the scraper. See **"Post-implementation: live testing, fixes & the GHL pivot"** at the
bottom of this doc — that section is the pick-up-here guide for finishing this feature.

## Goal

Automatically source real, de-identified client stories from a business's Google reviews and feed
them into the article pipeline's existing `{{real_case_studies}}` slot — so articles ground their
case-study sections in real client outcomes instead of the LLM's generalized fallback, with zero
manual work from the client after one-time onboarding confirmation.

## Decisions locked (2026-07-10 discussion)

1. **Discovery**: at onboarding, auto-find the business's Google Business Profile from its name +
   website, present it for confirmation (or manual entry as a fallback) — **imperative at
   onboarding**, not optional. The confirmed URL is stored in the *existing*
   `BrandSettings.googleBusinessProfileUrl` field — no new field for this.
2. **Legal framing**: Google reviews are Google's third-party data, not the practice's own
   testimonials — the practice isn't liable for republishing what Google publishes. That said, we
   **must** reframe every extracted story as a nameless, star-less narrative case example, never
   as a quoted testimonial. This reframing is a product-quality decision independent of the legal
   reasoning.
3. **No per-story human review** — clients review stories in the context of finished articles
   (their existing review step), not as a separate story-approval queue. De-identification is the
   only safeguard, enforced entirely in the extraction prompt.
4. **Usage cap**: each story used **at most once a month**. If a business doesn't have enough
   usable stories yet, that's a signal to push their GHL review-collection cadence (separate,
   already-planned initiative) — not a reason to relax the cap.
5. **Cadence: once a month, not twice** — triggered as **the first thing after payment clears,
   before any content is generated for the new cycle.** Since real billing doesn't exist yet, this
   maps directly onto the existing `Account.subscriptionStartedAt` billing-cycle infrastructure
   (`billingWindows()`, see `.plans/content-plan-billing-window.implementation-plan.md`) — a cycle
   rollover *is* "payment clears" for this purpose, exactly as it already is for Content Plan
   windowing. No new billing concept needed.
6. **Scraping tool**: Oxylabs was tested live against staging credentials — its dedicated
   `google_maps` source rejects `parse=true`, returns only the JS app shell unparsed, and
   `universal + render:html` rejects Maps URLs outright ("Provided url is not supported"). Its
   `google_search` source, however, cleanly returns a parsed knowledge panel (website, address,
   description) — proven live. **Conclusion: Oxylabs handles discovery; it cannot render Maps
   reviews.** Reviews require our own headless-browser navigation, routed through Oxylabs'
   *residential proxy* (separately confirmed configured on staging) to avoid datacenter-IP
   blocking — the browser we already run in the worker for diagram/cover rendering, not a new
   dependency.
7. **Capture method: full-page screenshots + vision-LLM transcription**, not DOM scraping. Chosen
   over DOM extraction specifically because Google's Maps CSS classes are obfuscated and rotate —
   confirmed empirically during the spike (raw HTML scrape returned CSS/style fragments, not
   review text). Vision transcription reads rendered text regardless of markup, and doubles as the
   only way to read star ratings (a visual signal, not text).
8. **Vision provider: OpenAI (GPT-5.4-mini), not Gemini**, for this specific task — decided after
   comparing both current pricing and OCR-benchmark standing. Cost is a non-issue either way
   (fractions of a cent per monthly run for either provider); GPT-5.4-mini's multi-pass
   re-evaluation is architecturally suited to dense, variable-legibility screenshot text, and
   Gemini's document-OCR benchmark strength is concentrated in its Pro tier, not the cheap
   Flash-Lite tier this task would actually use. Neither adapter has vision support today — this
   is new plumbing regardless of provider, so there's no implementation-cost tiebreaker.
9. **New-review detection: content fingerprint, not date tracking.** Google only exposes *relative*
   dates ("2 weeks ago") which drift between runs and can't serve as a stable cursor. Instead:
   hash `(reviewer name + review text)` per transcribed review; anything with a fingerprint we've
   already stored for that account is silently dropped before it reaches triage. This also answers
   "which reviews to capture" — capture the same bounded top-N (sorted Newest) every run
   unconditionally; dedup happens *after* transcription, since we can't know if a review is new
   before we've read its text.
10. **Real gate, article-scoped — revised 2026-07-10.** Story-spidering must genuinely finish
    *before* article generation for the new cycle starts (client stories only ever feed
    `Topic.realCaseStudies`, so this never needs to concern newsletter-only generation). Rejected
    with a clear, actionable message, not silently blocked open — see Phase 6.
11. **Two trigger paths, not a single always-on cron — revised 2026-07-10.** An earlier draft of
    this plan proposed a 15-minute cron checking *every* subscribed account for a cycle rollover.
    Superseded: that wastes spidering on accounts that won't touch content generation for days,
    *and* has a latent race — if a user manually generates before the cron has ticked, nothing has
    actually started a run yet for the gate to wait on. Replaced with:
    - **Standing preference** (Settings page, not the dashboard): a toggle labeled **"Auto-generate
      next month's content plan."** Unlike a one-time-per-cycle opt-in, this is a genuine
      "auto-renew"-style setting — flip it once, it applies to every future cycle until turned off
      (`Settings.autoGenerateNextCycle`, default `false`, mirrors the existing
      `socialAutomationEnabled` field's convention). When on: the moment a new billing cycle rolls
      over, spidering happens automatically, and once it completes the **entire new cycle's content
      generates automatically too** — no login required that month at all.
    - **On-demand fallback** for everyone else (the default): nothing proactive happens. The first
      article-containing `POST /content-plan/generate` call in a new cycle is itself what creates
      the spider run and enqueues the job — the trigger and the gate are the same code path, so
      there's no longer a window where the gate can block without anything having been started.
    - Both paths converge on the same underlying spider job. The **only** thing that differs is
      what happens after it completes: for a flagged account, completion chains directly into a
      full-cycle batch generation (the exact same `createBatchFromDates` + `advanceBatch` calls the
      manual "Generate selected" button already uses, just for every date in the new production
      window); for everyone else, completion just means the next retried generate call goes
      through normally. See Phases 5-6 for the mechanics.

## Current-state facts this builds on

- **`Topic.realCaseStudies`** (`packages/db/prisma/schema.prisma:490-511`) is already a first-class
  pipeline input, consumed by `variable-resolver.ts`'s `real_case_studies` case
  (`apps/api/src/article-pipeline/variable-resolver.ts:311-317`) and referenced directly in article
  prompts (`packages/db/prisma/seed.ts` — outline/writer/facts steps), which already handle absence
  gracefully ("If `{{real_case_studies}}` is empty, write a generalised illustrative example").
  **This plan only needs to populate this field automatically when the user hasn't** — no prompt
  changes required.
- **`BrandSettings`** already has `organizationName`, `organizationWebsite`, `geolocation`, and
  `googleBusinessProfileUrl` (currently used for JSON-LD `sameAs`/`hasMap` output) — the discovery
  step reuses all four, and confirmation writes into the existing URL field.
- **Oxylabs `google_search` source** (`apps/api/src/newsletter/oxylabs.ts:133-`, pattern already
  proven for newsletter teaser sourcing) returns a parsed knowledge panel including a `factoids`
  array with the business's website — the exact signal needed to auto-match and confirm.
- **Headless Chromium is already provisioned and pooled** in the worker
  (`apps/api/src/article-pipeline/enrichment/diagram-browser-pool.ts`, `puppeteer-core`,
  `/usr/bin/chromium-browser` baked into `apps/api/Dockerfile`) — used today for diagram
  rasterization, SVG rendering, and newsletter covers. This plan needs a **separate** pool/launch
  path (not the shared diagram pool) so a hung external Maps navigation can't wedge trusted
  local-file rendering.
- **Oxylabs residential proxy creds are configured** (`getOxylabsProxyAuth()` in
  `apps/api/src/lib/oxylabs-auth.ts`, confirmed live on staging during the spike) and already used
  by `proxyFetch()` for plain `fetch()` calls via `ProxyAgent`. Puppeteer needs the same
  credentials wired differently — `--proxy-server=http://<host>` launch arg (host resolved the
  same way `buildProxyUrl()` does, via `OXYLABS_PROXY_HOST`/`DEFAULT_PROXY_HOST`) plus
  `page.authenticate({ username, password })` after opening the page, since Chromium ignores
  embedded credentials in `--proxy-server`.
- **Neither the OpenAI nor Gemini adapter accepts image input today** (confirmed via grep — zero
  `inlineData`/vision call sites anywhere). `LLMCallOptions`
  (`apps/api/src/article-pipeline/llm/adapter.ts`) needs a new optional `images` field, wired only
  into `OpenAIAdapter.call()` for this plan (Gemini/Anthropic vision support is a future extension,
  not needed here — nothing else in the codebase currently needs image input).
- **`Account.subscriptionStartedAt` + `billingWindows()`**
  (`apps/api/src/article-pipeline/billing-window.ts`) already compute the current cycle's start
  date purely from date math — no renewal webhook exists or is needed. This plan is the **first
  real consumer of "detect a cycle rollover"**, a capability the billing-window plan explicitly
  scoped out ("auto-triggering generation... out of scope now, no implementation... a daily cron
  comparing `now` against each account's computed window" — that's exactly Phase 5 below, just
  triggering review-spidering instead of content generation).
- **Cron scheduling convention**: `apps/api/src/worker.ts` registers scheduled jobs via
  `boss.schedule(QUEUES.X, cronExpr, {})` (e.g. `PUBLISH_SCHEDULED` every minute,
  `ANALYTICS_SYNC` daily at 02:00 UTC) — this plan's cycle-rollover check follows the same pattern.
- **Article pipeline entry point**: `articlePipelineHandler` →
  `runPipelinePhaseA(jobId)` (`apps/api/src/article-pipeline/executor.ts`) is the single call made
  before any pipeline step runs — the exact analog to how the newsletter override plan's
  `ensureTopicDraft` hooks in before `ensureTopicResearch`.

## Data model (new)

```prisma
model ClientStory {
  id             String   @id @default(cuid())
  accountId      String
  account        Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  storyText      String   @db.Text // de-identified narrative — no names, no stars, no "a reviewer wrote"
  topicTags      String[] // 2-4 keywords from triage, used for topic-matching at generation time
  sourceReviewId String   @unique
  sourceReview   RawReview @relation(fields: [sourceReviewId], references: [id], onDelete: Cascade)
  lastUsedAt     DateTime? // null = never used; gates the once-a-month cap
  useCount       Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([accountId, lastUsedAt])
  @@map("client_stories")
}

// Every uniquely-fingerprinted review ever transcribed, story or not — lets triage be re-run
// later (e.g. a better prompt) without re-scraping.
model RawReview {
  id            String   @id @default(cuid())
  accountId     String
  account       Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  fingerprint   String   // sha256(normalize(reviewerName) + '|' + normalize(reviewText))
  reviewText    String   @db.Text
  starRating    Int?
  relativeDate  String?  // "2 weeks ago" — logging/debugging only, never a cursor
  triageStatus  String   @default("pending") // pending | story | not_story
  clientStory   ClientStory?
  capturedAt    DateTime @default(now())

  @@unique([accountId, fingerprint])
  @@map("raw_reviews")
}
```

A third model tracks each cycle's spider run explicitly — needed for idempotent dedup on the
rollover cron *and* as the queryable signal the generation gate (Phase 6) checks:

```prisma
model ClientStorySpiderRun {
  id          String    @id @default(cuid())
  accountId   String
  account     Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  cycleStart  DateTime  // billingWindows().from for the cycle this run is for
  status      String    @default("running") // running | completed | failed
  startedAt   DateTime  @default(now())
  completedAt DateTime?

  @@unique([accountId, cycleStart]) // idempotent dedup key for the rollover cron
  @@map("client_story_spider_runs")
}
```

(`Account.lastReviewSpiderCycleStart` from the earlier draft of this plan is dropped —
`ClientStorySpiderRun` supersedes it with a real per-cycle record instead of a single scalar.)

`Settings` gains one field, mirroring the existing `socialAutomationEnabled` convention
(`packages/db/prisma/schema.prisma:320`):

```prisma
// Standing preference: when true, a new billing cycle's content generates automatically once
// review-spidering completes (Phase 5/6). Default false — most accounts stay fully manual.
autoGenerateNextCycle Boolean @default(false)
```

## Phase 1 — Onboarding discovery + confirmation

- New endpoint, e.g. `POST /api/brand-settings/discover-gbp` — takes the account's
  `organizationName` + `geolocation` (already collected earlier in onboarding), runs Oxylabs
  `google_search` for `"{name} {geolocation}"`, extracts the knowledge panel's website factoid,
  fuzzy-matches its registrable domain against `organizationWebsite`.
- Response: a candidate (name, address snippet, resolved website) for the onboarding UI to show as
  "Is this your business?" with **Confirm** / **Enter manually** actions. Manual entry accepts a
  raw Maps URL or share link directly.
- On confirm: `PATCH BrandSettings.googleBusinessProfileUrl` (existing field, no schema change).
  This step never touches reviews — it only resolves and stores the place identity.
- Onboarding flow placement (which existing settings/setup step this slots into) is an
  implementation-time call — not architecturally significant.

## Phase 2 — Review capture (screenshot + vision transcription)

- New module, e.g. `apps/api/src/article-pipeline/client-stories/capture.ts`.
- **Resolve the stored URL to a canonical Maps place URL** first (short `maps.app.goo.gl` links
  redirect to the full `google.com/maps/place/...` URL — confirmed via the spike; a plain
  `fetch(url, { redirect: 'manual' })` reading the `Location` header is enough, no proxy needed for
  this step since it's just following a redirect, not scraping content).
- **New, separate browser pool** (not `diagram-browser-pool.ts`): launch Chromium with
  `--proxy-server=http://<OXYLABS_PROXY_HOST>`, then `page.authenticate({ username, password })`
  from `getOxylabsProxyAuth()`. One fresh browser per spidered account (closed after), not a
  long-lived singleton — bounds resource use during the cron's sequential per-account run and lets
  the proxy's session naturally rotate per account.
- Navigate to the place URL, open the reviews panel, click **Sort → Newest** by visible
  text/`aria-label` (not CSS class — same fragility reasoning that ruled out DOM scraping in the
  first place: labels are far more stable than Google's rotating class names).
- Scroll the reviews panel in increments, screenshotting the panel's clip region after each
  increment (waiting for lazy-loaded content between scrolls), until either ~20-25 reviews' worth
  of scroll distance is covered or `scrollHeight` stops growing (end of all reviews) — whichever
  first. Typically 5-8 screenshots.
- **One multimodal call to GPT-5.4-mini** with all screenshots + a structured-output prompt:
  transcribe each visually-distinct review (reviewer first name/initial, star count — visually
  counted, not read as text, full review text, relative date), and explicitly instruct the model to
  **dedupe reviews appearing in the overlap between consecutive screenshots** (scrolling always
  re-shows a few rows for visual continuity).
- Requires the `LLMCallOptions.images` + `OpenAIAdapter` extension noted above.

## Phase 3 — Fingerprint + persist

- For each transcribed review: `fingerprint = sha256(normalize(name) + '|' + normalize(text))`
  (normalize = lowercase, collapse whitespace, strip punctuation variance).
- Upsert-by-uniqueness into `RawReview` (`@@unique([accountId, fingerprint])`) — reviews whose
  fingerprint already exists for this account are silently skipped (no-op), which is the entire
  "detect new reviews" mechanism; no separate tracking needed.
- Newly-inserted rows are left `triageStatus: 'pending'` for Phase 4 to pick up.

## Phase 4 — Triage + de-identified extraction

- New prompt pair in the existing DB-backed `PromptTemplate` registry, string-keyed like the
  newsletter `nl_*` prompts (this isn't newsletter-specific, so a new prefix — proposed
  `cs_story_triage`, `stepNumber` in a fresh 400+ range to avoid colliding with enrichment's 100s,
  social's 200s, and newsletter's 300+). Text-only (no vision needed here) — cheapest available
  text model is fine (e.g. `gemini-3.1-flash-lite`, consistent with the rest of the codebase's cost
  posture); this is a separate, cheaper step from Phase 2's vision call.
- Per pending `RawReview`: **is this a specific client story** (a described problem → treatment →
  outcome), or generic praise ("great service, 5 stars")? If yes: rewrite as a short de-identified
  narrative — no names, no star/rating mentions, no "a reviewer said" framing, outcome language
  softened (no cure/guarantee claims) — plus 2-4 topic tags (e.g. "lower back pain", "pediatric",
  "sports injury") for Phase 7's matching. If no: discard (still marked, not re-processed).
- On yes: create the `ClientStory` row, link `RawReview.clientStory`, set `triageStatus: 'story'`.
- On no: set `triageStatus: 'not_story'`. Both outcomes are terminal — a `RawReview` is only ever
  triaged once (re-running triage on already-classified rows is a manual/future operation, not
  part of the automated flow).

## Phase 5 — The spider job, and the narrow auto-generate cron

**The job** (`QUEUES.CLIENT_STORY_SPIDER`, carries `{ accountId, clientStorySpiderRunId }`) is the
one thing both trigger paths (this phase's cron, and Phase 6's on-demand path) ever enqueue. It
runs Phases 2-4 (capture → fingerprint → triage) sequentially, sets the owning `ClientStorySpiderRun`
to `status: 'completed'` (or `'failed'` after exhausted retries), and — regardless of which path
triggered it — **checks the account owner's `Settings.autoGenerateNextCycle` on completion**. If
true: resolve every date in the new cycle's production window that has planned content (article or
newsletter primary present — the same set a user would get selecting everything under "This Cycle
— Ready to Produce"), call `createBatchFromDates(account, dates)` then `advanceBatch(batchId)` — the
exact functions the manual "Generate selected" button already calls
(`apps/api/src/article-pipeline/content-batch.ts`). If false (the default): no-op — the run's
existence and `completed` status is itself the signal Phase 6's gate is waiting on.

This single completion-check is what unifies the two trigger paths: it doesn't matter whether the
run was created by the cron below (flagged account, zero user interaction) or by a manual user's
own early click while *also* having the flag on (edge case) — either way, completion always
produces the correct outcome for that account's actual preference.

**The cron** (`boss.schedule(QUEUES.CLIENT_STORY_AUTO_GENERATE_CHECK, '*/15 * * * *', {})`, every 15
minutes — tight enough that "as soon as the new monthly payment clears" holds until real Stripe
webhooks exist) is now **scoped only to accounts with `autoGenerateNextCycle: true`** — a much
smaller working set than every subscriber, since most accounts stay on the on-demand path and this
cron does nothing for them at all. For each flagged account with a confirmed
`googleBusinessProfileUrl`: compute `billingWindows(subscriptionStartedAt, now).from`, try to
`create` a `ClientStorySpiderRun` for `(accountId, cycleStart)` (the `@@unique` constraint makes
this the idempotent dedup key — a re-tick within the same cycle is a harmless no-op), and on
successful creation enqueue the spider job.

## Phase 6 — Generation gate (article-scoped, self-triggering)

- `POST /content-plan/generate` (`apps/api/src/routes/content-plan.ts`) gains a check *before* the
  existing `executableUntil` production gate — but **only when the requested `dates` include at
  least one date whose resolved primary is an article** (client stories never touch newsletters, so
  a newsletter-only batch is never delayed by this at all). If the account has no confirmed
  `googleBusinessProfileUrl`, skip the check entirely regardless of batch contents.
- Otherwise, look up the `ClientStorySpiderRun` for the account's current `billingWindows().from`:
  - **No run exists yet** — this is the on-demand trigger: create one and enqueue the spider job
    right here (the same job Phase 5 defines), then reject with a clear, actionable message
    ("Client stories are being refreshed for this billing cycle — this usually takes a few minutes;
    try again shortly"). No cron dependency — this request *is* what starts the clock.
  - **`running`, within the 1-hour safety-valve window**: reject with the same message (don't
    re-create — one run per cycle). The dashboard can use the same signal (a new
    `storySpiderStatus` field on `GET /content-plan`'s response: `'completed' | 'running' |
    'not_configured'`) to disable the Generate button proactively instead of letting the user hit
    the rejection.
  - **`running` past the 1-hour mark, `failed`, or `completed`**: allow generation to proceed
    (Phase 7 uses best-available stories regardless of freshness). The 1-hour ceiling isn't the
    expected runtime — it's a generous worst-case failsafe so a scraper hiccup can never
    indefinitely block a paying client's articles, whether they're generating manually or (per
    Phase 5) about to be auto-generated for them.
- A newsletter-only batch, even though it skips the gate/reject logic, is still free to
  opportunistically create-and-enqueue a run if none exists — harmless, and gets spidering started
  slightly earlier for whichever request happens to hit the account first that cycle. Implementation
  detail, not required for correctness.

## Phase 7 — Selection + injection at generation time

- Hook into `runPipelinePhaseA(jobId)` (`apps/api/src/article-pipeline/executor.ts`), at the very
  start, before step 0 — mirrors exactly how the newsletter override plan's `ensureTopicDraft`
  hooks in before `ensureTopicResearch`.
- If `topic.realCaseStudies` is already set (user-typed or CSV-imported): do nothing, ever — never
  overwrite a user-provided value.
- If empty: query the account's `ClientStory` bank for candidates where `lastUsedAt` is null or
  `< now - 30 days` (the once-a-month cap). Score candidates by keyword/tag overlap between
  `topicTags` and the article's topic string (simple overlap scoring — no embeddings needed at
  realistic bank sizes of a few dozen stories). Pick the best match; if nothing scores reasonably,
  leave `realCaseStudies` empty (the prompts' existing graceful fallback handles this — a forced
  weak match would be worse than the LLM's generalized illustrative example).
- On pick: write `storyText` into `topic.realCaseStudies`, bump `lastUsedAt = now()`,
  `useCount += 1`.

## Touch list (files)

- `packages/db/prisma/schema.prisma` + migration — `ClientStory`, `RawReview`,
  `ClientStorySpiderRun`, `Settings.autoGenerateNextCycle`.
- `apps/api/src/article-pipeline/llm/adapter.ts` — `LLMCallOptions.images`.
- `apps/api/src/article-pipeline/llm/openai.ts` — vision message construction.
- `apps/api/src/article-pipeline/client-stories/capture.ts` — new, browser launch + proxy +
  scroll/screenshot + vision transcription call.
- `apps/api/src/article-pipeline/client-stories/fingerprint.ts` — new, hash + persist.
- `apps/api/src/article-pipeline/client-stories/triage.ts` — new, LLM triage + `ClientStory`
  creation.
- `apps/api/src/article-pipeline/client-stories/select.ts` — new, Phase 7 matching/injection.
- `apps/api/src/article-pipeline/executor.ts` — call the Phase 7 selector at the top of
  `runPipelinePhaseA`.
- `apps/api/src/handlers/client-story-spider.ts` (or similar) — new, the Phase 5 job handler:
  runs Phases 2-4, then the `autoGenerateNextCycle` completion-check that chains into
  `createBatchFromDates` + `advanceBatch` for the whole new cycle when true.
- `apps/api/src/routes/content-plan.ts` — Phase 6 gate on `POST /content-plan/generate`
  (article-scoped, self-triggering) + `storySpiderStatus` on `GET /content-plan`.
- `apps/api/src/routes/settings.ts` (wherever `Settings` PATCH lives) — the
  `autoGenerateNextCycle` toggle endpoint.
- `apps/api/src/routes/brand-settings.ts` (or wherever `BrandSettings` PATCH lives) — Phase 1
  discovery endpoint.
- `apps/api/src/queues/index.ts` + `apps/api/src/worker.ts` — `CLIENT_STORY_AUTO_GENERATE_CHECK`
  (every-15-minutes cron, scoped to `autoGenerateNextCycle: true` accounts only) +
  `CLIENT_STORY_SPIDER` (the shared per-account job, enqueued by either that cron or the Phase 6
  on-demand path) queues.
- `apps/web` onboarding flow — the "Is this your business?" confirmation step (exact page TBD at
  implementation time).
- `apps/web/src/app/(protected)/settings` (or equivalent) — the **"Auto-generate next month's
  content plan"** toggle.
- `apps/web/src/features/dashboard/ContentPlan.tsx` (or equivalent) — surface `storySpiderStatus`
  so the Generate button/bar can show "Refreshing client stories…" instead of only relying on the
  backend rejection.
- `packages/db/prisma/newsletter-prompts.ts`-equivalent or a new
  `packages/db/prisma/client-story-prompts.ts` — the `cs_story_triage` prompt, seeded the same way
  (`seed.ts` for prod, a targeted staging seed script since staging doesn't run full `seed.ts`).

## Risks / open details for implementation time

- **Selector fragility for the Sort→Newest click** — text/`aria-label` targeting is far more
  stable than CSS classes, but Google can still change label text/locale phrasing. Worth a health
  check (log + alert, not silent failure) if the sort click can't be found, falling back to
  default-sort capture rather than failing the whole run.
- **Screenshot batching size** — 5-8 images per vision call is an estimate; needs tuning against
  real captures (how many reviews actually load per scroll increment varies).
- **Gate UX for manual generation** — a hard rejection is a worse experience than a disabled button
  with a live countdown/status. Phase 6's `storySpiderStatus` field is meant to let the frontend
  preempt the rejection, but the backend check must still be authoritative (never trust the
  frontend alone to have disabled the button — same principle already applied to the
  `executableUntil` production gate).
- **Multi-location businesses** — a chain with several GBP listings needs the discovery step to
  surface multiple candidates, not assume one. Out of scope for a single-clinic MVP but worth
  flagging if any client has multiple locations.
- **Empty-bank cold start** — a brand-new client's first cycle has zero stories (nothing spidered
  yet before their first article generates, and the gate has nothing to wait for since no run
  exists on their very first onboarding day — only *subsequent* cycles have a real run to gate on).
  Acceptable — the prompts' existing empty-fallback handles it identically to today's default
  behavior; the bank fills in over subsequent cycles.
- **Auto-generate has a bigger blast radius than a bare spider run.** For a flagged account, the
  1-hour safety-valve isn't just "generate one article with maybe-stale stories" — it's "generate
  an entire month of content automatically, unattended, on a schedule the client never explicitly
  confirmed that day." Worth confirming at implementation time whether that's genuinely fine (it
  matches the point of the feature — full autopilot, no login required) or whether a failed/timed-
  out spider run should make the completion-check skip auto-generation for that cycle entirely
  (falling back to requiring a manual click) rather than proceeding with degraded story matching
  for a whole cycle's worth of articles.
- **Admin visibility** — not planned as a phase, but a minimal admin list view (read + soft-delete
  a bad `ClientStory`, plus visibility into `ClientStorySpiderRun` status/timing for support
  debugging) would be cheap to add later using the same pattern as `/admin/prompts` or
  `/admin/music`, if QA/support visibility into triage quality or gate timing turns out to be
  needed.

---

## Post-implementation: live testing, fixes & the GHL pivot (2026-07-10)

> **⏸️ PICK UP HERE.** This feature is implemented and deployed to staging but is ON HOLD. The
> blocker: finishing requires access to a **verified Google Business Profile** (owner or manager)
> — none was available on 2026-07-10 (Coast Chiropractic Kawana was only a content-testing
> subject, not ours; the user's own GBP is unverified, and GHL refuses unverified profiles).
> Resume checklist at the bottom of this section.

### What live testing proved (staging, real listing: Coast Chiropractic Kawana, ~97 reviews)

The full chain works mechanically end-to-end, triggered through the real production code path
(`checkArticleGenerationGate` → run row → pg-boss job → worker):
navigate via Oxylabs residential proxy → screenshot → vision-transcribe (OpenAI) →
fingerprint/persist → triage (Gemini) → run `completed`. The triage LLM also demonstrated the
intended safety behavior: given a truncated review fragment, it declined to fabricate a story
(`not_story`) instead of inventing one.

### Bugs found & fixed during live testing (all deployed to staging, SHA-verified)

| Commit | Fix |
|---|---|
| `a86fce3` | `OpenAIAdapter` sent legacy `max_tokens`; `gpt-5.4-mini` requires `max_completion_tokens` (400 error killed the first run) |
| `11dd2f8` | Force `hl=en` (URL + Accept-Language) — proxy exit IPs made Google render in random locales, silently breaking every text-based selector; click into the actual Reviews tab; click "More" to expand truncated reviews; scroll-height check moved after the lazy-load wait (screenshot yield 1 → 3 immediately) |
| `7c6dadd` | Dismiss `consent.google.com` interstitial — EU/EEA proxy exits redirect the whole navigation there (observed `gl=HR`); neither Reviews tab nor Sort exists on that page |
| `29b7fb9` | Retry with a fresh proxy session (up to 3) when the reviews UI is absent — Google intermittently serves a **stripped page variant** (Overview/About only, no reviews at all) on the same listing; confirmed not a hydration race (persists past 9.5 s), most likely anti-scraping tied to proxy-IP reputation |

### What remains UNPROVEN about the scraper

- Capture yield: across ~6 live runs, the full reviews UI appeared exactly **once**. The
  fresh-session retry fired correctly but all 3 attempts still hit the stripped variant in the last
  test. Confound: the test hammered one listing with dozens of requests in ~20 minutes, which a
  real monthly cadence never would — the target may have been self-poisoned. Needs a clean re-test
  after a cooldown, or against a different listing.
- `expandTruncatedReviews` ("More" click) — implemented but never exercised against a page that
  actually had visible reviews.

### The GHL pivot (investigated same day — likely replaces the scraper)

Findings, all verified against the official `GoHighLevel/highlevel-api-docs` repo + live API calls:

1. **No pull API for reputation reviews exists** in GHL's public API (v2 or v3) — the only
   "reviews" endpoints/scopes are e-commerce product reviews. Publishing Omniply as a GHL
   marketplace app does NOT help: the complete official app-webhook event list (58 events) has no
   review event either.
2. **Workflow trigger "Review Received"** (Google + FB; filterable by source/rating/spam) →
   outbound **Webhook action** POSTs each new review to any URL. Location-side config → ship it in
   the **agency snapshot** so every client location is armed automatically before GBP ever
   connects.
3. **Conversations API has a documented `TYPE_REVIEW` message type**:
   `GET /conversations/search?locationId=…&lastMessageType=TYPE_REVIEW` +
   `GET /conversations/{id}/messages` (`body` = review text, `dateAdded` = real timestamp, untyped
   `meta` may carry rating/reviewer). Verified live with our stored PIT credentials against dev
   location `nTr8IulThJiXAzJXmy9N`: 200 OK, `total: 0` — zero only because that location has never
   had a GBP connected. Requires `conversations.readonly` / `conversations/message.readonly`
   scopes on the Private Integration.
4. **THE open question (load-bearing for backfill):** when a GBP is first connected, GHL imports
   the existing reviews into Reputation — but does that initial import (a) fire the Review
   Received trigger, and/or (b) create TYPE_REVIEW conversations? Undocumented. Prior: the trigger
   is suppressed on backfill (otherwise auto-reply automations would blast years-old reviews — no
   such community complaints exist). If (b) is true, backfill becomes a simple documented API pull
   and the scraper can be deleted outright.

### Resume checklist (when a verified GBP is available)

1. In the target GHL location, create the test workflow **before** connecting GBP: trigger
   "Review Received" (NO filters) → action "Webhook" (plain, not Custom) → POST to a fresh
   capture URL (webhook.site token expires ~7 days — make a new one). **Publish** it (not Draft).
2. Connect the GBP: sub-account → Settings → Integrations → Google Business Profile (needs
   owner/manager Google account, verified listing).
3. Observe three things: (a) does the webhook fire for the imported historical reviews; (b) does
   Reputation → Reviews populate (confirms import happened); (c) re-run the Conversations probe —
   `GET /conversations/search?lastMessageType=TYPE_REVIEW` with the location's PIT (one-liner via
   `getGhlCredentials` in the staging api container; see memory/session 2026-07-10).
4. Decide per the outcome matrix: historical reviews pullable via Conversations API → **retire the
   scraper entirely** and switch cycle-start ingestion to an API pull; only new reviews flow → keep
   scraper as one-time onboarding backfill, webhook/API for ongoing; neither works → scraper stays,
   as built today.
5. Either way: add the Review Received → Omniply webhook workflow to the **client snapshot**, and
   build the receiving endpoint (`POST /api/ghl/review-webhook` or similar, mapping locationId →
   account, feeding the existing fingerprint → triage → story pipeline — everything downstream of
   capture stays unchanged).
6. Optional parallels: ask HighLevel support the backfill question directly; verify the user's own
   GBP as a permanent test rig (starts at 0 reviews — tests new-review flow only, not backfill).

Test rig state as of 2026-07-10: a Review Received → webhook workflow may already exist (inert) in
the dev GHL location; the webhook.site URL from that day is expired — regenerate.

## P3 backlog (added 2026-09-07): manual review entry on the Settings page

User-approved idea (discussion 2026-09-07); build post-launch. Healthgrades/Yelp/etc.
scraping explicitly REJECTED (ToS/evasion posture contradicts the compliance brand;
Oxylabs proxy capability exists but is not to be used for review scraping).

- Settings-page section where the client pastes reviews from ANY source
  (Google / Healthgrades / Yelp / Facebook / other) → `source: 'manual'` into the
  existing ingest funnel (lib/google/review-ingest.ts: normalize → fingerprint →
  RawReview upsert → story triage). Everything downstream unchanged; dedup vs
  scraped/webhook arrivals is free.
- v1 scope: one-review-at-a-time form — source dropdown, review text, optional
  reviewer first name + star rating. NO bulk-paste LLM splitting in v1.
- REQUIRED: authenticity attestation checkbox per submission ("This is a genuine
  review my practice actually received") — FTC fake-reviews rule; store the
  attestation + source label on the RawReview (same pattern as onboarding's
  "I wrote this" authorship gate).
- Also render the reviews ALREADY in the funnel (scraped + webhook + manual) in the
  same section — turns the paste box into a small reputation dashboard so clients
  see what story mining has to work with. Exact scope worth a discussion at build
  time (user: "worth a discussion when we get to it").
