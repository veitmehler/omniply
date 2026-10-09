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
      workflow PUBLISHED (but no one tagged yet). ⚠️ The emails still
      carry SEPTEMBER dates (Sep 22/24/26 wording) from the postponed
      launch — re-date all date mentions for the Oct 13 window (W1 copy
      + "Send Info 1" too).
- [ ] LinkedIn story-window: VERIFY `linkedinPersonal` state on the
      azavea account — it was unset 2026-09-16 for the September launch
      and parked, so it is LIKELY STILL UNSET (automated story beats
      have skipped the personal profile since). If unset: leave it (the
      launch arc owns the profile through launch week). Restore + re-add
      the 3 parked narrator beats after the arc completes
      (copy-restore §5).
- [ ] Optional hygiene while in dashboards: rotate the demo ElevenLabs
      key (prefix appeared in working transcripts) and the Resend key
      (parked-for-launch item).
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

## REVISED FINAL BOARD (agreed 2026-10-08 late — supersedes the T-1 list above where they differ)

### Friday Oct 9
1. PARALLEL: Claude = cost-tracking audit+fix (recordLLMUsage coverage all
   pipelines; Gemini token pricing current; GROUNDED-SEARCH per-request fees;
   image gen; Places in-or-documented-out) · Veit = snapshot freeze+re-export
   (pre-freeze sweep: callback-notification type, placeholder sweep, workflows
   Published → Agency Snapshots → Refresh → verify SaaS-plan linkage →
   timestamp). Snapshot BEFORE the purchase; orderform re-enabled.
2. Angle one-liners discussion (10 min) → Veit runs test purchase + 19-step
   onboarding SOLO (incl. VOICE SMOKE CALL to demo line + WordPress connect =
   SCHEMA_MARKUP_AUTO verification) · Claude plans copy sweep + X-Ray
   AI-inquiry metric (formula: weekly inquiries × AI-research share
   [conservative default ~20-25%; Adyen 2026: 42-51% of shoppers research via
   AI; Visa/Finextra: 25% daily / 72% ever] × not-AI-visible loss → $ via
   existing close-rate × patient-value; all adjustable, cited basis line) +
   watches costs populate live during the content run.
3. Write + implement the ANGLE SWEEP (hierarchy: 1. AI assistants will book
   appointments soon — be the practice they find · 2. missed calls, quantified
   · 3. reviews = visibility to people AND AI · 4. rest supports): X-Ray
   landing/results/debrief + new metric, both sales heroes, nurture email
   leads (re-push templates via fresh PI key, delete after), W2 drafts.
   Marketing surfaces only — platform backend untouched (freeze intact).

### Weekend — Veit OFF. True freeze.

### Monday Oct 12 (T-1)
1. Finish any angle-sweep remainder.
2. Video v2 (Veit edits Zoom errors) → Claude uploads NEW S3 key + flips
   walkthrough config.
3. GHL block: W2 Launch Blast (re-DATE from Sept wording + checkout links +
   AI-led copy + publish check), system-email brand alignment (Claude's audit
   list; slides to Wed if tight), A2P registration, demo CRM contact cleanup.
   Orderform findings (test purchase 2026-10-09): re-import the Stripe product
   with the corrected name ("Chiropractors" — GHL blocks renaming imported
   products; re-link orderform + SaaS plan after and confirm with a preview),
   map the orderform Company field to the contact's STANDARD Business Name
   field (stops "<Buyer>'s Account" location names → wrong schema/brand
   prefill), phone-input padding CSS (flag covers digits: .iti input
   padding-left ~64px on the funnel step), and confirm the LIVE orderform
   shows only the real plan (no leftover $10/$20 test prices).
   ("INFOMATION" typo + SaaS Configurator name: fixed Oct 9.)
4. Draft content topics: website articles + LinkedIn articles (AI-first angle).
5. Rebuild azavea.ai as the marketing agency behind Omniply (Claude builds,
   Veit reviews).
6. Standard T-1: launch-commit prep (LAUNCH_TS ×3 + price/CTA restores ON TOP
   of new-angle pages), linkedinPersonal verify, monitoring green,
   announcements staged, help-doc parked decisions.

### Tuesday Oct 13 (launch — per the timeline above, verification now ALSO
checks: heroes lead AI-first, X-Ray shows the AI-inquiry metric, video v2
playing).

### Deliberately launch-week (recorded, not forgotten): outreach email/message
rework (AI-visibility lead — DONE early 2026-10-09), article WRITING (Monday =
topics only), azavea.ai polish, cold-domain warmup start.

### Post-launch backlog (from the 2026-10-09 test purchase)
- Lighter-cadence offer (Veit 2026-10-09): clinics who feel full cadence is
  too much can choose 1–2 articles/wk and 1–4 newsletters/wk. Framed as
  customization; every step down is margin (content COGS ~$55/mo full →
  ~$21/mo at 1+1). Mostly calendar routing, not new plumbing. Diagrams are
  NOT a cost lever — too valuable (Veit).
- Per-content cost attribution: stamp jobId on diagram-restyle / social /
  syndication llm_usage rows (or add a rollup) — the admin article page
  shows ~$1.35 while true all-in is ~$3.30/article.
- PDF guide style selector: cover color + logo-variant picker with a
  "Regenerate guides" button, mirroring the newsletter template builder
  (per-account overrides + recompile of the library). The automatic
  contrast fix (cover ink + logo variant by header luminance) shipped
  2026-10-09; the selector is the taste-control layer on top.
- Diagram-restyle cost: ~$1.74/article (22 image calls) — the largest
  single content cost line; evaluate motif caching / fewer variants.
- Onboarding belt: treat "<Name>'s Account"-shaped location names as unset
  in the business-confirm prefill (don't invite one-click-accepting them).
