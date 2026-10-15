# Authority Engine — Chiro Platform Port

Status: PLANNED 2026-10-15. Build AFTER the Azavea engine proves itself
(.plans/authority-content-engine.implementation-plan.md) — same templates,
same bag rotation, same scheduler; this plan covers what's DIFFERENT for
client clinics. Positioning: "your personal authority engine" — makes the
OWNER visible, not just the clinic; strongest retention feature on the
backlog.

## Why the stretch is short: onboarding already runs a 4/5 authority interview

| Type | Already collected | Quality |
|---|---|---|
| Opinionated | `q_enemy` ("what drives you crazy / what patients keep falling for") | literally "call out the bad advice" — rich |
| Thought leadership | `q_declaration` (philosophy) + `q_line` (non-negotiables) | rich |
| Proof-led | `q_moments` (true stories: mistake/lesson/proud) → storyBeats | rich, already beat-formatted |
| Framework-driven | `q_proof` (first visit + first month walkthrough) | the clinic's care process IS its proprietary framework |
| **Belief-shifting** | **— nothing asks for it directly** | **THE collection gap** |

## Gaps to close (in build order)

1. **New voice question `q_myths`** (the belief-shift source), placed right
   after `q_enemy` (the rant usually contains the myths; this surfaces them):
   "What do patients wrongly believe — about chiropractic, about pain,
   about your work — that you find yourself correcting in the treatment
   room?" Voice-first like the other six; stored alongside; feeds the
   belief_shift pool and voice-matching.
2. **Backfill for existing accounts** (demo, test clinic, pre-question
   customers): an LLM derivation pass extracts belief-shift material from
   the stored `q_enemy` answer — the question is the primary source,
   derivation is the no-re-onboarding fallback.
3. **Typed classification at synthesis**: when onboarding synthesizes the
   interview, tag the extracted material into the five pools
   (enemy→opinion, declaration/line→leadership, moments→proof,
   proof→framework, myths/derived→belief_shift). Pools stored on brand
   settings; the generator draws from them plus published articles.
4. **Register-infused story arcs** (REVISED 2026-10-15, mirroring the azavea
   v2 correction: registers go INTO the existing story-arc posts, no new
   slot): clinic story arcs draw a dominant register per arc from the shared
   bag — the clinic matrix's existing story slots carry it. Gate: extend the
   story-arc draw beyond vertical==='azavea' once the typed pools (items 1-3)
   exist; clinic registers draw from the POOLS + article, azavea-style
   article-only until then.
5. **Owner's personal LinkedIn (optional onboarding ask)**: the
   `linkedinPersonal` mechanism already exists in the dispatcher — clinics
   currently map business pages only. Add an optional onboarding/Settings
   step: "connect your personal LinkedIn — your authority posts perform
   best there." Personal-first routing for opinion/leadership types;
   company page gets the full rotation.

## Compliance overlay (HARD rules — healthcare is not Azavea)

- **Opinion scope**: strong opinions about practice MARKETING, patient
  experience, and care philosophy — NEVER clinical claims, outcomes
  promises, or anything the existing healthcare-advertising guardrails
  block. The authority templates get a chiro-specific system preamble
  extending the existing compliance layer; the quality gate applies.
- **Proof-led + Google reviews (Veit 2026-10-15)**: reviews enter ONLY
  through the existing de-identification pipeline (client-story mining,
  live since 2026-07) — never raw named-review reposts (HIPAA: republishing
  with commentary can constitute confirming patient status; FTC endorsement
  rules; several STATE chiropractic boards restrict patient testimonials in
  advertising outright). The safe palette: de-identified transformed
  stories, AGGREGATE proof (review count/rating growth — the practice's own
  data, zero patient exposure), and process/milestone proof.
- **Substance-first**: same system rule as Azavea — no source, no stance.

## Explicitly later
Engagement feedback loops; per-state testimonial-rule matrix (start with
the conservative de-identified+aggregate default everywhere); multi-provider
clinics (per-practitioner authority voices).
