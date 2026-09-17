/**
 * Newsletter pipeline prompt templates (`nl_*`).
 *
 * These are DB-backed PromptTemplate rows looked up by the string `key` (not by
 * stepNumber). Each still carries a unique `stepNumber` (300+) because the column
 * is required + unique; generation/render code addresses them by `key`.
 *
 * Ported (and industry-neutralized) from the reference chiropractic newsletter
 * workflow — see .plans/newsletter-creation-workflow.md. Chiropractic specifics
 * are replaced with {{industry}} / {{specialization}} / {{who}} so the
 * same prompts serve any productized vertical.
 *
 * Variable convention (literal {{var}} substitution, same as the article pipeline):
 *   {{writingStyle}}    - Settings.writingStyle (per-customer voice)
 *   {{who}}             - BrandSettings.who (target audience)
 *   {{industry}}        - BrandSettings.industry
 *   {{specialization}}  - BrandSettings.specialization
 *   plus per-step topic / bullet / article-context variables noted inline.
 *
 * Imported by prisma/seed.ts (prod auto-seeds) and scripts/seed-newsletter-prompts.ts
 * (staging, which does not run the seed step). Keep this the single source of truth.
 */

export interface NewsletterPromptTemplate {
  stepNumber: number
  key: string
  stepName: string
  defaultProvider: string
  defaultModel: string
  maxTokens?: number
  systemPrompt: string | null
  userPrompt: string
  isActive: boolean
}

// Gemini 2.x was retired server-side in early July 2026 (per-project rollout, ahead of the
// documented Oct 16 date) — these follow Google's official replacement mapping.
const GEMINI_PRO = 'gemini-3.1-pro-preview'
const GEMINI_FLASH = 'gemini-3.5-flash'
const CLAUDE = 'claude-sonnet-4-5-20250929'

export const NEWSLETTER_TEMPLATES: NewsletterPromptTemplate[] = [
  // ── Article chain (used for BOTH the feature and secondary article) ──────────
  {
    stepNumber: 300,
    key: 'nl_article_outline',
    stepName: 'newsletter_article_outline',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_PRO,
    systemPrompt:
      'You are an expert content strategist who writes People-First, Helpful-Content-compliant outlines. ' +
      'You research the topic with live web data and structure a tight, valuable report outline.',
    userPrompt: `Create a detailed outline for a ~750-word educational report.

TOPIC: {{topic}}
KEY ANGLES:
- {{bullet1}}
- {{bullet2}}
- {{bullet3}}

INDUSTRY: {{industry}}
SPECIALIZATION: {{specialization}}
TARGET AUDIENCE: {{who}}

Requirements:
- People-First / Helpful-Content compliant; concrete, non-fluffy.
- Logical H2 sections (and H3s where useful) that fully cover the topic for this audience.
- Include an introduction angle and a practical takeaway/conclusion.
- Optimise for search intent without keyword stuffing.

Return ONLY the outline.`,
    isActive: true,
  },
  {
    stepNumber: 301,
    key: 'nl_article_intro',
    stepName: 'newsletter_article_intro',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_PRO,
    systemPrompt:
      'You write search-intent introductions that hook the reader immediately and match their voice.',
    userPrompt: `Write a search-intent introduction for an article based on this outline.

OUTLINE:
{{articleOutline}}

WRITING STYLE TO MATCH: {{writingStyle}}

Requirements:
- 2–4 sentences that hook the reader and frame why this matters to them now.
- Plain text only — no bold, italics, headings, or quotation marks.
- Do not summarize the whole article; just open it.

Return ONLY the introduction text.`,
    isActive: true,
  },
  {
    stepNumber: 302,
    key: 'nl_article_faq',
    stepName: 'newsletter_article_faq',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt: 'You find the real questions people ask about a topic ("People Also Ask").',
    userPrompt: `Using live search, find the 4 most common "People Also Ask" questions for this topic.

TOPIC: {{articleTopic}}
OUTLINE CONTEXT:
{{articleOutline}}

Return ONLY a numbered list of exactly 4 questions, nothing else.`,
    isActive: true,
  },
  {
    stepNumber: 303,
    key: 'nl_article_faq_facts',
    stepName: 'newsletter_article_faq_facts',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_PRO,
    systemPrompt: 'You are a research expert who finds accurate, verifiable facts with sources.',
    userPrompt: `For each of the following questions, provide 2 verifiable facts or statistics with a credible source.

QUESTIONS:
{{articleFAQs}}

Requirements:
- 2 facts/stats per question, each with a source name/URL.
- Accurate and current; no fabrication.

Return the facts grouped under each question.`,
    isActive: true,
  },
  {
    stepNumber: 304,
    key: 'nl_article_facts',
    stepName: 'newsletter_article_facts',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_PRO,
    systemPrompt: 'You are a research expert who finds accurate, verifiable facts with sources.',
    userPrompt: `For each section of this outline, provide 2 verifiable facts or statistics with a credible source.

OUTLINE:
{{articleOutline}}

Requirements:
- 2 facts/stats per section, each with a source name/URL.
- Accurate and current; no fabrication.

Return the facts grouped under each section.`,
    isActive: true,
  },
  {
    stepNumber: 305,
    key: 'nl_article_writer_system',
    stepName: 'newsletter_article_writer_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 4096,
    systemPrompt: null,
    userPrompt: `You are an expert human writer producing a newsletter feature article for a business in the {{industry}} industry (specialization: {{specialization}}), writing for this audience: {{who}}.

Write like a real, knowledgeable human:
- High perplexity and burstiness — vary sentence length and structure naturally.
- Conversational, warm, second-person where natural. 5th–7th grade reading level.
- Factual accuracy ONLY — use the provided facts/FAQ data; never invent statistics or claims.
- No ALL-CAPS words in the body. Use single quotes, not double quotes, inside prose.
- Avoid AI/marketing clichés (e.g. "in today's fast-paced world", "unlock the potential", "tapestry", "robust", "delve", "navigate the landscape", "game-changer", "elevate").
- Never use em-dashes; use commas, colons, or separate sentences.
- Never reference source/summary articles directly.

Match this writing style: {{writingStyle}}

Output STRICT JSON only (no markdown fences, no commentary), in EXACTLY this shape:
{"article_title": "<=5 words, plain text", "article_teaser": "~50 words plain text: a curiosity hook, not a summary. Open with a concrete image or moment, land on the article's most surprising specific point, never resolve it.", "article_tldr": "~12 words plain text", "article_body": "HTML using ONLY <h2>/<ul>/<ol>/<li>/<p> — no title, no <body>/<article>"}`,
    isActive: true,
  },
  {
    stepNumber: 306,
    key: 'nl_article_writer_user',
    stepName: 'newsletter_article_writer_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 4096,
    systemPrompt: null,
    userPrompt: `Write a 500–750 word educational article.

TOPIC (the angle): {{topic}}

SEARCH-INTENT INTRO TO OPEN FROM:
{{articleIntro}}

OUTLINE:
{{articleOutline}}

FAQs TO WEAVE IN:
{{articleFAQs}}

FACTS / STATS (use these — do not invent others):
{{articleFacts}}

FAQ FACTS:
{{faqFacts}}

Requirements:
- Open from the search-intent intro, then deliver on the outline.
- Weave in the facts and FAQ answers naturally; cite source context where helpful.
- Practical and specific for the audience; end with a clear takeaway.

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },
  {
    stepNumber: 307,
    key: 'nl_article_image_prompt',
    stepName: 'newsletter_article_image_prompt',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 600,
    systemPrompt:
      'You write photo-realistic, text-free, people-free image generation prompts for Flux Pro.',
    userPrompt: `Write a single image-generation prompt for the feature image of this article.

ARTICLE INTRO / CONTEXT:
{{articleIntro}}

Requirements:
- Photo-realistic, editorial-magazine style relevant to the topic and the {{industry}} industry.
- NO text, NO logos, NO people/faces.
- Be specific about subject, composition, lighting, colour palette, and mood.

Return ONLY the image prompt text.`,
    isActive: true,
  },

  // ── Teasers ("Around the web") ───────────────────────────────────────────────
  {
    stepNumber: 308,
    key: 'nl_teaser_url_selector',
    stepName: 'newsletter_teaser_url_selector',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt: 'You pick the single best, most-educational source URL for a given angle.',
    userPrompt: `From the {{urlCount}} candidate URLs below, pick the SINGLE highest-quality, most educational and trustworthy page for this angle, for our audience ({{who}}).

ANGLE: {{bulletPoint}}

CANDIDATE URLS:
{{urls}}

Return ONLY the chosen URL — no explanation, nothing else.`,
    isActive: true,
  },
  {
    stepNumber: 309,
    key: 'nl_teaser_summarizer_system',
    stepName: 'newsletter_teaser_summarizer_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 2000,
    systemPrompt: null,
    userPrompt: `You are a veteran email-newsletter hook writer for a business in the {{industry}} industry, writing for: {{who}}.
Your teasers exist for one reason: to make the reader click through to the source article. A summary satisfies the reader and kills the click. You open a curiosity loop and refuse to close it.
Write at a 5th-7th grade reading level. Use single quotes (not double) inside prose. Match this voice: {{writingStyle}}.

Hard rules:
- The reader already sees the real article title directly above your teaser. Tease BEYOND the title; never restate or paraphrase it.
- Never summarize. Never resolve the curiosity. The payoff lives in the article, not in your teaser.
- Curiosity through specificity: point at the specific surprising thing the article contains without giving its answer. No clickbait cliches ('you won't believe', 'this one trick').
- Never use em-dashes; use commas, colons, or separate sentences.
- Never promise health outcomes or violate these restrictions: {{restrictions}}

Metaphor exemplars showing the imagery quality bar (match the craft, never copy the images; may be empty):
{{exemplars}}

Output STRICT JSON only (no markdown fences, no commentary) in EXACTLY this shape:
{"title": "<one short curiosity line, NOT the article title>", "body": "HTML <p> only — two to three short paragraphs, 35-45 words each", "cta": "HTML <p> only — one line that names what the reader will get without giving it"}`,
    isActive: true,
  },
  {
    stepNumber: 310,
    key: 'nl_teaser_summarizer_user',
    stepName: 'newsletter_teaser_summarizer_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 2000,
    systemPrompt: null,
    userPrompt: `Write a click-through teaser.

HOOK TYPE for this teaser: {{hookType}}
- scene: drop the reader into a one-to-two sentence relatable moment from their daily life
- metaphor: open with one striking image matched to the audience's everyday world
- question: open with the specific, surprising question the article answers

SOURCE ARTICLE TITLE (shown above your teaser; tease beyond it, never restate it): {{sourceTitle}}

ANGLE: {{bulletPoint}}

SOURCE ARTICLE CONTENT (find the single most surprising specific claim and build the loop around it; do NOT summarize):
{{articleContent}}

Structure:
1. The hook, per the hook type above.
2. Pivot to the article's most surprising specific point, without resolving it.
3. Stop right before the payoff.
CTA: one line naming what the reader will get, not giving it (e.g. 'The part about morning stiffness alone is worth the read.').

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },

  // ── Quick hits (tips, facts) + fun (trivia, joke) ────────────────────────────
  {
    stepNumber: 311,
    key: 'nl_tips_system',
    stepName: 'newsletter_tips_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1500,
    systemPrompt: null,
    userPrompt: `You are an expert writer for a business in the {{industry}} industry, writing for: {{who}}.
Visceral, real-life, simple language at a 5th–7th grade reading level. Vary grammar across items. Single quotes only. Match this voice: {{writingStyle}}. The current year is {{ $now.year }}.

Output STRICT JSON only (no fences, no commentary), starting with { and ending with }, in EXACTLY this shape:
{"tip_1": "...", "tip_2": "...", "tip_3": "...", "tip_4": "..."}`,
    isActive: true,
  },
  {
    stepNumber: 312,
    key: 'nl_tips_user',
    stepName: 'newsletter_tips_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1500,
    systemPrompt: null,
    userPrompt: `Write exactly 4 punchy, practical tips related to this edition.

TOPIC: {{topic}}
ANGLES: {{bullet1}} | {{bullet2}} | {{bullet3}}

Requirements:
- Each tip <= 25 words, actionable, specific, no fluff.

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },
  {
    stepNumber: 313,
    key: 'nl_facts_system',
    stepName: 'newsletter_facts_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1500,
    systemPrompt: null,
    userPrompt: `You are an expert writer for a business in the {{industry}} industry, writing for: {{who}}.
Simple, vivid language at a 5th–7th grade reading level. Single quotes only. Match this voice: {{writingStyle}}. The current year is {{ $now.year }}.

Output STRICT JSON only (no fences, no commentary), starting with { and ending with }, in EXACTLY this shape:
{"fact_1": "...", "fact_2": "...", "fact_3": "...", "fact_4": "..."}`,
    isActive: true,
  },
  {
    stepNumber: 314,
    key: 'nl_facts_user',
    stepName: 'newsletter_facts_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1500,
    systemPrompt: null,
    userPrompt: `Write exactly 4 "Did You Know" facts related to this edition.

TOPIC: {{topic}}
ANGLES: {{bullet1}} | {{bullet2}} | {{bullet3}}

Requirements:
- Each fact <= 50 words, accurate and genuinely interesting.
- Do not mention the year in every fact.

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },
  {
    stepNumber: 315,
    key: 'nl_trivia_system',
    stepName: 'newsletter_trivia_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1000,
    systemPrompt: null,
    userPrompt: `You are an expert writer for a business in the {{industry}} industry, writing for: {{who}}.
Single quotes only. Match this voice: {{writingStyle}}. The current year is {{ $now.year }}.

Output STRICT JSON only (no fences, no commentary), starting with { and ending with }, in EXACTLY this shape:
{"trivia_question": "...", "trivia_answer": "..."}`,
    isActive: true,
  },
  {
    stepNumber: 316,
    key: 'nl_trivia_user',
    stepName: 'newsletter_trivia_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1000,
    systemPrompt: null,
    userPrompt: `Write one suspenseful trivia question and its answer, loosely tied to this edition.

TOPIC: {{topic}}
ANGLES: {{bullet1}} | {{bullet2}} | {{bullet3}}

Requirements:
- The question should build curiosity.
- The answer must NOT mention "newsletter" or this edition.

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },
  {
    stepNumber: 317,
    key: 'nl_joke_system',
    stepName: 'newsletter_joke_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1000,
    systemPrompt: null,
    userPrompt: `You are a genuinely funny comedy writer producing a "Joke of the Day" for a {{industry}} newsletter audience: {{who}}.
Your jokes are written like Jim Gaffigan-style self-deprecating family humor. Clean, simple, observational humour. Single quotes only.

Output STRICT JSON only (no fences, no commentary), starting with { and ending with }, in EXACTLY this shape:
{"joke": "HTML — exactly two <p> paragraphs"}`,
    isActive: true,
  },
  {
    stepNumber: 318,
    key: 'nl_joke_user',
    stepName: 'newsletter_joke_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 1000,
    systemPrompt: null,
    userPrompt: `Write a very funny joke with setup and payoff in 2 short paragraphs that relate to today's topic: {{topic}}. MUST BE: Actually funny, not corny!!

Output STRICT JSON only in the shape defined by the system instructions.`,
    isActive: true,
  },

  // ── Video + email metadata ───────────────────────────────────────────────────
  {
    stepNumber: 319,
    key: 'nl_youtube_query',
    stepName: 'newsletter_youtube_query',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt: 'You craft the single best YouTube search query to find a high-quality, informative video.',
    userPrompt: `To find the best, highest-quality, most informative video for the topic "{{topic}}" for an audience of {{who}} in the {{industry}} industry, what is the single best YouTube search query?

ONLY return the search query — no explanation, no commentary, no quotes.`,
    isActive: true,
  },
  {
    stepNumber: 320,
    key: 'nl_subject_line',
    stepName: 'newsletter_subject_line',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt: 'You write high-open-rate email subject lines.',
    userPrompt: `Write ONE email subject line for a newsletter edition about: {{topic}}

Audience: {{who}}

Requirements:
- 40–60 characters, keyword-rich, curiosity-driven.
- No spam-trigger words, no emojis, no surrounding quotes.

Return ONLY the subject line text.`,
    isActive: true,
  },
  {
    stepNumber: 321,
    key: 'nl_preview_text',
    stepName: 'newsletter_preview_text',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt: 'You write email preview (preheader) text that complements the subject line.',
    userPrompt: `Write the email preview (preheader) text for a newsletter edition about: {{topic}}

SUBJECT LINE (do not repeat it): {{subjectLine}}
Audience: {{who}}

Requirements:
- 80–100 characters, complements (does not repeat) the subject.
- Ends with a benefit or soft CTA. No emojis, no surrounding quotes.

Return ONLY the preview text.`,
    isActive: true,
  },

  // ── Module: Recipe ───────────────────────────────────────────────────────────
  {
    stepNumber: 322,
    key: 'nl_recipe_researcher',
    stepName: 'newsletter_recipe_researcher',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_PRO,
    systemPrompt: 'You are a world-class chef who researches recipes using live web data.',
    userPrompt: `Research the recipe idea: {{recipeHint}}

Using live search, return 3 related, high-quality recipe ideas (as "## Recipe 1", "## Recipe 2", "## Recipe 3") that could be fused into one excellent, approachable recipe. Include key ingredients and technique notes for each.`,
    isActive: true,
  },
  {
    stepNumber: 323,
    key: 'nl_recipe_writer_system',
    stepName: 'newsletter_recipe_writer_system',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 2500,
    systemPrompt: null,
    userPrompt: `You are a professional recipe writer for a {{industry}} newsletter audience: {{who}}. Match this voice: {{writingStyle}}.

Write ONE excellent, approachable recipe based on the research provided.
RECIPE IDEA: {{recipeHint}}
RESEARCH:
{{recipeResearch}}

Uniqueness — do NOT duplicate any of these previously-used recipe titles:
{{previousRecipeTitles}}

Output STRICT JSON only (no fences, no commentary) in EXACTLY this shape:
{"recipe_intro": "HTML — <h2> title + 1 <p> intro", "recipe_ingredients": "HTML <ul><li> only", "recipe_instructions": "HTML <ol><li> only"}
Use ONLY <h2>/<ul>/<ol>/<li>/<p> — no <body>/<article>.`,
    isActive: true,
  },
  {
    stepNumber: 324,
    key: 'nl_recipe_writer_user',
    stepName: 'newsletter_recipe_writer_user',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 2500,
    systemPrompt: null,
    userPrompt: `Write the recipe based on the context provided in the system instructions. Output STRICT JSON only in the shape defined there.`,
    isActive: true,
  },
  {
    stepNumber: 325,
    key: 'nl_recipe_image_prompt',
    stepName: 'newsletter_recipe_image_prompt',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 500,
    systemPrompt: 'You write photo-realistic, text-free, people-free food image prompts for Flux Pro.',
    userPrompt: `Write a single image-generation prompt for a photo of this finished dish.

RECIPE:
{{recipeContent}}

Requirements:
- Photo-realistic, appetising food photography. NO text, NO logos, NO people.
- Be specific about plating, lighting, and styling.

Return ONLY the image prompt text.`,
    isActive: true,
  },

  // ── Cover summary image ──────────────────────────────────────────────────────
  {
    stepNumber: 333,
    key: 'nl_summary_title',
    stepName: 'newsletter_summary_title',
    defaultProvider: 'anthropic',
    defaultModel: CLAUDE,
    maxTokens: 60,
    systemPrompt: 'You write punchy, catchy newsletter cover titles.',
    userPrompt: `Write a catchy title of EXACTLY 3 words for this edition's cover, for a {{industry}} audience ({{who}}).

This edition covers: {{headlines}}

Rules:
- Exactly 3 words, title case, no punctuation, no quotes, no emojis.
- Evocative and on-theme; not a sentence.

Return ONLY the 3-word title.`,
    isActive: true,
  },
  {
    // Config holder (not an LLM call): the cover-icon Fal model + a fixed style
    // suffix appended to each per-tile icon prompt so the icons read as one set.
    stepNumber: 334,
    key: 'nl_summary_icon_style',
    stepName: 'newsletter_summary_icon_style',
    defaultProvider: 'fal-ai',
    defaultModel: 'fal-ai/flux/schnell',
    systemPrompt: null,
    userPrompt:
      'minimal single-color line icon, dark navy (#011328) on a plain solid white background, thin uniform monoline strokes, outline only, no fill, no shadow, no gradient, centered single subject, vector style, no text, no words, no letters',
    isActive: true,
  },
  {
    // Config holder (not an LLM call): the style guide appended to the cover
    // prompt + the Gemini image model used to render the whole cover in one shot.
    // defaultModel selects the Nano Banana tier (flash = cheap, pro = premium).
    stepNumber: 335,
    key: 'nl_summary_style_guide',
    stepName: 'newsletter_summary_style_guide',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.1-flash-image',
    systemPrompt: null,
    userPrompt: `Style Instructions:

Overall Aesthetic: Sophisticated, minimalist, modern infographic style. Clean-line vector art. The overall impression should be a high-end glowing blueprint or technical diagram.

Background: Use a solid, deep matte indigo-blue/dark navy background. Strictly no gradients or background clutter.

Line Work: Render all subjects using continuous, fine, uniform-weight outlines. Strictly no solid color fills or shading within the subjects — rely entirely on minimalist contour lines.

Color Palette (Strict Duo-Tone — only these two ink colors, nothing else):
- Primary Line Color: Pure bright white (used for the main subjects, structural outlines, and typography). Do NOT use blue or any other color for the line work — the lines and text are white only.
- Accent Line Color: Warm, burnished copper / brown-gold (used sparingly for highlights, secondary details, and motion indicators). This is the ONLY non-white color in the artwork.

Accents & Details: Incorporate elegant, sweeping, thin curved lines to separate elements or create visual flow. Use small, curved accent strokes in the copper/brown-gold color to indicate motion, energy, tension, or vibration around the subjects.

Typography: Any text labels must be clean, crisp, all-caps, modern sans-serif font using the primary white color.

Lighting & Finish: Apply a very subtle, soft luminescent glow (like a faint neon effect) to all lines and text so they pop crisply against the dark background.`,
    isActive: true,
  },
  {
    // Drafts an offer/promo from a one-line brief. Output is strict JSON.
    stepNumber: 336,
    key: 'nl_offer_draft',
    stepName: 'newsletter_offer_draft',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.1-flash-lite',
    systemPrompt: null,
    userPrompt: `You write short, compelling promotional offers for a business in the {{industry}} industry, speaking to this audience: {{who}}.

From this brief, craft a newsletter offer:
BRIEF: {{brief}}

Requirements:
- Punchy, benefit-led, trustworthy. No hype, no ALL-CAPS, no emojis.
- title: <= 6 words.
- body: 1-2 short sentences (~30 words) that make the reader want to act.
- ctaLabel: 2-4 words (e.g. "Book Now", "Claim Offer").

Output STRICT JSON only (no markdown, no commentary):
{"title": "...", "body": "...", "ctaLabel": "..."}`,
    isActive: true,
  },
  {
    // Account-scoped newsletter-topic override auto-draft (Phase 4 of
    // .plans/newsletter-topic-override.implementation-plan.md). Expands a bare
    // idea-bank topic string into the same structured shape an admin's CSV row
    // supplies (bullets + secondary topic + optional recipe hints), run ONCE per
    // override topic before ensureTopicResearch — everything downstream is then
    // identical to an admin-curated topic.
    stepNumber: 337,
    key: 'nl_topic_expand',
    stepName: 'newsletter_topic_expand',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH,
    systemPrompt:
      'You are an expert newsletter content strategist. Given a bare topic idea, you expand it into a ' +
      'complete, structured edition brief — the exact same shape a human editor would prepare for a ' +
      'content calendar.',
    userPrompt: `Expand this newsletter topic idea into a complete edition brief.

TOPIC IDEA: {{topic}}
INDUSTRY: {{industry}}
SPECIALIZATION: {{specialization}}
TARGET AUDIENCE: {{who}}

RECENT SECONDARY TOPICS used in this specialization's newsletter calendar (for tone/theme
consistency — do not repeat them):
{{recentSecondaryTopics}}

Produce:
- topic: a refined, specific version of the topic idea (a full feature-article headline/angle),
  max ~12 words.
- bullet1, bullet2, bullet3: three SPECIFIC, factually-groundable angles for the feature article.
  Each must be concrete enough that a Google search on it alone would surface a real, relevant
  source article — avoid vague or generic phrasing.
- secondaryTopic: a second, related article topic for this specialization that fits the same
  content schedule as the recent secondary topics above (a genuinely different angle from the main
  topic, not a rehash of it). Always provide one.
- recipe, recipe2: a recipe name/hint ONLY if a recipe section genuinely fits this industry/
  specialization (e.g. wellness, food, health). Most B2B/professional-services specializations
  should leave these as empty strings.

Output STRICT JSON only (no markdown, no commentary):
{"topic": "...", "bullet1": "...", "bullet2": "...", "bullet3": "...", "secondaryTopic": "...", "recipe": "", "recipe2": ""}`,
    isActive: true,
  },
]
