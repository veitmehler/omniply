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
Delete the five chiro `omniply-guide-*` links; create four:
- [ ] `omniply-guide-everyday-strength-guide`
- [ ] `omniply-guide-better-sleep-guide`
- [ ] `omniply-guide-switch-off-guide`
- [ ] `omniply-guide-everyday-fuel-guide`
Placeholder destinations are fine: compile repoints by LITERAL NAME match
at every guide regeneration. A typo = a silently dead drip link.

### Edit 2 — quiz trigger link: KEEP THE NAME `omniply-spine-check`
- [ ] Do NOT rename it to anything age-check. The repoint code looks for
      the literal legacy name and already writes the vertical-correct URL
      (wellness → the Biological Age Check) into it. Renaming it makes the
      repoint log "link not found" and skip.

### Edit 3 — comment-keyword workflows
Re-key to the locked wellness vocabulary (delete surplus chiro keyword
workflows):
- [ ] AGE → `omniply-spine-check` (the quiz)
- [ ] STRONG → `omniply-guide-everyday-strength-guide`
- [ ] SLEEP → `omniply-guide-better-sleep-guide`
- [ ] UNWIND → `omniply-guide-switch-off-guide`
- [ ] FUEL → `omniply-guide-everyday-fuel-guide`
Public comment reply stays: "Just sent it to your DMs!"

### Edit 4 — nurture workflow
- [ ] Trigger: Contact Tag Added, OR across the four wellness
      `leadgen-*` tags (see Edit 1 slugs, prefixed `leadgen-`)
- [ ] Email 0: four delivery branches (copy + branch table in
      wellness-snapshot-nurture.md)
- [ ] Emails 1 + 2: day 1 + day 4 follow-ups (same doc)
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
- [ ] Set `accounts.vertical = 'wellness'` BEFORE onboarding runs (flips
      quiz choice, template compiles, q_myths wording, arc compliance,
      linktree label)
- [ ] Flip Specialization `recovery_wellness` to `enabled: true` (both
      envs; it is staged disabled) so onboarding can select it
- [ ] Onboarding must set BrandSettings.industry to exactly
      "Wellness & Recovery" (case-insensitive match) or the claims-policy
      injection silently skips
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
