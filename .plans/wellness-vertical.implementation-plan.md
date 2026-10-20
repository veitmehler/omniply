# Wellness/Recovery Vertical + Whealth Pilot (Cabarete, DR)

Status: **PLANNED 2026-10-20 — not started.** Pilot: Whealth Recovery Center
(cabaretehealth.simonchirocenter.com is the WP test; her production Next.js
site will be transferred to WP on our stack — transfer is user/owner-side).
Owner has a warm pipeline of similar clinics → one vertical build, N leads.

## What the clinic is
Recovery & wellness center (US analogue: Restore Hyper Wellness). Services:
HBOT, PEMF, whole-body vibration, compression boots, KAATSU, sports massage,
physiotherapy, OligoScan, peptide consultations; retreats, memberships,
packages, product line. Cash-pay, appointment-driven, tourist-heavy clientele
(site is EN/ES/DE/FR/RU). Six distinct booking calendars needed.

## Decisions already made (Veit, 2026-10-20)
- **No DR local numbers in LC Phone** (checked: zero inventory). She runs a
  **US number** — normal for her market.
- **WhatsApp is required** — primary channel for DR + international tourists.
- Integration is **fully GHL** (white-label "her Omniply CRM", as always).

## Architecture read (what already exists — verified in code 2026-10-20)
- `Account.vertical` (default 'chiro') + PromptTemplate vertical dimension:
  'default' rows are the chiro-tuned base, override rows exist only where a
  vertical differs (resolution: exact vertical row, else 'default'). A new
  vertical is mostly *absence* of overrides.
- Calendars are `industry + specializationKey + hemisphere` with an
  admin-managed `Specialization` table — wellness is a new Specialization row
  + 2 article + 2 newsletter calendars, NOT a schema change.
- `PlainLanguageConfig.restrictions` (per-industry advertising-claim
  limitations injected into EVERY generation) is the ready-made hook for the
  HBOT/PEMF/peptide claims policy.
- Agent booking: `agentBookingMode` + `agentBookingCalendarId` (single) +
  `agentBookingConfig Json` — the Json field is the natural home for a
  service→calendar map; no migration needed.
- Agent DM channels: `CHANNEL_TYPES` in agent/dm.ts is FB+IG only, built to
  extend ("Extend to enable more channels") — WhatsApp is an entry + the
  Conversations-API channel resolution it already does.

## Phase 0 — Prerequisites & decisions (mostly user-side)
1. **Number: US toll-free vs US local 10DLC.** ⚠️ A2P 10DLC brand
   registration generally wants a US tax ID; she is a DR entity. Toll-free
   verification accepts a business address anywhere → **recommend US
   toll-free** (SMS-capable after TF verification, no EIN, no A2P). Verify in
   LC Phone TF-verification flow before promising. US local + 10DLC only if
   toll-free deliverability disappoints.
2. **GHL WhatsApp add-on** on her sub-account (~$10/mo, Meta WABA): needs a
   Meta Business Manager, a WhatsApp-dedicated number (can be the new US
   number if it has no prior WA registration), and display-name approval.
3. **WP server transfer** (hers): the Next.js→WP test already passed; she
   moves production to the WP instance, we get an application password at
   onboarding (standard flow). The pasted test password gets revoked now.
4. **Claims policy sign-off (Veit)**: draft FDA/FTC-safe restriction text for
   HBOT/PEMF/peptides (recovery/wellness-support framing; never
   disease-treatment claims; peptides = "consultation" language only). Veit
   approves before any content generates.
5. **Pricing**: standard $397/mo; voice metering per post-launch plan.

## Phase 1 — Multi-service booking layer (platform-wide; chiro benefits too)
Status: **BUILT 2026-10-20.** Config shape shipped as
`agentBookingConfig.services: [{key,label,calendarId,synonyms[]}]`
(lib/booking/services.ts parser; direct-ghl only; absent/invalid = classic
single-calendar, byte-identical). Engine renders per-service inventory with
tighter per-service caps (14/svc, full detail day 1) + service rules; the
validator pins slot↔service (offeredByService); executeBooking books on the
service's calendar and stamps the service into note/booking-time field; MCP
get_availability/book_appointment gained the service param (enum of keys,
required when configured). Scope note vs. the original sketch: NO client
Settings editor — booking mode/calendar themselves are deliberately
admin-set until the rollout Settings surface lands (routes/pms.ts), so the
services map is admin-set the same way.
Goal: AI agent (voice + chat + MCP) books across N service calendars.
- `agentBookingConfig.services`: `[{ key, label, calendarId, durationMin?,
  synonyms[] }]`; absent → today's single-calendar behavior (zero regression).
- Engine/context: inject the service menu as facts; conversation asks which
  service when ambiguous; availability fetched per matched service's
  calendarId (hours.ts negative-availability discipline applies per calendar).
- Voice `book_appointment` + MCP `get_availability`/`book_appointment`: add
  `service` param (enum from config); schema-EntryPoint doc on
  omniply.io/agents updated.
- Settings UI: service↔calendar mapping editor in the booking panel.
- Tests: service resolution (synonyms, ambiguity), fallback single-calendar
  path untouched, MCP param validation. E2E against demo + a second calendar.
- Estimate: 2–4 days. **Do this first** — it unblocks her core ask and is
  the piece every multi-service chiro clinic also wants.

## Phase 2 — WhatsApp channel
Status: **PLATFORM SIDE BUILT 2026-10-20.** CHANNEL_TYPES += TYPE_WHATSAPP/
WHATSAPP → 'WhatsApp' (send-type confirmed against the GHL send-a-new-message
enum: SMS, Email, WhatsApp, IG, FB, Custom, Live_Chat; inbound arrives as
TYPE_WHATSAPP). The DM transport was already channel-generic, so inbound WA →
Customer Replied workflow → same webhook → same agent pipe → reply as
'WhatsApp'. No GHL workflow change needed (it fires on every inbound reply;
we filter server-side). ⚠️ NOT live-E2E-testable until a WABA exists — first
real test happens at the pilot's onboarding (checklist below).
- `CHANNEL_TYPES` += TYPE_WHATSAPP → 'WhatsApp' (confirm GHL send-type string
  against Conversations API docs); channel resolution via
  findGhlConversationChannel already exists for builder-less triggers. DONE.
- Inbound WA lands in GHL Conversations → same Customer Replied workflow →
  same agent pipe. Expected: config + one enum entry + send-path test.
- **24-hour session rule**: free-form replies only within 24h of the
  customer's last message; business-initiated (review requests, recall,
  booking reminders) need pre-approved WA templates. v1: agent replies
  (always in-session) + reminders via templates created in GHL's template UI
  (user-side); recall/review drips stay SMS/email until templates approved.
- Estimate: 1–2 days platform + user-side Meta/GHL setup.

## Phase 3 — Wellness vertical content pack
Status: **IN PROGRESS 2026-10-20.** Done: vertical-aware q_myths
(mythsQuestionFor in flow.ts; chiro keeps the original wording),
specializationRegistryKeys now honors `enabled` (staged rows invisible to
onboarding), `recovery_wellness` Specialization row inserted DISABLED on
prod + staging. Arc compliance preamble audited: already vertical-neutral
("healthcare practice… never clinical claims/outcomes/condition promises")
— applies to HBOT/PEMF as written, NO code change needed. GATED on the
claims-policy sign-off below: PlainLanguageConfig row insert, calendar topic
generation, lead magnet + nurture copy.

### Claims policy for industry "Wellness & Recovery" — SIGNED OFF (Veit) + INSERTED prod/staging 2026-10-20
⚠️ Onboarding convention: the pilot account's BrandSettings.industry must be
set to exactly "Wellness & Recovery" (case-insensitive match) or the whole
injection pass silently skips. Specializations stay audience orientations,
NOT service lines (Veit agreed 2026-10-20): one `recovery_wellness` calendar
for the pilot; modality coverage via topic seeds.
Becomes `PlainLanguageConfig.restrictions` (injected into every article/
newsletter generation for matching accounts; same mechanism as chiro):

> ADVERTISING-CLAIM RESTRICTIONS (wellness & recovery center — hard rules):
> 1. FRAME EVERYTHING as recovery, performance, relaxation, and general
>    wellness SUPPORT. Never present any service as treating, curing,
>    preventing, or diagnosing any disease, illness, or medical condition.
> 2. HBOT (hyperbaric oxygen): an active FDA/FTC enforcement target. NEVER
>    name a disease or condition it helps (not cancer, autism, Lyme, long
>    COVID, stroke, dementia — not any). Allowed: recovery routines, how a
>    session works and feels, published research described with hedges
>    ("researchers have explored…", "a 2023 study examined…") and never as
>    proof of benefit. Never the words "heal", "treat", "cure", "therapy
>    for <condition>" in connection with HBOT.
> 3. PEPTIDES: strictest category — many compounds are not FDA-approved.
>    NEVER name specific peptides' effects, suggest doses, or promise
>    outcomes. The ONLY allowed framing is the consultation itself: a
>    practitioner-led conversation about options, suitability, and sourcing
>    safety. No peptide product claims of any kind.
> 4. PEMF, whole-body vibration, compression, KAATSU, massage,
>    physiotherapy: recovery/circulation/mobility SUPPORT language with
>    honest hedges ("many clients use…", "may help you feel…"). No injury-
>    treatment promises, no "fixes", no named-condition relief claims.
> 5. PRODUCTS (teas, supplements): FDA structure/function rules — "supports"
>    language only, never disease claims, and when a product benefit is
>    stated, note that such statements are not FDA-evaluated.
> 6. NO detox-cure, disease-reversal, anti-aging-as-fact, or longevity-
>    promise framing. Aging, inflammation, and recovery may be DISCUSSED as
>    topics; outcomes may not be promised.
> 7. PROOF: only de-identified transformed client stories from the provided
>    material and the practice's own aggregate numbers (review counts,
>    ratings). Never named testimonials, never before/after health claims.
> 8. Always point readers to qualified medical professionals for medical
>    concerns; the practice complements, never replaces, medical care.

Starter plain-language exemplars (metaphor bank, same table's `exemplars`):
HBOT chamber = "a pressurized room that lets your blood carry extra oxygen,
like turning up the water pressure so every sprinkler on the lawn reaches
further"; PEMF = "a gentle magnetic pulse, like a metronome your cells can
rest to"; compression boots = "a wave pattern that walks fluid up your legs,
the way squeezing a toothpaste tube from the bottom moves everything along";
KAATSU/BFR = "training with a light safety brake on blood flow so muscles
work hard at low loads"; fascia = "the cling-film layer that wraps every
muscle"; VO2/recovery capacity = "the size of your body's fuel line, not the
size of the tank".
- Specialization row `recovery_wellness` (+ industry string "Wellness &
  Recovery" convention for BrandSettings.industry — plain-language REQUIRES
  industry, onboarding runbook already notes this).
- Calendars: 2 article + 2 newsletter (N/S hemisphere) via the existing
  topic-generator skills; seasonal-integrity rules as per 2026-09-30 fix;
  topic seeds themed on recovery/longevity/performance, NOT medical claims.
- `PlainLanguageConfig` row: wellness exemplars + the Phase-0 claims
  restrictions (this injects into every article/newsletter automatically).
- Onboarding: q_myths wording de-chiro'd per vertical (template, not fork:
  "about recovery, about your methods…"); synthesis prompt takes industry.
- Prompt templates: start with ZERO overrides (vertical='wellness' resolves
  to 'default' everywhere), add override rows only where the chiro-tuned copy
  leaks chiro specifics (audit pass on first E2E output). Arc compliance
  preamble: generalize `arcRegisterDirective`'s chiro preamble to a
  per-vertical healthcare preamble (wellness variant = claims policy).
- Lead magnet: "2-Minute Recovery Check" (spine-check analogue) + guide
  variant through the existing Drive delivery; X-Ray nurture copy variant.
- Estimate: ~1 week, dominated by calendar generation+validation and the
  first-output audit pass. English-only v1; multilingual = explicit roadmap
  item, not promised.

## Phase 4 — Pilot onboarding (Whealth)
Zero-touch provisioning as usual, then: sub-account + snapshot; US toll-free
purchase + TF verification; WhatsApp add-on + templates; 6 GHL service
calendars created and mapped in the Phase-1 editor; WP app password on the
transferred site; brand onboarding (7 voice questions → pools, default-on
authority engine); palette extraction from her site; first content E2E with
the same review rigor as the 2026-10 clinic test (article quality, audit,
arcs, figure gate); voice smoke call on the US number; outbound geo
permissions for her callback destinations (US/CA auto; enable DO + main EU).
Gate: Veit reviews first content batch before anything auto-publishes.

## Phase 5 — Her referral pipeline
Snapshot + vertical are reusable as-is for sibling clinics; consider a simple
referral arrangement (out of scope here). Each new clinic = standard
onboarding, no new engineering.

## Order & total
Phase 1 → 2 in parallel with 3 → 4. Realistic total: **2–3 weeks** to a live
pilot, of which engineering is ~1 week (Phases 1–2) and the rest is content
pack + user-side GHL/Meta/number admin + review gates.

## Risks / open checks
- TF verification for a DR entity (expected fine — address anywhere — but
  verify in LC Phone flow before promising SMS timelines).
- WhatsApp display-name/template approval latency (Meta, days not hours).
- HBOT/peptide claims: content NEVER generates before the restrictions row
  exists (enforce by creating PlainLanguageConfig row in Phase 3 before
  calendar assignment).
- International SMS/voice rates for EU-tourist callbacks (cost note in her
  onboarding, not a blocker).
- Multilingual content demand from her five-language site — explicitly v2.
