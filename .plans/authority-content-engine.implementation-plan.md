# Authority Content Engine (Azavea) — Implementation Plan v2

Status: v1 BUILT 2026-10-15 (deploy gated on idle job queue as always).
PIPELINE-FIRST per Veit (no hand-written posts — the engine generating from
our own articles IS the proof of concept).
Chiro-platform port: .plans/authority-engine-chiro.implementation-plan.md.

Built pieces: authority-rotation.ts (persisted shuffled bag, anti-streak,
fit swap; 4 unit tests), authority-post.ts (generator, 5 register shapes,
step-250 override hook, substance-first system rule), authority-processor.ts
(run slotVariant='authority' → spec result + ready posts + preview through
the EXISTING approval/dispatch flow; runSocialAutomation branches so the
safety sweeper recovers correctly), handlers/authority-post.ts (daily cron
05:30 UTC, azavea-gated, article-pool source, AUTHORITY_ENGINE_ENABLED=0
kill-switch), dispatch-run.ts (new 'linkedin_personal' surface + authority
text-only allowance), syndication/generate.ts (dominant register per
platform article from the same bag, stored on syndication_articles.register),
migration 20261015090000 (brand_settings.authorityEngineState +
syndication_articles.register), web preview labels.

## The five types (Sehgal taxonomy)
opinionated · belief-shifting · thought leadership · proof-led ·
framework-driven. Omniply's substance per type is real and already written
(see v1 notes in git history); the articles backfilled 2026-10-15 are the
immediate substrate — 15 pieces ≈ 2-3 weeks of typed-post runway.

## v1 scope — article-driven, all surfaces

**Generator**: (published azavea article + assigned type) → typed post in
Veit's voice. Five prompt templates are the core craft work, each encoding
its rhetorical shape:
- opinion: stake the claim → name the bad advice → why it costs money →
  what instead. No hedging.
- belief_shift: common assumption → why it once made sense → the break
  (evidence) → the new mental model, named.
- leadership: observation/pattern → the lens → prediction or principle.
  First person; allowed to be early, never vague.
- proof: before-state w/ context → what was done → the real number → the
  generalizable lesson. Numbers verbatim from source.
- framework: name the model → the 3-5 parts → when it applies → one
  concrete application.

**Rotation assigner — RANDOM with anti-streak (Veit requirement):**
shuffled-bag draw: shuffle the 5 types, draw without replacement, reshuffle
when empty, with the constraint that a new bag's first draw ≠ the previous
bag's last draw (hard cap: never 2 of the same type consecutively, and no
repeating sequence pattern ever). Bag state persisted (brand_settings JSON)
so restarts/deploys don't reset or repeat. The article↔type pairing is also
sanity-checked: if the drawn type fits the article poorly (e.g. 'proof' on
a pure framework piece), swap within the bag rather than force it.

**Surfaces — ALL of them (Veit decision):**
- LinkedIn PERSONAL (primary; linkedinPersonal mapping restored 2026-10-15)
  + company page: native text posts.
- FB/IG: the SAME post rendered through the existing brand-tint motif
  design (text over motif + brand-color overlay — the tinted-slide
  compositor reused as a single-image post). No new design system.
- LinkedIn + Medium ARTICLES (syndication/generate.ts): each platform
  article gets ONE dominant type register (rotating via the same bag) that
  sets lead/hook/thesis; other types may appear as supporting ingredients.
  Never all five woven into one piece — feed-level variety, not per-piece
  density.

**Cadence**: ≥1/day during the profile-filling phase (first 2 weeks), then
3-4/week. Scheduler spaces approved posts automatically.

**Approval**: exactly the existing social review flow — generated posts
land in the same approval surfaces; nothing posts unapproved.

**Substance-first guardrail (system rule, not style note)**: every typed
post must reference a real source (the article, a beat's sourceNote, or a
measured number). The generator refuses a stance with no substance; an
empty pool falls back to narrative, never manufactures an opinion.

## v2 — typed beats as a second source
storyBeats elements gain authorityType + required sourceNote; the
IdeaCapturePanel gets a 20-second typed-capture path; the generator mixes
beat-sourced posts into the same bag/scheduler. (The current 9-beat bank is
already stance-rich — several are opinion/leadership beats avant la lettre.)

## Cost & ops
~$0.03-0.06/post (caption-class calls) + one tint render for FB/IG.
Deploy discipline: build any time, deploy only on drained queue.

## First output = the proof batch
The engine's first run over the 15 backfilled articles, reviewed by Veit in
the normal approval flow; edits feed back into the templates.
