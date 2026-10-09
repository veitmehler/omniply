/**
 * Promotional email generator.
 *
 * Generates a short promotional email (subject + HTML body) from a published
 * article using PromptTemplate step 32. The result is persisted on the
 * ArticleEmailCampaign row; the handler then creates + schedules a GHL Email
 * Campaign from it.
 */

import { resolvePromptByStep } from '../../lib/prompt-resolver'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { getLLMAdapter } from '../llm/factory'
import { recordLLMUsage } from '../../lib/llm-usage'
import { logger } from '../../lib/logger'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'

const PROMO_EMAIL_STEP_NUMBER = 32

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

/** Derive GHL preheader/preview text from the HTML body (first ~100 chars, single line). */
export function htmlToPreviewText(html: string): string {
  return stripHtmlTags(html).replace(/\s+/g, ' ').trim().slice(0, 100)
}

export interface PromoEmailResult {
  subject: string
  bodyHtml: string
  inputTokens: number
  outputTokens: number
  cost: number
  provider: string
  model: string
}

/**
 * Parse the model output into { subject, bodyHtml }. Prefers strict JSON
 * (optionally wrapped in a ```json fence); falls back to "first line = subject,
 * remainder = body" so a malformed response still yields a usable email.
 */
export function parsePromoEmail(raw: string, fallbackSubject: string): { subject: string; bodyHtml: string } {
  const trimmed = raw.trim()
  const jsonText = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(jsonText) as { subject?: unknown; bodyHtml?: unknown }
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
    const bodyHtml = typeof parsed.bodyHtml === 'string' ? parsed.bodyHtml.trim() : ''
    if (subject && bodyHtml) {
      return { subject, bodyHtml }
    }
  } catch {
    // fall through to heuristic parsing
  }

  const lines = trimmed.split('\n')
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0)
  if (firstNonEmpty !== -1) {
    const subject = lines[firstNonEmpty].replace(/^#+\s*/, '').replace(/^subject:\s*/i, '').trim()
    const bodyHtml = lines.slice(firstNonEmpty + 1).join('\n').trim()
    if (subject && bodyHtml) {
      return { subject, bodyHtml }
    }
  }

  return { subject: fallbackSubject, bodyHtml: trimmed }
}

export async function generatePromoEmail(jobId: string, userId: string): Promise<PromoEmailResult> {
  // Idempotency: if a prior attempt already produced the email (e.g. a pg-boss
  // retry after a schedule failure), reuse it instead of making another LLM
  // call. The enqueue placeholder has empty subject/body, so a populated row
  // means generation already succeeded.
  const prior = await prisma.articleEmailCampaign.findUnique({
    where: { jobId },
    select: {
      subject: true, bodyHtml: true,
      inputTokens: true, outputTokens: true, cost: true, provider: true, model: true,
    },
  })
  if (prior && prior.subject && prior.bodyHtml) {
    logger.info({ jobId }, '[promo-email] reusing previously generated email (idempotent retry)')
    await prisma.articleEmailCampaign.update({
      where: { jobId },
      data: { status: 'generated', errorMessage: null },
    })
    return {
      subject: prior.subject,
      bodyHtml: prior.bodyHtml,
      inputTokens: prior.inputTokens,
      outputTokens: prior.outputTokens,
      cost: prior.cost,
      provider: prior.provider ?? '',
      model: prior.model ?? '',
    }
  }

  const [sitePage, brand, template] = await Promise.all([
    prisma.sitePage.findUnique({
      where: { jobId },
      select: {
        title: true,
        seoTitle: true,
        bodyHtml: true,
        excerpt: true,
        primaryKeyword: true,
        slug: true,
      },
    }),
    brandSettingsForUser(userId),
    resolvePromptByStep(PROMO_EMAIL_STEP_NUMBER, { userId }),
  ])

  if (!sitePage) {
    throw new Error(`No SitePage found for job ${jobId}`)
  }
  if (!template || !template.isActive) {
    throw new Error(`Promotional email prompt template (step ${PROMO_EMAIL_STEP_NUMBER}) not found or inactive`)
  }

  const articleTitle = sitePage.seoTitle ?? sitePage.title
  const base = brand?.organizationWebsite?.replace(/\/$/, '') ?? ''
  const articleUrl = sitePage.slug ? (base ? `${base}/${sitePage.slug}` : '') : base

  const resolveVars = (text: string) =>
    text
      .replace(/{{title}}/g, articleTitle)
      .replace(/{{primary_keyword}}/g, sitePage.primaryKeyword ?? '')
      .replace(/{{excerpt}}/g, sitePage.excerpt ?? '')
      .replace(/{{article_url}}/g, articleUrl)
      .replace(/{{article_body}}/g, stripHtmlTags(sitePage.bodyHtml ?? ''))

  const resolvedSystem = template.systemPrompt ? resolveVars(template.systemPrompt) : null
  const resolvedUser = resolveVars(template.userPrompt)

  logger.info({ jobId }, '[promo-email] generating email')

  const adapter = getLLMAdapter(template.defaultProvider)
  const response = await adapter.call({
    systemPrompt: resolvedSystem,
    userPrompt: resolvedUser,
    model: template.defaultModel,
    maxTokens: template.maxTokens ?? 2000,
    temperature: 0.7,
  })

  await recordLLMUsage(userId, 'promo_email', response)
  const parsed = parsePromoEmail(response.content, articleTitle)
  const subject = await sanitizeDashesText(parsed.subject, { jobId, surface: 'promo_subject' })
  const bodyHtml = await sanitizeDashesText(parsed.bodyHtml, { jobId, surface: 'promo_body' })

  await prisma.articleEmailCampaign.upsert({
    where: { jobId },
    create: {
      jobId,
      userId,
      subject,
      bodyHtml,
      status: 'generated',
      inputTokens: response.tokens.input,
      outputTokens: response.tokens.output,
      cost: response.cost,
      provider: response.provider,
      model: response.model,
    },
    update: {
      subject,
      bodyHtml,
      status: 'generated',
      errorMessage: null,
      inputTokens: response.tokens.input,
      outputTokens: response.tokens.output,
      cost: response.cost,
      provider: response.provider,
      model: response.model,
    },
  })

  logger.info({ jobId, subject }, '[promo-email] email generated')

  return {
    subject,
    bodyHtml,
    inputTokens: response.tokens.input,
    outputTokens: response.tokens.output,
    cost: response.cost,
    provider: response.provider,
    model: response.model,
  }
}
