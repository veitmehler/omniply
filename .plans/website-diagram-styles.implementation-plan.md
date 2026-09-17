# Website-derived diagram styles + set consistency + camelCase lint (2026-09-17)

**Status: PLANNED — pre-launch (Veit decision 2026-09-17). Multi-site bench
REQUIRED before any implementation ships.**

Veit's rationale: most clinics will find the jewel-box default too dark for a
chiro clinic. Per-client style, fine-tuned during custom onboarding, beats one
dark house style. Border treatment must be consistent across ALL diagrams of an
article — outlined or borderless, never a mix. The camelCase label bug must be
fixed regardless.

## Evidence base (3 experiment rounds, 2026-09-17, Simon Chiro site)

Artifact with all outputs: https://claude.ai/code/artifact/cd9a5088-8963-4812-a3f2-f0f37567eabc
Runner script (container, no code changes): scratchpad `style-experiment.js`.

- Round 1 (skeleton-only vision prompt): style genuinely website-native, but
  2/4 content errors — invented category headers, duplicated nodes.
- Round 2 (+ few-shot jewel guide + treatment-only rule): structure errors
  gone; NEW leak — palette ROLE words rendered as node text ("Secondary:
  #2D808E") because the palette tied hexes to "labels".
- Round 3 (+ renderer named gemini-3.1-flash-image + behavioral profile
  "extremely literal — anything phrased like content gets drawn as content" +
  palette-by-VISUAL-PART rule): **4/4 content-clean sweep.** Remaining issues
  are compositional only: square under-fill on light canvases, and diagram 3
  kept outlined boxes while 1/2/4 went borderless (per-image independence).

**The proven vision-prompt recipe (round 3):**
1. Few-shot: include the branded jewel guide's first three sections as an
   example of RIGOR (explicitly "do NOT copy its look").
2. Name the renderer AND describe its behavior: extremely literal; renders
   color names/hex codes/role words as visible text if wording allows.
3. Treatment-only rule: describe how to treat EXISTING nodes/connections/
   labels; never instruct adding headers, panels, categories, or any text.
4. Palette by visual part (borders, fills, connector lines, canvas) — never
   roles attached to "labels"/"headings". Required ending sentence: "These
   brand hues (plus neutrals) are the ENTIRE palette. Never render color
   names, hex codes, or role words as text in the image."
5. Brand hexes injected as authoritative ground truth (from palette v2) — the
   vision model describes CHARACTER, never picks colors.

**New rules to add for the production version (from Veit's requirements):**
6. Mandatory border commitment: the guide MUST state "nodes are borderless
   cards" or "nodes are outlined boxes" — exactly one; validation rejects a
   guide without it. Fixed tail gains: "This diagram is one of a series in
   the same article — every diagram uses the IDENTICAL node treatment; NEVER
   mix outlined and borderless."
7. Square-fill discipline: light canvases under-fill (round-3 "spaciousness"
   fought the fill instruction) — the aesthetic section must not contradict
   the task prompt's edge-to-edge reflow requirement.

## Workstream A — camelCase label lint (independent; ship first)

Bug: diagram-writing LLM emits bare Pascal/camelCase IDs with no display
labels (`HipsBelowKnees`, `state` diagrams without `state "..." as X`), so
renders show machine identifiers. Live example: demo article diagram 3.
Restyle correctly reproduces it verbatim — fix belongs UPSTREAM, never at the
style layer (text-rewrite permission = hallucination channel).

- Deterministic post-generation lint in the mermaid pipeline: detect label-less
  camelCase node definitions per diagram type; auto-repair by inserting split
  labels ("HipsBelowKnees" → "Hips below knees"; preserve acronym runs);
  bounce-to-retry only when unrepairable. Unit tests per diagram type.
- Retrofit: re-render + re-restyle demo article diagram 3 before filming.

## Workstream B — style-guide generation at onboarding

- New module (api): `generateDiagramStyleGuideFromWebsite(userId)`:
  screenshotHomepage (exists, battle-tested) → ONE vision call (recipe above;
  model swappable, start gemini-3-flash-preview; ~$0.01) → assemble full guide
  = LLM's three sections + FIXED skeleton tail (STRUCTURAL ELEMENTS +
  CRUCIAL EXCLUSIONS + set-consistency rule — never LLM-authored) →
  **validation gate**: three section headers present, ALL brand hexes present,
  border commitment stated, required ending sentence, length caps → store to
  `brandSettings.diagramStyleGuide` (existing field; restyle already honors it
  verbatim; settings page already edits it).
- Onboarding hook: fire during/after the site-analysis crawl (screenshot in
  memory) or as a follow-up job. Any failure → field stays empty → branded
  jewel guide fallback (current behavior). Azavea: untouched (its guide/flow
  unaffected; add vertical guard on the hook).
- Settings: "Regenerate from website" button next to the style-guide field
  (supports the fine-tune-with-client loop during custom onboarding).
- Demo account: apply generated guide + regenerate the article's 12 diagrams
  (rerun-diagrams.js pattern, -v3 keys + HTML/DB swap) before filming.

## Workstream C — border/set consistency

1. Prompt-side (ship): rules 6-7 above + validation.
2. Reserve (only if bench still shows drift): reference-image conditioning —
   restyle diagram 1 first, pass its output as a second input image for the
   rest ("match this set's established style exactly"). Needs
   generateWithGeminiImage to accept multiple input images + sequencing the
   first restyle before the rest. Do NOT build speculatively in launch week.

## REQUIRED BENCH before shipping (Veit gate)

Test the generator against several OTHER real chiro websites; with each
generated guide, restyle the SAME 4 test diagrams (demo article positions
1-4) and judge:
- Content fidelity: no invented text, no duplication, no palette leakage.
- Border consistency across the 4 as a set.
- Square fill.
- Aesthetic: does it actually look like the source website?

Protocol: extend scratchpad style-experiment.js — parameterize (siteUrl,
palette). For non-customer sites, extract a rough palette from the screenshot
via the existing palette pipeline or by eye; screenshots are read-only.
Suggested mix: one dark/premium site, one warm/organic, one GHL-template-style,
plus Simon Chiro as control. Publish results to the same artifact page.
PASS = every site content-clean + border-consistent; only then implement A-C.

## Sequencing

1. Bench (this gate) → 2. A (lint + retrofit) → 3. B+C prompt-side →
4. dual-env tests → 5. deploy → 6. demo regeneration → 7. filming.
Estimated ~2 working days after bench passes; fits before Tue 2026-09-22.

## Open confirmations (Veit)

- Auto-generate for EVERY new onboarding, jewel as silent fallback? (proposed)
- Apply generated guide + regenerate demo article diagrams pre-filming? (proposed)
- Which bench sites (Veit may name real prospect clinics, else Claude picks a
  diverse public set).
