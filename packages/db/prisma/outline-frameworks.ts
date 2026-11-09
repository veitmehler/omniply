/**
 * Outline frameworks (the `{{outline_framework}}` block in the step-9 brief).
 *
 * Rewritten 2026-11-09 (consolidation round, bench B10–B13). The previous
 * bodies were per-section recipes: "common misconceptions, debunk 2–3", "one
 * misconception per cause", "signs that this is the cause", "one rookie
 * mistake per consideration", plus literal sentences to print ("In this
 * article, I cover…", "You don't have to deal with this alone") and a
 * mandatory "Compliance Notes" output. Every one of those shapes came back as
 * a detectable loop or a verbatim string in the bench articles.
 *
 * A framework now describes the ARC of the whole article: what the reader
 * arrives with, how the article moves them, what they leave with, and the
 * compliance posture that arc needs. Section-level shape is left to the
 * writer prompt (§5) and the outline. No per-section recipes, no sentences
 * to copy, no word counts (the writer prompt carries the budgets), no
 * template variables (the body is inserted as a value and is never
 * re-resolved, so a `{{who}}` inside it would print literally).
 *
 * Descriptions are unchanged: outline-assignment.ts shows them to the
 * framework-picking model.
 */

export interface OutlineFrameworkSeed {
  number: number
  label: string
  description: string
  body: string
}

const CONSULTATION_RULE =
  'Anything the reader would act on in a regulated area (treatment, exercise selection for a clinical condition, legal filings, tax or financial structure) is framed as what to raise with, prepare for, or expect from a professional, never as steps to carry out alone. General wellness habits (desk setup, sleep position, walking, hydration) may be fully actionable.'

const SELF_DIAGNOSIS_RULE =
  'Symptom categories may be described; mapping specific symptoms to specific structures, grades, or nerve levels, and home tests the reader could run on themselves, are not. What a practitioner checks and why is the way to carry that content.'

const CASE_RULE =
  'A specific patient, scene, timeline, quote, or quantified outcome appears only when the Real Case Material section supplies it. Otherwise experience stays general: what is seen often, what people ask, what is checked.'

export const OUTLINE_FRAMEWORKS: OutlineFrameworkSeed[] = [
  {
    number: 1,
    label: 'Pillar / Educational Foundation',
    description:
      'A comprehensive, authoritative guide on a core topic. Best for foundational knowledge articles, "ultimate guides", or topic overviews that establish authority.',
    body: `# PILLAR / EDUCATIONAL FOUNDATION

## What this article is for
The one place a reader comes back to on this topic. Breadth with judgment: the article covers the ground a thoughtful patient would want covered, and at every turn it is clear what the author thinks matters and what does not.

## The arc
- The reader arrives with a vague picture and a few wrong assumptions. The article gives them the real picture early, then earns it.
- The middle moves from what the thing is, to how it works, to what changes the picture for an individual (age, history, how long it has been going on), to what the author actually does about it in practice.
- Trade-offs are stated as facts about the options, not as the author's hesitation.
- The reader leaves able to describe the topic accurately to someone else, knowing which questions are worth asking a practitioner, and knowing when to stop reading and book.

## Posture
- ${CONSULTATION_RULE}
- ${SELF_DIAGNOSIS_RULE}
- ${CASE_RULE}
- Mechanism claims are stated at the certainty of their sources: the current understanding, what the evidence supports, not settled fact dressed up.`,
  },
  {
    number: 2,
    label: 'Data-Driven / Research-Based',
    description:
      'Builds credibility through statistics, studies, and market data. Best for market analysis, trend reports, or topics where numbers validate the narrative.',
    body: `# DATA-DRIVEN / RESEARCH-BASED

## What this article is for
A reader who wants to see the evidence before they trust the advice. The numbers carry the argument; the author's job is to say what each number means for a person sitting across the desk.

## The arc
- Open on the figure that changes how the reader sees the problem, then say plainly what it does and does not tell them.
- Build from what the data shows, to why it looks that way, to what it means for someone in the reader's position, to what the author would do with that knowledge in practice.
- Where the sources disagree, the range is given and the article moves on. Where the data stops, the article stops with it; no gap is announced.
- The reader leaves with three or four figures they can actually remember, each attached to a decision.

## Posture
- Every figure comes from the brief, exactly as given. A figure that measures a population keeps its period in words; a finding about the body carries no date.
- The author's own practice is a source of observation, never of invented rates.
- Prediction is kept visibly apart from documented trend and from practice observation.
- ${CONSULTATION_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 3,
    label: 'FAQ / Question-Answer',
    description:
      'Answers the most common questions on a topic. Best for high-volume search queries, voice search optimization, or topics where people have many specific questions.',
    body: `# FAQ / QUESTION-ANSWER

## What this article is for
The reader has a question in their own words and wants the answer first, then enough reasoning to trust it. Each section is one real question, answered completely, the way the author would answer it in the room.

## The arc
- Questions run from the broad to the specific to the decision ("should I"), so a reader who reads top to bottom builds a picture, and a reader who lands on one section still gets a complete answer.
- A "should I" question is answered with the factors that decide it and the point at which a consultation is the right next step, not with the decision itself.
- Where the true answer depends on the person, the article names the two to four things it depends on. It does not hedge vaguely, and it does not invent a specific to avoid hedging.
- The reader leaves with their question answered and a clear sense of which answers vary with their own situation.

## Posture
- Equivalent questions are merged into one. No question is labelled as frequently asked.
- ${CONSULTATION_RULE}
- ${SELF_DIAGNOSIS_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 4,
    label: "Beginner's Guide / Step-by-Step",
    description:
      'Takes a complete novice through a process or concept from zero to confident. Best for complex topics with a clear learning curve.',
    body: `# BEGINNER'S GUIDE / STEP-BY-STEP

## What this article is for
Someone new to the subject who feels behind. The article removes the overwhelm by giving them a sequence they can hold in their head and a clear sense of which parts are theirs to do.

## The arc
- Start with the reader's situation as they would describe it, then the one thing that reorders their thinking.
- The sequence is real: each stage depends on the one before, or the article says plainly that order does not matter. Each stage has something the reader can actually observe to know it is done.
- Where a stage is the practitioner's rather than the reader's, the article says what happens at that point and what the reader brings to it.
- The reader leaves knowing what to do first, what comes after, and the point at which a professional takes over.

## Posture
- The promised outcome is something the reader can complete on their own: being prepared for a consultation, having a shortlist, having the right questions written down.
- ${CONSULTATION_RULE}
- ${SELF_DIAGNOSIS_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 5,
    label: 'Opinion / Thought Leadership',
    description:
      'Takes a clear, defensible position on a contested topic. Best for establishing a distinctive point of view and demonstrating expertise through informed opinion.',
    body: `# OPINION / THOUGHT LEADERSHIP

## What this article is for
A reader who has heard the standard advice and senses it is incomplete. The article defends one clear position, in the author's voice, fairly enough that a sceptic finishes it thinking they had not seen it that way.

## The arc
- The position is stated early and plainly. The mainstream view gets its strongest form before the author departs from it.
- The case is built from evidence in the brief and from what the author sees in practice, and the two are kept visibly apart.
- The strongest objections are taken seriously; at least one is conceded in part, because that is what a credible opinion does.
- The reader leaves with a changed frame and two or three things to weigh or ask about, not a prescription.

## Posture
- The thesis never claims clinical superiority, predicts an individual's outcome, or places a named or implied competitor below the author.
- Practice observation is labelled as such and never quantified unless the brief holds the figure.
- ${CONSULTATION_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 6,
    label: 'Case Study / Success Story',
    description:
      'Documents a real outcome or transformation, with before/after structure. Best for trust-building, testimonial-adjacent content, and demonstrating real-world application.',
    body: `# CASE STUDY / SUCCESS STORY

## What this article is for
Show rather than tell: one situation, followed from the problem through what was found and done to what changed, so the reader can recognise themselves in it.

## The arc
- The situation is set out as the person experienced it, including what they had already tried.
- What the assessment found is told as the turning point, with the reasoning a practitioner would give for choosing one approach over others.
- What changed is told at the specificity the material allows, and then translated into what it means for the reader, without promising them the same.
- The reader leaves understanding how a practitioner thinks through a case like theirs.

## Posture
- Two modes, never blended. When the Real Case Material section holds a documented case, every detail comes from it and a plain outcome disclaimer appropriate to the profession follows the results. When it is empty, the article is a representative scenario, said so once at the start in plain words, with qualitative outcomes and no quoted patient.
- No other practitioner is faulted by name or implication; what was found is additional, not a correction.
- ${CONSULTATION_RULE}
- ${SELF_DIAGNOSIS_RULE}`,
  },
  {
    number: 7,
    label: 'Problem-Solution',
    description:
      'Diagnoses a specific problem in depth and provides a structured solution. Best for pain-point-focused content targeting people already aware they have a problem.',
    body: `# PROBLEM-SOLUTION

## What this article is for
A reader who already knows they have the problem and wants to understand it and get rid of it. The article is a clinician's explanation, not a troubleshooting table: here is what is going on, here is what actually helps, here is when to come in.

## The arc
- Open inside the reader's experience of the problem, then explain the mechanism behind it in plain concrete terms.
- The causes are explained as mechanisms, not as a checklist of signs; the article is honest that the same symptom has several sources and that sorting them is the practitioner's job.
- What helps is organised by what the reader can safely do and what a practitioner does, with the practitioner's part described as what to expect rather than how to perform it. Realistic time frames are ranges from the brief or are left out.
- "When to come in" sits where the reader is most tempted to push on alone, and the one first-person boundary sentence lives there.
- The reader leaves knowing what is happening in their body, what they can change this week, and the point at which self-management stops being the right answer.

## Posture
- ${SELF_DIAGNOSIS_RULE}
- ${CONSULTATION_RULE}
- Consequences of leaving the problem are stated factually, never as fear.
- ${CASE_RULE}`,
  },
  {
    number: 8,
    label: 'Comparison / Versus',
    description:
      'Compares two or more options head-to-head to help readers make a decision. Best for high-intent decision-stage readers evaluating alternatives.',
    body: `# COMPARISON / VERSUS

## What this article is for
A reader ready to choose between options who needs an informed, even-handed view. The article makes the decision easier by saying which option suits which situation, in the author's voice.

## The arc
- Each option is described plainly and fairly first, with no selling.
- The comparison runs on the criteria that actually decide it for a patient (what it involves, cost, time, risk, who it suits), and every verdict is conditional on the reader's situation rather than absolute.
- The ending turns the comparison into a decision aid: in this situation lean this way, in that one lean the other, and here is when neither is right.
- The reader leaves able to say which option fits them and what to ask before committing.

## Posture
- When one option is the author's own service, it may not win most criteria without external evidence, the alternative is described from sources rather than from the author's impression, both receive equal scrutiny, and at least one criterion where the alternative is genuinely better is stated without qualification.
- Long-term outcome comparisons come from cited evidence or are labelled as practice observation.
- ${CONSULTATION_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 9,
    label: 'Listicle / Top-N',
    description:
      'A structured list of the best, most important, or most useful items on a topic. Best for high-traffic SEO content, shareable resources, and quick-reference guides.',
    body: `# LISTICLE / TOP-N

## What this article is for
A scannable, opinionated set of items on one topic, each genuinely different from the others, each judged by someone who deals with them.

## The arc
- The basis for inclusion is stated once, truthfully: experience with each item where the brief supports it, otherwise experience with people navigating them.
- Each item is explained, judged, and matched to the reader it suits best. Items that are not rankable are presented in no particular order and the article says so.
- A short decision aid at the end helps the reader find their own starting point and tells them what to discuss with a professional rather than which item to buy.
- The reader leaves with a clear map and one or two items to look into further.

## Posture
- Named products or services are not ranked by implied superiority; any ranking states its basis. The author's own service, if present, receives no stronger endorsement language than the others, and a commercial relationship is a fact the practitioner must disclose in the published piece.
- Examples from experience appear only for items the brief actually covers; the rest go without.
- ${CONSULTATION_RULE}
- ${CASE_RULE}`,
  },
  {
    number: 10,
    label: 'News / Trend Analysis',
    description:
      'Covers a recent development, regulatory change, or emerging trend. Best for timely content, demonstrating up-to-date expertise, and capitalising on current search interest.',
    body: `# NEWS / TREND ANALYSIS

## What this article is for
The first credible explanation of what a development means for the reader. Facts first, then interpretation, then what to do, with the line between them never blurred.

## The arc
- What happened is told from sourced material only, with the publication date made clear to the reader, and with the local angle where there is one.
- Why it is happening gives the background a practitioner would give.
- What it means is worked through for the reader's situation, including who should act soon and who can wait.
- What the author expects next is labelled as the author's assessment, in ranges and conditions, never as fact.
- The reader leaves knowing what is confirmed, what is the author's reading, and what, if anything, they should do now.

## Posture
- No facts about the event come from memory; background may, when it is clearly background.
- No regulatory, legislative, judicial, or guideline change is predicted unless formally proposed by the responsible body.
- The development is described without charged language; the implications carry the weight.
- A promise to update the article appears only if the practitioner has confirmed an update process.
- ${CONSULTATION_RULE}`,
  },
  {
    number: 11,
    label: 'How-To / Tutorial',
    description:
      'Teaches the reader to accomplish a specific task with precision and completeness. Best for skill-based topics where readers need to DO something, not just understand.',
    body: `# HOW-TO / TUTORIAL

## What this article is for
The reader finishes able to do a specific thing they could not do before. Precision and completeness, in the author's voice, for a task the reader can safely complete on their own.

## The arc
- The task is scoped to what the reader can do independently: the preparatory, administrative, or lifestyle part. Where the full process needs a professional, the article says what it does not cover and why.
- The steps are real, in order, each beginning with an action and each with something observable that shows it worked. Common errors appear only where the brief or the author's experience documents them.
- A short troubleshooting and verification passage closes the loop, followed by what comes next, including the professional engagement where the task was preparation for one.
- The reader leaves with the thing done and knowing the next step.

## Posture
- No step asks the reader for a judgment that needs professional training (diagnosing, interpreting legal language, assessing their own condition); that step becomes a visit.
- Time estimates cover execution only and are ranges from the brief or are left out.
- ${CONSULTATION_RULE}
- ${SELF_DIAGNOSIS_RULE}`,
  },
  {
    number: 12,
    label: 'Local / Niche Authority',
    description:
      'Establishes deep, specific authority for a geographically or contextually defined audience. Best for local SEO, niche expertise content, and hyperspecific community knowledge.',
    body: `# LOCAL / NICHE AUTHORITY

## What this article is for
The definitive local voice on this topic: what is genuinely different here, said by someone embedded here, for readers who have found that generic advice does not quite fit.

## The arc
- Open on something specific to the place or community that only an insider would notice, then say what it changes.
- The local landscape (who the players are, what the rules are, what the conditions are) is set out from the brief's regional material and sourced research only.
- The non-obvious insights come from the author's experience and the brief; three real ones beat five with two invented. Where standard advice genuinely applies locally, the article says so and gives the local adjustments.
- Local resources and next steps are named only when they come from research or the brief, with links where available so the practitioner can verify before publishing.
- The reader leaves knowing what is different about their situation and where to go next.

## Posture
- No local claim, institution, programme, or proper noun comes from memory.
- Historical framing appears only with a verifiable source.
- ${CONSULTATION_RULE}
- ${CASE_RULE}`,
  },
]
