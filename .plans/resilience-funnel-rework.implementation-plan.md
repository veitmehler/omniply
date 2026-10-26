# Resilience Funnel Rework — implementation plan

Status: PLANNED (locked with Veit 2026-10-26). Supersedes the "Biological
Age Check + basics guides" funnel for the WELLNESS vertical only. Chiro is
untouched everywhere.

## Why (the two market signals, both from the Whealth pilot owner)

1. The four pillar guides teach fundamentals her audience already knows —
   people who walk into a biohacking/recovery studio have the basics; the
   lead magnet must teach the layer they DON'T know (modality science).
2. The "Biological Age" quiz angle is saturated in the wellness niche.

## The locked direction

**Funnel spine:** The Body Resilience Score ("How fast do you bounce
back?") → weakest of four bounce-back inputs → a modality-science guide
for that input → studio visit. Every layer shares one mental model.

Decisions locked 2026-10-26:
- **Quiz name**: "The Body Resilience Score". **Hook**: "How fast do you
  bounce back?" — the recovery concept carried WITHOUT the word
  "recovery" (reads athlete-self-check, not patient-intake). Subline
  positions against wearables: "...Two minutes, no wearable needed."
- **Re-test loop is the moat**: a resilience score plausibly moves month
  to month → "retake in 30 days" return loop + a progress metric the
  studio owns (impossible with bio-age). Build the retake invitation into
  the result screen + (later) nurture.
- **Four pillars stay** (move/sleep/unwind/fuel), reframed on the result
  screen as "your four bounce-back inputs". Score 0-100 + four bars +
  weakest input → matched guide (mechanics unchanged).
- **Score bands**: aspirational only — low end must never shame
  (working set: Developing / Solid / Strong / Elite; final at Phase 2).
  Claims framing: "a habit-based estimate of how well your routines
  support bounce-back, not a medical measurement."
- **Guides**: keep the four slugs + pillar mapping; rework CONTENT into
  "the layer beyond the basics": short respect-their-knowledge opening →
  physiology mechanism → the modality stack for that pillar → honest
  evidence-status table (established / promising / exploratory — the
  honesty IS the positioning) → self-experiment with metrics (HRV,
  resting HR). Per-account slot personalization adapts modality sections
  to each clinic's actual services.
  - move → smarter load: BFR/KAATSU, strength science
  - sleep → temperature, light, PEMF, what sleep-staging data means
  - unwind → nervous-system regulation: HRV, breathwork, heat/cold
  - fuel → hydration/electrolytes, timing, what to measure
  - **Peptides are EXCLUDED from all lead magnets** (claims/regulatory
    minefield; consult-room topic only).
- **Art**: monoline restyle — thin consistent stroke, precise small
  diagrams (HRV curve, session timeline, pressure diagram), same palette
  (#1F3A5F/#FAF0D7/#F4F8F7/#D7EBE8/#35507A/#52709E) but line-led, premium
  product-manual feel. Scope: all wellness assets (w6-w9 ×12 + w10 ×3).
  Chiro keeps its chunky flat-geometric style.
- **Comment keyword stays WELLNESS**: "Comment WELLNESS and I'll send you
  the 2-minute Body Resilience Score."
- **Multilingual note (v2)**: "resilience" translates cleanly
  (resiliencia/Resilienz/résilience); "bounce back" is the EN idiom —
  the NAME is the translatable half, correct way around.

## What does NOT change (scope guards)

- Internal keys and plumbing: `GUIDE_SLUG_BY_PILLAR` slugs, the
  `age-check` module/route paths, capture tag names
  (`age-check-lead` + guide tags), trigger-link names (incl. the legacy
  `omniply-spine-check` quiz link), Drive grant-all delivery, the
  `dm_keyword` preset mechanics, FIRST_VISIT_SLUG.
- The first-visit guide's CONTENT register (already modality-education);
  only its 3 figures get the monoline restyle for consistency.
- Everything chiro. Everything about provisioning/vertical detection.

## Phases

**Phase 0 — Dasha's input (Veit, now):** ask her which services/topics
she most wants the guides to teach (she is the audience expert and the
referral-pipeline voice). Her list anchors the modality stacks.

**Phase 1 — Review packet (me, ~half day):** one artifact for Veit+Dasha:
quiz treatment (headline, subline, result-screen copy, band names, retake
invitation), outlines for all four guides in the new register, ONE guide
fully drafted (move/BFR — clearest beyond-the-basics story), and two
sample monoline figures. GATE: both approve register + art before mass
production.

**Phase 2 — Quiz rework (me, ~half day):** age-check template copy +
scoring narrative (score math replaces age-delta math; AGE_MATH block
becomes the resilience scoring block), result screen (score + bands +
inputs + retake line), DEFAULT_TITLES fallbacks, linktree/CTA label
("Take the Body Resilience Score"), hosted page. OPEN QUESTION (decide at
build): WP page slug — recommend NEW slug `resilience-score` (user-visible
URL; cheap now with zero wellness clients live, expensive later), repoint
handles the trigger link either way.

**Phase 3 — Guides + art (me, ~1 day after approval):** finish the other
three drafts, full monoline asset set (15 SVGs), dash-free gate, reseed
both envs (bundled-seeder recipe in the playbook), regenerate Whealth's
five compiled guides.

**Phase 4 — Nurture emails + snapshot close-out (Veit + me):** paste
sheet with FINAL titles + quiz name (this is why emails waited);
Veit duplicates his approved DND sample ×6 in the builder, pastes,
assigns to the nurture workflow steps + attaches trigger links; wellness
snapshot saved; "Omniply Wellness" SaaS plan created/attached. (API
cloning of drag-and-drop templates is impossible — the structure-read
endpoint needs an internal scope no PIT can carry; proven 2026-10-26.)

**Phase 5 — Verify + sweep (me):** end-to-end funnel check on her
account (quiz → capture → tags → delivery email → guide link), docs
sweep (playbook: PIT builder-read fact, this plan's lessons;
wellness-snapshot docs: quiz name strings), memory update.

## Dependencies / sequencing notes

- Phase 4 is BLOCKED by Phase 2+3 (titles + quiz name must be final
  before the paste sheet — avoiding double-pasting is why emails waited).
- Nothing here blocks Whealth's Nov 2 newsletter (separate review
  track) or the chiro vertical.
- Whealth's five currently-compiled guides stay pending_review and get
  regenerated in Phase 3 — do not approve them meanwhile.
