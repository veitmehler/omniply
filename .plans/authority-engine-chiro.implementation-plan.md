# Authority Engine — Chiro Platform Port

Status: PLANNED 2026-10-15, REVISED 2026-10-16 after the azavea engine's
first full production day (11 register-infused arcs reviewed beat-by-beat).
The azavea v2 architecture is proven; this plan covers what's DIFFERENT for
client clinics, plus the fixes the first live day showed are PREREQUISITES
for clinics rather than nice-to-haves. Positioning: "your personal authority
engine" — makes the OWNER visible, not just the clinic; strongest retention
feature on the backlog.

## What the first azavea production day validated (2026-10-16)

- Register adherence is real: 9/11 arcs carried a clearly detectable
  rhetorical spine (belief_shift and framework strongest; leadership good).
- Truth/compliance discipline held: zero fabricated narrator events, scenes
  correctly attributed to the article, zero em-dashes, CTA/schedule
  mechanics intact. The shared system prompt needs no structural change.
- Registers cost ~nothing (same arc call) and the shared bag balances
  across arcs + syndication.

## What it exposed — now PREREQUISITES for the clinic rollout

P1. **Burst repetition (critical for clinics).** Two azavea arcs opened with
   the IDENTICAL narrator beat and two beats recycled across 4-5 arcs,
   because the distinctness pool only sees `scheduled|published` posts and a
   burst generates every arc simultaneously. Azavea bursts are rare; **clinic
   onboarding bursts are the NORM** (payment burst = many articles at once),
   so clinics would ship near-duplicate story openings in week one. Fix
   BEFORE clinic enablement: widen the prior-posts pool in story-arc.ts to
   `ready|scheduled|published` (sequential runs in a burst then dedupe;
   3-way-concurrent siblings may still overlap — acceptable residual).
   Consider also: pass the burst's already-generated beat openings into the
   prompt's prior block when runs share a batch.
P2. **Arc-level figure gate (critical for healthcare).** One azavea beat
   stated "$72,000 annually" — supported by neither the (audited) article
   nor the beat's own inputs, despite the prompt's verbatim-numbers rule.
   Prompt rules reduce, deterministic gates catch. Port the consistency-audit
   figure cross-check to arc beats: every figure in postText/slides must
   appear in the article material or a narrator moment (complement allowance
   like the diagram check, e.g. 71% ≡ 100−29%). On violation: strip the
   offending sentence (same philosophy as the slide URL-stripper) or
   regenerate once; never ship an unsupported number in a clinic's name.
P3. **Register-fit degradation is graceful but should be fit-aware for
   clinics.** Azavea's 'proof' arc had no case material and drifted into
   belief-shift language rather than inventing (good!). Clinics will have
   REAL proof pools (de-identified stories, aggregate review stats) — but
   when a pool is EMPTY the draw should skip that register up front:
   reuse `swapAuthorityType` from authority-rotation.ts (built for the v1
   fit-swap, currently unused) to exchange a drawn register whose pool is
   empty for the next bag entry. Also tighten `arcRegisterDirective` for
   'opinion' (azavea's opinion arcs drifted framework-ward): lead with the
   claim-stake requirement.

## Why the stretch is short: onboarding already runs a 4/5 authority interview

| Type | Already collected | Quality |
|---|---|---|
| Opinionated | `q_enemy` ("what drives you crazy / what patients keep falling for") | literally "call out the bad advice" — rich |
| Thought leadership | `q_declaration` (philosophy) + `q_line` (non-negotiables) | rich |
| Proof-led | `q_moments` (true stories: mistake/lesson/proud) → storyBeats | rich, already beat-formatted |
| Framework-driven | `q_proof` (first visit + first month walkthrough) | the clinic's care process IS its proprietary framework |
| **Belief-shifting** | **— nothing asks for it directly** | **THE collection gap** |

## Gaps to close (in build order)

0. **Prerequisites P1–P3 above** (shared code, benefit azavea immediately).
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
   settings; small banks are the clinic reality (one interview, not 15
   articles) — so pool material is injected as a "REGISTER MATERIAL (may
   draw on; same truth rules as narrator moments)" block in the arc prompt,
   and P1's widened prior-pool is what keeps a small bank from repeating.
4. **Register-infused story arcs**: clinic arcs draw a dominant register per
   arc from the clinic's own persisted bag (brandSettings.authorityEngineState
   is per-account already) — the clinic matrix's existing story slots carry
   it; no new posts, no new cron (azavea v2 architecture verbatim).
   **Gating (revised 2026-10-16): per-account opt-in, not vertical-wide** —
   an `enabled` flag inside authorityEngineState, default off; flip for the
   pilot clinic first, watch one week of arcs, then default-on for new
   accounts at synthesis time. The story-arc code gate becomes
   `vertical==='azavea' || state.enabled` instead of azavea-only.
   Syndication's register draw gets the same gate (currently azavea-only in
   syndication/generate.ts).
5. **Owner's personal LinkedIn (optional onboarding ask)**: the
   `linkedinPersonal` mechanism already exists in the dispatcher — story
   posts (which now carry the registers) already route there when mapped.
   Add an optional onboarding/Settings step: "connect your personal
   LinkedIn — your authority posts perform best there." No dispatcher work
   needed (v1's linkedin_personal surface was removed; story_text routing
   suffices).

## Compliance overlay (HARD rules — healthcare is not Azavea)

- **Opinion scope**: strong opinions about practice MARKETING, patient
  experience, and care philosophy — NEVER clinical claims, outcomes
  promises, or anything the existing healthcare-advertising guardrails
  block. The arc register directive gets a chiro-specific preamble
  extending the existing compliance layer.
- **Proof-led + Google reviews (Veit 2026-10-15)**: reviews enter ONLY
  through the existing de-identification pipeline (client-story mining,
  live since 2026-07) — never raw named-review reposts (HIPAA: republishing
  with commentary can constitute confirming patient status; FTC endorsement
  rules; several STATE chiropractic boards restrict patient testimonials in
  advertising outright). The safe palette: de-identified transformed
  stories, AGGREGATE proof (review count/rating growth — the practice's own
  data, zero patient exposure), and process/milestone proof.
- **Substance-first**: same system rule as Azavea — no source, no stance.
  P2's figure gate is the deterministic backstop for this rule (2026-10-16:
  prompt rules alone demonstrably leak ~1 number per 11 arcs).
- **Upstream is already covered**: the step-20.5 consistency audit (live
  2026-10-16, all verticals) means clinic arcs consume audited article
  text, and the verbatim-numbers rule is already in the geo/KT/mermaid
  prompts for every vertical.

## Explicitly later
Engagement feedback loops; per-state testimonial-rule matrix (start with
the conservative de-identified+aggregate default everywhere); multi-provider
clinics (per-practitioner authority voices).

## Related open items NOT in this plan (runbook backlog)
Consistency-audit Phase 2 (client suggestion cards for guard-rejected ops);
step-21 Mermaid figure gate in-pipeline (prevented-by-prompt today, gate =
belt-and-suspenders); narrator-beat usage tracking beyond P1's window.
