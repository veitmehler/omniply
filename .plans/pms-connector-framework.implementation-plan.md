# PMS Integration Framework v2 — Availability Tiers, Booking, Contact Pipe

**Status: PLANNED (v2, 2026-10-06) — supersedes the 2026-07-15 parked v1,
whose core decisions are PRESERVED below. Direction + phrasing locked with
Veit 2026-10-06. Build sits in the client-rollout lane: nothing here blocks
filming or launch; Phase A–C are the first post-launch-prep engineering
block, the Jane application is paperwork to file NOW.**

## The two product problems this solves

1. **Availability on a call**: what may the voice agent SAY about times, per
   PMS, without ever being confidently wrong.
2. **Contact flow into GHL**: recall, reactivation, newsletters and review
   requests only work on patients who exist in the CRM — existing base at
   onboarding AND new patients forever after.

## Decisions (locked)

- **Three availability tiers** (below); the exact-slot truth guarantee
  applies ONLY to Tier 1; Tier 2 uses the canonical stale-disclaimer
  phrasing; Tier 3 speaks patterns, never times.
- **Canonical Tier-2 phrasing (Veit, 2026-10-06, verbatim intent):**
  > "I can currently see availability at X, Y and Z. But the front desk
  > might have recently booked one of those slots — so please open the
  > booking link I'm sending you, confirm the available times, and book
  > your appointment right there at your convenience."
  The disclaimer + confirm-on-link step is MANDATORY in this tier, never
  optional, never summarized away.
- **Demographics-only sync** (name, phone, email, tags) **plus appointment
  TIMESTAMPS** (v1 decision, kept: timestamps drive `appointment-completed`
  / `first-visit-completed` tags → the dormant review-request workflow +
  New Patient pipeline). NEVER clinical data, never appointment types that
  imply conditions (HIPAA-adjacent / Privacy Act / GDPR posture).
- **One-way PMS → GHL for data; booking writes only through real APIs**
  (Tier 1). GHL never becomes a shadow diary for a PMS clinic.
- **Tag separation (v1, kept, strict):** service-communication tags
  (`pms-import-*`, `appointment-completed`) stay separate from marketing
  tags — synced patients are NEVER auto-subscribed to newsletters; the
  clinic owns that consent decision explicitly.
- **Cliniko first** regardless of cohort data (cleanest API, per-clinic key
  = the same paste-one-key UX as ElevenLabs/WordPress); Nookal second
  (same shape). **Jane Developer Platform application filed EARLY** — the
  demographics-only scope is a strong application story. ChiroTouch
  partnership only when client count justifies it.
- **No scraping of booking pages, ever** (fragility, anti-bot, ToS,
  partnership poison, truth-guarantee breakage — analysis 2026-10-06).
- **Booking-link flow stays first-class forever**: every major PMS ships a
  hosted booking page, so link-texting covers ~100% of clinics on day one.

## The three availability tiers

| Tier | Source of truth | Agent behavior | Who |
|---|---|---|---|
| **1 · Direct** | Real API free-slots | Current pipeline: offer ≤3 times at different hours, book in-call via `book_appointment` (exact-ISO validated), confirm aloud | GHL-calendar clinics (live), Cliniko, Nookal; Jane post-JDP |
| **2 · Advisory** | GHL calendar mirroring the clinic's Google Calendar (PMS → Google sync, hours-stale by nature) | Speak ≤3 times WITH the canonical disclaimer, then `send_booking_link` (text/chat). `book_appointment` DISABLED — validator refuses it in this mode | Jane (iCal feed → Google), zHealth/ChiroFusion if their Google sync proves real, any clinic maintaining a Google mirror |
| **3 · Patterns** | One onboarding question ("when do you typically have availability?") stored in the KB | Hedged patterns only ("we usually have afternoon openings Tuesdays and Thursdays"), never specific times, then `send_booking_link` | ChiroTouch, ChiroSpring, TM3, everyone else |
| (0 · none) | — | Today's behavior: booking link / phone / callback | Clinics w/ no online booking |

Degradation rules: Tier 1 with zero slots or a failed fetch degrades to the
clinic's Tier-2/3 config for that call; Tier 2 with a stale-empty mirror
degrades to Tier 3. Never upward.

## Architecture

### A. Booking/availability side

1. **Provider interface** (extract from today's GHL-only code):
   `freeSlots(account, window) → ISO[]`, `book(account, {slotStart, name,
   phone, email?}) → {externalId}`, `cancel(account, externalId)`.
   Implementations: `ghl` (exists — becomes the first provider), `cliniko`,
   `nookal`. Tier 2 has NO provider — it reuses the ghl `freeSlots` against
   the Google-mirroring calendar with booking disabled.
2. **Account config** (replaces the bare `agentBookingCalendarId` gate):
   - `agentBookingMode`: `'off' | 'direct-ghl' | 'direct-cliniko' |
     'direct-nookal' | 'advisory-gcal' | 'patterns'` (default `off`).
   - `agentBookingCalendarId` (direct-ghl + advisory-gcal), provider config
     JSON (`clinikoBusinessId`, `practitionerIds`, `appointmentTypeId` —
     Cliniko slots are natively per-practitioner, which is where the
     "which practitioner?" conversation eventually plugs in).
   - Keys in the ApiKey table (`provider: 'cliniko' | 'nookal'`),
     encrypted, validated on save like the ElevenLabs key — WITH a
     permission probe (lesson learned: validate the permissions the
     feature needs, not just that the key is real).
3. **Engine**: `bookingInfoFor` returns `{mode, slots}`; per-mode prompt
   blocks — Tier 1 = current block; Tier 2 = canonical phrasing template +
   send_booking_link choreography; Tier 3 = patterns text from KB.
   Validator: `book_appointment` accepted ONLY in direct modes.
4. **Audit**: `agent_appointments` gains `provider` + `externalId`
   (generalizing `ghlEventId`).

### B. Contact pipe (one pipe, many feeders)

**The pipe** (single module): normalized `{name, phone, email, tags[],
source}` → GHL contact upsert (phone-first dedupe, existing machinery) +
event-tag application. Idempotent; every feeder converges here.

**Feeders:**
1. **API pollers** (Cliniko now, Nookal next, Jane post-JDP):
   `fetchChangedPatients(since)` / `fetchChangedAppointments(since)` via
   the PMS `updated_since` filters; cron every 5 min (leadgen-poll
   pattern); per-account cursor stored. Completed-appointment timestamps →
   `appointment-completed` / `first-visit-completed` tags.
2. **CSV onboarding import**: every PMS exports a patient list; an import
   step maps columns → the pipe. Covers the EXISTING base for all
   platforms at onboarding.
3. **Periodic refresh ritual** (closed platforms): Settings "re-upload
   your patient list" (default cadence: monthly nudge), diffed against GHL
   so only new rows import. Bounded gap: walk-ins/PMS-direct patients wait
   at most one cycle; anyone arriving through OUR funnels is in GHL from
   birth regardless.
4. **(Later) Jane Patients API** once the JDP application is approved.

**Consent hygiene**: `pms-import-<provider>` source tags; onboarding
runbook checkbox — the clinic confirms its patient-communications policy
covers recall/service contact; marketing-list addition stays a separate,
explicit clinic action.

## Per-PMS playbook

| PMS | Availability tier | Booking | Contacts | Notes |
|---|---|---|---|---|
| GHL-native | 1 (live today) | in-call | native | current demo path |
| **Cliniko** | 1 | in-call via API | poller | FIRST build; AU/NZ/UK beachhead; per-clinic API key |
| **Nookal** | 1 | in-call via API | poller | near-free second (same shape) |
| **Jane** | 2 now → 1 post-JDP | link now → API later | CSV+ritual now → Patients API later | file JDP application NOW; Jane→Google feed is stale iCal (fits Tier 2 exactly); their Google→Jane busy-pull is irrelevant to us (we don't book) |
| zHealth / ChiroFusion | 2 IF their Google sync proves API-grade in a pilot, else 3 | link | CSV+ritual | verify sync depth with a real account before promising Tier 2 |
| **ChiroTouch** | 3 | link | CSV+ritual | biggest US prize, partner-gated; pursue when cohort justifies |
| ChiroSpring / TM3 / rest | 3 | link | CSV+ritual | — |

## Onboarding additions (when phases land)

- PMS dropdown (exists, data-capture) now SELECTS the available modes.
- Tier-3 question: "When does your practice typically have availability?"
  → KB `availabilityPatterns`.
- Tier-2 setup guide: per-PMS "connect your PMS calendar to Google" steps
  (Jane: the two one-way syncs) + Google → GHL calendar conflict-check
  (the free-slots-respects-Google-busy VERIFY item from the missed-call
  plan is the build gate here too).
- CSV import step + the booking-page QA check: the link loads and accepts
  NEW patients (some clinics restrict online booking to existing patients
  — the agent must never text a link a new caller can't use).

## Phasing & effort

| Phase | Work | Size | Gate |
|---|---|---|---|
| **0 (now)** | Veit files the Jane JDP application (demographics-only sync + booking, clinical data never leaves Jane) | paperwork | — |
| A | Provider interface + modes schema + per-mode prompt blocks + validator gating + audit generalization | ~1.5 d | all current tests green; demo (direct-ghl) behavior unchanged |
| B | Tier 2 advisory: canonical phrasing template, Google-mirror setup guide, free-slots-vs-Google-busy verification | ~1 d | live test: a Google-busy block visibly removes a spoken slot |
| C | Contact pipe + CSV import + refresh ritual + consent tagging | ~1.5 d | import 100-row CSV → deduped GHL contacts, zero marketing-tag leakage |
| D | Cliniko provider (slots/book/cancel) + patient/appointment poller + Settings key flow (with permission probe) | ~2–3 d | pilot clinic E2E: in-call booking lands in the REAL diary; review-request tag fires after a completed visit |
| E | Nookal provider | ~1 d | same gates |
| F | Jane build (post-approval) | sized on approval | — |

## Invariants (the non-negotiables)

1. Exact times are spoken as bookable ONLY in Tier 1. Tier 2 ALWAYS
   carries the canonical disclaimer + link-confirm step. Tier 3 NEVER
   speaks specific times.
2. `book_appointment` validates against server-offered exact ISO slots,
   direct modes only — unchanged from the live pipeline.
3. Clinical data never leaves the PMS. Appointment TYPES never sync.
4. Synced patients never auto-enter marketing lists.
5. No booking-page scraping, under any pressure.

## Open questions (decide at Phase D, not before)

- Cliniko patient creation on booking: match-by-phone + create-if-new, or
  match-only with callback fallback when ambiguous? (Clinic-policy per
  onboarding, with a default — lean: create-if-new with `source: omniply`.)
- Default Cliniko appointment type for AI bookings ("New Patient
  Consultation") — per-clinic picker.
- CSV refresh default cadence (monthly vs quarterly nudge).
- Whether advisory Tier 2 is offered proactively or only on clinic request
  (staleness expectations conversation required either way).
