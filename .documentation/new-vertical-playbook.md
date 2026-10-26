# New Vertical Playbook

Everything we learned launching the second vertical (Wellness & Recovery,
Oct 2026, pilot: Whealth Recovery Center / "Dasha Maximov's Account").
Follow this top to bottom for vertical #3. The wellness build took ~1 week
of engineering spread over ~2.5 weeks; most of it is now reusable rails, so
the next vertical is mostly content + snapshot work.

Companion docs: `wellness-snapshot-checklist.md` (the worked example of
section D), `wellness-snapshot-nurture.md` (nurture copy + keyword),
`ghl-snapshot-guide.md` (the chiro base snapshot), plan:
`.plans/wellness-vertical.implementation-plan.md`.

---

## A. Decisions to lock BEFORE building anything

1. **Vertical key** — short lowercase slug (`wellness`). It goes into
   `KNOWN_VERTICALS` (apps/api/src/lib/ghl/auto-provision.ts), the
   Specialization rows, LeadGenTemplate rows, and the snapshot marker.
2. **Claims policy** — what the content may and may not say. For wellness:
   SUPPORT language, no outcome promises, no condition claims; "evidence
   varies by modality" honesty. This gates ALL content work, so get
   sign-off first. It materializes as a `PlainLanguageConfig` row whose
   `industry` string must later be matched EXACTLY (see C4).
3. **The B2C quiz concept** — the lead-gen front door. Naming rule learned
   the hard way: aspirational, never deficit-framed ("Biological Age
   Check", NEVER "recovery check" — nobody self-identifies into a deficit).
   The quiz must route each lead to a matched guide (see C6).
4. **Specializations are AUDIENCE ORIENTATIONS, not service lines.** One
   `recovery_wellness` specialization covers HBOT+PEMF+massage+...; the
   modalities live in topic seeds and the services map (agentBookingConfig),
   not in the specialization registry. Resist creating one per service.
5. **ONE comment keyword, and it leads to the quiz.** The quiz routes to
   the matched guide anyway; per-guide keywords bypass the capture.
   Keyword criteria: feels good to type publicly (aspirational, not an
   admission), markets the offer by itself, near-zero organic collision in
   comments. Wellness = `WELLNESS` (superseded `AGE`). In GHL the comment
   automation must use EXACT match, especially for dictionary words.
6. **Target market framing** — remember the standing rule: US + international,
   never infer AU-centric anything (AU is only the dev clinic).

## B. Platform code (ordered; most is now one-row/one-entry work)

1. **Vertical plumbing**: add the key to `KNOWN_VERTICALS`
   (auto-provision). `Account.vertical` drives everything downstream via
   `verticalForUser` (lib/prompt-resolver).
2. **Prompt overrides**: PromptTemplate has a vertical dimension with
   'default' fallback — only add override rows where the chiro/default
   wording is wrong (e.g. `q_myths` via `mythsQuestionFor(vertical)`).
   Audit, don't blanket-copy: the arc compliance preamble turned out to be
   vertical-neutral already.
3. **Specialization row(s)**: insert with `vertical: '<key>'` and
   `enabled: false` until the calendars are imported, then `enabled: true`.
   The registry is vertical-scoped (`specializationRegistryKeys(vertical)`),
   so an enabled row can never leak into other verticals' onboarding.
   `enabled` means exactly one thing: "calendars exist".
4. **PlainLanguageConfig row** (claims policy): the `industry` value is
   matched LITERALLY by the injection pass, which silently skips on any
   mismatch. The profile commit pins the exact string for the vertical
   (commits.ts — add the new vertical to that pin), so this trap is closed
   as long as you add the pin.
5. **Calendars**: 2 article (Tue/Thu) + 2 newsletter calendars (cadence may
   differ per vertical — wellness is Mon/Wed/Fri, 3/wk vs chiro's 4/wk),
   Northern + Southern hemisphere each. Generate via the Gemini-browser
   skills (article-topics-generator / newsletter-topics-generator), validate
   (dupes, dates, seasonal integrity, claims scan), import both envs.
   Vertical-specific ingredient language may be FINE per the claims policy
   (wellness recipes may say detox/immune-support — they sell nothing).
6. **Quiz**: build under its own module (apps/api/src/age-check/ is the
   template), dispatch in `lib/quiz.ts` (onboarding publish, linktree
   label+URL, trigger-link repoint). Capture: vertical lead tag + matched
   guide tag; `GUIDE_SLUG_BY_PILLAR` maps quiz dimensions → guide slugs;
   `guidesAvailable` gates delivery promises. The not-quiz-matched
   first-visit guide is offered as the results-page one-liner
   (`firstVisitGuideTitle`).
7. **Guide masters**: pillar guides (one per quiz dimension) + a
   "What to Expect at Your First Visit" guide (chiro master 05 pattern —
   the results-page extra). Specs in packages/db/scripts/leadgen-masters/,
   registered in seed-leadgen-masters.ts with the `vertical` column
   (LeadGenTemplate filters at onboarding compile-all, GET /leadgen/templates,
   from-template create). Art: flat-geometric house palette
   (#1F3A5F/#FAF0D7/#F4F8F7/#D7EBE8/#35507A/#52709E), covers on navy,
   interiors on #F4F8F7; approve via an artifact gallery before seeding.
   Paper size is country-aware already (Letter default incl. non-A4-world).
   The seeder has a DASH-FREE gate — em/en dashes anywhere fail the seed.
   ⚠️ SEEDING RECIPE: in-container `tsx` FAILS (the image ships only dist,
   not apps/api/src). Bundle locally:
   `node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild
   packages/db/scripts/seed-leadgen-masters.ts --bundle --platform=node
   --external:@prisma/client --outfile=seed-masters.cjs`, copy the
   `assets/` dir NEXT TO the bundle (loadAsset reads `__dirname/assets`;
   templates store self-contained HTML so assets are seed-time only), then
   scp → docker cp → `NODE_PATH=/app/node_modules node seed-masters.cjs`.
8. **WP taxonomy**: add the vertical's category + tag sets in
   lib/wp-taxonomy.ts (`wpCategoriesForVertical`/`wpTagsForVertical`).
   Align categories with the quiz dimensions so articles categorize
   naturally. Three consumers resolve the vertical already (onboarding
   step incl. pitch wording, commit, Settings bare-site bootstrap).
9. **Onboarding vertical-aware checkpoints** (all built — verify, don't
   rebuild): specialization checkboxes + crawl detection prompt (B3), the
   social lead-gen consent step's keyword pitch AND `commitCta`'s
   dm_keyword preset (`KEYWORD|asset name`), wp_categories, quiz publish,
   industry pin.
10. **Booking**: multi-service booking is generic
    (`agentBookingConfig.services` [{key,label,calendarId,synonyms[]}],
    per-service slots, MCP service param). Per-clinic and admin-set BY
    DESIGN — no code work per vertical, one config per clinic.

## C. Hard-won GHL facts (these cost us real debugging time)

1. **GHL snapshot cloning copies custom-value KEYS but STRIPS their
   VALUES.** Consequences:
   - You cannot ship a value in a snapshot. "Neutral default" values
     (pending-page URLs etc.) arrive EMPTY in clones.
   - The vertical therefore rides in a marker KEY NAME:
     `omniply_vertical_<key>` custom value in the snapshot (value
     irrelevant). Auto-provision reads the key pattern. A hand-set
     non-empty `omniply_vertical` value still wins.
   - Any writer that POSTs custom values will FAIL on cloned locations
     (the key already exists) — all our writers now upsert
     (list → PUT by id, else POST). Keep it that way.
2. **The workflows API is LIST-ONLY** (id/name/status/version). Steps and
   inline email bodies are not readable or writable. Workflow email
   layouts must be copy-pasted from the UI's code view; attaching emails
   to steps is always manual.
3. **Email templates (library) DO travel in snapshots** — but trigger-link
   merge ids inside them DON'T survive replication. URLs a template needs
   per-location go through custom values written by our code at send-time
   semantics (the omniply_review_url pattern). Trigger links INSIDE
   workflow emails DO survive (the guide-drip design relies on it).
4. **Email builder API recipe**: POST /emails/builder {locationId,
   type:'html'|'blank', title, body} returns 201 but installs DEFAULT
   content; then POST /emails/builder/data {locationId, templateId,
   updatedBy, editorType:'html', html} sets the real HTML. Reading a
   drag-and-drop template's structure needs the builder READ scope
   (GET /emails/builder/data/{id}); 'blank' creates a d&d template.
   Client-editable emails should be drag-and-drop; locked transactional
   ones can be code-view HTML.
5. **Trigger links**: compile repoints by LITERAL NAME match
   (`omniply-guide-<slug>`) — a typo is a silently dead drip link. The
   quiz link KEEPS the legacy name `omniply-spine-check` in every vertical
   (the repoint code looks for it and writes the vertical-correct URL).
6. **Do NOT install the marketplace app on a snapshot template
   sub-account.** The install webhook auto-provisions a real account and
   writes live tokens into the template's custom values. Templates get no
   app; clients get it via the SaaS plan.
7. **A SaaS plan carries ONE snapshot** → each vertical needs its own plan,
   bundling the SAME marketplace app. Re-attach snapshot + app to the plan
   after every snapshot re-save.
8. **Private Integration keys**: location-scoped, can't self-identify
   (always ask for the Location ID), die with scope edits unpredictably —
   do all planned API work while one is confirmed alive, and delete
   key-bearing scripts from droplets immediately after use.
9. **GHL API calls from a local machine can hit Cloudflare 1010** — run
   them from the droplet via docker exec + Node fetch.
10. **Custom objects**: schema delete is NOT supported by API ("not
    supported yet") — UI only. (We removed the AI Activity object; the
    dashboard reads Postgres. Don't re-introduce snapshot-side data
    objects without a consumer.)

## D. Snapshot build (clone chiro → vertical template)

Work in a fresh sub-account created FROM the chiro snapshot. The worked
example with checkboxes is `wellness-snapshot-checklist.md`. Summary:

1. Trigger links: delete the old vertical's guide links (they point at the
   template's real Drive files — poison for clones), create the new
   `omniply-guide-<slug>` set at a placeholder URL, keep
   spine-check/booking/review.
2. Custom values: add the `omniply_vertical_<key>` marker. (Values you add
   won't survive into clones — see C1 — so only key presence matters.)
3. Nurture workflow: tag-OR trigger across the vertical's `leadgen-*`
   tags, Email 0 delivers via the guide trigger link, follow-ups never
   link the doc, booking CTA, pipeline opportunity + booked/stage exits.
   Emails as library templates (friend-style plain, 600px centered, 20px,
   minimal footer + unsubscribe) assigned to steps; attach trigger links
   per step in the builder.
4. Comment workflow: ONE keyword → DM the quiz trigger link, public reply
   "Just sent it to your DMs!", exact match. Delete all other keyword
   workflows from the clone.
5. Review-request workflow: keep; verify the counter WEBHOOK step exists
   (POST {{custom_values.omniply_review_request_webhook}}) — it was added
   to the chiro source after some clones.
6. Language sweep: patient/spine/adjustment wording in every remaining
   workflow email + SMS; grep mentality, and NEVER name GHL in
   customer-facing copy ("your Omniply CRM").
7. Transactional emails: the two Omniply code-view templates travel with
   the clone; point the booking-confirmation + review-request workflow
   emails at them (manual, no workflow API).
8. Dashboard: add the AI Receptionist URL widget
   ({{custom_values.omniply_ai_dashboard_url}} via the {} picker), delete
   native widgets (the panel replaced them all).
9. Save as the vertical's snapshot → create its SaaS plan (snapshot +
   same app + pricing/coupon). Re-save + re-attach after later edits.

## E. Provisioning & funnel (automated — verify, don't redo)

Purchase → location from the vertical's snapshot (carries the marker key)
→ install webhook → auto-provision: mints tokens, UPSERTS webhook custom
values, reads the marker → account born with the right vertical →
onboarding surfaces the right specialization/quiz/categories/keyword →
profile commit pins the claims-policy industry string.

Per-pilot verification (2 minutes, worth it every time):
- The provision log line shows `vertical: '<key>'`.
- The location's omniply_* custom values are SET (not empty).
- After onboarding: BrandSettings.industry === the PlainLanguageConfig
  string; socialCallToAction === the vertical's `KEYWORD|asset`.

What stays manual per clinic BY DESIGN: `agentBookingConfig.services`
(service→calendar map), phone number + A2P (user side), WhatsApp/WABA
(user side), social accounts connected in GHL then our mapping re-run.

## F. Pilot-day lessons (Whealth, 2026-10-22)

1. **If the vertical was hand-flipped after account creation, the crawl
   already ran with the wrong registry** → the Brand Profile draft holds
   foreign specialization keys, nothing valid is checked, and the confirm
   button is dead. Fix: rewrite
   stepData.brandProfileDraft.specializations/primarySpecialization to the
   vertical's key, have them reload. (Born-right vertical prevents this
   entirely.)
2. **DEPLOY FREEZE while a client is onboarding or a batch is
   generating.** The queue gate only sees jobs that exist at push time; an
   onboarding finishing minutes later starts a burst your deploy will
   kill. pg-boss recovered ours, but don't rely on it.
3. Voice-answer transcription can hang up to ~2 min worst case (Gemini
   retry ladder 45s+75s) — looks stuck, recovers alone.
4. WordPress step: skipping is fine (hosted quiz/linktree fallbacks);
   connect later via Settings. Don't connect a staging/transfer WP copy on
   a foreign domain. Until WP connects, articles have nowhere to publish.
5. The socials step snapshots GHL's connected accounts AT THAT MOMENT —
   an "okay" with nothing connected just stores an empty map; re-run the
   mapping any time after they connect.
6. **Limiting the first burst**: the ContentBatch runs sequentially;
   deleting its `pending` ContentBatchItem rows (never the generating
   ones) trims it safely to any size. Items can be re-added later from
   the content plan.
7. Step buttons that look stuck: `pending` cards poll with a "Check
   again"; a faded button is either the busy flag (reload) or a
   validation (see F1).

## G. Per-vertical cost of the rails (what vertical #3 actually needs)

- Code: KNOWN_VERTICALS entry, Specialization row(s), PlainLanguageConfig
  row + industry pin, prompt override rows where needed, quiz module (or
  reuse), guide master specs + art, WP category/tag sets, calendar
  imports. No provisioning, booking, dashboard, email, or webhook work.
- GHL: one snapshot build (section D), one SaaS plan.
- Docs: clone wellness-snapshot-checklist.md as the working checklist.
