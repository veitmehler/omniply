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

## 5. Post-launch backlog (small items, no launch impact)

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
