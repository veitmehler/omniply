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
- [ ] **Confirm the Azavea account's social timezone** before Fri Aug 7 (controls the
  9/12/15 post slots). Approve article + social preview before 9am local for clean
  spacing — late approval bunches past slots to ~10 min out.
- [ ] **Verify the Azavea account→calendar link before every cadence milestone**
  (`Account.articleCalendarId` → cmsgxchgk); it was found silently NULLed on
  2026-08-06 — cadence no-ops without error when unlinked.
- [ ] **Decide: ElevenLabs voice for Azavea?** Without it all video social slots render
  as accent-tint carousels; with it, reels + hook videos unlock. Config-only.
- [ ] **Metered-overage billing rail: decide WITH the voice agent build.** Leading:
  GHL marketplace-app usage billing against the location wallet (verify
  availability + rev share while building the app); fallback: Stripe metered items
  on the GHL-created customer. Launch ships fair-use clause + existing
  instrumentation only.
- [ ] Compile the LinkedIn personal-profile backlog (long-form texts ready in DB);
  sweep decision on the old pre-Omniply azavea.ai drafts; publish post 1402 when
  article 1 should go live.

## 2. Platform arming (launch-day switches)

- [ ] **Arm the auto-delete lifecycle** — the 60/90-day cancellation deletion path is
  built + deployed but DISARMED. Arm at launch (see ghl-billing-lifecycle plan).
- [ ] **Flip `SCHEMA_MARKUP_AUTO=1`** after the fresh walkthrough against a real
  WordPress site verifies the schema ladder (body-ladder + micro-plugin path).
- [ ] **Verify GHL billing workflows fire on the first real subscription** — the
  workflows exist but have never seen a live payment event end-to-end.
- [ ] **Eyeball the first automated cadence run's captions** (de-AI hook/caption pass
  ran clean in E2E; confirm the first unattended production run too).
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

## 4b. Onboarding-polish batch — AFTER simonchiro E2E, BEFORE filming (added 2026-09-14)

One batch, one API+web deploy (needs a migration — never mid-onboarding/burst).
User-committed 2026-09-14 ("it will make it much easier for clients to be happy"):

- [ ] **FIX (bug): onboarding session lost-update race.** Background jobs
  (onboarding-synthesis, onboarding-crawl) and submitStep all write the WHOLE
  stepData JSON back after seconds of work — concurrent writers clobber each
  other's keys. Hit the live E2E: synthesis wiped q_proof + logoChosen +
  logoVariants + logo_confirm (restored by hand via jsonb_set). Fix: every
  writer merges ONLY its own keys atomically (jsonb || / jsonb_set), never a
  full-object write.
- [ ] **Template reveal card: header font color swatch** (+ new
  nlHeaderTextColor brand field; renderer defaults to today's white).
- [ ] **Template reveal card: logo layout option** — a) replace header name
  (today's behavior = default), b) beside name, c) above name. New
  nlHeaderLogoLayout field (default 'replace' → zero change for existing
  accounts), email-safe table markup in newsletter render.ts, both preview
  builders (server synthesis.ts + client cards.tsx mirror) kept in LOCKSTEP
  with the renderer + render tests. (Light/dark logo toggle already exists.)
- [ ] **Button/header text color rule: prefer white on mid/dark brand colors**
  (labelColorFor currently picks black on teal #3aa6b9 by WCAG math; user
  design rule = white). Align preview + commitTemplateReveal + renderer.
- [ ] **Preview honesty**: onboarding preview used extracted headerText
  (black) while real sends hardcode white — unify (covered by the two items
  above; add a test asserting preview palette == renderer output).
- [ ] **Writing-sample step buttons** (moved from §5): "I wrote this ✓" /
  "Paste my article instead" / "Skip" when a scraped candidate exists —
  film the walkthrough with the NEW UI.
- [ ] **Restore q_proof transcript** for the demo account: re-transcribe the
  surviving S3 audio (onboarding/cmtxbfoi5000fmi014yx125bt/voice/q_proof-*)
  back into stepData (audio itself is safe; only the session reference was
  clobbered).
- [ ] After approve: set nlButtonTextColor='#ffffff' on the demo account
  (commitTemplateReveal recomputes it dark — patch until the rule ships).
- [ ] **FIX (bug): readiness validator still requires the REMOVED elevenlabs
  step** (generation-readiness.ts: `stepData.elevenlabs !== undefined`) —
  every P3-era client fails the finale gate. Drop the check (voice is a
  post-onboarding dashboard decision now). Demo account worked around via
  stepData patch 2026-09-14.
- [ ] **Offer cards readability** (Veit, mid-E2E): offer text panels are hard
  to read and scroll internally — auto-grow the textareas (or high min-height)
  so full offer text shows without inner scrolling.
- [ ] **Lead Magnets view: post-finale notification + live compile status**
  (Veit requirement, mid-E2E): (1) banner "Your first month's content is being
  generated — it arrives for review shortly" after onboarding completes;
  (2) spinner + polling while any doc status='compiling' (currently a stale
  "compiling" flag until manual refresh, no approve buttons visible).
- [ ] **FIX: PDF back-page offer must be EVERGREEN, never seasonal**
  (compile.ts:138 picks the FIRST enabled newsletter offer by createdAt —
  demo got "New Year Posture Check" in September; PDFs live for months).
  Use the neutral fallback or a dedicated evergreen readerOffer field;
  seasonal offers stay newsletter-only.
- [ ] **BUG: GHL Business Profile phone/email never reach BrandSettings** —
  demo has organizationPhone=null, organizationEmail=null (only the address
  landed in geolocation). Consequence: PDF back page says "Call our Mesa
  office" with NO number (contact line drops empty fields), and the chat KB
  has no phone. Fix the prefill→brand mapping in onboarding; backfill the
  demo account; recompile its PDFs.
- [ ] **PDF phone numbers become clickable tel: links** (mobile launch-a-call)
  — back-page contact block + footer strip.
- [ ] **Onboarding chat: wider layout + larger base font** (Veit, mid-E2E):
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
