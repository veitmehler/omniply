# Authority Content Engine — Implementation Plan

Status: PLANNED 2026-10-15 (Veit + Sahil Sehgal's 5-type taxonomy). Build:
post-launch-week, Tier 1 first. Surface coupling: typed authority posts are
founder-voice content — their primary home is Veit's PERSONAL LinkedIn
(linkedinPersonal mapping restored 2026-10-15), with the company surfaces
secondary.

## Thesis

Azavea's social today is content-DERIVED (weekly matrix narrates the cadence
articles; story lane narrates beats). Authority content adds a STANCE layer:
posts that argue a position, shift a belief, or teach a framework. The five
types (Sehgal): **opinionated · belief-shifting · thought leadership ·
proof-led · framework-driven.**

Omniply's raw material per type (all real; the no-fabrication posture is a
hard constraint):
- Opinionated: lifetime-care-plan racket, "bursts are a lottery ticket",
  review-buying, "no sales calls needed" — already on record in voice
  interviews + sales copy.
- Belief-shifting: the Big Idea (132M / patients ask AI, not Google),
  "posting isn't the test — answering at 2am is."
- Thought leadership: predictions with receipts — AI assistants booking
  directly (PROVEN on our own demo 2026-10-13/14), GEO-before-it-had-a-name.
- Proof-led: the AI-booked appointment, the five anonymized client cases
  (azavea.ai), measured transparency numbers (COGS, bookings).
- Framework-driven: the Loop, the Practice X-Ray, the four systems,
  find→understand→talk→book — named models with diagrams already drawn.

## Tier 1 — Typed beats bank (SMALL, build first)

The existing `storyBeats` + IdeaCapturePanel infrastructure is Sehgal's
"scribble it before you forget" habit, already built — just untyped.

1. **Schema**: beats gain `authorityType` ('opinion' | 'belief_shift' |
   'leadership' | 'proof' | 'framework' | null=legacy narrative) +
   `sourceNote` (the real event/call/number behind it — REQUIRED for typed
   beats). Beats live in brand_settings.storyBeats (JSON) → extend the
   element shape, no migration.
2. **Capture**: IdeaCapturePanel (embed + dashboard) gets an optional type
   selector when saving an idea/beat; a voice note or one-liner + type +
   source is a complete capture. Friction target: under 20 seconds.
3. **Prompt templates, one per type** (the core craft work). Each encodes
   its rhetorical shape in Veit's voice:
   - opinion: stake the claim → name the bad advice being called out → why
     it costs practices money → what to do instead. No hedging.
   - belief_shift: the common assumption → why it made sense once → the
     break (evidence) → the new mental model, named.
   - leadership: the observation/pattern → the lens ("what I think this
     means") → the prediction or principle. First person, allowed to be
     early/wrong, never vague.
   - proof: before-state with context → what was done → after with the real
     number → the generalizable lesson. Numbers verbatim from sourceNote.
   - framework: name the model → the 3-5 steps/parts → when it applies →
     one concrete application. Diagram slot when one exists.
4. **Generation lane**: the azavea story processor, when the beat pool has
   typed beats, rotates types (max 1 opinion + 1 proof per week — scarcity
   keeps edges sharp) and renders with the matching template instead of the
   generic narrative prompt. Untyped beats keep today's behavior.
5. **Routing**: typed posts → linkedinPersonal primary (dispatcher's
   preferPersonalProfile), company surfaces get the non-opinion types only
   (opinion/leadership read wrong under a logo).

## Tier 2 — Typed matrix slots (MEDIUM, after Tier 1 proves)

Weekly matrix (azavea-gated): P-slots carry an `authorityType` rotation;
the generator pulls substance from the matching pool (typed beats + the
week's cadence article + framework docs). Makes scheduled content
argumentative, not just the story lane.

## Hard guardrails (both are system rules, not style notes)

1. **Substance-first (Paul's caveat)**: a typed post MUST reference a real
   source — beat.sourceNote, an article, or a measured number. The
   generator refuses a stance with no substance; empty-pool weeks fall back
   to narrative beats rather than manufacturing opinions. This is the
   no-fabrication posture extended to opinions.
2. **Voice, not volume**: types are a rotation, not a quota. One sharp
   opinionated post beats five soft ones; the scheduler never pads.

## First test batch (also the template-tuning exercise)

The MCP/AI-booked-appointment story drafted FIVE ways, one per type:
- opinion: "Most practice marketing is invisible to the thing patients now
  ask first. That's malpractice-adjacent."
- belief_shift: "You think patients find you on Google. 132M of them
  stopped asking Google."
- leadership: "I watched an AI book an appointment this week. Here's what
  the next 24 months look like."
- proof: the booking itself — timestamps, calendar entry, how.
- framework: find→understand→talk→book, with the diagram.
Veit reviews all five → the edits become the template refinements.

## Out of scope / later
Client-facing authority engine (same machinery for clinic owners' personal
profiles — a future differentiator, big), cross-posting cadence tuning,
engagement-feedback loops.
