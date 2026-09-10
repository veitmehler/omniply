# Story-arc posts — full build plan (engagement v2)

> DATE NOTE 2026-09-10: launch moved to **Sept 22** (final). Sept 15 refs below are historical; P3 shipped before the original date.

All decisions locked with user 2026-09-03. Replaces the earlier notes-only
version of this doc. Goal: serialized, human-feeling story posts derived
from every article (and newsletter), replacing the low-engagement section
carousels. Azavea first, fine-tune, then main app — LIVE FOR CLINICS AT
LAUNCH (Sept 15): "the posts you watched work on me now run for you" is
part of the launch pitch.

## Locked decisions

- 2 story posts per article per day: **morning (~7:30) + evening (~19:30)**
  local, deliberately outside business-hours matrix slots so the profile
  reads human.
- Midday keeps ONE visual anchor: KT music video on the KT day, ONE section
  carousel on azavea's other day (variety), the newsletter visual on
  newsletter days. All other section carousels are REPLACED.
- Platforms per story post (ONE generation, three renderings):
  - LinkedIn: text post → PERSONAL profile when connected (azavea: Veit's,
    already in GHL), else company page.
  - Facebook page: same text as a text post. (Carousel A/B = post-launch.)
  - Instagram: **story carousel** — beats ON slides (simple tinted
    background, NOT full AI images) + the full story text as the caption
    anyway (costs nothing, serves readers/search/accessibility).
- "Superficial" arcs = compliance frame: narrator is the OWNER observing
  industry patterns + their own professional journey. Composite, explicitly
  generic scenes allowed. BANNED: identifiable patients, invented patient
  events presented as real, outcome promises. Existing per-industry ad
  restrictions + de-AI dash rules + owner approval gate all apply.
- Narrator authenticity: onboarding captures 2-3 REAL owner story beats via
  the voice-input section (spoken > typed: gives beats AND cadence).
  Azavea's narrator profile seeds from Veit's launch-arc bio facts.

## Architecture

### 1. Data (migration)

- `BrandSettings.storyNarratorName String?` (default: defaultAuthorName)
- `BrandSettings.storyBeats String? @db.Text` — transcribed real owner
  moments, newline-separated; the arc generator's authenticity pool.
- `GhlAccountIds` gains `linkedinPersonal?: string` (accountIds JSON — no
  schema change, just the type + admin UI field). Story posts route
  LinkedIn to it when present.

### 2. Arc generation (ONE LLM call per article)

Same trick as batched captions: generating all beats in one call makes
continuity and mutual distinctness structural.

Input: article title + intro + section summaries (or newsletter feature),
narrator profile (name, beats, writingStyle), the last ~4 published story
posts (verbatim, for callbacks), N = beat count.
- Main app / newsletters: N = 2 (am sets tension, pm pays off + soft
  article CTA).
- Azavea articles: N = 4 (2-day window: d1 am/pm + d2 am/pm, one arc).

Output (strict JSON, schema-validated, per beat):
- `postText` — the LinkedIn-ready story (short lines, open loop, dash-free;
  links ONLY in the final beat).
- `slides[]` — IG carousel beats: slide 1 = hook line alone; middle slides
  20-35 words each CUT AT CLIFFHANGERS (the swipe is the payoff); final
  slide = open loop + follow cue.

Prompt rules: compliance frame above; each beat ends mid-tension except the
last; callbacks to prior posts where natural; never reuse a prior post's
scene. Failure → slot falls back to the existing section-carousel path
(never a lost slot).

### 3. Rendering

- New postType `story_text`. Asset step builds the IG carousel ONLY
  (LinkedIn/FB are text-only): new **story-tint template** in the carousel
  compositor — reuses brand-tint machinery (shared motif bg + 0.85 wash +
  logo) with: centered text, ~35-word budget/slide, larger floor (44px+),
  continuation-arrow cue on every non-final slide.
- buildPostsForSpec: story special-case — instagram gets mediaUrls +
  caption = postText; linkedin/facebook get postText only, no media;
  linkedin account = linkedinPersonal when set.
- Caption generator NOT involved (postText IS the caption, verbatim).
- Story-slot 9:16 companions: quote story from the beat's hook line
  (existing derivation handles unknown types → quote).

### 4. Matrix restructure

Azavea (article window):
- Day 1: 7:30 `story_text` beat1 · 12:00 `carousel art_section_0`
  (variety anchor, per-slide motif bgs) · 19:30 `story_text` beat2
- Day 2: 7:30 beat3 · 12:00 `kt_music_video` · 19:30 beat4

Main app article days (Tue/Thu): 7:30 beat1 · 12:00 KT anchor (voice reel /
kt_music_video via voice capability) · 19:30 beat2.
Main app newsletter days: 7:30 nl-beat1 · 12:00 existing newsletter visual
(brand-tint carousel or reel) · 19:30 nl-beat2.

Batched-caption pregen skips story slots (no caption LLM); KT stays
verbatim; the midday visual keeps its existing caption path.

### 5. Onboarding (main-app phase)

Voice-input section gains a story-beats step: "tell us 2-3 moments that
shaped how you practice" → recorded → transcribed → `storyBeats`. Text
fallback field. (Ship main-app phase with the TEXT field if the voice
recording plumbing is tight; voice upgrade = v2.)

## STATUS 2026-09-03 (final): DESIGN LOCKED after user review rounds

Final visual/CTA design (on top of the earlier fine-tune): LEFT-aligned
text in a horizontally centered block (no justification, no centering);
FIXED arrow row at y=830 with story text region capped at 780; motif =
gemini flash-image wordless flat icon at 0.70 alpha on brand canvas
(~10% perceived); NO URLs on any slide; dedicated CTA slide = comment
hook ('Comment "XRAY" ...' azavea; parameterize keyword for clinics in
P3) wired to the EXISTING comment-keyword funnel; captions split per
platform (IG hook replaces URL line, FB link + hook, LinkedIn link only).
⚠️ Comment funnel E2E test is now LOAD-BEARING before first dispatch.

## (superseded) P1+P2 FINE-TUNE COMPLETE — ship quality

Final design after 4 QA cycles on the Sep 2 article: FULL article into the
arc writer with RETELL-the-article's-own-scenes instruction (solves
fabrication-vs-abstraction: the plain-language layer's composite scenes are
pre-vetted narrative material); serial 4-beat arc with one-line re-anchors;
middle slides 40-60 words; arrows on all non-final slides; Recraft V3
motifs (vector_illustration style, hard-WORDLESS directive after gibberish
labels); IG 9:16 stories = pitch companions of their feed beat (old generic
pull-quotes made no sense); evening beats end with brand.socialCallToAction
verbatim (azavea = X-Ray line, set in DB); step-230 prompt override (208
COLLIDED with social_story_pitch_slide — restored). Personal-LinkedIn
window live until Sep 9 (launch doc has the flips).

## (earlier) P1 COMPLETE — deployed prod + staging, E2E-verified

Arc generator live (4 beats from the 12-beat narrator pool, real moments
woven with article numbers), all slot types verified (4 story slots ×8
slides, KT video d2 midday, variety carousel d1 midday), hook banner +
arrows QA'd, story slides sized up to 52px base after QA, prompt
hard-forbids merging narrator moments / false dates (caught in E2E).
Narrator seeded BOTH envs (12 beats mined from project history).
NOT yet set: linkedinPersonal accountId for azavea (deliberate — launch
arc owns the personal profile until Sep 16; flip after).
P2 fine-tune next: run against the queued cadence articles with Veit.

## Phases + timeline (launch Sep 15)

- **P1 — build on azavea** (~2 days, target Sep 4-5): migration, arc
  generator + tests, story-tint template, matrix restructure (azavea only),
  linkedinPersonal routing, seed Veit's narrator profile.
- **P2 — fine-tune** (Sep 5-10): run against the 4 queued cadence articles
  (review-only, nothing dispatches without approval); iterate prompt +
  slide template with Veit; then azavea brand pages go live on story
  cadence DURING launch week (better content while the launch arc runs on
  the personal profile — the two tracks must not collide: launch-arc posts
  own the personal LinkedIn Sep 9-15; azavea story posts route LinkedIn to
  the COMPANY page until Sep 16).
- **P3 — main app** (before Sep 15): default-vertical matrix restructure,
  narrator fields in onboarding (text input minimum), enabled for launch
  clinics. Pre-flight compliance verifier (runs on every beat before the run
  turns `ready`): (a) every figure in postText/slides must exist VERBATIM in
  the article material or a narrator moment (digit extraction + source
  lookup); (b) numeric-consistency: no slide may carry two different
  durations/quantities referring to different things (added 2026-09-04 after
  a "15-minute audit" bridge collided with the "2-minute Practice X-Ray"
  hook on one slide — the bridge validator now rejects digits/durations
  outright, the verifier generalizes the check to ALL slides); (c) no URL
  and no destination-pointer phrases on slides (link in bio, pinned/first
  comment, read the article — the semantic class, not one phrasing), no
  "swipe" on final slides, correct Tonight/Tomorrow label (re-verify the
  deterministic normalizers actually ran); (d) action lists rendered as
  prose (2+ imperative sentences, neither "- " bullets nor numbered slides)
  → flag: the auto-bulletizer is heuristic (curated imperative-verb list)
  and a list phrased without imperatives slips both layers.
- **P4 — post-launch v2**: FB carousel A/B, voice-recorded beats capture,
  cheap-graphic carousel refinements, cross-article "season" arcs.

## Open items

- IG grid monotony watch (all quote-card covers + tint carousels): revisit
  with v2 carousel refinements.
- Azavea day-1 midday section carousel: which section — keep art_section_0
  (has the diagram) since beats now carry sections' narrative content.
- Engagement measurement: analytics sync exists per post; define the
  story-vs-carousel comparison once 2 weeks of data exist (drives the FB
  A/B and any clinic matrix tuning).
