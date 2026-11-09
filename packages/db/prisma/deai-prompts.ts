/**
 * De-AI writing prompt templates (`st_*` = style).
 * See .plans/de-ai-writing.implementation-plan.md.
 *
 * `st_dash_fix` is the Tier-2 sentence micro-editor used by
 * apps/api/src/lib/text/dash-sanitizer.ts — its output is code-verified by a
 * token-diff guard (only punctuation + a couple of allowlisted function words
 * may change), so the prompt's job is precision, not creativity.
 *
 * NOTE: the storytelling-hook prompt texts themselves live in their canonical
 * source files (newsletter-prompts.ts for 305/309/310, seed.ts for 203,
 * plain-language-prompts.ts for 411/412 + exemplars). The signed-off overwrite
 * of the existing DB rows happens via scripts/reseed-deai-prompts.ts, which
 * imports from those sources — this file only adds the NEW template.
 */
import type { NewsletterPromptTemplate } from './newsletter-prompts'

const GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'

/**
 * Canonical hook-caption texts for stepNumber 203 (social_platform_caption).
 * Consumed by seed.ts's numbered-template entry AND by the reseed script;
 * apps/api/src/social/generators/platform-caption.ts keeps matching in-code
 * DEF_SYS/DEF_USER fallbacks (reviewed in lockstep).
 */
export const CAPTION_HOOK_SYSTEM =
  'You write platform-native social media captions that HOOK. The first line decides everything: it must ' +
  'earn the tap on "more" with a concrete scene, striking image, or surprising specific — never a summary, ' +
  'never the title restated. Open a curiosity loop and do not close it. Match the platform tone and brand ' +
  'voice exactly. Never invent facts not in the source content. Never promise health outcomes. Never use ' +
  'em-dashes; use commas, colons, or separate sentences.'

export const CAPTION_HOOK_USER = `Write a {{platform}} caption for slot {{slotKey}} ({{postType}}).

Article title: {{title}}
Section text (this slot's source):
{{sectionText}}

Platform tone: {{platformTone}}
Character limit: {{charLimit}}

Brand voice:
- Organization: {{organizationName}}
- Business: {{businessDescription}}
- Target audience: {{who}}
- Writing style: {{writingStyle}}

Metaphor exemplars (the craft bar for imagery; may be empty):
{{exemplars}}

Advertising restrictions (hard rules; may be empty):
{{restrictions}}

Rules:
- FIRST LINE = the hook: a concrete moment, image, or surprising specific from the source content. Never a summary, never the title restated.
- Open a loop the caption does not close; the payoff lives in the content, not the caption.
- Curiosity through specificity; no clickbait cliches ("you won't believe").
- Return ONLY the caption text: no quotes, labels, or JSON
- Stay under {{charLimit}} characters
- Do not use markdown or em-dashes
- Match native {{platform}} posting style
- Apply the brand writing style above; if writing style is empty, default to the platform tone`

export const DEAI_TEMPLATES: NewsletterPromptTemplate[] = [
  {
    stepNumber: 420,
    key: 'st_dash_fix',
    stepName: 'style_dash_fix_sentence',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH_LITE,
    maxTokens: 256,
    systemPrompt:
      'You are a precision copy editor. You receive ONE sentence that contains an em-dash (—) ' +
      'joining words or clauses. Rewrite it with correct conventional punctuation instead of the ' +
      'dash: a comma, a colon, a semicolon, or splitting into two sentences, whichever grammar ' +
      'genuinely calls for. CHANGE NOTHING ELSE: keep every word, in the same order, with the ' +
      'same meaning. You may add at most one small connective word (like "and" or "because") if ' +
      'a comma alone would create a comma splice. Output ONLY the rewritten sentence, nothing else.',
    userPrompt: `SENTENCE:
{{sentence}}

Rewrite it now.`,
    isActive: true,
  },
  {
    // Narrated-constraint gate (bench B10): the writer announcing what it
    // cannot claim is the tell; the clinician states what is known and stops.
    // Output is code-guarded by apps/api/src/lib/text/hedge-gate.ts (no new
    // numbers, links or strengthening words, no surviving hedge, no growth).
    stepNumber: 421,
    key: 'st_hedge_fix',
    stepName: 'style_hedge_fix_sentence',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 300,
    systemPrompt:
      "You edit a clinician's patient-facing article. You receive ONE sentence in which the writer " +
      'narrates their own evidence base, limits or refusal ("I won\'t claim…", "I don\'t have data to ' +
      'hand…", "I\'d rather tell you that than quote a percentage", "that is practitioner observation"). ' +
      'Rewrite it the way the clinician would put it in print: state what is known as plain fact or ' +
      'plain opinion, in the same first-person voice, with no comment on evidence, certainty, refusals, ' +
      'or the writer\'s own honesty. Keep the real information the sentence carries (a range, a ' +
      'comparison, a recommendation, a caution). Never add facts, numbers, studies or outcomes that ' +
      'are not in the sentence. Never strengthen a claim: keep "usually", "tends to", "in my ' +
      'experience" where they exist. No em-dashes. Stay at or under the original length. If the ' +
      'sentence carries nothing beyond the narration itself, output exactly [DELETE]. Output ONLY the ' +
      'rewritten sentence or [DELETE], nothing else.',
    userPrompt: `SENTENCE:
{{sentence}}

THE SENTENCE BEFORE IT (context only, do not rewrite it):
{{before}}

Rewrite now.`,
    isActive: true,
  },
  {
    // Editor pass (consolidation round 2026-11-09): the banned-phrase list,
    // tour-guide transitions and citation-metadata rules left the step-9
    // prompt and became detection + this guarded rewrite
    // (apps/api/src/lib/text/editor-pass.ts).
    stepNumber: 422,
    key: 'st_phrase_fix',
    stepName: 'style_phrase_fix_sentence',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 300,
    systemPrompt:
      "You edit a clinician's patient-facing article. You receive ONE sentence and the reason it was " +
      'flagged. Rewrite it the way the clinician would say it across the desk: plain, concrete, in the ' +
      'same first-person voice, carrying exactly the same information. Keep every figure, range, ' +
      'comparison, recommendation and caution the sentence holds. Never add facts, numbers, names, ' +
      'studies or outcomes that are not in the sentence. Never strengthen a claim: keep "usually", ' +
      '"tends to", "in my experience" where they exist. No em-dashes. Stay at or under the original ' +
      'length. If the sentence carries nothing beyond the flagged phrase itself, output exactly [DELETE]. ' +
      'Output ONLY the rewritten sentence or [DELETE], nothing else.',
    userPrompt: `SENTENCE:
{{sentence}}

WHY IT WAS FLAGGED:
{{reason}}

THE SENTENCE BEFORE IT (context only, do not rewrite it):
{{before}}

Rewrite now.`,
    isActive: true,
  },
  {
    // Editor pass: a section with no trace of the practitioner gets one
    // paragraph rewritten to carry their presence. Code-guarded (same numbers,
    // no links, bounded growth, must now contain a first-person marker).
    stepNumber: 423,
    key: 'st_presence_fix',
    stepName: 'style_presence_fix_paragraph',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 600,
    systemPrompt:
      "You edit a clinician's patient-facing article written in their own first-person voice. You receive " +
      'ONE paragraph from a section in which the clinician has gone silent: nothing in the section shows ' +
      'that a practitioner who does this work is speaking. Rewrite the paragraph so the clinician is ' +
      'present in it, in whatever way fits this material: a judgment they hold, something they check or ' +
      'watch for, a preference, a point where they part ways with common advice. Change as little as ' +
      'possible: keep every fact, figure and recommendation exactly as given, keep the order of ideas, ' +
      'and add no new facts, numbers, studies, patients or scenes. Never narrate caution, evidence or ' +
      'limits. No similes or metaphors. No em-dashes. At most one short sentence longer than the ' +
      'original. Output ONLY the rewritten paragraph as plain text, no HTML, nothing else.',
    userPrompt: `SECTION HEADING (context only):
{{heading}}

PARAGRAPH:
{{paragraph}}

Rewrite now.`,
    isActive: true,
  },
  {
    // B16 source support check (apps/api/src/article-pipeline/source-support.ts):
    // one closed question per fact; the quote is code-checked against the
    // source text, the verdict decides link / fact per Veit's rulings.
    stepNumber: 424,
    key: 'st_source_support',
    stepName: 'source_support_check',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH_LITE,
    maxTokens: 300,
    systemPrompt:
      'You check whether a source text supports a statement. You read only what is in the source text given to you. ' +
      'Output ONLY a JSON object: {"verdict": "supported" | "partial" | "unsupported", "quote": "<the one sentence from the source that supports the statement, copied exactly, or an empty string>"}. ' +
      '"supported" means the source states the claim, including any figure, rate, duration or percentage in it, at the same scope. ' +
      '"partial" means the source covers the claim but not the exact figure, or a narrower or broader scope (for example a different patient group or condition). ' +
      '"unsupported" means the source does not state the claim. Never infer from general knowledge; if it is not in the source text, it is unsupported.',
    userPrompt: `STATEMENT:
{{fact}}

SOURCE TEXT:
{{source}}

Answer with the JSON object only.`,
    isActive: true,
  },
]
