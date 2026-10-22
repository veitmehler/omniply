# Wellness snapshot build checklist

How to produce the "Omniply Wellness" snapshot by duplicating the chiro
snapshot, plus the platform-side steps that make a wellness account work
end to end. Companion docs: wellness-snapshot-nurture.md (workflow copy),
ghl-snapshot-guide.md (the chiro original this duplicates),
.plans/wellness-vertical.implementation-plan.md (the whole vertical).

## A. Duplicate + edit the snapshot (GHL agency UI)

Duplicate the chiro snapshot into a template sub-account, make the edits
below, save as snapshot "Omniply Wellness".

### Keep untouched (vertical-agnostic)
- [ ] AI DM Responder workflow (Customer Replied → webhook; the server is
      channel- and vertical-aware, WhatsApp included)
- [ ] Review-request workflow + Review Received webhook workflow
- [ ] QR review counter card (template vertical is already 'all')
- [ ] Trigger links `omniply-review` + `omniply-booking` (placeholders;
      provisioning repoints both)
- [ ] Custom fields (guide_link) + custom values (omniply_dm_webhook,
      omniply_review_token — set per clinic at provisioning)

### Edit 1 — guide trigger links (names must match slugs EXACTLY)
DONE VIA API 2026-10-22 (location dyDcrf5pZnHXVXA7Rhx4, PIT): the five
chiro `omniply-guide-*` links deleted; four wellness links created, all
pointing at the https://omniply.io/pending placeholder (also fixed the
inherited `omniply-booking` typo `/pendingv` → `/pending`):
- [x] `omniply-guide-everyday-strength-guide`
- [x] `omniply-guide-better-sleep-guide`
- [x] `omniply-guide-switch-off-guide`
- [x] `omniply-guide-everyday-fuel-guide`
- [x] `omniply-guide-first-wellness-visit` (master 10, added 2026-10-22:
      "What to Expect at Your First Visit" — NOT quiz-matched; the Age
      Check results page offers it as the one-line extra, like chiro's
      first-visit guide)
Placeholder destinations are fine: compile repoints by LITERAL NAME match
at every guide regeneration. A typo = a silently dead drip link.

### Edit 2 — quiz trigger link: KEEP THE NAME `omniply-spine-check`
- [ ] Do NOT rename it to anything age-check. The repoint code looks for
      the literal legacy name and already writes the vertical-correct URL
      (wellness → the Biological Age Check) into it. Renaming it makes the
      repoint log "link not found" and skip.

### Edit 3 — comment-keyword workflow: ONE keyword only
Design rule (Veit 2026-10-22): ALL comments lead to the lead-gen quiz —
it routes each lead to their matched guide anyway. Delete ALL chiro
keyword workflows; keep/create exactly one:
- [ ] AGE → `omniply-spine-check` (the quiz)
Public comment reply stays: "Just sent it to your DMs!"
Social config at onboarding: dm_keyword preset = `AGE | the Biological
Age Check` (the preset is single-keyword by design; no code change).

### Edit 4 — nurture workflow
- [ ] Trigger: Contact Tag Added, OR across the four wellness
      `leadgen-*` tags (see Edit 1 slugs, prefixed `leadgen-`)
- [ ] Email 0: four delivery branches (copy + branch table in
      wellness-snapshot-nurture.md). All six emails are IMPORTED as
      builder templates (2026-10-22: "Guide delivery - …" ×4,
      "Nurture day 1/4 - …"); assign per step, then attach the trigger
      link to each CTA (hrefs are "#" placeholders; link name is in each
      template's top code-view comment, with subject + preview text).
- [ ] Emails 1 + 2: day 1 + day 4 follow-ups (same doc, templates above)
- [ ] End step: Opportunity in the "New Client" pipeline
- [ ] Exits: appointment tag / stage move (mirror chiro)

### Edit 5 — language sweep
- [ ] Pipeline "New Patient" → "New Client"
- [ ] Review-request email + DM reply snippets: patient/spine/
      chiropractic wording → client/wellness wording
- [ ] Any remaining template emails mentioning chiro specifics

## B. SaaS plan decision
- [ ] PILOT (one clinic): create the sub-account manually, apply the
      "Omniply Wellness" snapshot, attach to the existing SaaS plan.
- [ ] AT CLINIC #2 from the referral pipeline: create a second SaaS plan
      ("Omniply Wellness") tied to this snapshot + its own checkout link,
      so burst-on-payment auto-provisioning works per vertical.

## C. Platform-side pilot steps (admin/DB, mostly one-liners)
- [x] ~~Set `accounts.vertical = 'wellness'` BEFORE onboarding~~ AUTOMATED
      2026-10-22 (funnel provisioning): the wellness snapshot carries the
      `omniply_vertical = wellness` custom value (written via PIT; custom
      values travel in snapshots), and auto-provision reads it at account
      birth — every location born from the wellness SaaS plan arrives
      labeled. Absent/unknown value = chiro. VERIFY on the pilot: the
      provision log line shows `vertical: 'wellness'`.
- [x] ~~Flip Specialization `recovery_wellness` to enabled~~ RETIRED
      2026-10-22: the registry is now VERTICAL-AWARE (specializations
      carry vertical 'chiro'|'wellness'|'all'; onboarding only surfaces
      the account's vertical). recovery_wellness is permanently
      `vertical='wellness', enabled=true` (flipped by the migration on
      both envs) and can never appear in chiro onboarding. `enabled` is
      back to meaning only "calendars exist".
- [x] ~~Industry exactly "Wellness & Recovery"~~ AUTOMATED 2026-10-22: the
      profile commit pins the exact PlainLanguageConfig string for
      wellness-vertical accounts (crawl-detected industry is ignored for
      them), so the claims-policy injection can never silently skip.
- [ ] Verify calendar routing lands on the Recovery & Wellness calendars
      (articles 122 topics, newsletters 183 editions, both hemispheres
      imported 2026-10-21)
- [ ] agentBookingConfig.services: map her 6 services → their GHL
      calendar IDs (admin-set JSON; voice/chat/MCP booking then
      service-aware)
- [ ] Paper size needs no action (Letter auto via
      organizationCountryCode; DO is a Letter country)

## D. User-side prerequisites (Phase 0 of the plan, unchanged)
- [ ] US toll-free number + TF verification (SMS without A2P/EIN)
- [ ] GHL WhatsApp add-on (Meta Business Manager, number, display-name
      approval) — first live WhatsApp E2E happens here
- [ ] Her WP server transfer (the Next.js → WP move already proven on
      the test subdomain)
- [ ] Outbound voice geo permissions for her callback destinations
      (US/CA auto + home country; enable main EU as needed)

## E. First-content gate
- [ ] Standard pilot rigor: Veit reviews the first article/newsletter/
      social batch and the compiled guide PDFs (land pending_review)
      before anything auto-publishes.
