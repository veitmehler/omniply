# Launch-Day Runbook — Tuesday, October 13, 2026, 11:00 AM ET

**LAUNCH_TS = `2026-10-13T15:00:00Z`** (11:00 AM Eastern DAYLIGHT time —
EDT/UTC-4 on this date). All clock times below are ET.

The gate is TIME-BASED: once the real LAUNCH_TS is deployed, every gated
block flips by itself at 15:00Z — video player, buy boxes, notify-pitch
hiding. The code push therefore happens launch MORNING (not at 11:00),
and 11:00 needs no action at all. Companion docs:
`launch-day-copy-restore.md` (exact copy), `pre-launch-todos.md` (§2/§4).

---

## T-1 — Monday, Oct 12 (launch eve, light)

- [ ] Monitoring green: BetterStack `svc.omniply.io/health/deep`, Sentry
      envs split, alert email = protonmail.
- [ ] Demo account state clean (no leftover test contacts/appointments).
- [ ] **Prepare the launch commit on `staging` (do NOT push to main yet):**
      1. `LAUNCH_TS = Date.parse('2026-10-13T15:00:00Z')` in the 3 places:
         - `apps/web/src/components/marketing/FoundingNotify.tsx:15`
         - `apps/web/public/walkthrough/index.html` (~line 105)
         - `apps/web/public/x-ray/index.html` (~line 914)
      2. All copy restores from `launch-day-copy-restore.md` §1–§4
         (x-ray punch line, walkthrough buy box with $397, chiropractors
         price copy + PricingBlock, home meta/FAQ).
      3. `CONFIG.CHECKOUT_URL` in walkthrough/index.html = the live GHL
         purchase link (URL is stable even while the orderform is off).
- [ ] GHL W2 "Launch Blast" prep: real checkout link into all three
      emails, spot count [N] into Email 2, waits back at 2 days,
      workflow PUBLISHED (but no one tagged yet).
- [ ] LinkedIn story-window: UNSET `linkedinPersonal` on the azavea
      account (launch-arc posts own the profile through launch week);
      per copy-restore §5, restore + re-add the 3 parked beats after the
      arc completes.
- [ ] Stage announcement posts from `launch-arc-posts.md`.
- [ ] Dry-read this runbook end to end.

## Launch morning — Tuesday, Oct 13

**09:15 — pre-flight**
- [ ] In-flight job check on prod (inline pg-boss query; the
      check-active-jobs.js copy dies with each container recreate).
- [ ] `gh run list` clean; GitHub pushes working (they 500'd transiently
      on Oct 7 — the 09:30 push time exists to absorb exactly this).

**09:30 — the push**
- [ ] Push the prepared launch commit: `origin staging` +
      `origin staging:main`.
- [ ] Watch CI + Deploy API (droplets) + Vercel to completion.
- [ ] Verify pre-flip state: site still says "opening soon" (gate not yet
      passed), but `omniply.io/walkthrough?preview=1` plays the video and
      the buy button href points at the live checkout URL.

**10:00 — droplet env flags (one session, containers restart once)**
- [ ] Prod `/opt/socioply` env: `ACCOUNT_AUTO_DELETE_ENABLED=true`
      (arms the 60/90-day cancellation deletion path).
- [ ] `SCHEMA_MARKUP_AUTO=1` — ONLY if Friday's rehearsal verified the
      schema ladder against a real WordPress site; otherwise leave for
      post-launch.
- [ ] Recreate containers, `/health/deep` green, re-run the job check
      habit afterward.

**10:30 — GHL morning actions (copy-restore §5b)**
- [ ] Re-enable the checkout orderform.
- [ ] Final look at the W2 emails (links resolve, spot count right).

**11:00 — doors open (automatic — verify, don't act)**
- [ ] omniply.io: notify pitch gone, $397 copy + PricingBlock live.
- [ ] /walkthrough (NO preview param): video public, buy box shows
      "$397/month · Put my practice on autopilot" → live orderform.
- [ ] X-Ray results: punch line shows the price multiple; walkthrough
      CTA box present.
- [ ] Click through the checkout to the payment page (do not purchase).
- [ ] Demo line +1 507 483 5331 answers.

**11:15 — announce**
- [ ] Bulk-add `launch-blast` tag to the waitlist smart list → W2 drip
      starts.
- [ ] Publish the staged launch posts.

**Rest of day — monitor**
- [ ] Sentry + BetterStack + GHL conversations; first real purchases run
      the full provisioning path (billing workflows fire on live
      subscriptions — verified pattern from the July E2E).
- [ ] Any flow-breaking issue: `rollback-runbook.md`; the LAUNCH_TS
      commit itself is safe to leave (gate-flip is independent of later
      fixes).

## Deliberately NOT on launch day
- Win-back workflow (post-launch build), C3 red-team completion (gates
  first widget install, not launch), voice metering, pg-boss retention
  tuning, Theme B–D refactors, notify-block code removal (harmless,
  self-hidden; remove at leisure).
