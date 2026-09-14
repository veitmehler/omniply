# Prod Merge — Launch Batch (staging → main, pre-E2E)

Decision 2026-09-14: merge BEFORE the simonchiro E2E, then run the E2E as a real
purchase on prod — tests the true customer path (zero-touch provisioning → new
onboarding) with no Custom Page URL swap and gives prod a week of soak before the
Sept 22 launch.

## What rides the merge (38 commits, dry-run merge = CLEAN)

- Full ElevenLabs voice agent (custom-LLM façade, provisioning wizard + dashboard
  card, transfers + 25s watchdog, one-number rescue, intake, SMS delivery,
  preferredTime callback field)
- Security Theme A (credential scrub, CVE bumps, trustProxy:true, 3 SSRF sink
  guards) + full Supabase removal + F5 frozen-lockfile Dockerfile
- Onboarding P3 (blog-scrape writing sample, q_moments 6th voice question, SPINE
  one-tap CTA, ElevenLabs step removed) + story-arc matrix + agent C3 fixes +
  KB textarea + WP plugin v1.1 sources
- Launch content docs (walkthrough script, 12 help articles), Sept 22 date sweep
  (gate files already on main via cherry-pick 568dca1 — merges clean)

Migrations (all additive, 43 lines): 20260909180000_agent_extra_knowledge,
20260909200000_voice_agent, 20260910100000_voice_rescue, 20260910200000_voice_sms.

## Phase 0 — Pre-flight (me, ~15 min)

- [ ] Staging health + deploy green at tip (15601cb docs commit didn't deploy;
      last code deploy cc3607c must be the running image).
- [ ] Prod in-flight check (activejobs pattern) — today Mon Sep 14 is an Azavea
      cadence day (MWF): deploy only in a quiet window. The workflow's own gate
      waits ≤15 min then aborts; don't rely on it, check first.
- [ ] Prod DB backup (pg_dump via droplet, postgresql18-client in container)
      BEFORE migrations.
- [ ] Azavea account→calendar link sanity check (was silently nulled once).

## Phase 1 — Prod env prep (before pushing main)

`/opt/socioply/.env.production` — append:
- [ ] `TWILIO_ACCOUNT_SID=` + `TWILIO_AUTH_TOKEN=` (same master account as
      staging — per-clinic subaccounts hang under it; CONFIRM with Veit)
- [ ] `API_PUBLIC_URL=https://svc.omniply.io` (code defaults to this anyway —
      set explicitly for clarity)
- [ ] Do NOT set `VOICE_TRANSFER_BYPASS_HOURS` (test-only override).
- Env lands when the deploy recreates containers (new image → recreate happens).
- Vercel prod web: nothing new required (`NEXT_PUBLIC_API_URL` already set).
  Optional cleanup: delete leftover SUPABASE_* vars if any.
- Per-clinic ElevenLabs keys live encrypted in the DB, not env — simonchiro's
  gets entered in the wizard during the E2E.

## Phase 2 — Merge + deploy

1. `git checkout main && git pull && git merge origin/staging && git push`
   (merge-tree dry run 2026-09-14: clean, no conflicts).
2. Push triggers BOTH: `deploy-api.yml` (api/db/lockfile paths all changed ✓)
   and the Vercel production web build (prod branch = main).
3. deploy-api does: Tailscale → in-flight gate → image build — **first prod
   build with --frozen-lockfile** (proven green on staging cc3607c) → tag
   :previous → `prisma migrate deploy` (4 migrations) → seed (upsert
   `update:{}` — creates missing rows only, never overwrites) → up -d →
   health check with auto-rollback to :previous.
4. Poll the run by FULL sha (`git rev-parse main` — never guess short SHAs).
5. Verify Vercel prod deployment green; spot-check chiro.omniply.io renders.

## Phase 3 — Prod DB prompt patches (seed won't touch existing rows)

Container-side method (prod DB hostname is VPC-private): serialize locally →
`docker cp` into socioply-api → node script requiring `@omniply/shared` from /app.
Capture current values to a backup JSON first.

- [ ] `agent_system` ← packages/db/prisma/agent-prompts.ts (C3 fixes: callback
      correction rule #4, preferredTime rule #5, send_guide_link button phrasing).
- [ ] `write_article` systemPrompt ← seed.ts (legal-citation rule appended).
- [ ] While in there: diff prod `fact_check` row vs seed (legal-citation memory
      flagged a prod fc-row/seed mismatch — verify patched, patch if not).
- [ ] Read back all patched rows and diff against source = verification.

## Phase 4 — Post-deploy verification

- [ ] `/health` 200; Sentry release = new GIT_SHA, no error spike over 30 min.
- [ ] Image proof of frozen lockfile: `sharp` 0.35.4 + `fast-uri` 3.1.7 inside
      the prod container (same spot-check as staging).
- [ ] trustProxy sanity: request logs show real client IPs behind Caddy (rate
      limiters now key per-visitor, not per-proxy).
- [ ] Web: dashboard shows the voice-agent card, Settings shows KB textarea +
      voice section, /embed loads with CSP intact, marketing pages still say
      Sept 22.
- [ ] pg-boss workers healthy (prod connection budget: pgboss 3 / prisma 4 —
      voice queues add job types, not connections).

## Phase 5 — Azavea regression regen (same day, before E2E)

The merge touches shared pipeline code (sharp 0.35, ffmpeg redirect loop with
SSRF guard, frozen image). Don't wait for Wednesday's cadence:
- [ ] Regenerate one recent Azavea article's full social set on prod.
- [ ] Verify: KT music video (verbatim takeaways), carousels render (sharp),
      ffmpeg encodes + S3 uploads, captions em-dash-free, per-slide motif bgs.
- [ ] Then let Wed Sep 16 cadence run be the live confirmation.

## Phase 6 — Then the simonchiro E2E, fully on prod

- Marketplace app stays pointed at `chiro.omniply.io/embed` — NO URL swap; it
  now serves the new build. This plan supersedes the staging-swap idea in
  onboarding-test-simonchiro.md's environment discussion.
- Real purchase → zero-touch provisioning (re-verification for free) →
  19-step onboarding (six voice answers SPOKEN — clone source) → snapshot →
  burst → live SPINE/DM/chat/voice tests incl. FIRST live SMS delivery.
- Snapshot contacts: already cleared by Veit (week of Sep 7) — junk-contact
  cleanup step is DONE, drop it from the follow-ups.
- Capture checkout clip for walkthrough Scene 2 during purchase.

## Rollback story

- API image: health-check auto-rollback to :previous; manual retag + up -d.
- Migrations: additive-only → roll-forward; pre-merge pg_dump is the backstop.
- Web: Vercel one-click rollback to prior deployment.
- Prompts: backup JSON captured before each patch; restore via same pusher.

## Explicitly NOT in this plan

- Sept 16 linkedinPersonal unset (cron 15aed1e0, separate track).
- Supabase project deletion/rotation (Veit, independent — still outstanding).
- W2 Launch Blast GHL copy sweep + callback merge-field workflow (Veit,
  GHL-side; needed before E2E's callback verification, not before merge).
- Security Themes B–D (post-launch).
