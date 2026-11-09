import { PrismaClient } from '@prisma/client'
import { NEWSLETTER_TEMPLATES } from './newsletter-prompts'
import { CLIENT_STORY_TEMPLATES } from './client-story-prompts'
import { PLAIN_LANGUAGE_TEMPLATES, PLAIN_LANGUAGE_CONFIGS } from './plain-language-prompts'
import { AGENT_TEMPLATES, WELLNESS_AGENT_TEMPLATES } from './agent-prompts'
import { DEAI_TEMPLATES, CAPTION_HOOK_SYSTEM, CAPTION_HOOK_USER } from './deai-prompts'
import { OUTLINE_FRAMEWORKS } from './outline-frameworks'
import { KEY_TAKEAWAYS_SYSTEM_PROMPT, KEY_TAKEAWAYS_USER_PROMPT } from './article-writer-prompts'

const prisma = new PrismaClient()

const PROMPT_TEMPLATES = [
  {
    stepNumber: 0,
    stepName: 'generate_title',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are an expert content strategist and SEO copywriter. Your task is to convert a raw article idea into a compelling, SEO-optimized H1 title.',
    userPrompt: `Convert this article idea into a single, compelling H1 article title:

Idea: {{topic}}
Industry: {{industry}}
Business context: {{business_description}}

Rules:
- The title must be specific, clear, and engaging
- Optimise for search intent and click-through
- Keep it under 70 characters when possible
- Do NOT use clickbait or vague phrasing
- Respond with ONLY the title text — no quotes, no explanation, nothing else`,
  },
  {
    stepNumber: 1,
    stepName: 'generate_outline',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are an expert content strategist and SEO specialist. Your task is to create comprehensive, well-structured article outlines that follow SEO best practices and engage readers.',
    userPrompt: `Create a detailed article outline for the following topic: {{topic}}

Excluded keywords (do not use): {{excludedKeywords}}

Requirements:
- Create a logical, engaging structure
- Include H2 and H3 headings
- Ensure the outline covers the topic comprehensively
- Make it SEO-friendly
- Include introduction and conclusion sections

Return the outline in a structured format.`,
  },
  {
    stepNumber: 2,
    stepName: 'keyword_research',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: 'You are an expert SEO specialist focusing on keyword research and search intent analysis.',
    userPrompt: `Perform comprehensive keyword research for the topic: {{topic}}

Excluded keywords (do not use): {{excludedKeywords}}

Return ONLY a JSON object (no markdown fences, no extra text) with this exact structure:
{
  "primary_keyword": "the single best target keyword phrase",
  "secondary_keywords": ["kw1", "kw2", "kw3"],
  "long_tail_keywords": ["long tail 1", "long tail 2"],
  "search_intent": "informational | commercial | transactional | navigational",
  "difficulty": "low | medium | high"
}`,
  },
  {
    stepNumber: 3,
    stepName: 'find_supporting_keywords',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: 'You are an SEO expert specializing in semantic keyword research and LSI keywords.',
    userPrompt: `Based on the topic "{{topic}}" and the primary keywords: {{primary_keyword}}

Find additional supporting keywords including:
1. LSI (Latent Semantic Indexing) keywords
2. Related terms and phrases
3. Question-based keywords
4. Semantic variations

Excluded keywords (do not use): {{excludedKeywords}}

Return as a JSON array with relevance scores.`,
  },
  {
    stepNumber: 4,
    stepName: 'optimize_outline_seo',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: 'You are an expert in Google SEO best practices and content optimization.',
    userPrompt: `Take this article outline and optimize it according to Google's latest SEO best practices:

{{outline}}

Keywords to incorporate: {{keywords}}
Excluded keywords (do not use): {{excludedKeywords}}

Optimize for:
- Keyword placement in headings
- Search intent alignment
- E-E-A-T principles (Experience, Expertise, Authoritativeness, Trustworthiness)
- User engagement
- Featured snippet potential

Return the optimized outline with SEO annotations.`,
  },
  {
    stepNumber: 5,
    stepName: 'write_search_intent_intro',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are an expert content writer specializing in creating compelling introductions that match search intent.',
    userPrompt: `Write a compelling introduction for an article about: {{topic}}

Primary keyword: {{primaryKeyword}}
Search intent: {{searchIntent}}

Requirements:
- Address the reader's search intent immediately
- Hook the reader in the first sentence
- 150-200 words
- Include the primary keyword naturally
- Set clear expectations for what the article will cover

Excluded keywords (do not use): {{excludedKeywords}}`,
  },
  {
    stepNumber: 6,
    stepName: 'research_faqs',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are an expert at understanding user questions and creating comprehensive FAQ sections.',
    userPrompt: `Research and generate frequently asked questions (FAQs) for the topic: {{topic}}

Requirements:
- Generate 8-12 highly relevant questions
- Questions should cover different aspects of the topic
- Include both beginner and advanced questions
- Format questions naturally, as a person would ask ALOUD — short (aim under 10 words), no audience or keyword qualifiers bolted on for SEO
- Consider "People Also Ask" style questions

Excluded keywords (do not use): {{excludedKeywords}}

Return as JSON array with question text.`,
  },
  {
    stepNumber: 7,
    stepName: 'find_faq_facts',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: 'You are a research expert specializing in finding accurate, verifiable facts and data.',
    userPrompt: `For each of these FAQ questions, provide detailed, factual answers with supporting data:

{{faqQuestions}}

Requirements:
- Provide accurate, well-researched answers
- Include specific facts, statistics, or data points
- Cite credible sources where possible
- Each answer should be 100-150 words
- Maintain authoritative tone

Topic context: {{topic}}

Return as JSON with question-answer pairs and source suggestions.`,
  },
  {
    stepNumber: 8,
    stepName: 'find_article_facts',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are a research specialist focusing on gathering credible facts, statistics, and data for content creation.',
    userPrompt: `Research and provide supporting facts, statistics, and data for this article:

Topic: {{topic}}
Outline: {{outline}}

Requirements:
- 10-15 specific facts, statistics, or data points
- Ensure facts are recent and verifiable
- Cover different sections of the outline
- Include numerical data where possible
- Suggest credible sources

Return as JSON array with fact, context, and suggested source.`,
  },
  {
    stepNumber: 9,
    stepName: 'write_article',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt:
      'You are a professional content writer with expertise in creating engaging, SEO-optimized long-form articles. You write in a clear, authoritative voice while maintaining reader engagement. LEGAL-CITATION RULE: When mentioning court cases or legal decisions: describe them ONLY as examples of what actually happened in that specific case; NEVER assert a case as "precedent" or claim it establishes a legal rule for a different context unless the source material explicitly states that holding applies.',
    userPrompt: `Write a comprehensive, SEO-optimized article based on the following:

Topic: {{topic}}
Outline: {{outline}}
Keywords: {{keywords}}
Search Intent Intro: {{intro}}
Supporting Facts: {{facts}}
FAQs: {{faqs}}

Excluded keywords (do not use): {{excludedKeywords}}

Requirements:
- 1500-2500 words
- Follow the provided outline structure
- Incorporate keywords naturally
- Use the provided intro
- Include the FAQ section
- Weave in supporting facts throughout
- Use engaging, clear language
- Include transition sentences between sections
- Write in HTML format with proper heading tags (h2, h3)
- Include <p> tags for paragraphs

Output the complete article in clean HTML format.`,
  },
  {
    stepNumber: 10,
    stepName: 'fact_check_article',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are a professional fact-checker with expertise in verifying claims, statistics, and statements in content. When mentioning court cases or legal decisions: describe them ONLY as examples of what actually happened in that specific case; NEVER assert a case as "precedent" or claim it establishes a legal rule for a different context unless the source material explicitly states that holding applies. Flag any citation asserted as precedent beyond its actual holding.',
    userPrompt: `Carefully fact-check the following article for accuracy:

{{article}}

Task:
1. Identify all factual claims and statements
2. Flag any claims that appear incorrect, outdated, or unverifiable
3. Note any statistics that need verification
4. Highlight potentially misleading information
5. Check EVERY court case or legal citation: does the described holding match what that case actually decided? Flag any case asserted as "precedent" or as establishing a legal rule beyond its actual holding (e.g. a sanctions ruling described as establishing general liability)

Return as JSON array with:
- claim: the specific text
- issue: what's wrong or needs verification
- severity: low/medium/high
- suggestion: how to correct it`,
  },
  {
    stepNumber: 11,
    stepName: 'adjust_incorrect_facts',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt: 'You are a professional editor specializing in fact correction and content refinement.',
    userPrompt: `Revise this article to correct the identified factual issues:

Original Article:
{{article}}

Fact Check Issues:
{{factCheckIssues}}

Task:
- Correct all flagged inaccuracies
- Replace incorrect statistics with accurate ones (or remove if unverifiable)
- Maintain the article's flow and readability
- Keep the same HTML structure and formatting
- Preserve all correct content

Return the corrected article in HTML format.`,
  },
  {
    stepNumber: 12,
    stepName: 'find_citations',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt:
      'You are a research expert specializing in finding high-quality, authoritative sources for content citations.',
    userPrompt: `Find 8-12 high-quality citation sources for this article:

Article: {{article}}
Topic: {{topic}}

Requirements:
- Authoritative sources (.edu, .gov, reputable organizations)
- Recent publications (prefer last 2-3 years)
- Directly relevant to claims in the article
- Include diverse source types (studies, reports, articles)
- Provide specific URLs where possible

Return as JSON array with:
- sourceTitle: title of the source
- sourceUrl: URL (if available)
- sourceType: study/article/report/website
- relevantClaim: which claim in the article it supports
- authority: rating of source authority (1-10)`,
  },
  {
    stepNumber: 13,
    stepName: 'generate_seo_metadata',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are an SEO specialist focusing on metadata optimization for maximum click-through rates and search visibility.',
    userPrompt: `Based on this search intent intro and article, create optimized SEO metadata:

Topic: {{topic}}
Search Intent Intro: {{intro}}
Primary Keyword: {{primaryKeyword}}

Generate:
1. Meta Title (50-60 characters, include primary keyword)
2. Meta Description (150-160 characters, compelling, include keyword and CTA)
3. URL Slug (SEO-friendly, lowercase, hyphens, include keyword)

Requirements:
- Optimize for click-through rate
- Include target keyword naturally
- Make meta description action-oriented
- Keep URL slug concise and descriptive

Return as JSON with metaTitle, metaDescription, and urlSlug fields.`,
  },
  {
    stepNumber: 15,
    stepName: 'generate_image_prompt',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are an expert at creating detailed prompts for AI image generation that produce professional, relevant featured images.',
    userPrompt: `Create a detailed image generation prompt for a featured image for this article:

Topic: {{topic}}
Article Summary: {{articleSummary}}

Requirements:
- Professional, high-quality appearance
- Relevant to the topic
- Visually engaging
- Suitable for a blog featured image (16:9 aspect ratio)
- Modern, clean aesthetic
- Avoid text in the image

Write a detailed prompt that will generate an appropriate featured image. Be specific about style, composition, colors, and mood.`,
  },
  {
    stepNumber: 17,
    stepName: 'generate_excerpt',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are an expert copywriter specializing in creating compelling, curiosity-evoking teasers for articles.',
    userPrompt: `You are an expert copywriter specializing in creating compelling, curiosity-evoking teasers for articles.

Article Title: {{article_title}}
Article Content: {{article}}

Generate a compelling excerpt/teaser for this article that:
1. Is exactly 135 characters or less (to fit within a 150 character limit)
2. Creates curiosity and makes readers want to click and read more
3. Highlights the most interesting or valuable aspect of the article
4. Is engaging and compelling
5. Does NOT include quotes, markdown formatting, or code blocks

Return ONLY the excerpt text. No explanations, no markdown, no code blocks. Just the plain text excerpt.`,
  },
  {
    stepNumber: 18,
    stepName: 'generate_legal_disclaimer',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      "You are a legal compliance expert specializing in Google's YMYL (Your Money or Your Life) content standards.",
    userPrompt: `You are a legal compliance expert specializing in Google's YMYL (Your Money or Your Life) content standards.

Article Title: {{article_title}}
Article Topic: {{topic}}
Article Content Summary: {{article_summary}}

Generate a legal disclaimer for this article that:
1. Is 2-3 paragraphs long
2. Complies with Google's YMYL standards
3. Addresses potential legal, financial, or health implications
4. Includes appropriate warnings and disclaimers
5. Is professional and clear

Return ONLY the disclaimer text. No explanations, no markdown, no code blocks. Just the plain text disclaimer.`,
  },
]

// ── Image generation model config (stepNumber 150) ───────────────────────────
// Not an LLM step — holds only the Fal.ai model identifier used by image-generation.ts.
// The prompt is auto-generated by Step 15; this row controls which Fal.ai model renders it.
const IMAGE_GEN_TEMPLATE = [
  {
    stepNumber: 150,
    stepName: 'image_generation_model',
    defaultProvider: 'fal-ai',
    defaultModel: 'fal-ai/flux-pro',
    systemPrompt: null,
    userPrompt: '(No prompt — image rendering is handled automatically using the output of Step 15.)',
    isActive: true,
  },
]

// ── Platform syndication templates (Steps 30–31) ─────────────────────────────
const SYNDICATION_TEMPLATES = [
  {
    stepNumber: 30,
    stepName: 'generate_linkedin_article',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 4096,
    systemPrompt:
      'You are an expert LinkedIn content strategist who writes high-performing LinkedIn Articles (long-form, newsletter-style). ' +
      'You adapt well-researched articles into compelling LinkedIn Articles that drive professional engagement and thought leadership. ' +
      'LinkedIn Articles support rich formatting: use ## headings, **bold** for emphasis, and bullet lists. ' +
      'Do NOT use H1 (#) — LinkedIn renders the article title separately. ' +
      'Write for a professional audience. Be direct, credible, and insightful. ' +
      'Output ONLY the article content — no preamble, no commentary, no "Here is your article" intro.',
    userPrompt: `You are adapting the following article into a LinkedIn Article.

ORIGINAL ARTICLE TITLE: {{title}}

PRIMARY KEYWORD: {{primary_keyword}}

ARTICLE EXCERPT: {{excerpt}}

FULL ARTICLE BODY:
{{article_body}}

REFERENCE CITATIONS:
{{citations}}

---

Write a LinkedIn Article based on the same facts, research, and citations above. Follow these requirements strictly:

**Format & Length**
- 900–1300 words
- Use ## for section headings (LinkedIn renders these as H2)
- Use **bold** for key terms and emphasis
- Use bullet lists for scannable takeaways
- No H1 (#) heading — the title is handled separately

**Structure**
1. Hook (2–3 sentences): a compelling professional insight or surprising finding from the article that stops the scroll
2. Context (1 short paragraph): why this matters right now for professionals
3. 3–4 substantive sections with ## headings covering the main insights
4. Key Takeaways (bullet list, 4–6 points)
5. Closing CTA (1–2 sentences): invite readers to share their experience or connect

**Tone & Style**
- Authoritative but conversational — write as a senior practitioner, not an academic
- First-person perspective where natural ("In my experience…", "What I've found…")
- Direct, no filler, no hedging
- Cite specific facts and data points from the original article

**At the end**, add a "## References" section with a numbered list of the citations provided above.

Output the article content only. Start directly with the hook paragraph.`,
    isActive: true,
  },
  {
    stepNumber: 31,
    stepName: 'generate_medium_article',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 6000,
    systemPrompt:
      'You are an expert writer for Medium who crafts high-quality, deeply researched long-form articles. ' +
      'Medium readers expect substance, nuance, and a distinct point of view. ' +
      'Medium supports full Markdown: use # for title (H1), ## for sections, ### for sub-sections, **bold**, *italic*, ' +
      '> blockquotes for pull quotes, and numbered/bullet lists. ' +
      'Write with intellectual depth and a clear narrative arc. ' +
      'Output ONLY the article content in Markdown — no preamble, no commentary.',
    userPrompt: `You are adapting the following article into a Medium article.

ORIGINAL ARTICLE TITLE: {{title}}

PRIMARY KEYWORD: {{primary_keyword}}

ARTICLE EXCERPT: {{excerpt}}

FULL ARTICLE BODY:
{{article_body}}

REFERENCE CITATIONS:
{{citations}}

---

Write a Medium article based on the same facts, research, and citations above. Follow these requirements strictly:

**Format & Length**
- 1500–2500 words
- Full Markdown — use # for the article title, ## for main sections, ### for sub-sections
- Use > blockquotes to highlight the single most important insight in each major section (1 per section max)
- Use **bold** for key terms, *italic* for nuanced qualifications
- Use numbered lists for sequential steps; bullet lists for parallel points

**Structure**
1. # [Title] — rewrite the title to be compelling for Medium's audience (keep the core topic but optimise for curiosity and click-through)
2. Introduction (3–4 paragraphs): set the scene, establish the problem, and state your thesis
3. 4–6 substantive sections with ## headings — each should develop a distinct insight from the original article
4. Use ### sub-sections where a topic needs further breakdown
5. Conclusion (2–3 paragraphs): synthesise the argument, leave the reader with a memorable closing thought
6. ## References — numbered list of the citations provided

**Tone & Style**
- Authoritative and intellectually engaging — write for curious, informed readers
- Develop ideas with depth: explain the "why" and "so what" behind every fact
- Use pull quotes (>) for the single most important insight per section
- Cite specific data points and facts from the original article throughout
- Third-person or first-person — whichever serves the argument better

Output the full article in Markdown. Start directly with the # title.`,
    isActive: true,
  },
]

// ── Promotional email template (Step 32) ────────────────────────────────────
// Generates a short promotional email from a published article. Sent as a GHL
// Email Campaign to a tag/smart list. Output is strict JSON { subject, bodyHtml }.
const PROMO_EMAIL_TEMPLATE = [
  {
    stepNumber: 32,
    stepName: 'generate_promotional_email',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 2000,
    systemPrompt:
      'You are an expert email marketer who writes short, high-converting promotional emails that drive clicks to a newly published article. ' +
      'You write a compelling subject line and a concise, scannable HTML email body. ' +
      'The body must be valid, email-safe HTML (use <p>, <strong>, <ul>/<li>, and <a href> only — no <html>, <head>, <body>, <style>, or <script> tags, no external CSS). ' +
      'Always include exactly one clear call-to-action link to the article. ' +
      'Output ONLY a single JSON object and nothing else, in the exact shape: ' +
      '{"subject": "<subject line>", "bodyHtml": "<email body html>"}. ' +
      'Do not wrap the JSON in markdown code fences. Do not add commentary.',
    userPrompt: `Write a promotional email announcing this newly published article to our newsletter audience.

ARTICLE TITLE: {{title}}

PRIMARY KEYWORD: {{primary_keyword}}

ARTICLE EXCERPT / SUMMARY: {{excerpt}}

ARTICLE URL: {{article_url}}

FULL ARTICLE BODY (for context — do NOT reproduce it):
{{article_body}}

---

Requirements:
- Subject line: 4–9 words, curiosity-driven, no clickbait, no emoji.
- Body: 90–160 words of valid email-safe HTML.
- Open with a hook tied to the reader's problem, give 2–3 concrete reasons to read the article, then a single call-to-action button/link pointing to {{article_url}} (use an <a href> with anchor text like "Read the full article").
- Warm, professional, second-person ("you") tone. No "Dear reader". No signature block.
- If {{article_url}} is empty, still write the email but make the CTA link text "Read the full article" with href="#".

Output ONLY the JSON object: {"subject": "...", "bodyHtml": "..."}`,
    isActive: true,
  },
]

// ── Enrichment template (not a numbered pipeline step — uses stepNumber 20) ─────
const ENRICHMENT_TEMPLATES = [
  {
    stepNumber: 20,
    stepName: 'enrichment_generate_diagram',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt:
      'You generate Mermaid.js diagrams that visually summarize a section of an article. ' +
      'You output ONLY valid Mermaid syntax — no explanation, no code fences, no markdown. ' +
      'The diagram type must be appropriate to the content ' +
      '(flowchart for processes, sequenceDiagram for interactions, gantt for timelines, ' +
      'classDiagram for hierarchies, mindmap for concept maps, pie for proportions, ' +
      'timeline for chronologies). ' +
      'If no diagram type fits the section, output exactly the string SKIP.',
    userPrompt: `Article topic: {{article_topic}}
Primary keyword: {{primary_keyword}}

Section heading: {{section_title}}

Section HTML:
{{section_html}}

Output a Mermaid diagram that adds visual clarity to this section. Pick the most appropriate diagram type. Do not exceed 12 nodes. Use plain English labels. No code fences. No commentary.

If the section is purely narrative or doesn't benefit from a visual, output exactly: SKIP`,
  },
]

// ── GEO / Phase C expansion (Steps 101–104, 107–109) ─────────────────────────
const GEO_ENRICHMENT_TEMPLATES = [
  {
    stepNumber: 101,
    stepName: 'enrichment_question_matching',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are an expert content strategist helping match research questions to article sections.',
    userPrompt: `You are helping enrich an article by matching research FAQ questions to article sections.

Article sections (JSON):
{{sections}}

Available FAQ questions (JSON):
{{candidates}}

Rules:
- Match each section to the MOST topically relevant FAQ question.
- Each FAQ question may only be used ONCE across all sections.
- If no FAQ question is a good fit for a section, respond with null for that section.
- Respond ONLY with valid JSON: an array of strings (the matched question text) or null, one per section, in order.
- Do NOT include any explanation — ONLY the JSON array.

Example response: ["Why is X important?", null, "How does Y work?"]`,
  },
  {
    stepNumber: 102,
    stepName: 'enrichment_keyword_to_question',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: 'You are an expert SEO specialist converting keywords into natural search questions.',
    userPrompt: `Convert the following keyword or phrase into a clear, specific question that someone might ask when searching for information about "{{sectionHeading}}".

Keyword: {{keyword}}

Rules:
- The question must be relevant to the topic.
- Write in a natural, conversational style — the way a person would ask it ALOUD.
- Keep it SHORT: at most 9 words. Long keyword-stuffed questions read as robotic to human readers.
- Never bolt on audience or keyword qualifiers ("...for chiropractic patients in 2026") — the surrounding article provides that context.
- Do NOT add quotes or punctuation beyond the question mark.
- Respond with ONLY the question text — nothing else.`,
  },
  {
    stepNumber: 103,
    stepName: 'enrichment_uniqueness_rephrase',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt: null,
    userPrompt: `Rephrase the following question to convey the same meaning with different wording. The goal is to create a unique variant that is topically equivalent but worded differently.

Original question: {{question}}

Rules:
- Keep the same meaning and intent.
- Use different words, sentence structure, or phrasing.
- Keep it SHORT and natural: at most 9 words, phrased as a person would ask aloud. If the original is long or keyword-stuffed, the rephrase should FIX that, not preserve it.
- Do NOT add quotes or extra punctuation.
- Respond with ONLY the rephrased question — nothing else.`,
  },
  {
    stepNumber: 104,
    stepName: 'enrichment_ai_summary',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt:
      'You are an expert content writer creating concise AI-optimised summaries for Generative Engine Optimisation (GEO). ' +
      "You always provide direct, factual answers. You never say \"the article does not contain\" or \"this section doesn't mention\" — " +
      'you synthesise an authoritative answer from the context provided and your domain knowledge.',
    userPrompt: `Write a concise 40-60 word answer to the following question.

Question: {{question}}

Article section content (for context):
{{content}}

Rules:
- Answer the question directly and factually.
- Use the article section as your primary source. If the section does not fully address the question, supplement with established domain knowledge that is consistent with the article's topic and perspective.
- NEVER say "the article does not contain", "this section doesn't mention", or any variant. Always give a direct answer.
- Stay between 40 and 60 words.
- Write in third person, informational tone.
- Do NOT use bullet points or headings.
- Respond with ONLY the summary paragraph — nothing else.`,
  },
  {
    stepNumber: 107,
    stepName: 'enrichment_key_takeaways',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt: KEY_TAKEAWAYS_SYSTEM_PROMPT,
    userPrompt: KEY_TAKEAWAYS_USER_PROMPT,
  },
  {
    stepNumber: 108,
    stepName: 'enrichment_wp_category',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are a content categorization expert. Given an article topic and a list of WordPress categories, select the single most appropriate category.',
    userPrompt: `Select the most appropriate WordPress category for this article.

Article topic: {{topic}}
Article title: {{title}}

Available categories (JSON):
{{categories}}

Rules:
- Select exactly ONE category from the list.
- Respond with ONLY the category ID as a number — nothing else.
- If no category is a good fit, respond with the ID of the most general/default category.`,
  },
  {
    stepNumber: 109,
    stepName: 'enrichment_wp_tags',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt:
      'You are a content tagging expert. Given an article topic and a list of WordPress tags, select the most applicable tags.',
    userPrompt: `Select the most applicable WordPress tags for this article.

Article topic: {{topic}}
Article title: {{title}}

Available tags (JSON):
{{tags}}

Rules:
- Select UP TO 4 tags from the list.
- Respond with ONLY a JSON array of tag IDs, e.g. [12, 47, 83].
- If fewer than 4 tags are relevant, return only the relevant ones.
- If no tags apply, return an empty array: []`,
  },
  {
    stepNumber: 110,
    stepName: 'insert_inline_citations',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt:
      'You are a professional editor specializing in adding inline citation hyperlinks to HTML articles. You add links precisely at the most relevant claim or data point, preserving the article\'s existing structure exactly.',
    userPrompt: `Add inline citation hyperlinks to this article. Each citation must be inserted as an <a> tag wrapping the most relevant phrase, sentence, or data point in the article body.

Article HTML:
{{article}}

Validated Citations (JSON):
{{validated_citations}}

Rules:
- Each citation URL must appear AT MOST ONCE in the entire article.
- Use ONLY the URLs in the Validated Citations JSON, copied EXACTLY, character for character. Never alter, shorten, "correct" or invent a URL. A URL that has no matching passage is skipped, never replaced with another.
- Wrap the most relevant existing text in an <a href="URL" target="_blank" rel="noopener noreferrer"> tag. Do NOT add new text — only wrap existing text.
- Place each citation near the specific claim or data point it supports.
- Do NOT modify any other HTML structure, headings, paragraphs, lists, or content.
- Do NOT remove or rearrange any existing content.
- If a citation has no clearly relevant passage in the article, skip it entirely — do not force it.
- Return the COMPLETE article HTML with the citation links added.
- Output ONLY the HTML — no explanation, no markdown fences, no preamble.`,
  },
]

// ── Outline Frameworks: canonical bodies live in ./outline-frameworks.ts (article-level arcs since 2026-11-09) ──

const GOOGLE_GUIDELINES_TEXT = `# Google's Helpful Content Guidelines — Summary for Article Writers

## The Core Principle
Google's helpful content system rewards content written primarily for people, not for search engines. Content that puts search engine ranking ahead of reader value will be downranked by automated systems that evaluate entire websites, not just individual pages.

## People-First Content: What Google Rewards

### 1. Demonstrated Experience
Content should reflect genuine first-hand experience. Ask: "Does this content clearly demonstrate the author has actually used, visited, or experienced what they're describing?" Generic information available anywhere online is not rewarded. Specific, personal, or organizational experience is.

### 2. Expertise
Content should show real knowledge of the topic. This is different from experience — an expert may not have personal experience with every scenario but deeply understands the field. Expertise is demonstrated through: accurate technical detail, nuanced understanding of edge cases, and familiarity with professional standards.

### 3. Authoritativeness
The author or site should be a recognized source on the topic. Authority is established through: consistent, accurate publishing history on the topic; being cited or linked to by other trusted sources; clear "About" information; credentials where applicable.

### 4. Trustworthiness
Content must be accurate and honest. Signs of trustworthiness: citing sources for factual claims; acknowledging uncertainty where it exists; accurate dates and currency of information; not making unsupported medical, legal, financial, or scientific claims.

## Content Quality: What to Avoid

### Avoid: Content created primarily to rank
Signs of search-first content that Google penalizes: writing about trending topics without genuine expertise; summarizing what others say without adding original value; producing content at volume without maintaining quality.

### Avoid: Unhelpful AI content
AI-generated content that simply synthesizes existing web content without adding original experience, analysis, or perspective is not helpful content. AI should be used to enhance and assist human expertise, not replace it.

### Avoid: Misleading signals
Don't exaggerate expertise or credentials. Don't present information as more certain than it is. Don't use misleading click-bait titles that don't match the content.

## E-E-A-T in Practice (for Article Writers)

**Experience:** Include specific personal or organizational examples. Reference real situations from your work. Mention relevant locations, timeframes, and contexts.

**Expertise:** Go beyond surface-level. Explain the "why" behind your advice. Address nuances, exceptions, and edge cases. Show you know what you're talking about, not just what to say.

**Authoritativeness:** Be consistent in your field. Link to authoritative sources for factual claims. Have a clear author profile.

**Trustworthiness:** Date your content. Acknowledge its limitations. Disclose conflicts of interest. Correct errors promptly.

## YMYL Topics (Your Money or Your Life)
Topics affecting a person's health, safety, financial stability, or important life decisions are held to a higher standard. For YMYL topics: always recommend professional consultation; never make absolute claims; disclose if you are not a licensed professional; cite peer-reviewed or authoritative sources.

## The Helpful Content Question Test
Before publishing any article, ask: "If a visitor reads only this article, will they leave satisfied — having learned something real, received useful guidance, or felt their time was well spent?" If the honest answer is "no" or "maybe", the content needs work.

## Practical Application
- Write for a specific person, not a generic "reader".
- The article should leave the reader better equipped to make a decision or take an action.
- If you can't add something original to a topic (personal experience, unique data, specialist analysis), reconsider whether to publish.
- A shorter article that fully satisfies the reader's intent is better than a long article that partially satisfies it.`

// ── Social media image generation prompts (Steps 201–202) ────────────────────
const SOCIAL_TEMPLATES = [
  {
    stepNumber: 201,
    stepName: 'social_quote_selection',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 256,
    systemPrompt:
      'You are a social media content strategist. Select the single most compelling, shareable quote from the provided content. The quote must stand alone without context, be under 220 characters, and avoid hashtags or emojis.',
    userPrompt: `Select ONE quote from the content below for a branded social media quote card.

Content:
{{content}}

Organization: {{organizationName}}

Rules:
- Return ONLY valid JSON: { "quote": "...", "attribution": "optional source label" }
- Quote must be ≤ 220 characters
- Prefer declarative insights, surprising facts, or actionable advice
- Do not invent facts not present in the content
- attribution is optional (e.g. article title or author); omit if unclear`,
    isActive: true,
  },
  {
    stepNumber: 202,
    stepName: 'social_carousel_plan',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 4096,
    systemPrompt:
      'You are a social media designer planning image carousel slides. Each slide has a type (hook/content/cta), optional headline, body text paragraphs, and a detailed image prompt for AI image generation (no text in the image).',
    userPrompt: `Plan an image carousel with exactly {{slide_count}} slides based on the content below.

Topic: {{topic}}

Content:
{{details}}

Special image instructions: {{special_instructions}}

Rules:
- Return ONLY valid JSON: { "slides": [ { "index": 1, "type": "hook|content|cta", "headlineText": "...", "bodyText": "...", "imagePrompt": "..." } ] }
- Exactly {{slide_count}} slides
- First slide type must be "hook", last must be "cta", all others "content"
- headlineText: max 22 characters per line; set to null for content slides that lead with body text only
- bodyText: 1-4 short paragraphs separated by \\n; null for hook slides
- imagePrompt: photorealistic scene for flux image gen, no text/words/logos/watermarks`,
    isActive: true,
  },
  {
    stepNumber: 203,
    stepName: 'social_platform_caption',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 512,
    // Canonical text lives in deai-prompts.ts (also used by reseed-deai-prompts.ts);
    // platform-caption.ts keeps matching in-code fallbacks.
    systemPrompt: CAPTION_HOOK_SYSTEM,
    userPrompt: CAPTION_HOOK_USER,
    isActive: true,
  },
  {
    stepNumber: 204,
    stepName: 'social_reel_bullets',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 256,
    systemPrompt:
      'You extract concise bullet points from article content for a short social media video reel overlay. Each bullet must be ≤ 50 characters.',
    userPrompt: `Extract 3–5 bullet points from the content below for a video reel text overlay.

Content:
{{content}}

Return ONLY valid JSON: { "bullets": ["...", "..."] }
- 3–5 bullets
- Each ≤ 50 characters
- Declarative, scannable
- No hashtags or emojis`,
    isActive: true,
  },
  {
    stepNumber: 206,
    stepName: 'social_video_reel_prompt',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3-flash-preview',
    maxTokens: 512,
    systemPrompt:
      'You are an expert at writing cinematic video generation prompts for text-to-video AI models.\n\n' +
      'Your task: Write a single, detailed prompt describing an atmospheric background video. The video will play behind text overlays (headline + bullet points) — the video is ONLY a visual backdrop. The real content is the text on top.\n\n' +
      'RULES:\n' +
      '1. Describe SLOW, SMOOTH, AMBIENT scenes — no fast cuts, no action, no people talking.\n' +
      '2. CAMERA FIXED: The video model uses a fixed camera. Do NOT describe camera pans, zooms, or movement. Describe static or slow-moving subjects (clouds drifting, gentle waves, light shifting).\n' +
      '3. TOPIC-RELEVANT but NOT LITERAL: For a finance article, describe "golden sunset over a modern city skyline" — not spreadsheets or charts. Abstract, evocative, professional.\n' +
      '4. Keep it to 2-4 sentences. One cohesive scene.\n' +
      '5. Style: cinematic, high-end, suitable for LinkedIn/Instagram/Twitter. Natural lighting, professional mood.\n\n' +
      'OUTPUT: Return ONLY the video description text. No preamble, no quotes, no markdown.',
    userPrompt: `Write a cinematic background video description for this content:

TOPIC: {{topic}}

DETAILS: {{details}}

SPECIAL INSTRUCTIONS (if any):

Photo-Realistic, modern, in bright, sunny coloring. MUST have PHOTO-REALISTIC proportions!!

CRITICAL: MUST BE photo-realist and serious, AVOID anything cartoonish!
CRITICAL: MUST NOT include paperwork or icons on the image!

{{special_instructions}}

VIDEO MODEL: {{video_model}}

Return ONLY the video description, ready to use in the video model.`,
    isActive: true,
  },
  {
    stepNumber: 207,
    stepName: 'social_video_reel_model',
    defaultProvider: 'fal-ai',
    defaultModel: 'fal-ai/bytedance/seedance/v1/lite/text-to-video',
    systemPrompt: null,
    userPrompt: '(No prompt — the video clip is generated by Fal.ai using the description produced by Step 206. Only the Fal.ai model selected above controls which video generation model renders that prompt.)',
    isActive: true,
  },
  {
    stepNumber: 208,
    stepName: 'social_story_pitch_slide',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 256,
    systemPrompt:
      'You write ultra-short slide copy for social media story posts.\nYour job: given an article topic, a brief content summary, and a CTA action phrase, write 2–4 short sentences that tease what the post contains.\n\nRULES:\n1. 2–4 short sentences for the pitch. Use normal sentence punctuation. No hashtags, no emojis.\n2. Never start with "Did you know" or generic filler.\n3. Tone: direct, confident, punchy — matching the brand voice.\n4. After the pitch sentences, output ONE final line starting with exactly "CTA: " followed by a short natural variation of the provided CTA action phrase. Do not include arrows or emojis in the CTA.\n5. Output format:\n   [pitch sentences — plain text]\n\n   CTA: [your CTA variation]\n\nNo quotes, no labels other than "CTA:", no markdown.',
    userPrompt: `Write a story pitch slide for this post.

Topic: {{topic}}

Content summary:
{{content}}

Required CTA action (vary the wording naturally):
{{cta_action}}

Return the pitch sentences, then a final line "CTA: ...".`,
    isActive: true,
  },
  {
    stepNumber: 205,
    stepName: 'social_quote_video_narration',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 256,
    systemPrompt:
      'You write short spoken narration scripts for social media quote videos. The script must sound natural when read aloud by text-to-speech.',
    userPrompt: `Write a spoken narration script for a short story quote video based on the section below.

Section content:
{{content}}

Organization: {{organizationName}}

Rules:
- Return ONLY valid JSON: { "narration": "..." }
- 2–4 sentences, conversational, under 400 characters total
- Summarize the theme; do not list quotes verbatim
- No hashtags, emojis, or markdown`,
    isActive: true,
  },
  {
    stepNumber: 217,
    stepName: 'social_hook_video_model',
    defaultProvider: 'fal-ai',
    defaultModel: 'fal-ai/bytedance/seedance/v1/lite/text-to-video',
    systemPrompt: null,
    userPrompt: '(No prompt — F6 hook video. Only the Fal.ai model selected above controls which text-to-video model renders the intro clip.)',
    isActive: true,
  },
  {
    stepNumber: 218,
    stepName: 'social_image_model',
    defaultProvider: 'fal-ai',
    defaultModel: 'fal-ai/flux/schnell',
    systemPrompt: null,
    userPrompt: '(No prompt — the Fal.ai model selected above renders the AI background images for ALL social carousels/slideshows: image carousels (article F4 + newsletter feature) and F6 hook-video slides.)',
    isActive: true,
  },
]

async function main() {
  console.log('Seeding prompt templates...')

  for (const template of [...PROMPT_TEMPLATES, ...IMAGE_GEN_TEMPLATE, ...ENRICHMENT_TEMPLATES, ...GEO_ENRICHMENT_TEMPLATES, ...SYNDICATION_TEMPLATES, ...PROMO_EMAIL_TEMPLATE, ...SOCIAL_TEMPLATES]) {
    await prisma.promptTemplate.upsert({
      where: { stepNumber_vertical: { stepNumber: template.stepNumber, vertical: 'default' } },
      create: template,
      // Never overwrite admin edits or production prompt content on re-seed.
      // To bulk-update prompts, run: pnpm --filter @omniply/db reseed:v3
      update: {},
    })
    console.log(`  ✓ Step ${template.stepNumber}: ${template.stepName}`)
  }

  const promptTotal = PROMPT_TEMPLATES.length + ENRICHMENT_TEMPLATES.length + GEO_ENRICHMENT_TEMPLATES.length
  console.log(`\nSeeded ${promptTotal} prompt templates.`)

  // Newsletter prompts are keyed by the string `key` (not stepNumber).
  console.log('\nSeeding newsletter prompt templates...')
  for (const template of NEWSLETTER_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'default' } },
      create: template,
      // Never overwrite admin edits on re-seed.
      update: {},
    })
    console.log(`  ✓ ${template.key}: ${template.stepName}`)
  }
  console.log(`Seeded ${NEWSLETTER_TEMPLATES.length} newsletter prompt templates.`)

  // Client-story review-mining prompts — same string-key convention.
  console.log('\nSeeding client-story prompt templates...')
  for (const template of CLIENT_STORY_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'default' } },
      create: template,
      update: {},
    })
    console.log(`  ✓ ${template.key}: ${template.stepName}`)
  }
  console.log(`Seeded ${CLIENT_STORY_TEMPLATES.length} client-story prompt templates.`)

  // Plain-language storytelling prompts — same string-key convention.
  console.log('\nSeeding plain-language prompt templates...')
  for (const template of PLAIN_LANGUAGE_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'default' } },
      create: template,
      update: {},
    })
    console.log(`  ✓ ${template.key}: ${template.stepName}`)
  }
  console.log(`Seeded ${PLAIN_LANGUAGE_TEMPLATES.length} plain-language prompt templates.`)

  // Plain-language per-industry exemplar configs (never overwrite admin edits).
  console.log('\nSeeding plain-language configs...')
  for (const config of PLAIN_LANGUAGE_CONFIGS) {
    await prisma.plainLanguageConfig.upsert({
      where: { industry: config.industry },
      create: config,
      update: {},
    })
    console.log(`  ✓ plain-language config: ${config.industry}`)
  }
  console.log(`Seeded ${PLAIN_LANGUAGE_CONFIGS.length} plain-language configs.`)

  // De-AI writing prompts (dash-fix micro-editor) — same string-key convention.
  console.log('\nSeeding de-AI writing prompt templates...')
  for (const template of DEAI_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'default' } },
      create: template,
      update: {},
    })
    console.log(`  ✓ ${template.key}: ${template.stepName}`)
  }
  console.log(`Seeded ${DEAI_TEMPLATES.length} de-AI writing prompt templates.`)

  // Chat-agent prompts (admin-editable via /admin/agents) — same string-key convention.
  console.log('\nSeeding chat-agent prompt templates...')
  for (const template of AGENT_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'default' } },
      create: template,
      update: {},
    })
    console.log(`  ✓ ${template.key}: ${template.stepName}`)
  }
  console.log(`Seeded ${AGENT_TEMPLATES.length} chat-agent prompt templates.`)

  // Wellness-vertical agent overrides (create-only, admin-edit-safe like the default set).
  for (const template of WELLNESS_AGENT_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: { key_vertical: { key: template.key, vertical: 'wellness' } },
      create: template,
      update: {},
    })
    console.log(`  ✓ ${template.key} (wellness): ${template.stepName}`)
  }
  console.log(`Seeded ${WELLNESS_AGENT_TEMPLATES.length} wellness agent overrides.`)

  // Seed outline frameworks
  console.log('\nSeeding outline frameworks...')
  for (const framework of OUTLINE_FRAMEWORKS) {
    await prisma.outlineFramework.upsert({
      where: { number: framework.number },
      create: framework,
      // Never overwrite admin edits on re-seed.
      // To bulk-update frameworks, run a dedicated reseed script.
      update: {},
    })
    console.log(`  ✓ Framework ${framework.number}: ${framework.label}`)
  }
  console.log(`Seeded ${OUTLINE_FRAMEWORKS.length} outline frameworks.`)

  // Seed platform settings (singleton — only insert if missing)
  console.log('\nSeeding platform settings...')
  await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      googleGuidelines: GOOGLE_GUIDELINES_TEXT,
    },
    update: {}, // never overwrite admin edits on redeploy
  })
  console.log('  ✓ PlatformSettings singleton seeded (google guidelines preserved if already set)')

  // Seed default schema type rules.
  // Strategy: ADDITIVE — only add keywords that don't already exist in the array.
  // This means admin edits (including removals) are always preserved, but new
  // default keywords added here will be picked up on the next deploy.
  interface SchemaTypeRuleSeed { keyword: string; articleType: string; publisherType: string }
  const DEFAULT_SCHEMA_RULES: SchemaTypeRuleSeed[] = [
    // Practitioner-form variants come first so "chiropractor" matches before the
    // root "chiropractic" would in a regex approach — both are kept in the list so
    // industry strings like "Chiropractic Clinic" also match.
    { keyword: 'chiropractor',    articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'chiropractic',    articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'physiotherapist', articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'physiotherapy',   articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'dentist',         articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'dental',          articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'psychologist',    articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'psychology',      articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'optometrist',     articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'optometry',       articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'podiatrist',      articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'podiatry',        articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'osteopath',       articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'naturopath',      articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'medical',         articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'health',          articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'nursing',         articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'pharmacy',        articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'pharmacist',      articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'veterinary',      articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
    { keyword: 'veterinarian',    articleType: 'MedicalArticle', publisherType: 'MedicalOrganization' },
  ]

  const ps = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } })
  const existingRules = (ps?.schemaTypeRules ?? []) as SchemaTypeRuleSeed[]
  const existingKeywords = new Set(existingRules.map((r) => r.keyword))
  const toAdd = DEFAULT_SCHEMA_RULES.filter((r) => !existingKeywords.has(r.keyword))

  if (toAdd.length > 0) {
    await prisma.platformSettings.update({
      where: { id: 'singleton' },
      data: {
        // Append new defaults after existing (admin-edited) rules so ordering is preserved.
        schemaTypeRules: [...existingRules, ...toAdd],
      },
    })
    console.log(`  ✓ Schema type rules updated — added ${toAdd.length} new keyword(s): ${toAdd.map((r) => r.keyword).join(', ')}`)
  } else {
    console.log('  ✓ Schema type rules up to date — no new keywords to add')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
