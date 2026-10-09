/**
 * Syndication article generator.
 *
 * Generates platform-optimised articles (LinkedIn Article, Medium) from the
 * published main article. Called synchronously from the API route — no queue
 * needed since the two LLM calls complete in ~10–20 s.
 */

import { resolvePromptByStep } from '../../lib/prompt-resolver'
import { prisma } from '@omniply/shared'
import { getLLMAdapter } from '../llm/factory'
import { recordLLMUsage } from '../../lib/llm-usage'
import { logger } from '../../lib/logger'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'

const PLATFORMS = ['linkedin', 'medium'] as const
export type SyndicationPlatform = (typeof PLATFORMS)[number]

/** PromptTemplate stepNumber for each platform */
const STEP_NUMBER: Record<SyndicationPlatform, number> = {
  linkedin: 30,
  medium:   31,
}

export interface SyndicationResult {
  platform:     SyndicationPlatform
  title:        string
  content:      string
  inputTokens:  number
  outputTokens: number
  cost:         number
  provider:     string
  model:        string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildCitationsText(
  citations: Array<{ link_title: string; link_url: string; source_type?: string }>,
): string {
  const refs = citations.filter(
    (c) => c.link_url && c.source_type !== 'inline',
  )
  if (refs.length === 0) return '(none provided)'
  return refs
    .map((c, i) => `${i + 1}. ${c.link_title || c.link_url} — ${c.link_url}`)
    .join('\n')
}

/**
 * Extract the first line as the title if the model wrote "# Title" at the top
 * (Medium format). Falls back to the main article title.
 */
function extractTitleAndContent(
  raw: string,
  fallbackTitle: string,
): { title: string; content: string } {
  const firstLineMatch = raw.match(/^#\s+(.+)$/m)
  if (firstLineMatch) {
    const title   = firstLineMatch[1].trim()
    const content = raw.replace(/^#\s+.+\n?/, '').trim()
    return { title, content }
  }
  return { title: fallbackTitle, content: raw.trim() }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateSyndicationArticles(
  jobId:  string,
  userId: string,
): Promise<SyndicationResult[]> {
  // Load SitePage + citations + diagrams
  const sitePage = await prisma.sitePage.findUnique({
    where: { jobId },
    select: {
      title:          true,
      seoTitle:       true,
      bodyHtml:       true,
      excerpt:        true,
      primaryKeyword: true,
      citations:      true,
    },
  })

  if (!sitePage) {
    throw new Error(`No SitePage found for job ${jobId}`)
  }

  const articleTitle     = sitePage.seoTitle ?? sitePage.title
  const articleBodyPlain = stripHtmlTags(sitePage.bodyHtml ?? '')
  const excerptText      = sitePage.excerpt ?? ''
  const primaryKeyword   = sitePage.primaryKeyword ?? ''

  // Build citations text (Tier 2 only)
  const rawCitations = sitePage.citations as Array<{
    link_title: string
    link_url: string
    source_type?: string
  }> | Record<string, unknown> | null

  let citationsArray: Array<{ link_title: string; link_url: string; source_type?: string }> = []
  if (rawCitations && !Array.isArray(rawCitations)) {
    const obj = rawCitations as Record<string, unknown>
    if (Array.isArray(obj.resource_links)) {
      citationsArray = (obj.resource_links as Array<Record<string, string>>).map((c) => ({
        link_title:  c.link_title ?? '',
        link_url:    c.link_url ?? '',
        source_type: 'reference' as const,
      }))
    }
  } else if (Array.isArray(rawCitations)) {
    citationsArray = rawCitations
  }

  const citationsText = buildCitationsText(citationsArray)

  const results: SyndicationResult[] = []

  for (const platform of PLATFORMS) {
    const stepNumber = STEP_NUMBER[platform]

    const template = await resolvePromptByStep(stepNumber, { userId })

    if (!template || !template.isActive) {
      logger.warn(
        { jobId, platform, stepNumber },
        '[syndication] prompt template not found or inactive — skipping',
      )
      continue
    }

    // Simple variable substitution (no full variable-resolver needed here)
    const resolveVars = (text: string) =>
      text
        .replace(/{{title}}/g,            articleTitle)
        .replace(/{{primary_keyword}}/g,   primaryKeyword)
        .replace(/{{excerpt}}/g,           excerptText)
        .replace(/{{article_body}}/g,      articleBodyPlain)
        .replace(/{{citations}}/g,         citationsText)

    const resolvedSystem = template.systemPrompt ? resolveVars(template.systemPrompt) : null
    const resolvedUser   = resolveVars(template.userPrompt)

    logger.info({ jobId, platform }, '[syndication] generating article')

    const adapter  = getLLMAdapter(template.defaultProvider)
    const response = await adapter.call({
      systemPrompt: resolvedSystem,
      userPrompt:   resolvedUser,
      model:        template.defaultModel,
      maxTokens:    template.maxTokens ?? 6000,
      temperature:  0.7,
    })

    await recordLLMUsage(userId, `syndication_${platform}`, response)
    const extracted = extractTitleAndContent(response.content, articleTitle)
    const title = await sanitizeDashesText(extracted.title, { jobId, surface: `syndication_${platform}_title` })
    const content = await sanitizeDashesText(extracted.content, { jobId, surface: `syndication_${platform}` })

    // Upsert — one row per platform per job
    await prisma.syndicationArticle.upsert({
      where:  { jobId_platform: { jobId, platform } },
      create: {
        jobId,
        userId,
        platform,
        title,
        content,
        status:       'completed',
        inputTokens:  response.tokens.input,
        outputTokens: response.tokens.output,
        cost:         response.cost,
        provider:     response.provider,
        model:        response.model,
      },
      update: {
        title,
        content,
        status:       'completed',
        errorMessage: null,
        inputTokens:  response.tokens.input,
        outputTokens: response.tokens.output,
        cost:         response.cost,
        provider:     response.provider,
        model:        response.model,
      },
    })

    results.push({
      platform,
      title,
      content,
      inputTokens:  response.tokens.input,
      outputTokens: response.tokens.output,
      cost:         response.cost,
      provider:     response.provider,
      model:        response.model,
    })

    logger.info({ jobId, platform, words: content.split(/\s+/).length }, '[syndication] article generated')
  }

  return results
}
