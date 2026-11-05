import type { BrandSettings, PlatformSettings, OutlineFramework } from '@prisma/client'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { getGlobalExcludedKeywords } from './keyword-validator'
import { seededRng } from './enrichment/plain-language'

// B6 (2026-11-04): per-article closing move, drawn deterministically from the
// jobId. A fixed "allowed closer" rule made the model end EVERY article the
// same sanctioned way; a per-job draw is the only reliable variety mechanism.
// B8: the neat opening-story bookend reads as an LLM-classic to detectors, so
// the callback draw is down-weighted (10%) and loosened to an oblique glance.
function drawCloserDirective(jobId: string): string {
  const r = seededRng(`closer:${jobId}`)()
  if (r < 0.3) return 'End the article with one short, fresh question that turns the final point toward the reader. Never the exact words "How about you?".'
  if (r < 0.4) return 'End the article with one sentence that glances back at the opening once, obliquely — never close the loop neatly or resolve the opening scene word for word. No closing question.'
  if (r < 0.7) return 'End the article with one concrete, doable next step for the reader. No closing question.'
  return 'End the article on a short, confident plain statement. No closing question, no callback.'
}

// B8: per-article opening move. The mandated micro-story opener came out as
// persona theatrics ("I'm the bloke people ring… Humbling.") — no clinician
// writes like that. The opening is now drawn, with the understated micro-story
// as one modest-weight option; the register ceiling lives in the voice spec.
function drawOpeningDirective(jobId: string): string {
  const r = seededRng(`opening:${jobId}`)()
  if (r < 0.3) return 'OPENING MOVE: open the article with a short patient-case observation — something you saw or were asked in practice — told in one or two understated sentences. No self-deprecation, no performance.'
  if (r < 0.55) return 'OPENING MOVE: open the article with the question a reader like this actually brings in, stated plainly in their words, then start answering it.'
  if (r < 0.8) return 'OPENING MOVE: open the article with a direct, confident statement of its core point. No anecdote, no scene-setting.'
  return 'OPENING MOVE: open the article with a brief personal micro-story told in one or two understated, professional sentences — a clinical observation, not a performance. No self-deprecating theatrics, no slang self-labels.'
}

// Maps generic {{<step_name>_output}} variable suffixes to step numbers
const STEP_NAME_MAP: Record<string, number> = {
  generate_title: 0,
  generate_outline: 1,
  keyword_research: 2,
  find_supporting_keywords: 3,
  optimize_outline_seo: 4,
  write_search_intent_intro: 5,
  research_faqs: 6,
  find_faq_facts: 7,
  find_article_facts: 8,
  write_article: 9,
  fact_check_article: 10,
  adjust_incorrect_facts: 11,
  find_citations: 12,
  generate_seo_metadata: 13,
  select_category: 14,
  generate_image_prompt: 15,
  insert_inline_citations: 110,
}

export interface PipelineContext {
  jobId: string
  userId: string
  topicId: string
  topicText: string           // Topic.topic
  topicSlug?: string | null   // Topic.slug (may be empty for manual topics)
  completedSteps: Map<number, string>  // stepNumber -> raw output string
  parsedSteps: Map<number, unknown>    // stepNumber -> parsed JSON (for steps 2, 12, 13)
  // Filled in progressively as the pipeline runs
  excludedKeywordsCache?: string
  // Research sources accumulated from Gemini search grounding metadata (Steps 6, 7, 8, 10)
  researchSources?: Array<{ title: string; url: string; step: number }>
  // Lazy-loaded caches for new V2 models
  brandSettingsCache?: BrandSettings | null
  platformSettingsCache?: PlatformSettings | null
  outlineFrameworkCache?: OutlineFramework | null
  writingStyleCache?: string | null
}

// ── Lazy loaders ────────────────────────────────────────────────────────────

async function getBrandSettings(ctx: PipelineContext): Promise<BrandSettings | null> {
  if (ctx.brandSettingsCache !== undefined) return ctx.brandSettingsCache
  ctx.brandSettingsCache = await brandSettingsForUser(ctx.userId)
  return ctx.brandSettingsCache
}

async function getPlatformSettings(ctx: PipelineContext): Promise<PlatformSettings | null> {
  if (ctx.platformSettingsCache !== undefined) return ctx.platformSettingsCache
  ctx.platformSettingsCache = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } })
  return ctx.platformSettingsCache
}

async function getOutlineFramework(ctx: PipelineContext): Promise<OutlineFramework | null> {
  if (ctx.outlineFrameworkCache !== undefined) return ctx.outlineFrameworkCache
  const topic = await prisma.topic.findUnique({
    where: { id: ctx.topicId },
    select: { outlineFrameworkNumber: true },
  })
  if (!topic?.outlineFrameworkNumber) { ctx.outlineFrameworkCache = null; return null }
  ctx.outlineFrameworkCache = await prisma.outlineFramework.findUnique({
    where: { number: topic.outlineFrameworkNumber },
  })
  return ctx.outlineFrameworkCache
}

async function getWritingStyle(ctx: PipelineContext): Promise<string> {
  if (ctx.writingStyleCache !== undefined) return ctx.writingStyleCache ?? ''
  const settings = await prisma.settings.findUnique({
    where: { userId: ctx.userId },
    select: { writingStyle: true },
  })
  ctx.writingStyleCache = settings?.writingStyle ?? null
  return ctx.writingStyleCache ?? ''
}

/** Replace all {{variable}} placeholders in a prompt string. */
export async function resolveVariables(
  template: string,
  ctx: PipelineContext,
): Promise<string> {
  const VARIABLE_RE = /\{\{\s*([^}]+?)\s*\}\}/g
  const replacements = new Map<string, string>()

  // Find all unique placeholders first
  const vars = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = VARIABLE_RE.exec(template)) !== null) {
    vars.add(m[1].trim())
  }

  // Resolve each variable (using cache where possible)
  for (const varName of vars) {
    const value = await resolveVariable(varName, ctx)
    replacements.set(varName, value)
  }

  // Apply all replacements
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => {
    return replacements.get(name.trim()) ?? ''
  })
}

async function resolveVariable(name: string, ctx: PipelineContext): Promise<string> {
  switch (name) {
    // ── Topic fields ────────────────────────────────────────────────────────
    case 'topic':
      return ctx.topicText

    case 'title':
      return ctx.completedSteps.get(0) ?? ''

    case 'slug':
      return ctx.topicSlug ?? ''

    // ── Global excluded keywords ─────────────────────────────────────────────
    case 'excludedKeywords':
    case 'excluded_keywords': {
      if (ctx.excludedKeywordsCache === undefined) {
        ctx.excludedKeywordsCache = await getGlobalExcludedKeywords(ctx.userId)
      }
      // Also include keywords that have been added to Topic.excludedKeywords
      const topic = await prisma.topic.findUnique({
        where: { id: ctx.topicId },
        select: { excludedKeywords: true },
      })
      const topicExcluded = topic?.excludedKeywords?.join(', ') ?? ''
      const combined = [ctx.excludedKeywordsCache, topicExcluded].filter(Boolean).join(', ')
      return combined
    }

    // ── Step outputs ─────────────────────────────────────────────────────────
    case 'outline':
      return ctx.completedSteps.get(1) ?? ''

    case 'keywords':
      return ctx.completedSteps.get(2) ?? ''

    case 'primaryKeyword':
    case 'primary_keyword':
    case 'primaryKeywords':  // typo in Step 3 prompt — map to same
      return extractPrimaryKeyword(ctx.parsedSteps.get(2)) ?? ''

    case 'secondary_keywords': {
      const parsed = ctx.parsedSteps.get(2)
      return extractSecondaryKeywords(parsed)
    }

    case 'salient_entities': {
      const parsed = ctx.parsedSteps.get(2)
      return extractSalientEntities(parsed)
    }

    case 'searchIntent':
    case 'intro':
      return ctx.completedSteps.get(5) ?? ''

    case 'faqQuestions':
    case 'faqs':
      return ctx.completedSteps.get(6) ?? ''

    case 'facts':
      return ctx.completedSteps.get(8) ?? ''

    case 'article':
    case 'article_html':
      // Prefer the corrected article (step 11), fall back to step 9
      return ctx.completedSteps.get(11) ?? ctx.completedSteps.get(9) ?? ''

    case 'factCheckIssues':
      return ctx.completedSteps.get(10) ?? ''

    case 'article_title': {
      const sitePage = await prisma.sitePage.findFirst({ where: { jobId: ctx.jobId } })
      return sitePage?.seoTitle ?? sitePage?.title ?? ctx.topicText
    }

    case 'articleSummary':
    case 'article_summary': {
      const articleBody = ctx.completedSteps.get(11) ?? ctx.completedSteps.get(9) ?? ''
      return articleBody.slice(0, 1000) + (articleBody.length > 1000 ? '...' : '')
    }

    case 'article_excerpt': {
      const sitePage = await prisma.sitePage.findFirst({ where: { jobId: ctx.jobId } })
      return sitePage?.excerpt ?? ''
    }

    case 'article_disclaimer': {
      const sitePage = await prisma.sitePage.findFirst({ where: { jobId: ctx.jobId } })
      return sitePage?.disclaimer ?? ''
    }

    case 'seo_title':
    case 'seo_description':
    case 'article_slug': {
      const parsed = ctx.parsedSteps.get(13) as Record<string, string> | undefined
      if (name === 'seo_title') return parsed?.metaTitle ?? parsed?.['meta title'] ?? ''
      if (name === 'seo_description') return parsed?.metaDescription ?? parsed?.['meta description'] ?? ''
      return parsed?.urlSlug ?? parsed?.slug ?? ''
    }

    case 'citation_urls': {
      const raw = ctx.completedSteps.get(12) ?? ''
      try {
        const data = JSON.parse(raw) as { resource_links?: Array<{ link_url: string }> } | Array<{ link_url: string }>
        const links = Array.isArray(data) ? data : (data.resource_links ?? [])
        return links.map((l) => l.link_url).filter(Boolean).join(', ')
      } catch { return '' }
    }

    case 'current_date':
      return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    case 'min_citation_year':
      return String(new Date().getFullYear() - 10)

    // ── Article pipeline V2 variables ─────────────────────────────────────────

    case 'outline_framework': {
      const fw = await getOutlineFramework(ctx)
      return fw?.body ?? ''
    }

    case 'writing_style':
      return getWritingStyle(ctx)

    case 'closer_directive':
      return drawCloserDirective(ctx.jobId)

    case 'opening_directive':
      return drawOpeningDirective(ctx.jobId)

    case 'google_guidelines': {
      const ps = await getPlatformSettings(ctx)
      return ps?.googleGuidelines ?? ''
    }

    case 'geolocation': {
      const bs = await getBrandSettings(ctx)
      return bs?.geolocation ?? ''
    }

    case 'industry': {
      const bs = await getBrandSettings(ctx)
      return bs?.industry ?? ''
    }

    case 'business_description': {
      const bs = await getBrandSettings(ctx)
      return bs?.businessDescription ?? ''
    }

    case 'who': {
      const bs = await getBrandSettings(ctx)
      return bs?.who ?? ''
    }

    case 'our_experience': {
      const bs = await getBrandSettings(ctx)
      return bs?.ourExperience ?? ''
    }

    case 'article_goal': {
      const bs = await getBrandSettings(ctx)
      return bs?.articleGoal ?? ''
    }

    case 'special_instructions': {
      const bs = await getBrandSettings(ctx)
      return bs?.specialInstructions ?? ''
    }

    case 'author_name': {
      const bs = await getBrandSettings(ctx)
      return bs?.defaultAuthorName ?? ''
    }

    case 'author_website': {
      const bs = await getBrandSettings(ctx)
      return bs?.defaultAuthorWebsite ?? ''
    }

    case 'author_linkedin': {
      const bs = await getBrandSettings(ctx)
      return bs?.defaultAuthorLinkedIn ?? ''
    }

    case 'author_job_title': {
      const bs = await getBrandSettings(ctx)
      return bs?.defaultAuthorJobTitle ?? ''
    }

    case 'author_alumni_of': {
      const bs = await getBrandSettings(ctx)
      return bs?.defaultAuthorAlumniOf ?? ''
    }

    case 'schema_article_type': {
      const bs = await getBrandSettings(ctx)
      return bs?.schemaArticleType ?? ''
    }

    case 'outline_special_instructions': {
      const topic = await prisma.topic.findUnique({
        where: { id: ctx.topicId },
        select: { outlineSpecialInstructions: true },
      })
      return topic?.outlineSpecialInstructions ?? ''
    }

    case 'real_case_studies': {
      const topic = await prisma.topic.findUnique({
        where: { id: ctx.topicId },
        select: { realCaseStudies: true },
      })
      return topic?.realCaseStudies ?? ''
    }

    case 'organization_name': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationName ?? ''
    }

    case 'organization_website': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationWebsite ?? ''
    }

    case 'organization_email': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationEmail ?? ''
    }

    case 'organization_phone': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationPhone ?? ''
    }

    case 'organization_address': {
      const bs = await getBrandSettings(ctx)
      // Prefer structured sub-fields; fall back to the legacy combined string
      if (bs?.addressLine1) {
        const parts = [
          bs.addressLine1,
          bs.addressLine2,
          bs.addressLocality,
          bs.addressRegion,
          bs.postalCode,
          bs.addressCountryName,
        ].filter(Boolean)
        return parts.join(', ')
      }
      return bs?.organizationAddress ?? ''
    }

    case 'organization_country_code': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationCountryCode ?? ''
    }

    case 'organization_logo_url': {
      const bs = await getBrandSettings(ctx)
      return bs?.organizationLogoUrl ?? ''
    }

    case 'google_business_profile_url': {
      const bs = await getBrandSettings(ctx)
      return bs?.googleBusinessProfileUrl ?? ''
    }

    case 'social_media_links': {
      const bs = await getBrandSettings(ctx)
      if (!bs?.socialMediaLinks) return ''
      const links = bs.socialMediaLinks as Array<{ platform: string; url: string }>
      if (!Array.isArray(links)) return ''
      return links.map((l) => `${l.platform}: ${l.url}`).join('\n')
    }

    case 'published_date':
    case 'modified_date': {
      const topic = await prisma.topic.findUnique({
        where: { id: ctx.topicId },
        select: { publishingDate: true },
      })
      // Default to today when no publishing date is set; return full ISO 8601 with timezone
      const date = topic?.publishingDate ?? new Date()
      return date.toISOString()
    }

    case 'featured_image_url': {
      const sp = await prisma.sitePage.findUnique({
        where: { jobId: ctx.jobId },
        select: { featuredImage: { select: { url: true } } },
      })
      return sp?.featuredImage?.url ?? ''
    }

    case 'article_url': {
      // SitePage.slug is always written before any approval step that needs this variable.
      // Topic.slug is user-supplied and often null for auto-generated topics.
      const [sp, bs] = await Promise.all([
        prisma.sitePage.findFirst({ where: { jobId: ctx.jobId }, select: { slug: true } }),
        getBrandSettings(ctx),
      ])
      const base = bs?.organizationWebsite?.replace(/\/$/, '') ?? ''
      const slug = sp?.slug ?? ''
      return slug ? `${base}/${slug}` : base
    }

    case 'validated_citations':
      // Populated by the approval service (step 110 setup) before calling StepRunner.
      // The approval service calls ctx.completedSteps.set(110, JSON.stringify(liveCitations))
      // so the resolved value is the JSON array of validated citations.
      return ctx.completedSteps.get(110) ?? ''

    case 'research_sources':
      return JSON.stringify(ctx.researchSources ?? [])

    // ── Generic step output accessor: {{<step_name>_output}} ─────────────────
    default: {
      if (name.endsWith('_output')) {
        const stepName = name.replace(/_output$/, '')
        const stepNumber = STEP_NAME_MAP[stepName]
        if (stepNumber !== undefined) {
          return ctx.completedSteps.get(stepNumber) ?? ''
        }
      }
      return ''  // unknown variable → empty string
    }
  }
}

// ── Keyword extraction helpers ──────────────────────────────────────────────

function extractPrimaryKeyword(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  const val = obj['Primary Keyword'] ?? obj['primaryKeyword'] ?? obj['primary_keyword']
  return typeof val === 'string' ? val.trim() : undefined
}

function extractSecondaryKeywords(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const obj = parsed as Record<string, unknown>
  const keywords: string[] = []
  for (let i = 1; i <= 5; i++) {
    const key = `Secondary Keywords ${i}`
    const altKey = `secondary_keyword_${i}`
    const val = obj[key] ?? obj[altKey]
    if (typeof val === 'string' && val.trim()) keywords.push(val.trim())
  }
  // Also accept array form
  if (!keywords.length) {
    const arr = obj['secondaryKeywords'] ?? obj['secondary_keywords']
    if (Array.isArray(arr)) return arr.filter(Boolean).join(', ')
  }
  return keywords.join(', ')
}

function extractSalientEntities(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const obj = parsed as Record<string, unknown>
  const entities: string[] = []
  for (let i = 1; i <= 5; i++) {
    const val = obj[`Salient Entity ${i}`] ?? obj[`salient_entity_${i}`]
    if (typeof val === 'string' && val.trim()) entities.push(val.trim())
  }
  if (!entities.length) {
    const arr = obj['salientEntities'] ?? obj['salient_entities']
    if (Array.isArray(arr)) return arr.filter(Boolean).join(', ')
  }
  return entities.join(', ')
}
