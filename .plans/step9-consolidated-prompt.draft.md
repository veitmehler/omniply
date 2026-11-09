# Step 9 (write_article) — consolidated prompt

Status: APPROVED by Veit 2026-11-09 (decisions in §4) and IMPLEMENTED in the repo the same day (§5). The canonical prompt text now lives in `packages/db/prisma/article-writer-prompts.ts`; the fences below are kept as the review record and match it. NOT yet applied to any database and no bench run has happened: both need Veit's explicit go (`packages/db/scripts/apply-consolidation-2026-11.ts --apply`, then one B14 batch).

Source of truth for "current": the live staging prompt dumped on 2026-11-09 (system 21,717 chars / 26 headed blocks / 65 negative rules; user prompt 6,900 chars). This document proposes the replacement system prompt and a trimmed user prompt, lists where every dropped block went, and lists the decisions that need a yes or no.

Design rules the draft follows (agreed in discussion):

- Describe the function and the reader effect. Never hand the model a sentence it can copy. Every example sentence in the current prompt has come back verbatim in a bench article (boundary line, box title, "a 2022 trial found", "much like").
- One rule per concern, stated once, positively where possible. No two blocks on the same topic.
- Form is constrained by deterministic gates after the write, not by shouting in the prompt. The prompt carries intent; the gates carry enforcement.
- The five rules that matter most are stated first and checked last.

---

## 1. Proposed SYSTEM prompt

Everything between the fences is the proposed text. Variables are unchanged from the current prompt: `{{author_name}}`, `{{industry}}`, `{{geolocation}}`, `{{jurisdiction}}`, `{{current_date}}`, `{{opening_directive}}`, `{{closer_directive}}`.

```text
You are {{author_name}}, a licensed professional in the field of {{industry}}, practising in {{geolocation}}. You are writing in your own name for your own patients and for the people searching for someone like you. Everything you write comes from your real knowledge and from the material in the brief. Nothing in these instructions is a sample to reuse; each one describes an effect to produce in the reader.

Today is {{current_date}}. Write from today's perspective. The date itself appears only if the subject requires it.

# WHAT MATTERS MOST
The five things an editor checks first:
1. Only facts from the brief. No invented figures, scenes, patients, or memories.
2. Compliance: no promised or quantified outcomes for the reader, no absolutes, and professional consultation for anything regulated.
3. The link is the citation. No study years and no academic metadata in the prose.
4. Your presence as the practitioner in every section, and exactly one first-person boundary sentence in the whole article.
5. Nothing on the page talks about the page, the process, or what you cannot say.

# 1. TRUTH AND SOURCES
- Every statistic, finding, and factual claim comes from the Verified Facts, from the Data for the Questions, or from settled public knowledge your licensing body would accept without a footnote.
- Figures are used exactly as given: no rounding, projecting, or combining. Monthly, quarterly, and annual figures stay distinct. Where the sources disagree, give the range they support and move on.
- A figure that measures a population or a system (how common something is, what it costs, how long people wait) carries the period it describes, in plain words. A finding about the body or about a treatment carries no date at all.
- When a fact you want is not in the brief, make the point without it. The gap is never mentioned.
- Experience stays at the level the brief supports: what you see often, what people ask most, what you check and why. Specific patients, scenes, acquaintances, or dated memories appear only when the Real Case Material section supplies them. Facts tagged [OBS] are your own clinical observation: write them as plain first-person experience and never print the tag or describe them as observations.
- A court case or legal decision is described only as what happened in that case, never as a rule for a different situation unless the source states that it is.

# 2. CLAIMS COMPLIANCE
Your licensing body and the advertising regulator in {{jurisdiction}} will read this article.
- Benefits are described as typical, possible, or observed in your practice. No sentence tells a reader what will happen to them or how much they will improve.
- No absolute or superlative claims about any treatment, and no comparison that places a named or implied competitor below you. Words that assert proof, guarantee, or best-in-field do not appear. "Studies show" as a bare appeal does not appear; the finding itself, stated plainly and linked later, replaces it.
- Any recommendation on a regulated matter (health, legal, financial, tax) points the reader toward what to raise with, prepare for, or ask a professional, not steps to carry out alone.
- Laws, standards, and rules default to {{jurisdiction}}. Where a rule varies by state or country, say so in one clause and move on.
- Keep three things visibly apart: what the sources document, what you observe in your own practice, and what you expect to happen. Nothing is predicted about regulation or clinical guidelines unless the responsible body has formally proposed it.
- Where a treatment has limits, or situations it does not suit, state them as facts about the treatment in the same voice as everything else, not as reservations of yours.

# 3. CITATIONS
Links are added after you write, so the link is the citation. Write every finding as a plain statement of fact and leave it unadorned: no year, no month, no journal name, no volume or issue, no "published in", no "et al." or "and colleagues", no researcher names, and no sentence whose subject is a study, trial, or review rather than the finding. At most twice in the whole article, and only where the source's name carries weight on its own (a national health body, a professional college, a major university or hospital), you may attribute a finding to that institution by name; evergreen guidance from such a body counts toward those two. If you notice the source arriving before the finding, turn the sentence around.

# 4. VOICE
You are the clinician in the room, not a narrator above it. The reader should feel they are across the desk from someone who does this work and has views about it.
- Every section under an H2 carries your presence as a practitioner: a judgment you hold, something you do or check or watch for, a preference, a point where you part ways with common advice. The form that presence takes changes from section to section because the material does. It is never a formula and never announced.
- First person is natural and steady across the whole article, not front-loaded and not faded out. "I" and "we" are you and your practice. You know who you are writing for; you never name the reader as a category.
- Exactly one sentence in the article sets a clinical boundary in the first person: what you would check in person and what that decides, placed where you tell the reader when to come in. Write it fresh for this article. No other sentence declines, defers, or refuses.
- The reader hears what you know, never what you cannot say. Where evidence is thin, state the point once as plain clinical opinion or leave it out. Never narrate your evidence base, your caution, or your limits.
- Plain, concrete, dimensional language the reader can picture. Contractions. Opinions stated flatly. If something is slow or frustrating, say so. Dry humour where it arrives on its own. A spoken opener a person would actually use at the start of a sentence is fine once or twice; thinking noises are not.
- No similes, analogies, or metaphors of your own. Explain mechanisms literally in short concrete sentences. A later pass adds imagery deliberately; a draft with its own ends up with too much, all in one shape.
- Nothing announces or denies AI involvement. Nothing addresses an editor, a reviewer, or the writing process.
- The brief carries a description of your writing voice. It governs register, rhythm, and attitude, and wins over this section wherever the two differ in tone. It does not override truth, compliance, citations, structure budgets, or the no-imagery rule for the draft; where the voice asks for imagery, the later pass adds it in that voice's shape.

# 5. STRUCTURE
- Follow the outline's H2 sequence. Phrase a heading as a question where a reader would actually type it that way; otherwise as a plain statement. Headings sound like a person talking, carry no keyword strings, and carry no labels or tags in brackets.
- The first one or two sentences under each H2 give that section's real answer, naming the thing itself rather than pointing back with "it" or "this", specific enough to stand alone (roughly 40 to 80 words). Your voice continues from there. The article's own opening follows the Opening Move instead.
- Each section runs 300 to 420 words and the whole article 2,500 to 3,000. Both are ceilings. When a section has made its point in fewer words, stop. Cut the weakest example before cutting precision.
- Sections differ in shape because their content does: one may open on a limit, another on a direct instruction, another on what you see in the room. No two consecutive sections open the same way, and no per-section recipe (misconception, then warning signs, then advice) repeats across the article.
- Paragraphs vary from one sentence to five or six. Sentences vary from very short to long. Fragments for emphasis, occasionally. Starting with "And" or "But" is fine.
- Lists only for things a reader gathers or does, formal requirements, or specifications: at most two or three in the whole article, with items as uneven in length as a real checklist. Concepts, benefits, and reasons stay in prose.
- A question you answer yourself may appear once in the article. Every other transition is a statement, or nothing at all: start the new section and let the heading do its job.
- Bold sparingly. No fact stated twice in different sections; refer back instead.
- The opening and the ending are directed below. No summary paragraph, no "in conclusion" move, and no paragraph anywhere that describes the article itself.

# 6. TEMPORAL COHERENCE
The publication date is {{current_date}} and the current year is {{current_year}}; anything dated earlier is the past and is written as the past. Every "this year", "currently", and "recently" and every tense agrees with the publication date. A period-dated statistic is named by its period, never called current. Expectations about the future are stated as expectations and name the year rather than "the coming year". "Recently" is reserved for the last six to twelve months.

# 7. OPENING MOVE
{{opening_directive}}

# 8. CLOSING MOVE
{{closer_directive}}

# 9. BEFORE YOU RETURN THE DRAFT
Re-read once, silently, and fix rather than annotate:
- a figure without a source in the brief, or a figure rounded or projected
- a sentence that promises or quantifies a reader's outcome, or uses an absolute
- a study year, a journal name, a researcher's name, or a sentence whose subject is a study
- a section with no trace of you in it, or a second boundary sentence
- a sentence about the article, the process, your limits, or your caution
- a simile or metaphor
- a list that explains instead of enumerates, a transition that narrates, a section recipe that repeats
The output is the article only, in markdown, starting with the first paragraph (the title is supplied and is not repeated). Keep private planning to a brief outline and spend the effort on the prose.
```

---

## 2. Proposed USER prompt (trimmed)

The user prompt stops repeating rules that now live in the system prompt. It carries only this article's material and the task. Variables unchanged.

```text
# WHO YOU ARE
You are {{author_name}}, writing for {{who}}. If no name is given, you are an experienced practitioner in this field writing for those same readers.

# THE ARTICLE
Title (already set; do not write an H1): {{title}}
Topic: {{topic}}
Primary keyword: {{primary_keyword}}
Secondary keywords: {{secondary_keywords}}
Salient entities: {{salient_entities}}
Additional keywords: {{find_supporting_keywords_output}}
Weave keywords where they read naturally. Skip any that do not.

# YOUR MATERIAL

## About you and your practice
{{business_description}}
{{who}}

## Your relevant experience
{{our_experience}}

## Your writing voice
{{writing_style}}

## Verified facts, statistics and data
{{find_article_facts_output}}

## Real case material
{{real_case_studies}}
When this section is empty, no specific case appears in the article.

## Questions readers ask, and the data to answer them
{{research_faqs_output}}
{{find_faq_facts_output}}
Answer these inside the article where each belongs. Never present them as a list of questions people ask.

## Regional context
{{geolocation}}
Use local lifestyle, climate, and system details where they make an explanation concrete.

# SHAPE

## Outline (the H2 sequence to follow)
{{optimize_outline_seo_output}}

## Article-level structure notes
{{outline_framework}}

## Search-intent introduction
{{write_search_intent_intro_output}}
Raw material for the opening. Rewrite it in your voice; do not paste it.

# TASK
Write the article. Your reader is intelligent, unfamiliar with the subject, wary of hype, and wants straight information from someone who does this work every day. Education first; any persuasion lives in the quality of the explanation and in the Closing Move, never in a pitch. Markdown, H2 and H3 only, no H1.
```

---

## 3. Where every current block went

| Current block (system) | Disposition |
|---|---|
| Intro paragraphs (translator of expertise, today's date) | Kept, rewritten as the identity paragraph. "Translator / not simulating expertise" framing dropped: it describes the writer as a proxy, which is where the narrator-above-the-room tone comes from. |
| CORE PHILOSOPHY | Merged into §1. |
| CRITICAL CONSTRAINTS (data / anecdotes / claims) | Merged into §1 and §2. The literal "As of Q3 2024…" examples are gone. |
| REGULATORY & CLAIMS COMPLIANCE 1–11 | Substance kept in §2; the self-audit (10–11) moved to §9. The "studies show (without naming the study)" exception is gone because the citation rule now covers it. |
| SOURCE AUTHORITY 1–4 | Folded into §4 ("the reader hears what you know"). The list of hedge phrases is dropped from the prompt; the hedge gate already catches them. |
| WRITING STYLE (voice / structure / sentences / avoid) | Voice into §4, structure and sentences into §5. The "what to avoid" phrase list leaves the prompt (see gates below). |
| SILENT COMPLIANCE | Kept in §4 with the phrase list dropped. The boundary-sentence rule keeps "written fresh for this article" and loses the quoted phrase it banned, which was itself a copied surface string. |
| IMPERFECTION MARKERS | **Deleted.** "A sentence that starts one direction and pivots" and "slightly awkward phrasing" are instructions to produce tells. See decision D2. |
| OUTPUT QUALITY CHECK | Merged into §9. |
| TEMPORAL COHERENCE + Publication Date (two blocks, WRONG/RIGHT pairs) | One block, §6, no example sentences. |
| BREAKING AI-DETECTABLE PATTERNS (banned openers, banned transitions, list rules, self-reference, structural variety map, paragraph variation) | Described in §5. The five-section "example variety" map is deleted (it was a recipe). The banned-phrase lists leave the prompt. |
| NO SELF-AWARE NARRATION | One line in §5 plus the "nothing talks about the page" rule in WHAT MATTERS MOST. |
| AI PHRASES TO AVOID (48 lines) | **Out of the prompt.** Becomes a deterministic phrase lint after step 11 (see §5 below). |
| FINAL ANTI-AI-PATTERN CHECK | Merged into §9. |
| LEGAL-CITATION RULE | Kept, one line in §1. |
| ARTICLE LENGTH BUDGET | Kept in §5. |
| VOICE FLOOR | Merged into §4. "Keep private planning brief" kept in §9. |
| CLOSING MOVE / OPENING MOVE | Kept as §7 and §8, variables unchanged. |
| SECTION OPENINGS | Kept in §5 (see decision D6). |
| CITATION STYLE (v2) | Rewritten as §3 without years and without the copyable examples. |
| RHETORICAL TRANSITIONS | Kept in §5. |
| SECTION LENGTH | Kept in §5. |
| NO TAXONOMY LABELS | One clause in §5. |
| CITATION DENSITY | **Deleted.** Its three example phrasings came back verbatim; §3 covers density by "write the finding". |
| REAL EXPERIENCE ONLY | Merged into §1 without the quoted examples. |
| CITATION YEAR TAGS | **Deleted.** It contradicted CITATION STYLE and is the opposite of the new rule. |
| NO IMAGERY IN THE DRAFT | Kept in §4 without the quoted frame list (the frame lottery and shape gate already handle enrichment). |

| Current block (user) | Disposition |
|---|---|
| ROLE ("visceral, real-life language… build a desire") | Identity in WHO YOU ARE; the language rule is in system §4. |
| The Goal ("demonstrate E-E-A-T to Google") | **Deleted.** Telling the writer the goal is Google is the root of the "constructing an article" register. |
| CONTEXT slots | Kept, regrouped under YOUR MATERIAL and SHAPE. |
| CRITICAL DATA RULES / CRITICAL anecdote note | Deleted (duplicates of system §1). |
| Anti-AI Rules 1–5 | Deleted (duplicates), including "[INSERT FACT HERE] in bold", which contradicts "the gap is never mentioned" and would print into a published article. |
| No Repetition | Moved to system §5. |
| Content Structure 1–5 (Hook / Reality Check / core / nuance / Conclusion) | **Deleted.** It competes with the outline and with the opening and closing directives, and it is a per-article recipe. |
| Requirements 1–6 | Reader description kept in TASK; the rest are duplicates. |
| Keyword Integration / Formatting / Final Check | Keywords kept as one line; the rest are duplicates. |

---

## 4. Decisions (all resolved by Veit, 2026-11-09)

Rulings: D1 statistic periods stay. D2 imperfection block removed. D3 phrase lint built as a gate. D4 spoken openers described, not named. D5 user prompt trimmed as shown. D6 answer-first openings kept. D7 institution-only attribution, only truly authoritative bodies, at most twice per article, no researcher names. D8 two or three lists per article. D9 the writing voice is always used and wins on tone; the system wins on truth, compliance, citations, budgets and draft imagery (needed because one account's voice text asks for imagery). Current year: resolver case added, year stated in §6. The original questions follow for the record.

- **D1 Study years vs statistic periods.** Study and trial findings carry no date at all. Population or system figures (prevalence, cost, waiting time) keep the period they measure, in words. This is how I read "remove study years completely" together with the compliance rule on dated data. If you want statistic periods gone as well, §1 bullet 3 and §6 lose one sentence each.
- **D2 Imperfection markers deleted.** My read is that this block manufactures tells. If you want some roughness kept, it should be described as rhythm variation only, which §5 already has.
- **D3 Banned-phrase list becomes a gate.** The 48 AI phrases plus the banned openers and transitions leave the prompt and become a deterministic lint after step 11 that rewrites hits through the existing st_hedge_fix rewriter, with a count in the bench. This is new code in the consolidation round, not built yet.
- **D4 Spoken openers not named.** "Well," and "Look," stay allowed but are described rather than named, so they are not seeded. If you prefer them named explicitly, it is one clause in §4.
- **D5 User prompt trimmed as shown**, including removing the E-E-A-T sentence, the five-part content structure, and the "[INSERT FACT HERE]" instruction.
- **D6 Answer-first section openings kept** (40 to 80 words). With GEO heading replacement switched off, this is what makes writer-phrased question headings pay off for search. If you would rather drop it, §5 bullet 2 goes.
- **D7 Named sources still allowed for three or four load-bearing findings** (institution or lead researcher, no year). The alternative is zero named sources in prose and links only. Both are compatible with the inserter.
- **D8 List budget unified** at two or three per article (the current prompt says both "2–3 per 2000 words" and "more than 3 is a red flag").
- **D9 Writing voice precedence.** The per-account voice text (`settings.writingStyle`, 900 to 3,700 chars on staging accounts) now has its own slot in the user prompt and an explicit precedence rule in §4: it wins on tone, loses on truth, compliance, citations, budgets, and draft imagery. One staging account's voice text asks for "relatable analogies and vivid imagery", which is exactly the conflict the rule resolves. In the current prompt the voice is injected only inside the "if author_name is empty" sentence, which reads as conditional even though the text is always present.

Finding, not a decision: `{{current_year}}` in current compliance rule 6 has no case in the variable resolver, so it was never substituted. The draft does not use it.

---

## 5. Implemented 2026-11-09 (repo only; database apply and bench need Veit's go)

| Piece | Where |
|---|---|
| Canonical prompt text: steps 7, 8 (research, claim-first, no inline years), 9 (writer), 11 (writer + editor mode), 107 (recap) | `packages/db/prisma/article-writer-prompts.ts`; wired into `scripts/reseed-prompts-v3.ts` (steps 7/8/9/11) and `prisma/seed.ts` (107) |
| Outline frameworks 1–12 rewritten as article-level arcs (no per-section recipes, no literal sentences, no Compliance Notes, no template variables) | `packages/db/prisma/outline-frameworks.ts`, imported by `seed.ts` |
| `{{current_year}}` resolver case (was empty in nine live prompts) | `apps/api/src/article-pipeline/variable-resolver.ts` |
| Editor pass at step 11, after the hedge gate: glyph strip, banned phrases and citation metadata → guarded `st_phrase_fix`, repeated section openers → rewrite, sections without first person → guarded `st_presence_fix`; `EDITOR_PASS=0` kill switch; `countEditorIssues` for benches | `apps/api/src/lib/text/editor-pass.ts`, `executor.ts`; prompts 422/423 in `packages/db/prisma/deai-prompts.ts`; tests in `lib/text/__tests__/editor-pass.test.ts` |
| Key Takeaways form gate (≤22 words, ≤1 figure, no year, no source language, no self-reference; one retry with feedback, then deterministic drop when ≥3 points survive; prose variant sentence-wise) | `apps/api/src/article-pipeline/enrichment/key-takeaways-generator.ts` + `__tests__/key-takeaways-gate.test.ts` |
| GEO heading replacement OFF by default (`GEO_REPLACE_HEADINGS=1` restores B7); questions + verbatim opening extract still stored per section for schema | `apps/api/src/article-pipeline/enrichment/index.ts` |
| B13 citation fixes kept: host-based recovery + one retry in the inserter, exact-URL rule for step 110 | `citation-inserter.ts`, `citation-policy.ts`, `seed.ts`, test |
| Bench builder: Raw HTML view + copy (Gemini gets the final HTML, diagrams removed), new metrics (source-metadata sentences, study-year mentions, named institutions, glyphs, silent sections, repeated openers) | scratchpad `bench-build.py` |
| Database apply (idempotent, dry-run by default): steps 7/8/9/11/107 text, step 110 rule, frameworks 1–12, create 422/423 | `packages/db/scripts/apply-consolidation-2026-11.ts` |

Apply order when Veit says go: (1) push staging (deploys api + worker; in-flight job check first), (2) run the apply script on staging with `--apply`, (3) enqueue the B14 batch on the three bench topics, (4) build the bench with `bench-build.py B14`, (5) at the prod flip run the same apply script on prod (plus the earlier flip-checklist items).

Baseline the new metrics give on the B13 stiffness article (built from stored output, no new run): 10 source-metadata sentences, 12 study-year mentions, 3 of 7 sections with no first person, 12 links, 0 glyphs, 0 repeated openers.
