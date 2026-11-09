/**
 * reseed-prompts-v3.ts
 *
 * One-time, idempotent script that overwrites PromptTemplate rows for Steps 1–16
 * with the production-grade, genericized versions from the active-prompts-from-db.md
 * snapshot (2026-05-01).
 *
 * Key changes vs. the original seed:
 *   - Steps 1–14: replaced with active production versions
 *   - Steps 9 & 11: persona stripped (Lic. Guido / DR specifics removed)
 *                   → generic {{author_name}} / {{who}} / {{our_experience}} injection
 *   - All models defaulting to gemini-3-pro-preview → gemini-2.5-flash
 *   - Step 14 (select_category): ADDED — was missing from original seed
 *   - Step 16 (generate_schema_markup): RE-ENABLED — wired into approval flow
 *   - Steps 15, 17–18: NO CHANGE (already match active)
 *
 * Usage:
 *   cd packages/db
 *   npx tsx scripts/reseed-prompts-v3.ts
 *
 * Safety: purely overwrites to deterministic values — safe to re-run.
 * Does NOT touch Steps 15–18 (already identical) or enrichment steps (19+).
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

import {
  WRITER_SYSTEM_PROMPT,
  WRITER_USER_PROMPT,
  EDITOR_SYSTEM_PROMPT,
  EDITOR_USER_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  FAQ_FACTS_USER_PROMPT,
  ARTICLE_FACTS_USER_PROMPT,
} from '../prisma/article-writer-prompts'

// ── Steps 7/8/9/11 prompt text lives in prisma/article-writer-prompts.ts (canonical since 2026-11-09) ──

// ── Prompt definitions ────────────────────────────────────────────────────────

export const PROMPTS = [
  // ─── Step 1: generate_outline ─────────────────────────────────────────────
  {
    stepNumber: 1,
    stepName: 'generate_outline',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class marketer and SEO specialist. You are world renowned for writing highly compelling, attention grabbing articles. You are amazing at your job.

You write your articles that follow, satisfy and comply with Google's "People First" principles, Google's Helpful Content guidelines and rules, and Google's E-E-A-T framework at the same time.

First you will receive your context, then you will receive your task.


# OUTPUT INSTRUCTIONS:

- Provide a very detailed article outline, clearly separated into sections, that will end up in a 3,000 word report.
- DO NOT provide any fake social proof. Just come up with a visceral description of how people can transform their investments.
- ONLY return the article outline. No commentary. No explanation. No other characters or prefix.
`,
    userPrompt: `# CONTEXT:

## ARTICLE TOPIC:

{{topic}}

## INSTRUCTIONS ON HOW TO STRUCTURE THE ARTICLE:

{{outline_framework}}

## ABOUT US:

{{who}}

=> Use this About Us text as a guide for this section ONLY! Do NOT use this text verbatim!!

## OUR EXPERIENCE:

{{our_experience}}

# GOAL OF THE ARTICLE:

{{article_goal}}

## SEO RANKINGS:

The article MUST also be optimized for SEO, so that it has the best chances to rank high in Google to attract as many leads as possible.


# TASK:

1. Read and carefully analyze your CONTEXT, EXAMPLE ARTICLE OUTLINE, and GOAL FOR THE ARTICLE.
2. Your task now is to produce me a a detailed and very comprehensive article outline that is perfectly optimized to rank in Google.
3. Follow the EXAMPLE ARTICLE OUTLINE as an EXAMPLE for your outline. Do NOT copy that outline directly, use it as a GUIDE for your structure for the topic of this article!
4. MAKE SURE the outline follows, complies with, and satisfies Google's "People First" principles, Google's Helpful Content guidelines and rules, and Google's E-E-A-T framework.
5. The article will be on the topic "{{topic}}".
6. {{special_instructions}}
7. The topic areas to focus on:
{{outline_special_instructions}}
`,
  },

  // ─── Step 2: keyword_research ─────────────────────────────────────────────
  {
    stepNumber: 2,
    stepName: 'keyword_research',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert that knows all the insider knowledge of Google. You have worked in the Google search department for the last 25 years and know everything about SEO and keyword research. 

You are the best in the world at what you do.

You will first receive your CONTEXT, then you will receive your TASK.


# OUTPUT STRUCTURE:

1. ONLY return the keywords, no explanation needed. No commentary. No Explanation.

2. Structure your output like this:

{
"Primary Keyword": "insert your primary keyword here",
"Secondary Keywords 1": "insert your secondary keyword 1 here",
"Secondary Keywords 2": "insert your secondary keyword 2 here",
"Secondary Keywords 3": "insert your secondary keyword 3 here",
"Secondary Keywords 4": "insert your secondary keyword 4 here",
"Secondary Keywords 5": "insert your secondary keyword 5 here",
"Salient Entity 1": "insert your salient entities 1 here",
"Salient Entity 2": "insert your salient entities 2 here",
"Salient Entity 3": "insert your salient entities 3 here",
"Salient Entity 4": "insert your salient entities 4 here",
"Salient Entity 5": "insert your salient entities 5 here"
}

3. No commentary. No explanation. No extra characters.
`,
    userPrompt: `# CONTEXT:

## ARTICLE OUTLINE:

{{generate_outline_output}}

## KEYWORDS ALREADY USED:

{{excludedKeywords}}


# TASK:

1. review the ARTICLE OUTLINE in CONTEXT.

2. review the KEYWORDS ALREADY USED in CONTEXT.

2. Pleases provide me with the best Primary Keyword for this article outline that is NOT on the KEYWORDS ALREADY USED list. The keyword should have high search volume (10,000 searches per month or more) and low competition. 

MAKE SURE the keyword is easy to rank for, but still have great search volume.

=> The keyword you select MUST be DIFFERENT to all the keywords on the KEYWORDS ALREADY USED list in CONTEXT.

3. Provide me a list of 5 secondary keywords that the article must cover in order to support the Primary Keyword. These should also have a high search volume, but low competition in the SERPs.

4. Provide me with a list of 5 Salient Entities that the article must cover to produce the highest EEAT perception of Google.

=> MAKE SURE: {{geolocation}}
`,
  },

  // ─── Step 3: find_supporting_keywords ────────────────────────────────────
  {
    stepNumber: 3,
    stepName: 'find_supporting_keywords',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert that knows all the insider knowledge of Google. You have worked in the Google search department for the last 25 years and know everything about SEO and keyword research. 

You are the best in the world at what you do.

You will first receive your CONTEXT, then you will receive your TASK. 


# OUTPUT STRUCTURE:

1. ONLY return the keywords, no explanation needed. No commentary. No Explanation.

2. Structure your output like this:

# Primary Keyword:

"Repeat the primary keyword here"

## People Also Searched For - Primary Keyword:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the Primary Keyword"

# Secondary Keyword 1:

"Repeat the first secondary keywords here"

## People Also Searched For - Secondary Keyword 1:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the first Secondary Keyword"

# Secondary Keyword 2:

"Repeat the second secondary keywords here"

## People Also Searched For - Secondary Keyword 2:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the second Secondary Keyword"

# Secondary Keyword 3:

"Repeat the third secondary keywords here"

## People Also Searched For - Secondary Keyword 3:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the third Secondary Keyword"

# Secondary Keyword 4:

"Repeat the fourth secondary keywords here"

## People Also Searched For - Secondary Keyword 4:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the fourth Secondary Keyword"

# Secondary Keyword 5:

"Repeat the fifth secondary keywords here"

## People Also Searched For - Secondary Keyword 5:

"Insert the 4 related search phrases and "People Also Searched For" keywords for the fifth Secondary Keyword"

# Salient Entity 1:

"Repeat the first Salient Entity here"

## People Also Searched For - Salient Entity 1:

"Insert the 3 related search phrases and "People Also Searched For" keywords for the first Salient Entity"

# Salient Entity 2:

"Repeat the second Salient Entity here"

## People Also Searched For - Salient Entity 2:

"Insert the 3 related search phrases and "People Also Searched For" keywords for the second Salient Entity"

# Salient Entity 3:

"Repeat the thrid Salient Entity here"

## People Also Searched For - Salient Entity 3:

"Insert the 3 related search phrases and "People Also Searched For" keywords for the thrid Salient Entity"

# Salient Entity 4:

"Repeat the fourth Salient Entity here"

## People Also Searched For - Salient Entity 4:

"Insert the 3 related search phrases and "People Also Searched For" keywords for the fourth Salient Entity"

# Salient Entity 5:

"Repeat the fifth Salient Entity here"

## People Also Searched For - Salient Entity 5:

"Insert the 3 related search phrases and "People Also Searched For" keywords for the fifth Salient Entity"
`,
    userPrompt: `# CONTEXT:

## Primary Keyword:
{{primary_keyword}}

## Secondary Keywords:
{{secondary_keywords}}

## Salient Entities:
{{salient_entities}}


# TASK:

1. review the keywords in CONTEXT.

2. Pleases research and find me 4 related search phrases and "People Also Searched For" keywords for the Primary Keyword and each Secondary Keyword. 

3. Please research and find me 3 related search phrases and "People Also Searched For" keywords for each Salient Entity.
`,
  },

  // ─── Step 4: optimize_outline_seo ────────────────────────────────────────
  {
    stepNumber: 4,
    stepName: 'optimize_outline_seo',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert that knows all the insider knowledge of Google. You have worked in the Google search department for the last 25 years and know everything about SEO and keyword research. 

You are the best in the world at what you do.

You write your articles in the style that follow, satisfy and comply with Google's "People First" principles, Google's Helpful Content guidelines and rules, and Google's E-E-A-T framework at the same time.

You will first receive your CONTEXT, then you will receive your TASK.


# OUTPUT STRUCTURE:

1. ONLY return the updated outline, no explanation needed. No commentary. No Explanation.

2. Returned output:

"Insert the newly updated article outline here"
`,
    userPrompt: `# CONTEXT:

## THE ARTICLE OUTLINE:

{{generate_outline_output}}

## THE TOP LEVEL KEYWORDS:

### Primary Keyword:

{{primary_keyword}}

### Secondary Keywords:

{{secondary_keywords}}

### Salient Entities:

{{salient_entities}}


## ADDITIONAL KEYWORDS:

{{find_supporting_keywords_output}}

## WHO WE ARE:

{{who}}


## GOOGLE's HELPFUL CONTENT GUIDELINES:

{{google_guidelines}}

=> MAKE SURE questions are carefully crafted into the text WITHOUT looking like an FAQ section for SEO!!


# TASK:

1. review the article outline and keywords in CONTEXT.

2. analyze the outline and the keywords and edit the article outline, so that it closely follows and fulfills Google's "Helpful Content" guidelines as explained in GOOGLE's HELPFUL CONTENT GUIDELINE for the THE TOP LEVEL KEYWORDS. 

3. Pleases rework this article outline to fulfill all points of GOOGLE's HELPFUL CONTENT GUIDELINES!!

=> MAKE SURE the outline is for the most helpful article on the topic that was ever produced for Google.
`,
  },

  // ─── Step 5: write_search_intent_intro ───────────────────────────────────
  {
    stepNumber: 5,
    stepName: 'write_search_intent_intro',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert that knows all the insider knowledge of Google. You have worked in the Google search department for the last 25 years and know everything about SEO and keyword research. 

You are the best in the world at what you do.

You write your articles in the style that follows, satisfies and complies with Google's "People First" principles, Google's Helpful Content guidelines and rules, and Google's E-E-A-T framework at the same time.

You will first receive your CONTEXT, then you will receive your TASK.


# OUTPUT STRUCTURE:

1. ONLY return the search intent introduction, no explanation needed. No commentary. No Explanation.

2. Structure your output like this:

"Insert the Search Intent Introduction here"
`,
    userPrompt: `# CONTEXT:

## ARTICLE OUTLINE:

{{generate_outline_output}}

## MAIN KEYWORDS:

### Primary Keyword:
{{primary_keyword}}

### Secondary Keywords:
{{secondary_keywords}}

### Salient Entities:
{{salient_entities}}

# WRITING STYLE:

{{writing_style}}


# TASK:

1. review the article outline and MAIN KEYWORDS in CONTEXT.

2. Your task now is to write a search intent introduction for this article outline. By that I mean a high-level summary intro that immediately fulfills the search intend of the user for the keywords of the article. 

3. MAKE SURE this search intent introduction closely follows the Useful Content guidelines and rules by Google.

4. DO NOT use italic type, bold type or quotation marks to highlight keywords. Just write plain text without highlighting.

=> FOLLOW the WRITING STYLE as close as possible!!
`,
  },

  // ─── Step 6: research_faqs ────────────────────────────────────────────────
  {
    stepNumber: 6,
    stepName: 'research_faqs',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert that knows all the insider knowledge of Google. You have worked in the Google search department for the last 25 years and know everything about SEO and keyword research. 

You are the best in the world at what you do.

You will first receive your CONTEXT, then you will receive your TASK.


# OUTPUT STRUCTURE:

1. ONLY return the questions, no explanation needed. No commentary. No Explanation.

2. Structure your output like this:

# Question 1: 

"Insert Question 1 here"

# Question 2 

"Insert Question 2 here"

# Question 3: 

"Insert Question 3 here"

# Question 4: 

"Insert Question 4 here"

# Question 5: 

"Insert Question 5 here"

# Question 6: 

"Insert Question 6 here"

# Question 7: 

"Insert Question 7 here"

# Question 8: 

"Insert Question 8 here"
`,
    userPrompt: `# CONTEXT:

## ARTICLE OUTLINE:

{{optimize_outline_seo_output}}

## KEYWORDS:

### Primary Keyword:
{{primary_keyword}}

### Secondary Keywords:
{{secondary_keywords}}

### Salient Entities:
{{salient_entities}}

### Additional Keywords:
{{find_supporting_keywords_output}}


# TASK:

1. review the article in CONTEXT and KEYWORDS.

2. Pleases research and find me 4 "People Also Ask For" questions for the Primary Keyword that relates to the content of the article. 

3. Pleases research and find me 2 "People Also Ask For" questions for the main two Salient Entities that relates to the content of the article. 

=> MAKE SURE these questions are UNIQUE from any questions appearing in Additional Keywords in your CONTEXT!

=> MAKE SURE these questions are UNIQUE from any questions appearing in Additional Keywords in your CONTEXT!
`,
  },

  // ─── Step 7: find_faq_facts ───────────────────────────────────────────────
  {
    stepNumber: 7,
    stepName: 'find_faq_facts',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    userPrompt: FAQ_FACTS_USER_PROMPT,
  },

  // ─── Step 8: find_article_facts ──────────────────────────────────────────
  {
    stepNumber: 8,
    stepName: 'find_article_facts',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    userPrompt: ARTICLE_FACTS_USER_PROMPT,
  },

  // ─── Step 9: write_article (PERSONA STRIPPED) ─────────────────────────────
  {
    stepNumber: 9,
    stepName: 'write_article',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt: WRITER_SYSTEM_PROMPT,
    userPrompt: WRITER_USER_PROMPT,
  },

  // ─── Step 10: fact_check_article ─────────────────────────────────────────
  {
    stepNumber: 10,
    stepName: 'fact_check_article',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE: 

You are a world-class fact-checker. You are the world's best at what you do. You are world-class at identifying facts, data points, and claims that must be fact-checked in a factual  article.  


# HOW TO STRUCTURE YOUR RESPONSE:

- Fact or Claim: 
"Insert the fact or claim you identified."

- Verdict:
"Insert if the claim is valid, true, false, or partly true."

- Explanation:
"Insert why you are giving your verdict and if something is incorrect, what would be the correct answer."
`,
    userPrompt: `# CONTEXT: 
          
{{write_article_output}}


# TASK:

1. Review and analyze the entire article in CONTEXT.
        
2. Your task now is to carefully analyze the following article, identify the facts, data points and claims that must be fact-checked in the article.

=> MAKE SURE all the facts, statistics, laws, and data points are valid for:

{{geolocation}}

=> MAKE SURE ALL of the facts are up to date. Today is: {{current_date}}
`,
  },

  // ─── Step 11: adjust_incorrect_facts (PERSONA STRIPPED) ───────────────────
  {
    stepNumber: 11,
    stepName: 'adjust_incorrect_facts',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    systemPrompt: EDITOR_SYSTEM_PROMPT,
    userPrompt: EDITOR_USER_PROMPT,
  },

  // ─── Step 12: find_citations ──────────────────────────────────────────────
  {
    stepNumber: 12,
    stepName: 'find_citations',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE: 

You are a world-class article citation finder. You are the world's best at what you do. You are world-class at identifying facts, data points, and claims that must be fact-checked in a factual article, and find verifiable, official, and authoritative sources that substantiate the claims and can be used as article citations. 


# OUTPUT STRUCTURE:

1. Return ONLY valid JSON (no markdown, no code blocks)

2. Return your output exactly like this:

{
  "resource_links": [
    {
      "link_title": "Insert the Name of Citation Source 1 here",
      "link_url": "Insert the Link to Citation Source 1 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 2 here",
      "link_url": "Insert the Link to Citation Source 2 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 3 here",
      "link_url": "Insert the Link to Citation Source 3 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 4 here",
      "link_url": "Insert the Link to Citation Source 4 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 5 here",
      "link_url": "Insert the Link to Citation Source 5 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 6 here",
      "link_url": "Insert the Link to Citation Source 6 here"
    },
    {
      "link_title": "Insert the Name of Citation Source 7 here",
      "link_url": "Insert the Link to Citation Source 7 here"
    },            
    {
      "link_title": "Insert the Name of Citation Source 8 here",
      "link_url": "Insert the Link to Citation Source 8 here"
    }
  ]
}

3. No explanation. No commentary. No extra characters.

4. CRITICAL: Wrap the output in curly braces {}. Do NOT return just the resource_links array.

5. Do NOT add markdown code blocks or "json" prefix.
`,
    userPrompt: `# CONTEXT: 
          
{{write_article_output}}


# TASK:

1. Review and analyze the entire article in CONTEXT.
        
2. Your task now is to carefully analyze the article, identify the facts, data points, claims, and key market insights that must have official citations.

=> MAKE SURE all the facts, statistics, laws, and data points are valid for:

{{geolocation}}

=> MAKE SURE ALL of the facts are up to date. Today is: {{current_date}}

3. only curate citations from authoritative sources such as government websites, the World Bank, the IMF, the BIS, the UN, and organizations of that type.

4. Curate EXACTLY 8 authoritative data sources for citations.  
`,
  },

  // ─── Step 13: generate_seo_metadata ──────────────────────────────────────
  {
    stepNumber: 13,
    stepName: 'generate_seo_metadata',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    systemPrompt: `# ROLE:

You are a world-class SEO expert. You know exactly what makes people click on search result listings because you worked for the last 25 years at Google and know all the insider information about the highest performing Meta Titles, Meta Descriptions, and Google Adwords ads.

You are the best at what you do!

First you get your context, then you will receive your task.
`,
    userPrompt: `# CONTEXT:

## TOPIC:

{{topic}}

## PRIMARY KEYWORD:

{{primaryKeyword}}

## SEARCH INTENT INTO:

{{write_search_intent_intro_output}}


# TASK:

1. review the PRIMARY KEYWORD and the SEARCH INTENT INTRO in your CONTEXT.

2. Based on this search intent intro and article, create optimized SEO metadata:

Generate:
1. Meta Title (50-60 characters, include primary keyword)
2. Meta Description (150-160 characters, compelling, include keyword and CTA)
3. Take the Primary Keyword and hyphenate it to create the URL Slug (SEO-friendly, lowercase, hyphens, include PRIMARY KEYWORD only)

Requirements:
- Optimize for click-through rate
- Include target keyword naturally
- Make meta description action-oriented
- MAKE SURE URL slug is the exact PRIMARY KEYWORD hyphenated.

Return as JSON with metaTitle, metaDescription, and urlSlug fields.

CRITICAL: No Commentary. No Explanation. No extra characters.
`,
  },

  // ─── Step 14: select_category (ADD — was missing) ─────────────────────────
  {
    stepNumber: 14,
    stepName: 'select_category',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt: 'You are a content categorization expert specializing in WordPress category classification.',
    userPrompt: `Analyze this article and select the most appropriate WordPress category from the available options.

Article Content:
{{article}}

Available Categories:
{{categories}}

Task:
1. Read and understand the article content
2. Review all available categories
3. Select the SINGLE most appropriate category for this article
4. Return ONLY the numeric category ID (no explanation, no text, just the number)

Example output: 5

Return only the numeric category ID:`,
  },

  // ── Step 16 — generate_schema_markup ─────────────────────────────────────
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
    stepNumber: 16,
    stepName: 'generate_schema_markup',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o-mini',
    systemPrompt: `You are a world-class SEO expert with an exceptional expertise in crafting the best Schema Markup for SEO rankings. You are the best at what you do.`,
    userPrompt: `# ROLE:
You are a world-class SEO expert with an exceptional expertise in crafting the best Schema Markup for SEO rankings. You are the best at what you do.

# GOAL:
To analyze the article, author, and citations and produce the best Schema Markup for SEO rankings.

# CONTEXT:
Article Title: {{article_title}}
Article Description: {{seo_description}}
Author: {{author_name}}
Author Website: {{author_website}}
Author LinkedIn: {{author_linkedin}}
Published Date: {{published_date}}
Last Modified Date: {{modified_date}}
Featured Image URL: {{featured_image_url}}
Organization Logo URL: {{organization_logo_url}}
URL: {{article_url}}
Article Content: {{article}}
Article Citations: {{citation_urls}}
Organization Name: {{organization_name}}
Organization Website: {{organization_website}}
Organization Email: {{organization_email}}
Organization Phone: {{organization_phone}}
Organization Address: {{organization_address}}
Organization Country Code: {{organization_country_code}}
Google Business Profile URL: {{google_business_profile_url}}
Social Media Links:
{{social_media_links}}

Requirements:
- Use @type: "Article" as the main type
- Include headline, description, url, author (Person with name and url), datePublished, dateModified (full ISO 8601 with timezone, e.g. "2026-05-08T14:30:00.000Z")
- Featured image: when "Featured Image URL" is non-empty, add it as the Article "image" property ONLY, structured as { "@type": "ImageObject", "url": "<url>", "width": 1200, "height": 630 }. Do NOT place the featured image URL anywhere else (e.g. do NOT use it as the publisher logo).
- Author: when "Author LinkedIn" is non-empty, add the author's LinkedIn URL to the Person sameAs array (or as sameAs string if a single value)
- Publisher: use @type "Organization" only (NOT LocalBusiness). Include name, url, email, telephone, address as PostalAddress
- Publisher logo: when "Organization Logo URL" is non-empty, add it as the publisher "logo" property structured as { "@type": "ImageObject", "url": "<logo_url>" }. If "Organization Logo URL" is empty, OMIT the logo property entirely — do not invent or reuse any other URL.
- PostalAddress: set addressCountry to "Organization Country Code" when non-empty; otherwise infer from the address text — must always be ISO 3166-1 alpha-2 (e.g. "US", never "United States")
- When "Google Business Profile URL" is non-empty: append it to publisher sameAs AND set publisher hasMap to the same URL (g.page links resolve to Google Maps — valid for both)
- Merge social profile URLs into publisher sameAs; deduplicate URLs
- mainEntityOfPage pointing to WebPage for the Article url
- Include article citation URLs in the citation property
- Return ONLY valid JSON (no markdown fences, no commentary) suitable for <script type="application/ld+json">

# TASK:
Generate Schema.org JSON-LD for this article.
No explanation.`,
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────
//
// Default behaviour: CREATE missing rows only. Existing rows are NEVER touched.
//
// To intentionally overwrite one or more steps, pass their numbers as arguments:
//   pnpm tsx scripts/reseed-prompts-v3.ts --force 16 17
//
// To overwrite ALL steps (dangerous — use only in a fresh DB):
//   pnpm tsx scripts/reseed-prompts-v3.ts --force-all

async function main() {
  const args = process.argv.slice(2)
  const forceAll = args.includes('--force-all')
  const forceIdx = args.indexOf('--force')
  const forceSteps = new Set<number>(
    forceIdx !== -1
      ? args.slice(forceIdx + 1).map(Number).filter((n) => !isNaN(n))
      : [],
  )

  if (forceAll) {
    console.warn('⚠️  --force-all: ALL existing prompts will be overwritten.')
  } else if (forceSteps.size > 0) {
    console.warn(`⚠️  --force: steps [${[...forceSteps].join(', ')}] will be overwritten if they exist.`)
  } else {
    console.log('ℹ️  Safe mode: only missing prompts will be created. Pass --force <steps> to overwrite.')
  }

  console.log(`Processing ${PROMPTS.length} prompt templates`)
  console.log('─'.repeat(60))

  let created = 0
  let skipped = 0
  let updated = 0

  for (const p of PROMPTS) {
    const existing = await prisma.promptTemplate.findUnique({
      where: { stepNumber_vertical: { stepNumber: p.stepNumber, vertical: 'default' } },
      select: { id: true, stepName: true },
    })

    const shouldOverwrite = forceAll || forceSteps.has(p.stepNumber)

    if (existing) {
      if (!shouldOverwrite) {
        console.log(`  ─ Step ${p.stepNumber} (${p.stepName}) — EXISTS, skipped (safe mode)`)
        skipped++
        continue
      }
      await prisma.promptTemplate.update({
        where: { stepNumber_vertical: { stepNumber: p.stepNumber, vertical: 'default' } },
        data: {
          stepName: p.stepName,
          defaultProvider: p.defaultProvider,
          defaultModel: p.defaultModel,
          systemPrompt: p.systemPrompt ?? null,
          userPrompt: p.userPrompt,
        },
      })
      console.log(`  ✓ Step ${p.stepNumber} (${p.stepName}) — OVERWRITTEN (forced)`)
      updated++
    } else {
      await prisma.promptTemplate.create({
        data: {
          stepNumber: p.stepNumber,
          stepName: p.stepName,
          defaultProvider: p.defaultProvider,
          defaultModel: p.defaultModel,
          systemPrompt: p.systemPrompt ?? null,
          userPrompt: p.userPrompt,
          isActive: true,
        },
      })
      console.log(`  ✓ Step ${p.stepNumber} (${p.stepName}) — CREATED`)
      created++
    }
  }

  console.log('─'.repeat(60))
  console.log(`Done. Created: ${created}  Skipped (safe): ${skipped}  Overwritten: ${updated}`)
  if (skipped > 0 && !forceAll) {
    console.log('  → To overwrite specific steps: pnpm tsx scripts/reseed-prompts-v3.ts --force <step numbers>')
    console.log('  → To overwrite all:            pnpm tsx scripts/reseed-prompts-v3.ts --force-all')
  }
}

if (process.argv[1] && /reseed-prompts-v3/.test(process.argv[1])) main()
  .catch((err) => {
    console.error('reseed-prompts-v3 FAILED:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
