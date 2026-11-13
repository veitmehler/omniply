/**
 * Plain-language storytelling prompt templates (`pl_*`).
 *
 * DB-backed PromptTemplate rows looked up by string `key` (not `stepNumber`),
 * same convention as `nl_*` / `cs_*`; `stepNumber` (410-413) only exists because
 * the column is required+unique. See
 * .plans/plain-language-storytelling.implementation-plan.md.
 *
 * The chain runs section-by-section on FINAL, fact-checked content and is
 * strictly additive: detection finds jargon terms + at most one complex concept
 * per section, the writers produce brand-voiced glosses/stories guided by
 * per-industry exemplars (PlainLanguageConfig), and the verifier enforces that
 * no generated text asserts anything beyond what the adjacent article text
 * already says. Code does all HTML splicing — these prompts only produce text.
 *
 * Imported by prisma/seed.ts (prod auto-seeds) and
 * scripts/seed-plain-language-prompts.ts (staging, which does not run the seed
 * step). New keys only — no existing prompt row is ever modified.
 */
import type { NewsletterPromptTemplate } from './newsletter-prompts'

const GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'
const CLAUDE = 'claude-sonnet-4-5-20250929'

export const PLAIN_LANGUAGE_TEMPLATES: NewsletterPromptTemplate[] = [
  {
    stepNumber: 410,
    key: 'pl_detect_section',
    stepName: 'plain_language_detect_section',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH_LITE,
    maxTokens: 1024,
    systemPrompt:
      'You review one section of a finished, fact-checked article and identify what would lose the ' +
      'stated TARGET AUDIENCE, read at the pace of a busy adult. You identify candidates only — ' +
      'you never rewrite anything. Be selective: MOST sections need nothing. Only flag a term when ' +
      'that audience would genuinely stumble on it AND the section does not already explain ' +
      'it in plain words. Never flag an idiom or figure of speech ("moving the needle"), a metaphor the ' +
      'author chose, a word the audience uses in daily life, or a word every adult knows (muscle, ' +
      'hormone, mitochondria for an active professional); prefer the genuinely technical term the ' +
      'section leaves unexplained (osteomyelitis, debridement) over the easy one. Never flag the article\'s own subject (the term in the ' +
      'title, defined at the top of the article) however far down the section sits, and never flag a term inside a sentence that tells ' +
      'a particular person\'s story (a client who came in, a patient in her sixties): a definition dropped into an anecdote reads as a footnote ' +
      'mid-story. Only flag a concept when the section explains a genuinely complex ' +
      'mechanism or multi-step causal chain whose understanding materially helps the reader — not ' +
      'merely because the section is long or detailed.',
    userPrompt: `SECTION HEADING: {{sectionHeading}}

SECTION TEXT:
{{sectionText}}

INDUSTRY: {{industry}}
TARGET AUDIENCE: {{audience}}

Identify:
1. AT MOST 2 technical terms the TARGET AUDIENCE would stumble on (never idioms, figures of speech, the author's own metaphors, or everyday words). For each, include the exact sentence (verbatim from the section text) where the term first appears.
2. AT MOST 1 complex concept/mechanism genuinely worth a short explanatory story. Include a one-line summary of the mechanism and a short verbatim quote (5-15 words) from the passage where it is explained (the anchor).

Return STRICT JSON only:
{"terms": [{"term": "...", "sentence": "exact sentence from the text"}], "concept": {"summary": "one-line mechanism summary", "anchorQuote": "short verbatim quote"} | null}

If nothing needs explaining (the common case), return: {"terms": [], "concept": null}`,
    isActive: true,
  },
  {
    stepNumber: 411,
    key: 'pl_write_gloss',
    stepName: 'plain_language_write_gloss',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 300,
    systemPrompt:
      'You write ONE short plain-language gloss sentence (two at most) that explains a technical ' +
      'term to the stated target audience in plain adult words, without ever sounding childish or ' +
      'condescending — you explain like a great teacher. The gloss will be inserted directly after ' +
      'an existing sentence in a published article, so it must flow naturally as a continuation, in ' +
      'the same voice and the same grammatical person as the sentence it follows: a gloss never ' +
      'switches between "I" and "you" mid-sentence. The gloss says what the term is and stops; it ' +
      'never hedges, qualifies what a finding proves, or adds a disclaimer ("which is not the same as ' +
      'proof", "for any one person"): staying inside the excerpt is how you comply, not by saying so. ' +
      'Plain words first; an everyday example only when the construction rule asks ' +
      'for one, and never an analogy tacked onto the end of the sentence (no "the second oar on the ' +
      'boat", no "the way you would photograph a room"). HARD ' +
      'CONSTRAINT: your gloss may only illustrate what the provided article excerpt already ' +
      'states — never add facts, never strengthen claims, never promise outcomes. Follow the ' +
      'advertising restrictions exactly. Do not reuse any imagery listed as already used. Study ' +
      'the exemplars: they define the quality bar and tone. Never use em-dashes; use commas, ' +
      'colons, or separate sentences. Output ONLY the gloss sentence(s) — no quotes, no ' +
      'preamble, no markdown.',
    userPrompt: `TERM: {{term}}

THE SENTENCE IT APPEARS IN (your gloss will directly follow this sentence):
{{sentence}}

SURROUNDING ARTICLE TEXT (the outer limit of what you may assert):
{{sectionExcerpt}}

BRAND WRITING VOICE: {{writingStyle}}
TARGET AUDIENCE: {{audience}}
INDUSTRY: {{industry}}

IMAGERY ALREADY USED IN THIS ARTICLE (do not reuse): {{alreadyUsedMetaphors}}

EXEMPLARS (the quality bar — match their craft, don't copy their images):
{{exemplars}}

ADVERTISING RESTRICTIONS (hard rules):
{{restrictions}}

Write the gloss now.`,
    isActive: true,
  },
  {
    stepNumber: 412,
    key: 'pl_write_story',
    stepName: 'plain_language_write_story',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 500,
    systemPrompt:
      'You write a 3-6 sentence explanatory story/extended metaphor that makes a complex ' +
      'mechanism instantly graspable to a reader with a 5th-grade reading level, while sounding ' +
      'professional and warm — a great teacher, never a children\'s book. Rules of craft: ONE ' +
      'central image carried through the whole story (never mix metaphors), drawn from the target ' +
      'audience\'s everyday world; end by connecting the image back to the reader\'s own body or ' +
      'experience. HARD CONSTRAINT: the story may only illustrate what the provided article ' +
      'excerpt already states — never add mechanisms, never strengthen hedged claims into ' +
      'certainty, never promise outcomes. Follow the advertising restrictions exactly. Do not ' +
      'reuse any imagery listed as already used. Study the exemplars: they define the quality ' +
      'bar. Never use em-dashes; use commas, colons, or separate sentences. Output ONLY the ' +
      'story text — no title, no quotes, no markdown.',
    userPrompt: `THE MECHANISM TO EXPLAIN: {{conceptSummary}}

THE ARTICLE PASSAGE EXPLAINING IT (the outer limit of what you may assert):
{{sectionExcerpt}}

BRAND WRITING VOICE: {{writingStyle}}
TARGET AUDIENCE: {{audience}}
INDUSTRY: {{industry}}

IMAGERY ALREADY USED IN THIS ARTICLE (do not reuse): {{alreadyUsedMetaphors}}

EXEMPLARS (the quality bar — match their craft, don't copy their images):
{{exemplars}}

ADVERTISING RESTRICTIONS (hard rules):
{{restrictions}}

Write the story now.`,
    isActive: true,
  },
  {
    stepNumber: 413,
    key: 'pl_verify',
    stepName: 'plain_language_verify',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH_LITE,
    maxTokens: 256,
    systemPrompt:
      'You are a strict compliance reviewer for healthcare-adjacent marketing content. You compare ' +
      'a generated plain-language explanation against the fact-checked article excerpt it will sit ' +
      'next to, and against a set of advertising restrictions. You fail anything doubtful — a ' +
      'skipped explanation is harmless, a non-compliant one is not.',
    userPrompt: `FACT-CHECKED ARTICLE EXCERPT (the outer limit of allowed claims):
{{sectionExcerpt}}

GENERATED EXPLANATION TO REVIEW:
{{generatedText}}

ADVERTISING RESTRICTIONS:
{{restrictions}}

Fail the explanation if ANY of these are true:
1. It introduces a factual, medical, or mechanistic claim not present in the excerpt, or upgrades a hedged claim ("may", "can support") into certainty.
2. It promises or implies a health outcome, timeline, cure, treatment, or prevention of any condition.
3. It violates any of the advertising restrictions.
4. It is condescending or childish in tone.

Return STRICT JSON only:
{"ok": true} or {"ok": false, "reason": "one short sentence naming the specific problem"}`,
    isActive: true,
  },
]

/** Seed content for PlainLanguageConfig — the chiropractic exemplar bank.
 * Approved via .plans/plain-language-storytelling.implementation-plan.md. */
export const PLAIN_LANGUAGE_CONFIGS: Array<{
  industry: string
  exemplars: Array<{ kind: 'term' | 'concept'; subject: string; metaphor: string }>
  restrictions: string
}> = [
  {
    industry: 'Chiropractor',
    exemplars: [
      {
        kind: 'term',
        subject: 'subluxation',
        metaphor:
          'Think of a garden hose watering a row of plants: kink one spot even slightly, and the ' +
          'plants furthest along the row are the first to droop. A subluxation is that kink in ' +
          'your spine: a segment that has shifted out of its normal position, changing how the ' +
          'joint moves and how nearby nerves carry their signals.',
      },
      {
        kind: 'concept',
        subject: 'adjustment → nervous system → vagus nerve communication',
        metaphor:
          'Your nervous system runs your body the way a control tower runs an airport: thousands ' +
          'of messages landing and taking off every second, all on precise timing. The spine is ' +
          'the main runway those messages travel through. When an adjustment restores normal ' +
          'motion to a stuck segment, it\'s like clearing debris off that runway. The tower and ' +
          'the planes were always talking, but now the messages move the way they were designed ' +
          'to. The vagus nerve is the busiest route of all, the direct line between the tower ' +
          'and your body\'s engine rooms: heart, lungs, digestion.',
      },
      {
        kind: 'term',
        subject: 'proprioception',
        metaphor:
          'Close your eyes and touch your nose. You didn\'t miss, because millions of tiny ' +
          'position sensors in your joints and muscles are constantly telling your brain exactly ' +
          'where every part of you is. That built-in GPS is called proprioception.',
      },
      {
        kind: 'concept',
        subject: 'acute vs. chronic inflammation',
        metaphor:
          'Acute inflammation is a campfire you light on purpose: your body starts it to cook a ' +
          'repair, then puts it out. Chronic inflammation is a smoldering fire that never gets ' +
          'extinguished: quiet, low, but slowly baking everything around it. The goal isn\'t to ' +
          'never have fire; it\'s to make sure every fire gets put out when its job is done.',
      },
      {
        kind: 'concept',
        subject: 'spinal discs need motion to stay nourished',
        metaphor:
          'The discs between your vertebrae have almost no blood supply of their own; they feed ' +
          'like a sponge in a shallow dish of water. Leave the sponge sitting still and it barely ' +
          'drinks. Squeeze and release it, and it pulls water in. Movement is how your discs eat. ' +
          'That\'s why long hours in one position leave your back feeling starved.',
      },
    ],
    restrictions:
      'You are writing for a licensed healthcare practice whose advertising is regulated. Hard ' +
      'rules: NEVER claim or imply that care cures, treats, or prevents any disease or medical ' +
      'condition. NEVER promise outcomes or timelines ("you will feel...", "this fixes..."). ' +
      'NEVER use fear-based imagery about what happens without care. NEVER disparage other ' +
      'health professions. NEVER overstate mechanisms: your metaphor may only illustrate what ' +
      'the adjacent article text already says; if the article says "may support", your image ' +
      'must carry the same hedging, never upgrade it to certainty. Avoid the phrases "boosts ' +
      'immunity", "heals", "life force", and "toxins". Tone: warm, professional, respectful. ' +
      'Explain like a great teacher, never like you\'re talking down to a child.',
  },
]
