# Pre-Launch Todos

Living checklist of everything deliberately deferred to the launch window.
Created 2026-07-31 (≈5 weeks out: walkthrough → snapshot → rehearsal purchase →
freeze week → vacation → launch). Check items off as they land; don't delete them.

## 1. Database / infrastructure (defer ≈1–2 weeks before launch — before the rehearsal purchase)

- [ ] **Upsize the DO Postgres cluster (B4).** Current node: 1 GB → `max_connections = 25`,
  shared by prod + staging + Vercel webs + DO system workers (~8 slots). We hit the cap
  2026-07-30 (Sentry `dbe546db…`, "connection slots reserved for SUPERUSER").
  Recommendation: **4 GB node (~97 connections)**; 2 GB (~47) is the minimum acceptable.
  Resize in the DO dashboard; brief failover, no data migration. Do it on a quiet day,
  check for in-flight jobs first (see `staging-deploy-inflight-check` runbook).
- [ ] **Add a DO connection pool (PgBouncer) for staging** — staging connects DIRECT
  (port 25060, db `socioply_staging`); prod already routes through the `socioply-pool`
  pool (port 25061). Create the staging pool in the DO dashboard, point the staging
  droplet `DATABASE_URL` at it.
- [ ] **Vercel web → pool ("Option B" from the staging-web incident).** Staging web's
  direct-Prisma server components read the PROD DB with `connection_limit=1` (Option A
  band-aid). Point both Vercel projects' `DATABASE_URL`s at DO pools so serverless
  bursts can't eat droplet slots.
- [ ] Re-check connection headroom after the upsize: run the `pg_stat_activity` group-by
  (see §Appendix) and confirm idle baseline ≤ ~50% of `max_connections`.

Done already (2026-07-31, context for the above): prod `PGBOSS_MAX_CONNECTIONS` 8→3,
prod Prisma `connection_limit=4&pool_timeout=20`; staging was already at 2/2;
`SENTRY_ENVIRONMENT` now set on both droplets so staging errors stop paging as
production (env backup: `/opt/socioply/.env.production.bak-20260731`).

## 1b. Chat agent + Azavea (added 2026-08-06)

- [ ] **C3 red-team — THE clinic-widget gate.** Suite must cover the rules locked in
  testing: refusal under rephrasing, insurance boundaries, free-assessment terms,
  dash-free output, KB-edit propagation, known-details memory + claim-possession
  probes ("what's my number?"), multi-action contact convergence with mid-flow
  detail changes, delivery-promise-without-attached-action. Precedes any clinic
  widget install; the week of varied user testing + the new test-practice
  onboarding (good KB) feeds it.
- [x] **Confirm the Azavea account's social timezone** — DONE: cadence live since
  Fri Aug 7 (first cold run), slots spacing clean; on-the-day approval remains the
  standing practice.
- [ ] **Verify the Azavea account→calendar link before every cadence milestone**
  (`Account.articleCalendarId` → cmsgxchgk); it was found silently NULLed on
  2026-08-06 — cadence no-ops without error when unlinked.
- [x] **Decide: ElevenLabs voice for Azavea?** DECIDED (2026-08): no Azavea
  voiceover — verbatim-KT music-video design shipped instead (v8 specimen approved).
- [x] **Metered-overage pricing: DECIDED 2026-09-14** — 200 free voice min/mo +
  $50 unlimited upsell; ElevenLabs always on the clinic's own key. Remaining
  (POST-LAUNCH): build the metering + pick the rail (GHL wallet vs Stripe
  metered). Launch ships fair-use clause + existing instrumentation only.
- [ ] Compile the LinkedIn personal-profile backlog (long-form texts ready in DB);
  sweep decision on the old pre-Omniply azavea.ai drafts; publish post 1402 when
  article 1 should go live.

## 2. Platform arming (launch-day switches)

- [ ] **Arm the auto-delete lifecycle** — the 60/90-day cancellation deletion path is
  built + deployed but DISARMED. Arm at launch (see ghl-billing-lifecycle plan).
- [ ] **Flip `SCHEMA_MARKUP_AUTO=1`** after the fresh walkthrough against a real
  WordPress site verifies the schema ladder (body-ladder + micro-plugin path).
- [x] **Verify GHL billing workflows fire on a real subscription** — VERIFIED:
  the demo accounts were live PURCHASED accounts (live-purchase E2E Jul 25–28;
  user confirmation 2026-10-03 — payment flow checked end-to-end).
- [ ] **Eyeball the first automated cadence run's captions** (de-AI hook/caption pass
  ran clean in E2E; confirm the first unattended production run too). NOTE: Azavea
  cadence has run since Aug 7 with on-the-day approvals — arguably covered; also
  re-check once after the SPINE caption-hook change (6bd2ba3 era) on a client-style
  account.
- [ ] **Add staging droplet IP to the `GOOGLE_MAPS_API_KEY` restriction** (key is
  currently prod-IP-only; Tier-2 review pulls fail from staging).
- [ ] Onboarding runbook note: `brandSettings.industry` is REQUIRED for the
  plain-language feature — confirm the onboarding flow always sets it.
- [ ] **Onboarding: import the clinic's patient list into their GHL sub-account**
  (CSV import; the newsletter needs an audience on day one — fastest win for
  new clients). Add as an explicit onboarding-checklist step.
- [ ] **Win-back workflow in the snapshot**: engagement-based reactivation
  (patient-tagged + quiet ~90 days → personal-tone win-back sequence).
  Emails to be written (copy task), then workflow added to master snapshot.

## 3. External clocks (start early — not under our control)

- [ ] **Trademark**: USPTO filing for OMNIPLY classes 35 + 42 via IP attorney
  (register is clear as of 2026-07-31); quick CIPO + IP Australia checks.
- [ ] **wordpress.org plugin**: awaiting review of Omniply Connect; on approval → SVN
  publish. Correction reply re: trademark wording sent.
- [ ] **GBP Tier-1 API**: blocked by the "verified profile active ≥60 days" gate.
  Azavea Media profile verification in progress → re-run the application form
  immediately after it verifies. Launch stands on Tier 2 + Tier 3 regardless.
- [ ] **Cloudflare Email Routing**: delete the 5 dead `eforward*.registrar-servers.com`
  MX records on omniply.io → enable routing → `veit@omniply.io` → protonmail
  (+ catch-all). Keep the `send.omniply.io` MX (Resend/SES).

## 4. Freeze week (the week before vacation)

- [ ] Droplet OS updates + reboot, BOTH droplets — after checking for in-flight jobs;
  verify containers come back healthy (`/health/deep`). **Big backlog done early
  2026-08-03** (~60 pkgs incl. docker/tailscale/kernel + reboots, both boxes verified
  healthy, health 200) so the rehearsal tests the updated system; freeze week only
  needs the light delta accumulated since, done together with the DB upsize (§1).
  Ops note: run upgrades via `systemd-run` on the host, NOT from an SSH/docker-attached
  shell — the docker-ce upgrade restarts the daemon and kills attached sessions mid-apt.
- [ ] Final rehearsal purchase through the live funnel (Stripe → provision → onboard →
  first content run).
- [ ] Snapshot frozen + re-exported after the last workflow/asset change.
- [ ] Confirm monitoring green: BetterStack `https://svc.omniply.io/health/deep`,
  Sentry envs now correctly split prod/staging, alert email = protonmail.

## 4b. ✅ RESOLVED 2026-09-15: onboarding-polish batch LIVE ON PROD

ALL batches (4b / 4b-2 / 4b-3 / 4d embed shell) shipped to prod 2026-09-15;
demo account reset clean afterwards; onboarding run #2 (2026-09-25) exercised
the new UI (both new steps, voice input, generators attempt-1). Items kept
below for the record:

- [x] **FIX (bug): onboarding session lost-update race.** Background jobs
  (onboarding-synthesis, onboarding-crawl) and submitStep all write the WHOLE
  stepData JSON back after seconds of work — concurrent writers clobber each
  other's keys. Hit the live E2E: synthesis wiped q_proof + logoChosen +
  logoVariants + logo_confirm (restored by hand via jsonb_set). Fix: every
  writer merges ONLY its own keys atomically (jsonb || / jsonb_set), never a
  full-object write.
- [x] **Template reveal card: header font color swatch** (+ new
  nlHeaderTextColor brand field; renderer defaults to today's white).
- [x] **Template reveal card: logo layout option** — a) replace header name
  (today's behavior = default), b) beside name, c) above name. New
  nlHeaderLogoLayout field (default 'replace' → zero change for existing
  accounts), email-safe table markup in newsletter render.ts, both preview
  builders (server synthesis.ts + client cards.tsx mirror) kept in LOCKSTEP
  with the renderer + render tests. (Light/dark logo toggle already exists.)
- [x] **Button/header text color rule: prefer white on mid/dark brand colors**
  (labelColorFor currently picks black on teal #3aa6b9 by WCAG math; user
  design rule = white). Align preview + commitTemplateReveal + renderer.
- [x] **Preview honesty**: onboarding preview used extracted headerText
  (black) while real sends hardcode white — unify (covered by the two items
  above; add a test asserting preview palette == renderer output).
- [x] **Writing-sample step buttons** (moved from §5): "I wrote this ✓" /
  "Paste my article instead" / "Skip" when a scraped candidate exists —
  film the walkthrough with the NEW UI.
- [x] **Restore q_proof transcript** for the demo account: re-transcribe the
  surviving S3 audio (onboarding/cmtxbfoi5000fmi014yx125bt/voice/q_proof-*)
  back into stepData (audio itself is safe; only the session reference was
  clobbered).
- [x] After approve: set nlButtonTextColor='#ffffff' on the demo account
  (commitTemplateReveal recomputes it dark — patch until the rule ships).
- [x] **FIX (bug): readiness validator still requires the REMOVED elevenlabs
  step** (generation-readiness.ts: `stepData.elevenlabs !== undefined`) —
  every P3-era client fails the finale gate. Drop the check (voice is a
  post-onboarding dashboard decision now). Demo account worked around via
  stepData patch 2026-09-14.
- [x] **Offer cards readability** (Veit, mid-E2E): offer text panels are hard
  to read and scroll internally — auto-grow the textareas (or high min-height)
  so full offer text shows without inner scrolling.
- [x] **Lead Magnets view: post-finale notification + live compile status**
  (Veit requirement, mid-E2E): (1) banner "Your first month's content is being
  generated — it arrives for review shortly" after onboarding completes;
  (2) spinner + polling while any doc status='compiling' (currently a stale
  "compiling" flag until manual refresh, no approve buttons visible).
- [x] **FIX: PDF back-page offer must be EVERGREEN, never seasonal**
  (compile.ts:138 picks the FIRST enabled newsletter offer by createdAt —
  demo got "New Year Posture Check" in September; PDFs live for months).
  Use the neutral fallback or a dedicated evergreen readerOffer field;
  seasonal offers stay newsletter-only.
- [x] **BUG: GHL Business Profile phone/email never reach BrandSettings** —
  demo has organizationPhone=null, organizationEmail=null (only the address
  landed in geolocation). Consequence: PDF back page says "Call our Mesa
  office" with NO number (contact line drops empty fields), and the chat KB
  has no phone. Fix the prefill→brand mapping in onboarding; backfill the
  demo account; recompile its PDFs.
- [x] **PDF phone numbers become clickable tel: links** (mobile launch-a-call)
  — back-page contact block + footer strip.
- [x] **Onboarding chat: wider layout + larger base font** (Veit, mid-E2E):
  widen the chat column inside the embed page and bump the font size —
  "look much easier and less tedious". Mind the GHL iframe viewport: keep it
  responsive, cap with a max-width, test at common CRM sidebar widths.
  Applies to the walkthrough video too — film AFTER this lands.

## 4c. ✅ RESOLVED 2026-09-15: full calendar coverage shipped

Every enabled specialization (family_care, sports, prenatal_pediatric,
geriatric, wellness_maintenance) × BOTH hemispheres now has an article AND
newsletter calendar on prod — verified programmatically ("COVERAGE
COMPLETE"). 17 new calendars, ~2,600 dated topic rows: family_care×south
articles copied from the curated staging export (+12mo runway); the four new
specializations generated season-tagged (articles ~2/week, newsletters
weekly, Oct 2026–Sep 2027 + 12-month runway; southern variants shifted +6
months so seasons align). Import script: scratchpad import-all-calendars.js
(idempotent). REMAINING (small, hardening): fallback routing (no exact
match → family_care same hemisphere) so a FUTURE registry addition without
calendars can't re-open the trap — post-launch acceptable now.

## 4d. Video completion → release critical path (added 2026-10-03)

The demo video's insert kit is COMPLETE (31 clips, VO 12:49, script v4.1 —
see `.documentation/marketing/` + the demo-video-production memory). What
remains is production + the release ripple, in order:

### Voice-AI demo setup (gates the Scene 11 call)
- [x] Set demo brand data (done 2026-10-03 via DB on Veit's request —
  "Demo Practice", +1-555-555-0100, Mon–Fri 8–6 / Sat 9–1 / Sun closed;
  plus two agent hardenings shipped alongside: probe periods gated behind
  user hours, and a listing-name mismatch guard that discards a
  mis-resolved Places probe entirely): organization name **"Demo Practice"**,
  an obviously-bogus 555 phone, realistic opening hours (user decision
  2026-10-03: demo-obvious identity; the probe-precedence fix means
  Settings values now stick). NOTE: chat + voice share ONE knowledge
  bundle — the Scene 10 chat demo will also say "Demo Practice"; film
  both demos under this identity.
- [ ] Provision via Settings → Voice Assistant → Step 2 (mode: direct
  line films simplest; transfer number; "Set up voice assistant").
  Entirely UI — FILM IT as future tutorial footage. First run is the
  cleanest take; the phone number may lag ("still pending" state).
- [ ] Dry-run the call script: intake name+number → hours question →
  "can I talk to someone?" → let transfer ring out → message with the
  best-time ask (deployed 2026-10-02) → front-desk notification arrives.
- [ ] Film the real call (Scene 11). SMS is NOT needed for the demo —
  the no-SMS voice path is designed in; A2P ID-verify stays a separate,
  non-blocking item (§3).

### Remaining filming + assets
- [x] Captures DONE (user 2026-10-03: "the last 2 scenes missing are the
  coffee scene and the voice AI call demo"): AI-search screens,
  pricing/checkout, welcome email, Scenes 3–8 footage, Scene 9 kit,
  Scene 10 chat demo (filmed — widget renders fine live), Flow takes.
- [ ] Veit: **coffee insert** (Scene 1 pivot) — one of the two remaining.
- [ ] Veit: **re-film the Scene 10 callback TAIL** — the filmed take has
  the coarse morning-or-afternoon ask; concrete-time ask deployed
  6bd2ba3 (2026-10-03). Only the callback exchange needs redoing.
- [ ] Claude: lit-pair card (YOUR PHONE ✓) once the call is recorded.

### Edit → release ripple
- [ ] Assemble the edit; publish to /walkthrough.
- [ ] **Minute-claim sweep** (old walkthrough doc's standing order):
  replace every "12-minute walkthrough" with the real runtime — master
  pitch §7, both sales pages, /walkthrough hero+metadata, X-Ray results
  CTA, debrief PDF template + static print HTML (+TEMPLATE_VERSION
  bump), nurture emails 5/6/9/10 + SMS 3, outreach doc; then one email
  rebuild + single GHL import.
- [ ] **AI-hook pass in the same sweep** (approved 2026-09-25, deferred):
  X-Ray report §2 technology-force extension, nurture email 3 two-wave
  teach + email 7 bullet, X-Ray results-page bridge line. Outreach stays
  on the leak hook.
- [ ] Scene 12 is UNGATED (option B — no page capture in the video),
  but the VO says "Omniply is open now": release the video only when
  the site gate flips (real LAUNCH_TS in its 3 places, 584e0c5).

### GHL / snapshot hygiene (before first real client)
- [ ] Master snapshot: decide + set callback-notification type (keep SMS
  for clients — staff-contacts provisioning 9e7cf8c handles the
  auto-contact artifact; demo switched to Email for clean filming).
- [ ] Master snapshot: add `staff-internal` tag-exclusion filters to all
  marketing/drip workflows (review requests, reactivation).
- [ ] Sweep snapshot for leftover placeholder values (the 809-555-5555
  class). Payment-workflow checklist: VERIFIED 2026-10-03 — demo
  accounts were live purchased accounts, billing flow fired end-to-end.

### Final verification
- [ ] Full prod pilot: the 19-step onboarding chat walkthrough
  (.documentation/onboarding-testing-guide.md) — the one remaining item
  from the GHL onboarding plan.
- [ ] Live SMS leg after A2P ID-verify (from home).
- [ ] Re-run the calendar seasonal audit before any future calendar
  import (.documentation/calendar-fix-2026-09-30/verify-lite.js).

### Marketing ops with lead time (start in parallel, non-blocking)
- [ ] Cold-outreach prereqs: buy cold domain, mailbox + SPF/DKIM/DMARC,
  ~2-week warm-up (xray-outreach.md) — needed only if outreach starts
  at launch.

## 5. Post-launch backlog (small items, no launch impact)

- [x] **Writing-sample step buttons** — MOVED to §4b (pre-filming batch,
  user-committed 2026-09-14).

- [ ] **Sync GHL location name → Account.name** (Veit, 2026-09-14): renames done in
  GHL (e.g. a typo fixed after signup) should reflect in our Account.name, which is
  set once at provisioning and never updated. Linkage is by locationId so nothing
  breaks — this is admin-display hygiene. Options when built: refresh on SSO session
  exchange (cheap, every open) or on the location-update webhook class. Until then:
  manual DB patch (account.update name), done once for the demo account
  ("Onboarding Demo Account", cmtxbfoi5000fmi014yx125bt).

## Appendix: connection usage one-liner

```bash
ssh socioply@socioply-api-01 'cd /opt/socioply && docker compose exec -T -e NODE_TLS_REJECT_UNAUTHORIZED=0 api node -e "
const {Client}=require(\"pg\");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query(\"select datname,usename,application_name,state,count(*)::int n from pg_stat_activity group by 1,2,3,4 order by n desc\");
for(const w of r.rows)console.log([w.datname,w.usename,w.application_name,w.state,w.n].join(\" | \"));
const s=await c.query(\"show max_connections\");console.log(\"max:\",s.rows[0].max_connections);await c.end()})()"'
```
