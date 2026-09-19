/**
 * Approval Service — Phase B
 *
 * Triggered by POST /api/articles/:jobId/approve.
 * Precondition: ArticleJob.status === 'completed'.
 *
 * Flow:
 *   1. Build PipelineContext from DB-persisted Phase A step outputs (0–12)
 *   2. Step 13  — generate_seo_metadata  (JSON: metaTitle, metaDescription, urlSlug)
 *   3. Step 15  — generate_image_prompt  (text prompt sent to Fal.ai)
 *      ↳ generateFeaturedImage → uploadFeaturedImageToS3 → Media row
 *   4. Upsert SitePage (body already has inline citations from Phase A step 12.5; SEO fields, citations, featured image)
 *   5. Step 16  — build_schema_markup (deterministic, no LLM) → SitePage.schemaJson (non-fatal if fails)
 *   6. Step 17  — generate_excerpt       → SitePage.excerpt
 *   7. Step 18  — generate_legal_disclaimer → SitePage.disclaimer
 *   8. Mark ArticleJob.status = 'approved'
 *   9. Enqueue 'article-enrichment' via pg-boss
 */

import type { Prisma } from '@prisma/client'
import { verticalForUser } from '../lib/prompt-resolver'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../lib/logger'
import { Sentry } from '../lib/sentry'
import { StepRunner } from './step-runner'
import { generateFeaturedImage } from './image-generation'
import { uploadFeaturedImageToS3WithRetry } from './image-uploader'
import { getBoss, QUEUES } from '../queues/index'
import type { PipelineContext } from './variable-resolver'
import { buildArticleSchema, type SchemaTypeRule } from './schema-builder'
import { validateSchemaJsonLd } from './quality-gate'
import { sanitizeDashesText, stripSafeDashes } from '../lib/text/dash-sanitizer'

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/** Calculate approximate reading time in minutes from HTML. */
function calculateReadingTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text.split(' ').filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

/** Returns a slug that is unique for the user, appending a jobId suffix on collision. */
async function resolveUniqueSlug(userId: string, jobId: string, base: string): Promise<string> {
  if (!base) return `article-${jobId.slice(0, 8)}`
  const conflict = await prisma.sitePage.findFirst({
    where: { userId, slug: base, NOT: { jobId } },
    select: { id: true },
  })
  return conflict ? `${base}-${jobId.slice(0, 8)}` : base
}

/** Extract SEO fields from the parsed Step 13 output. */
function extractSeoFields(parsed: Record<string, unknown>): {
  metaTitle: string
  metaDescription: string
  urlSlug: string
} {
  return {
    // Tier-1 dash cleanup only (sync): short fields, and the paired/conjunction
    // rules cover the common meta-description dash tell without an LLM call.
    metaTitle: stripSafeDashes(String(parsed.metaTitle ?? parsed['meta title'] ?? parsed.title ?? '')),
    metaDescription: stripSafeDashes(String(parsed.metaDescription ?? parsed['meta description'] ?? parsed.description ?? '')),
    urlSlug: String(parsed.urlSlug ?? parsed.url_slug ?? parsed.slug ?? ''),
  }
}

/** Extract primaryKeyword from the parsed Step 2 output. */
function extractPrimaryKeyword(parsed: Record<string, unknown> | undefined): string {
  if (!parsed) return ''
  return String(
    parsed['Primary Keyword'] ??
    parsed.primary_keyword ??
    parsed.primaryKeyword ??
    '',
  )
}

/**
 * Build the two-tier citations structure for SitePage.citations.
 *
 * Returns:
 * ```
 * {
 *   inline_sources:  [{ link_title, link_url, step }],   // Tier 1 — from research grounding
 *   resource_links:  [{ link_title, link_url, link_date? }] // Tier 2 — from Step 12
 * }
 * ```
 *
 * Backward-compatible: consumers can check for `inline_sources` to detect the new format.
 */
function buildTwoTierCitations(
  step12Raw: string,
  researchSourcesRaw: string,
): Record<string, unknown> | null {
  // Parse Step 12 (Tier 2 — bottom-of-page references)
  let resourceLinks: Array<Record<string, unknown>> = []
  if (step12Raw) {
    try {
      const parsed = JSON.parse(step12Raw)
      if (Array.isArray(parsed)) {
        resourceLinks = parsed
      } else if (parsed && typeof parsed === 'object') {
        resourceLinks = (parsed as Record<string, unknown>).resource_links as Array<Record<string, unknown>> ?? []
      }
    } catch { /* ignore */ }
  }

  // Parse research sources (Tier 1 — inline)
  let inlineSources: Array<{ link_title: string; link_url: string; step: number }> = []
  if (researchSourcesRaw) {
    try {
      const parsed = JSON.parse(researchSourcesRaw) as Array<{ title: string; url: string; step: number }>
      inlineSources = parsed.map((s) => ({
        link_title: s.title,
        link_url: s.url,
        step: s.step,
      }))
    } catch { /* ignore */ }
  }

  if (resourceLinks.length === 0 && inlineSources.length === 0) return null

  // Deduplicate: remove Tier 2 entries that already appear in Tier 1 (research sources take priority)
  const tier1Urls = new Set(inlineSources.map((s) => s.link_url))
  const dedupedResourceLinks = resourceLinks.filter((r) => {
    const url = (r.link_url ?? r.url ?? '') as string
    return !tier1Urls.has(url)
  })

  return {
    inline_sources: inlineSources,
    resource_links: dedupedResourceLinks,
  }
}

/** Truncate excerpt to ≤150 chars. */
function truncateExcerpt(text: string): string {
  const cleaned = text.replace(/<[^>]+>/g, '').trim()
  return cleaned.length > 150 ? `${cleaned.slice(0, 147)}...` : cleaned
}

/** Strip a leading markdown doc title (step 11 often starts with `# Corrected Article` etc.) */
export function cleanStepOutput(text: string): string {
  return text.replace(/^#+\s+[^\r\n]+\s*\r?\n+/, '').trimStart()
}

/**
 * Ensures every H2 that is phrased as a question ends with a `?`.
 * Detection: the visible text starts with a common English interrogative word.
 * Only appends `?` when the heading has no terminal punctuation at all.
 */
export function normalizeH2Questions(html: string): string {
  const QUESTION_START =
    /^(how|why|what|when|where|which|who|is|are|can|does|do|will|should|could|would|has|have|did)\b/i
  const TERMINAL_PUNCT = /[?!.]$/

  return html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    if (!QUESTION_START.test(text) || TERMINAL_PUNCT.test(text)) return match

    // Inject `?` just before any trailing closing HTML tags, or at the end of inner.
    const fixedInner = inner.trimEnd().replace(/(<\/[a-z][^>]*>(?:\s*<\/[a-z][^>]*>)*)$/i, '?$1')
    const finalInner = fixedInner === inner.trimEnd() ? inner.trimEnd() + '?' : fixedInner
    return `<h2${attrs}>${finalInner}</h2>`
  })
}

// ── Main approval flow ─────────────────────────────────────────────────────────

export async function approveArticleJob(jobId: string): Promise<void> {
  logger.info({ jobId }, '[approval] starting approval chain')

  // Load job + topic
  const job = await prisma.articleJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { topic: true },
  })

  const { userId, topic } = job

  // ── Build PipelineContext from completed Phase A steps ─────────────────────
  const existingSteps = await prisma.pipelineStep.findMany({
    where: { jobId, status: 'completed' },
    orderBy: { stepNumber: 'asc' },
  })

  const ctx: PipelineContext = {
    jobId,
    userId,
    topicId: job.topicId,
    topicText: topic.topic,
    topicSlug: topic.slug,
    completedSteps: new Map(),
    parsedSteps: new Map(),
  }

  for (const step of existingSteps) {
    ctx.completedSteps.set(step.stepNumber, step.output ?? '')
    if ([2, 12, 13].includes(step.stepNumber) && step.output) {
      try { ctx.parsedSteps.set(step.stepNumber, JSON.parse(step.output)) } catch { /* ok */ }
    }
  }

  // ── Confirm we have the minimum steps needed ───────────────────────────────
  const step11Raw = ctx.completedSteps.get(11) ?? ctx.completedSteps.get(9) ?? ''
  if (!step11Raw) {
    throw new Error('Missing step 11 (article body) — cannot approve')
  }
  const step11 = cleanStepOutput(step11Raw)

  // ── Step 13: generate_seo_metadata ────────────────────────────────────────
  logger.info({ jobId }, '[approval] step 13 — generate_seo_metadata')
  await prisma.articleJob.update({ where: { id: jobId }, data: { currentStep: 13 } })

  const runner13 = new StepRunner(jobId, 13, ctx)
  const result13 = await runner13.execute()

  ctx.completedSteps.set(13, result13.output)
  if (result13.parsedOutput !== undefined) {
    ctx.parsedSteps.set(13, result13.parsedOutput)
  }

  const seo = extractSeoFields(
    (result13.parsedOutput as Record<string, unknown> | undefined) ?? {},
  )
  logger.info({ jobId, seo }, '[approval] step 13 complete')

  // ── Step 15: generate_image_prompt → Fal.ai → S3 → Media ─────────────────
  logger.info({ jobId }, '[approval] step 15 — generate_image_prompt')
  await prisma.articleJob.update({ where: { id: jobId }, data: { currentStep: 15 } })

  const runner15 = new StepRunner(jobId, 15, ctx)
  const result15 = await runner15.execute()

  ctx.completedSteps.set(15, result15.output)
  const imagePromptText = result15.output.trim()

  let mediaId: string | null = null
  try {
    logger.info({ jobId }, '[approval] generating featured image with Fal.ai')
    const falImageUrl = await generateFeaturedImage(imagePromptText, jobId)

    const altText = seo.metaTitle || topic.topic
    const upload = await uploadFeaturedImageToS3WithRetry(falImageUrl, userId, jobId, altText)
    mediaId = upload.mediaId
    logger.info({ jobId, mediaId }, '[approval] featured image ready')
  } catch (err) {
    // Image generation failure is non-fatal — log + Sentry, continue without image
    logger.error({ jobId, err }, '[approval] featured image failed — continuing without image')
    Sentry.captureException(err, { tags: { phase: 'approval', step: 15 } })
  }

  // Inline citations are inserted in Phase A (executor) immediately after Step 12.
  const articleBodyHtml = step11

  // ── Upsert SitePage (makes {{article_title}} resolvable for steps 17/18) ──
  logger.info({ jobId }, '[approval] upserting SitePage')

  const primaryKeyword = extractPrimaryKeyword(
    ctx.parsedSteps.get(2) as Record<string, unknown> | undefined,
  )
  const citations = buildTwoTierCitations(
    ctx.completedSteps.get(12) ?? '',
    ctx.completedSteps.get(120) ?? '',
  )
  const baseSlug = slugify(seo.urlSlug || seo.metaTitle || topic.topic)
  const finalSlug = await resolveUniqueSlug(userId, jobId, baseSlug)
  const seoTitle = seo.metaTitle || ctx.completedSteps.get(0)?.trim() || topic.topic
  const readingTime = calculateReadingTime(articleBodyHtml)

  // Delete any conflicting sitePage keyed by jobId — shouldn't exist, but defensive
  await prisma.sitePage.upsert({
    where: { jobId },
    create: {
      jobId,
      userId,
      slug: finalSlug,
      title: seoTitle,
      bodyHtml: articleBodyHtml,
      originalBodyHtml: articleBodyHtml,
      seoTitle,
      seoDescription: seo.metaDescription || null,
      primaryKeyword: primaryKeyword || null,
      citations: (citations ?? undefined) as Prisma.InputJsonValue | undefined,
      readingTime,
      featuredImageId: mediaId,
      enrichmentStatus: 'pending',
    },
    update: {
      slug: finalSlug,
      title: seoTitle,
      bodyHtml: articleBodyHtml,
      originalBodyHtml: articleBodyHtml,
      seoTitle,
      seoDescription: seo.metaDescription || null,
      primaryKeyword: primaryKeyword || null,
      citations: (citations ?? undefined) as Prisma.InputJsonValue | undefined,
      readingTime,
      featuredImageId: mediaId,
      enrichmentStatus: 'pending',
    },
  })

  // ── Step 16: build_schema_markup (deterministic, no LLM) ─────────────────
  // Runs after SitePage upsert so the persisted slug can be used to build the canonical URL.
  logger.info({ jobId }, '[approval] step 16 — build_schema_markup (deterministic)')
  await prisma.articleJob.update({ where: { id: jobId }, data: { currentStep: 16 } })

  try {
    const [brand, platformSettings, sitePage] = await Promise.all([
      brandSettingsForUser(userId),
      prisma.platformSettings.findUnique({ where: { id: 'singleton' } }),
      prisma.sitePage.findUnique({
        where: { jobId },
        include: {
          featuredImage: { select: { url: true, width: true, height: true } },
        },
      }),
    ])

    if (!brand || !sitePage) {
      throw new Error('[approval] step 16 — missing brand or sitePage, cannot build schema')
    }

    const schemaTypeRules = (platformSettings?.schemaTypeRules ?? []) as unknown as SchemaTypeRule[]
    const siteBase = brand.organizationWebsite?.replace(/\/$/, '') ?? ''
    const articleUrl = sitePage.slug ? `${siteBase}/${sitePage.slug}` : siteBase

    // Extract citation URLs for schema markup — Tier 2 (Step 12 curated references) only.
    // Tier 1 inline sources are excluded: they are already <a> links in the body HTML and
    // listing 30+ grounding URLs in JSON-LD schema looks like a manipulated signal to Google.
    // New format: { inline_sources: [...], resource_links: [...] }
    // Old format: { resource_links: [...] } or plain array — handle all variants.
    const citationUrls: string[] = []
    if (sitePage.citations && typeof sitePage.citations === 'object') {
      const c = sitePage.citations as Record<string, unknown>
      const allArrays = [
        c.resource_links,   // Tier 2: Step 12 curated references
        c.citations,        // legacy key
      ].filter(Array.isArray) as Array<Array<Record<string, unknown> | string>>

      // If the stored value is itself a plain array (legacy)
      if (Array.isArray(sitePage.citations)) {
        allArrays.push(sitePage.citations as Array<Record<string, unknown> | string>)
      }

      const seen = new Set<string>()
      for (const arr of allArrays) {
        for (const entry of arr) {
          const url = typeof entry === 'string'
            ? entry
            : ((entry?.link_url ?? entry?.url ?? null) as string | null)
          if (url && typeof url === 'string' && !seen.has(url)) {
            seen.add(url)
            citationUrls.push(url)
          }
        }
      }
    }

    const schemaJson = buildArticleSchema({
      brand,
      schemaTypeRules,
      title: sitePage.seoTitle ?? sitePage.title ?? topic.topic,
      description: sitePage.seoDescription ?? '',
      articleUrl,
      featuredImageUrl: sitePage.featuredImage?.url ?? null,
      featuredImageWidth: sitePage.featuredImage?.width ?? null,
      featuredImageHeight: sitePage.featuredImage?.height ?? null,
      citationUrls,
      publishedDate: (sitePage.publishedAt ?? new Date()).toISOString(),
      modifiedDate: new Date().toISOString(),
    })

    // Deterministic JSON-LD validation (non-fatal; the builder is deterministic
    // so we flag rather than loop). Surfaces malformed schema for follow-up.
    const schemaCheck = validateSchemaJsonLd(schemaJson)
    if (!schemaCheck.ok) {
      logger.warn({ jobId, errors: schemaCheck.errors }, '[approval] step 16 — schema markup failed validation')
      Sentry.captureMessage('[approval] schema markup failed JSON-LD validation', {
        level: 'warning',
        tags: { phase: 'approval', step: 16, jobId },
        extra: { errors: schemaCheck.errors },
      })
    }

    ctx.completedSteps.set(16, schemaJson)

    await prisma.sitePage.update({
      where: { jobId },
      data: { schemaJson },
    })
    logger.info({ jobId, schemaValid: schemaCheck.ok }, '[approval] step 16 — schema markup persisted')
  } catch (err) {
    // Schema markup failure is non-fatal — log + Sentry, article is still approved
    logger.error({ jobId, err }, '[approval] step 16 — schema markup failed, continuing')
    Sentry.captureException(err, { tags: { phase: 'approval', step: 16 } })
  }

  // ── Step 17: generate_excerpt ──────────────────────────────────────────────
  logger.info({ jobId }, '[approval] step 17 — generate_excerpt')
  await prisma.articleJob.update({ where: { id: jobId }, data: { currentStep: 17 } })

  const runner17 = new StepRunner(jobId, 17, ctx)
  const result17 = await runner17.execute()
  ctx.completedSteps.set(17, result17.output)
  const excerpt = truncateExcerpt(await sanitizeDashesText(result17.output, { jobId, stepNumber: 17 }))

  await prisma.sitePage.update({
    where: { jobId },
    data: { excerpt },
  })

  // ── Step 18: article disclaimer ───────────────────────────────────────────
  // Clinics use the ONCE-generated, validated, client-editable disclaimer from
  // brandSettings (Veit 2026-09-19 — per-article LLM generation shipped a
  // truncated YMYL disclaimer to WordPress on the live E2E). The LLM step
  // remains only for azavea (its own per-article variant) and as a legacy
  // fallback when the stored field is empty.
  logger.info({ jobId }, '[approval] step 18 — article disclaimer')
  await prisma.articleJob.update({ where: { id: jobId }, data: { currentStep: 18 } })

  const storedDisclaimer =
    (await verticalForUser(ctx.userId)) === 'azavea'
      ? null
      : (await prisma.brandSettings.findFirst({ where: { userId: ctx.userId }, select: { articleDisclaimer: true } }))
          ?.articleDisclaimer?.trim() || null

  let disclaimer: string
  if (storedDisclaimer) {
    disclaimer = (await sanitizeDashesText(storedDisclaimer, { jobId, stepNumber: 18 })).trim()
    logger.info({ jobId, chars: disclaimer.length }, '[approval] step 18 — using stored brand disclaimer')
  } else {
    const runner18 = new StepRunner(jobId, 18, ctx)
    const result18 = await runner18.execute()
    ctx.completedSteps.set(18, result18.output)
    disclaimer = (await sanitizeDashesText(result18.output, { jobId, stepNumber: 18 })).trim()
  }

  await prisma.sitePage.update({
    where: { jobId },
    data: { disclaimer },
  })

  // ── Aggregate costs & mark approved ───────────────────────────────────────
  const approvalSteps = await prisma.pipelineStep.findMany({
    where: { jobId, stepNumber: { in: [13, 15, 17, 18] }, status: 'completed' },
    select: { cost: true, inputTokens: true, outputTokens: true },
  })

  const addedCost = approvalSteps.reduce((s, r) => s + (r.cost ?? 0), 0)
  const addedTokens = approvalSteps.reduce(
    (s, r) => s + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  )

  await prisma.articleJob.update({
    where: { id: jobId },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      currentStep: 18,  // highest completed Phase B step
      totalCost: { increment: addedCost },
      totalTokens: { increment: addedTokens },
    },
  })

  // ── Auto-enqueue Phase C enrichment ───────────────────────────────────────
  try {
    const boss = await getBoss()
    const enrichmentBossId = await boss.send(QUEUES.ARTICLE_ENRICHMENT, { jobId })
    if (enrichmentBossId) {
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { enrichmentJobId: enrichmentBossId },
      })
    }
    logger.info({ jobId, enrichmentBossId }, '[approval] enrichment job enqueued')
  } catch (err) {
    logger.error({ jobId, err }, '[approval] failed to enqueue enrichment — job is still approved')
    Sentry.captureException(err, { tags: { phase: 'approval', step: 'enqueue-enrichment' } })
  }

  logger.info({ jobId }, '[approval] approval chain complete')
}
