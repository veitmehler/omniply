/**
 * Article enrichment orchestrator — Phase C
 *
 * 1) GEO (optional): match FAQ questions, summaries, restructure headings
 * 2) Key takeaways + collapsible TOC (after intro, before first content H2)
 * 3) Mermaid diagrams per content H2 (runs on body after intro split — skips takeaways)
 * 4) Optional WP category when topic has wordPressConnectionId
 * 5) Optional WP tags (up to 4) when topic has wordPressConnectionId
 */

import sharp from 'sharp'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { Sentry } from '../../lib/sentry'
import { decrypt } from '@omniply/shared'
import { uploadBufferWithKey, deleteS3Prefix, downloadImageFromUrl } from '@omniply/shared'
import { getSystemApiKey } from '../../lib/system-keys'
import { specializationLabel } from '../../newsletter/calendar-routing'
import { getBoss, QUEUES } from '../../queues/index'
import {
  extractH2Sections,
  buildEnrichedHtml,
  buildFigureHtml,
  injectHeadingIds,
  extractHeadingsForToc,
  buildTocHtml,
  findFirstH2Index,
  stripTags,
  normalizeHeadingCase,
} from './html-parser'
import { generateMermaidDiagram, extractMermaidConcepts } from './mermaid-generator'
import { renderMermaidToSvg } from './svg-renderer'
import { rasterizeSvg } from './svg-rasterizer'
import { sanitizeSvg, addSvgAccessibility } from './svg-sanitizer'
import { selectDiagramType } from './diagram-type-selector'
import { buildDiagramInitDirective, buildDarkDiagramInitDirective, themeFromBrand, DIAGRAM_DARK_BACKGROUND } from './diagram-theme'
import { postprocessDiagramPng } from './png-postprocess'
import { parseFaqQuestions, parseSecondaryKeywords, pickKeywordForSection } from './faq-parse'
import { matchQuestionsToSections } from './geo-question-matcher'
import { generateQuestionFromKeyword, rephraseForUniqueness } from './geo-question-generator'
import { generateAiSummary } from './geo-summary-generator'
import { restructureHtmlWithGeo, type GeoSectionData } from './geo-html-restructurer'
import { sanitizeGeoQuestion } from './geo-question-sanitizer'
import { normalizeH2Questions } from '../approval-service'
import { loadPlainLanguageConfig, runPlainLanguagePass } from './plain-language'
import { generateKeyTakeaways } from './key-takeaways-generator'
import { generateDiagramCaption } from './diagram-caption-generator'
import { selectWordPressCategory } from './wp-category-selector'
import { selectWordPressTags } from './wp-tag-selector'
import { getDiagramRasterBrowser } from './diagram-browser-pool'
import { mapWithConcurrency } from '../../lib/concurrency'

/** Parallelism for the heavy diagram tail (render/caption/restyle/uploads).
 * Bounded further downstream by the mmdc + Chromium-page semaphores. */
const DIAGRAM_TAIL_CONCURRENCY = 3
import { buildRestylePrompt, restyleDiagram } from './diagram-restyle'
import { verifyRestyledDiagram } from './diagram-verify'
import { extractLabelInventory } from './mermaid-label-lint'
import { buildInventoryBlock, buildRetryFeedbackBlock } from './diagram-restyle'
import { overlayLogo } from './diagram-logo'
import { processLogo } from '../../newsletter/logo-process'

const CDN_BASE = process.env.CDN_BASE ?? ''

const GEO_EXCLUDE =
  /^(faq|frequently asked questions|conclusion|key takeaways)\b/i

function isGeoExcluded(heading: string): boolean {
  const t = stripTags(heading).trim()
  return GEO_EXCLUDE.test(t)
}

export function getCdnUrl(s3Key: string): string {
  return `${CDN_BASE.replace(/\/$/, '')}/${s3Key}`
}

/** Phase C milestones → ArticleJob.currentStep (SSE + workflow UI). Not PromptTemplate IDs.
 * 19 GEO · 20 key takeaways+TOC · 21 diagrams · 22 merge figures · 23 save (.finish sets 25).
 */
async function setEnrichmentPhaseStep(jobId: string, phaseStep: number): Promise<void> {
  await prisma.articleJob.update({
    where: { id: jobId },
    data: { currentStep: phaseStep },
  })
}

export async function runArticleEnrichment(jobId: string): Promise<void> {
  logger.info({ jobId }, '[enrichment] starting')

  const job = await prisma.articleJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { sitePage: true },
  })

  const sitePage = job.sitePage
  if (!sitePage) {
    throw new Error(`No SitePage found for job ${jobId} — approval must run first`)
  }

  // Always start from the pre-enrichment backup so re-runs don't accumulate
  // stale <figure> tags from previous runs on top of new ones.
  const bodyHtml = sitePage.originalBodyHtml ?? sitePage.bodyHtml ?? ''
  if (!bodyHtml) {
    throw new Error(`SitePage has no bodyHtml for job ${jobId}`)
  }

  const primaryKeyword = sitePage.primaryKeyword ?? ''

  const topic = await prisma.topic.findUniqueOrThrow({
    where: { id: job.topicId },
    select: {
      topic: true,
      wordPressConnectionId: true,
    },
  })

  await prisma.sitePage.update({
    where: { id: sitePage.id },
    data: { enrichmentStatus: 'in_progress', keyTakeawaysHtml: null, tocHtml: null },
  })

  // Wipe previous-run artefacts so re-runs are idempotent regardless of trigger.
  await prisma.sectionEnrichment.deleteMany({ where: { sitePageId: sitePage.id } })
  await prisma.articleDiagram.deleteMany({ where: { sitePageId: sitePage.id } })
  // Clear enrichment errors so the UI only shows errors from this run.
  await prisma.errorLog.deleteMany({ where: { jobId, errorType: { startsWith: 'enrichment_' } } })
  // Delete all S3 diagram objects so SKIPped sections don't show stale files from previous runs.
  await deleteS3Prefix(`articles/${job.userId}/${jobId}/diagrams/`).catch((err) =>
    logger.warn({ jobId, err }, '[enrichment] S3 diagram prefix delete failed — continuing'),
  )
  await prisma.media.updateMany({
    where: { userId: job.userId, jobId, source: 'diagram', deletedAt: null },
    data: { deletedAt: new Date() },
  })

  await setEnrichmentPhaseStep(jobId, 19)

  const stepRows = await prisma.pipelineStep.findMany({
    where: { jobId, status: 'completed', stepNumber: { in: [2, 6] } },
  })
  const step2 = stepRows.find((s) => s.stepNumber === 2)?.output ?? ''
  const step6 = stepRows.find((s) => s.stepNumber === 6)?.output ?? ''

  const faqQuestions = parseFaqQuestions(step6)
  const secondaryKws = parseSecondaryKeywords(step2)

  let totalCost = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  const baseSections = extractH2Sections(bodyHtml)
  let geoHtml = bodyHtml
  const geoByPosition = new Map<number, GeoSectionData>()

  type Eligible = {
    position: number
    heading: string
    contentSnippet: string
  }
  const eligible: Eligible[] = []
  for (const s of baseSections) {
    if (isGeoExcluded(s.heading)) continue
    eligible.push({
      position: s.position,
      heading: s.heading,
      contentSnippet: stripTags(s.sectionHtml).slice(0, 600),
    })
  }

  if (eligible.length > 0) {
    const matchByPos = new Map<number, string | null>()
    if (faqQuestions.length > 0) {
      try {
        const m = await matchQuestionsToSections({
          sections: eligible.map((e) => ({
            position: e.position,
            heading: e.heading,
            contentSnippet: e.contentSnippet,
          })),
          faqQuestions,
          jobId,
        })
        totalCost += m.cost
        totalInputTokens += m.inputTokens
        totalOutputTokens += m.outputTokens
        eligible.forEach((e, j) => {
          matchByPos.set(e.position, m.matches[j] ?? null)
        })
      } catch (err) {
        logger.warn({ jobId, err }, '[enrichment] GEO 101 failed — falling back to keyword questions')
        eligible.forEach((e) => matchByPos.set(e.position, null))
      }
    } else {
      eligible.forEach((e) => matchByPos.set(e.position, null))
    }

    for (const e of eligible) {
      // Sanitize the FAQ-matched question first; null means fall through to keyword generation
      let question = sanitizeGeoQuestion(matchByPos.get(e.position) ?? null)
      let source: 'faq_match' | 'keyword_gen' | 'rephrased' | null = question ? 'faq_match' : null
      let qCost = 0
      let qIn = 0
      let qOut = 0
      let qProv = ''
      let qModel = ''

      if (!question) {
        try {
          const kw = pickKeywordForSection(e.heading, secondaryKws)
          const g = await generateQuestionFromKeyword({
            keyword: kw,
            sectionHeading: e.heading,
            contentSnippet: e.contentSnippet,
            jobId,
            position: e.position,
          })
          // Sanitize keyword-generated question; null means skip this section
          question = sanitizeGeoQuestion(g.question)
          if (question) {
            source = 'keyword_gen'
            qCost += g.cost
            qIn += g.inputTokens
            qOut += g.outputTokens
            qProv = g.provider
            qModel = g.model
            totalCost += g.cost
            totalInputTokens += g.inputTokens
            totalOutputTokens += g.outputTokens
          }
        } catch (err) {
          logger.warn({ jobId, err, position: e.position }, '[enrichment] geo 102 failed')
        }
      }

      if (!question) continue

      try {
        const collision = await prisma.sectionEnrichment.count({
          where: {
            userId: job.userId,
            question,
            NOT: { sitePageId: sitePage.id },
          },
        })
        if (collision > 0) {
          const r = await rephraseForUniqueness({ question, contentSnippet: e.contentSnippet, jobId, position: e.position })
          // Sanitize rephrased question; if null, keep the pre-rephrase question
          const rephrased = sanitizeGeoQuestion(r.question)
          if (rephrased) {
            question = rephrased
            source = 'rephrased'
            totalCost += r.cost
            totalInputTokens += r.inputTokens
            totalOutputTokens += r.outputTokens
            qCost += r.cost
            qIn += r.inputTokens
            qOut += r.outputTokens
            qProv = r.provider
            qModel = r.model
          }
        }
      } catch (err) {
        logger.warn({ jobId, err }, '[enrichment] geo 103 skipped')
      }

      let summary: string | undefined
      const sectionHtml =
        baseSections.find((s) => s.position === e.position)?.sectionHtml ?? ''
      const plainBody = stripTags(sectionHtml).slice(0, 8000)
      try {
        const s104 = await generateAiSummary({
          question,
          sectionContent: plainBody,
          jobId,
          position: e.position,
        })
        summary = s104.summary
        totalCost += s104.cost
        totalInputTokens += s104.inputTokens
        totalOutputTokens += s104.outputTokens
        qCost += s104.cost
        qIn += s104.inputTokens
        qOut += s104.outputTokens
        qProv = s104.provider
        qModel = s104.model
      } catch (err) {
        logger.warn({ jobId, err, position: e.position }, '[enrichment] geo 104 failed')
      }

      geoByPosition.set(e.position, {
        position: e.position,
        question,
        summary: summary ?? null,
      })

      try {
        await prisma.sectionEnrichment.upsert({
          where: {
            sitePageId_position: { sitePageId: sitePage.id, position: e.position },
          },
          create: {
            sitePageId: sitePage.id,
            userId: job.userId,
            position: e.position,
            originalH2: e.heading,
            question,
            summary: summary ?? null,
            questionSource: source,
            llmProvider: qProv || null,
            llmModel: qModel || null,
            inputTokens: qIn,
            outputTokens: qOut,
            cost: qCost,
          },
          update: {
            originalH2: e.heading,
            question,
            summary: summary ?? null,
            questionSource: source,
            llmProvider: qProv || null,
            llmModel: qModel || null,
            inputTokens: qIn,
            outputTokens: qOut,
            cost: qCost,
          },
        })
      } catch (err) {
        logger.warn({ jobId, err }, '[enrichment] sectionEnrichment upsert failed')
      }
    }

    if (geoByPosition.size > 0) {
      geoHtml = restructureHtmlWithGeo(bodyHtml, baseSections, geoByPosition)
    }
    // Normalise question-style H2s (append `?`) before the TOC is built so
    // TOC display text matches the headings that appear in the article body.
    geoHtml = normalizeH2Questions(geoHtml)
  }

  // Plain-language storytelling pass — additive glosses/story boxes injected into
  // the post-GEO HTML so TOC/heading-ids/diagrams downstream all see the final
  // structure. Skips silently when no PlainLanguageConfig matches the industry.
  try {
    const plBrand = await brandSettingsForUser(job.userId)
    const plConfig = await loadPlainLanguageConfig(plBrand?.industry)
    if (plConfig) {
      const plSettings = await prisma.settings.findUnique({
        where: { userId: job.userId },
        select: { writingStyle: true },
      })
      const plTheme = themeFromBrand(plBrand ?? undefined)
      const pl = await runPlainLanguagePass({
        jobId,
        sitePageId: sitePage.id,
        html: geoHtml,
        voice: {
          writingStyle: plSettings?.writingStyle ?? '',
          audience: plBrand?.who ?? '',
          industry: plBrand?.industry ?? '',
        },
        config: plConfig,
        accentHex: plTheme.primaryColor,
      })
      geoHtml = pl.html
      totalCost += pl.cost
      totalInputTokens += pl.inputTokens
      totalOutputTokens += pl.outputTokens
      logger.info(
        { jobId, glosses: pl.injectedGlosses, boxes: pl.injectedBoxes, cost: pl.cost },
        '[enrichment] plain-language pass complete',
      )
    } else {
      logger.info({ jobId }, '[enrichment] plain-language pass skipped — no config for industry')
    }
  } catch (err) {
    logger.warn({ jobId, err }, '[enrichment] plain-language pass failed — continuing without it')
  }

  await setEnrichmentPhaseStep(jobId, 20)

  const cut = findFirstH2Index(geoHtml)
  const intro = cut >= 0 ? geoHtml.slice(0, cut) : ''
  const bodyOnly = cut >= 0 ? geoHtml.slice(cut) : geoHtml

  let keyTakeawaysHtml: string | null = null
  let tocHtml: string | null = null
  // Default: inject heading IDs on body alone (used when key-takeaways generation fails).
  // Overridden inside the try block with a shared-pass result to keep ToC anchors aligned.
  let bodyWithIds = injectHeadingIds(bodyOnly)
  try {
    const kt = await generateKeyTakeaways({
      bodyHtml: geoHtml,
      primaryKeyword,
      jobId,
    })
    totalCost += kt.cost
    totalInputTokens += kt.inputTokens
    totalOutputTokens += kt.outputTokens
    keyTakeawaysHtml = kt.sectionHtml

    // Run injectHeadingIds once on the full concatenated HTML so the shared
    // `used` set guarantees ToC href anchors match body heading ids exactly,
    // even when multiple headings share a slug prefix.
    const BODY_SEP = '<!--BODY_START-->'
    const stemForToc = injectHeadingIds(intro + kt.sectionHtml + BODY_SEP + bodyOnly)
    tocHtml = buildTocHtml(extractHeadingsForToc(stemForToc))
    // Extract the body portion (with IDs) from the combined result
    const sepIdx = stemForToc.indexOf(BODY_SEP)
    if (sepIdx >= 0) {
      bodyWithIds = stemForToc.slice(sepIdx + BODY_SEP.length)
    }
  } catch (err) {
    logger.warn({ jobId, err }, '[enrichment] key takeaways / toc failed')
  }

  await setEnrichmentPhaseStep(jobId, 21)

  const sections = extractH2Sections(bodyWithIds)

  if (sections.length === 0) {
    await setEnrichmentPhaseStep(jobId, 22)

    await setEnrichmentPhaseStep(jobId, 23)
    const mergedPlain =
      intro +
      (keyTakeawaysHtml ?? '') +
      (tocHtml ?? '') +
      bodyWithIds
    await finishEnrichment(jobId, sitePage.id, mergedPlain, keyTakeawaysHtml, tocHtml, totalCost, totalInputTokens, totalOutputTokens)
    await maybeWpCategory(jobId)
    await maybeWpTags(jobId)
    return
  }

  let successCount = 0
  let failCount = 0
  const figuresToInsert: Array<{ afterH2Offset: number; figureHtml: string }> = []

  const brandStyle = await brandSettingsForUser(job.userId)
  const theme = themeFromBrand(brandStyle ?? undefined)
  const diagramInitDirective = buildDiagramInitDirective(theme)
  const darkDiagramInitDirective = buildDarkDiagramInitDirective(theme)

  // AI restyle (Nano Banana): redesign each diagram into a branded, 1:1 image.
  // Resolved once per job; null disables restyling (no Gemini key) and the
  // pipeline keeps the plain Mermaid SVG. Any per-diagram failure also falls back.
  const restyleCfg = await buildDiagramRestyleConfig(jobId, brandStyle)

  const usedDiagramTypes: string[] = []
  // Rolling window of concept labels from the last 2 successful diagrams.
  const priorConceptWindows: string[] = []

  // Phase-1 parallelization (.plans/production-throughput.implementation-plan.md 1a):
  // type selection + Mermaid GENERATION stay SERIAL — the type-diversity chain
  // (usedDiagramTypes) and the prior-concepts window both depend on order. The
  // heavy tail (render → caption → restyle → uploads, ~70% of the time) runs in
  // parallel below, bounded by mmdc/Chromium semaphores + the provider limiter.
  type PreparedDiagram = {
    section: (typeof sections)[number]
    diagramType: string
    gen: Awaited<ReturnType<typeof generateMermaidDiagram>>
    priorConceptsContext: string | undefined
  }
  const prepared: PreparedDiagram[] = []

  await getDiagramRasterBrowser()

  for (const section of sections) {
    logger.info(
      { jobId, position: section.position, heading: section.heading.slice(0, 60) },
      '[enrichment] processing section (mermaid)',
    )

    try {
      let typePick = await selectDiagramType({
        sectionTitle: section.heading,
        contentSnippet: stripTags(section.sectionHtml),
        alreadyUsed: [...usedDiagramTypes],
        jobId,
        position: section.position,
      })
      totalCost += typePick.cost
      totalInputTokens += typePick.inputTokens
      totalOutputTokens += typePick.outputTokens

      // Code-enforced diversity: if the LLM picked the same type as the last
      // used one, re-query once with a hard exclusion so back-to-back dupes
      // are broken without relying on prompt-only soft hints.
      const lastUsed = usedDiagramTypes.at(-1)
      if (typePick.diagramType !== null && typePick.diagramType === lastUsed) {
        logger.info(
          { jobId, position: section.position, type: typePick.diagramType },
          '[enrichment] type same as previous — re-querying with exclusion',
        )
        const retry = await selectDiagramType({
          sectionTitle: section.heading,
          contentSnippet: stripTags(section.sectionHtml),
          alreadyUsed: [...usedDiagramTypes],
          excludeType: typePick.diagramType,
          jobId,
          position: section.position,
        })
        totalCost += retry.cost
        totalInputTokens += retry.inputTokens
        totalOutputTokens += retry.outputTokens
        // Use the retry result if it yielded a different (non-null) type; otherwise
        // keep the original so the section still gets a diagram.
        if (retry.diagramType !== null) typePick = retry
      }

      if (typePick.diagramType === null) {
        logger.info({ jobId, position: section.position }, '[enrichment] section skipped by diagram-type selector')
        continue
      }

      const diagramType = typePick.diagramType

      // Build prior-concepts hint: concat labels from the last 2 diagrams.
      const priorConceptsContext = priorConceptWindows.length > 0
        ? priorConceptWindows.join(', ')
        : undefined

      const gen1 = await generateMermaidDiagram({
        sectionTitle: section.heading,
        sectionHtml: section.sectionHtml,
        articleTopic: topic.topic,
        primaryKeyword,
        diagramType,
        priorConceptsContext,
        jobId,
        position: section.position,
      })

      totalCost += gen1.cost
      totalInputTokens += gen1.inputTokens
      totalOutputTokens += gen1.outputTokens

      if (gen1.mermaidSyntax === null) {
        logger.info({ jobId, position: section.position }, '[enrichment] section skipped by LLM')
        continue
      }

      // Chains advance at generation time (slightly stricter than the old
      // after-save point: a diagram that later fails render still "used" its
      // type/concepts — acceptable, diversity only gets stronger).
      usedDiagramTypes.push(diagramType)
      priorConceptWindows.push(extractMermaidConcepts(gen1.mermaidSyntax))
      if (priorConceptWindows.length > 2) priorConceptWindows.shift()

      prepared.push({ section, diagramType, gen: gen1, priorConceptsContext })
    } catch (sectionErr) {
      const errMsg = sectionErr instanceof Error ? sectionErr.message : String(sectionErr)
      logger.error({ jobId, position: section.position, err: sectionErr }, '[enrichment] section error')
      Sentry.captureException(sectionErr, {
        tags: { phase: 'enrichment', jobId },
        extra: { position: section.position, heading: section.heading },
      })
      await prisma.errorLog.create({
        data: {
          jobId,
          userId: job.userId,
          errorType: 'enrichment_section_error',
          errorMessage: `Section "${section.heading}": ${errMsg}`,
          context: { position: section.position },
        },
      })
      failCount++
    }
  }

  // Heavy tail, parallel. Failures are caught PER TASK (mapWithConcurrency then
  // never rejects); shared accumulators are safe — JS increments are synchronous.
  await mapWithConcurrency(prepared, DIAGRAM_TAIL_CONCURRENCY, async (task) => {
    const { section, diagramType, priorConceptsContext } = task
    let gen = task.gen
    try {
      let svgContent: string
      try {
        svgContent = await renderMermaidToSvg(gen.mermaidSyntax!, diagramInitDirective)
      } catch (renderErr) {
        const errMsg = renderErr instanceof Error ? renderErr.message : String(renderErr)
        logger.warn({ jobId, position: section.position, errMsg }, '[enrichment] render failed — retrying')

        const gen2 = await generateMermaidDiagram({
          sectionTitle: section.heading,
          sectionHtml: section.sectionHtml,
          articleTopic: topic.topic,
          primaryKeyword,
          diagramType,
          priorConceptsContext,
          jobId,
          position: section.position,
          retryContext: errMsg,
        })

        totalCost += gen2.cost
        totalInputTokens += gen2.inputTokens
        totalOutputTokens += gen2.outputTokens

        if (gen2.mermaidSyntax === null) return

        try {
          svgContent = await renderMermaidToSvg(gen2.mermaidSyntax, diagramInitDirective)
        } catch (retryRenderErr) {
          const retryMsg =
            retryRenderErr instanceof Error ? retryRenderErr.message : String(retryRenderErr)
          logger.warn({ jobId, position: section.position, retryMsg }, '[enrichment] render failed after retry')
          await prisma.errorLog.create({
            data: {
              jobId,
              userId: job.userId,
              errorType: 'enrichment_render_failed',
              errorMessage: `Section "${section.heading}": mmdc render failed after retry: ${retryMsg}`,
              context: { position: section.position },
            },
          })
          failCount++
          return
        }
        gen = gen2
      }

      const captionResult = await generateDiagramCaption({
        articleTopic: topic.topic,
        sectionTitle: section.heading,
        diagramType,
        mermaidSyntax: gen.mermaidSyntax!,
        jobId,
        position: section.position,
      })
      totalCost += captionResult.cost
      totalInputTokens += captionResult.inputTokens
      totalOutputTokens += captionResult.outputTokens

      await saveDiagramAndInsert({
        jobId,
        sitePage: { id: sitePage.id, userId: job.userId },
        section,
        mermaidSyntax: gen.mermaidSyntax!,
        svgContent,
        gen,
        figuresToInsert,
        darkDiagramInitDirective,
        altText: captionResult.altText,
        caption: captionResult.caption,
        restyle: restyleCfg,
      })
      successCount++
    } catch (sectionErr) {
      const errMsg = sectionErr instanceof Error ? sectionErr.message : String(sectionErr)
      logger.error({ jobId, position: section.position, err: sectionErr }, '[enrichment] section error')
      Sentry.captureException(sectionErr, {
        tags: { phase: 'enrichment', jobId },
        extra: { position: section.position, heading: section.heading },
      })
      await prisma.errorLog.create({
        data: {
          jobId,
          userId: job.userId,
          errorType: 'enrichment_section_error',
          errorMessage: `Section "${section.heading}": ${errMsg}`,
          context: { position: section.position },
        },
      })
      failCount++
    }
  })
  // NOTE: the pooled browser is intentionally NOT closed here anymore — it is
  // shared across concurrent jobs (newsletter covers/overlays) under Phase 1,
  // and getDiagramRasterBrowser() relaunches lazily if it ever dies.

  if (successCount === 0 && sections.length > 0 && failCount === sections.length) {
    await prisma.sitePage.update({
      where: { id: sitePage.id },
      data: {
        enrichmentStatus: 'failed',
        enrichmentError: `All ${sections.length} sections failed to generate diagrams`,
        keyTakeawaysHtml,
        tocHtml,
      },
    })
    await prisma.errorLog.create({
      data: {
        jobId,
        userId: job.userId,
        errorType: 'enrichment_total_failure',
        errorMessage: `All ${sections.length} h2 sections failed during enrichment`,
      },
    })
    logger.error({ jobId }, '[enrichment] all sections failed — job stays approved')
    return
  }

  await setEnrichmentPhaseStep(jobId, 22)

  const diagrammedBody = buildEnrichedHtml(bodyWithIds, figuresToInsert)
  const merged =
    intro +
    (keyTakeawaysHtml ?? '') +
    (tocHtml ?? '') +
    diagrammedBody

  await setEnrichmentPhaseStep(jobId, 23)

  await finishEnrichment(
    jobId,
    sitePage.id,
    merged,
    keyTakeawaysHtml,
    tocHtml,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
  )

  await maybeWpCategory(jobId)
  await maybeWpTags(jobId)
}

async function maybeWpCategory(jobId: string): Promise<void> {
  try {
    const job = await prisma.articleJob.findUnique({
      where: { id: jobId },
      select: { userId: true, topicId: true },
    })
    if (!job) return

    const topicRow = await prisma.topic.findUnique({
      where: { id: job.topicId },
      select: { id: true, topic: true, wordPressConnectionId: true },
    })
    if (!topicRow?.wordPressConnectionId) return

    const conn = await prisma.wordPressConnection.findFirst({
      where: { id: topicRow.wordPressConnectionId, userId: job.userId },
    })
    if (!conn) return

    const sp = await prisma.sitePage.findUnique({
      where: { jobId },
      select: { title: true },
    })

    const plain = decrypt(conn.appPassword)
    const auth = 'Basic ' + Buffer.from(`${conn.username}:${plain}`).toString('base64')

    const cat = await selectWordPressCategory({
      topic: topicRow.topic,
      title: sp?.title ?? topicRow.topic,
      siteUrl: conn.siteUrl,
      authHeader: auth,
      jobId,
    })

    if (cat.categoryId != null) {
      await prisma.topic.update({
        where: { id: topicRow.id },
        data: { wpCategoryId: cat.categoryId },
      })
      await prisma.articleJob.update({
        where: { id: jobId },
        data: {
          totalCost: { increment: cat.cost },
          totalTokens: { increment: cat.inputTokens + cat.outputTokens },
        },
      })
    }
  } catch (err) {
    logger.warn({ jobId, err }, '[enrichment] WP category selection failed')
  }
}

async function maybeWpTags(jobId: string): Promise<void> {
  try {
    const job = await prisma.articleJob.findUnique({
      where: { id: jobId },
      select: { userId: true, topicId: true },
    })
    if (!job) return

    const topicRow = await prisma.topic.findUnique({
      where: { id: job.topicId },
      select: { id: true, topic: true, wordPressConnectionId: true },
    })
    if (!topicRow?.wordPressConnectionId) return

    const conn = await prisma.wordPressConnection.findFirst({
      where: { id: topicRow.wordPressConnectionId, userId: job.userId },
    })
    if (!conn) return

    const sp = await prisma.sitePage.findUnique({
      where: { jobId },
      select: { title: true },
    })

    const plain = decrypt(conn.appPassword)
    const auth = 'Basic ' + Buffer.from(`${conn.username}:${plain}`).toString('base64')

    const sel = await selectWordPressTags({
      topic: topicRow.topic,
      title: sp?.title ?? topicRow.topic,
      siteUrl: conn.siteUrl,
      authHeader: auth,
      jobId,
    })

    await prisma.topic.update({
      where: { id: topicRow.id },
      data: { wpTagIds: sel.tagIds },
    })

    await prisma.articleJob.update({
      where: { id: jobId },
      data: {
        totalCost: { increment: sel.cost },
        totalTokens: { increment: sel.inputTokens + sel.outputTokens },
      },
    })
  } catch (err) {
    logger.warn({ jobId, err }, '[enrichment] WP tag selection failed')
  }
}

/** Resolved once per job; passed to every diagram save. */
interface DiagramRestyleConfig {
  geminiKey: string
  prompt: string
  logoBuffer: Buffer | null
}

/**
 * Build the per-job AI restyle config: resolve the Gemini key, assemble the
 * industry/specialization-aware prompt + style guide, and pre-download the brand
 * logo once. Returns null when restyling can't run (no key) so the pipeline
 * falls back to the plain Mermaid SVG.
 */
export async function buildDiagramRestyleConfig(
  jobId: string,
  brandStyle: Awaited<ReturnType<typeof brandSettingsForUser>>,
): Promise<DiagramRestyleConfig | null> {
  const geminiKey = await getSystemApiKey('gemini')
  if (!geminiKey) {
    logger.info({ jobId }, '[enrichment] no Gemini key — skipping diagram AI restyle')
    return null
  }
  const specLabel =
    (await specializationLabel(brandStyle?.primarySpecialization)) || brandStyle?.specialization || null
  const prompt = buildRestylePrompt({
    industry: brandStyle?.industry,
    specialization: specLabel,
    styleGuide: brandStyle?.diagramStyleGuide,
    primaryColor: brandStyle?.diagramPrimaryColor,
    secondaryColor: brandStyle?.diagramSecondaryColor,
  })
  let logoBuffer: Buffer | null = null
  const logoUrl = await resolveDiagramLogoUrl(jobId, brandStyle)
  if (logoUrl) {
    try {
      logoBuffer = await downloadImageFromUrl(logoUrl)
    } catch (err) {
      logger.warn({ jobId, err }, '[enrichment] diagram logo download failed — proceeding without watermark')
    }
  }
  return { geminiKey, prompt, logoBuffer }
}

/**
 * Resolve the watermark logo URL for the chosen light/dark variant:
 *  1. Newsletter variants (nlLogoLightUrl / nlLogoDarkUrl).
 *  2. Auto-generated-from-org-logo variants, cached on BrandSettings (regenerated
 *     only when organizationLogoUrl changes).
 *  3. Raw organizationLogoUrl → socialLogoUrl → none.
 */
async function resolveDiagramLogoUrl(
  jobId: string,
  brand: Awaited<ReturnType<typeof brandSettingsForUser>>,
): Promise<string | null> {
  if (!brand) return null
  const variant = brand.diagramLogoVariant === 'dark' ? 'dark' : 'light'

  // 1. Newsletter light/dark variants.
  const nlUrl = variant === 'dark' ? brand.nlLogoDarkUrl : brand.nlLogoLightUrl
  if (nlUrl) return nlUrl

  // 2. Auto-generate (and cache) from the org logo when no newsletter variants exist.
  const org = brand.organizationLogoUrl
  if (org) {
    let lightUrl = brand.diagramLogoLightUrl
    let darkUrl = brand.diagramLogoDarkUrl
    const stale = brand.diagramLogoSourceUrl !== org || !lightUrl || !darkUrl
    if (stale) {
      try {
        const generated = await processLogo(brand.userId, org, '#011328', `brand-assets/${brand.userId}/diagram-logo`)
        lightUrl = generated.lightUrl
        darkUrl = generated.darkUrl
        await prisma.brandSettings.update({
          where: { userId: brand.userId },
          data: { diagramLogoSourceUrl: org, diagramLogoLightUrl: lightUrl, diagramLogoDarkUrl: darkUrl },
        })
      } catch (err) {
        logger.warn({ jobId, err }, '[enrichment] diagram logo variant generation failed — using raw logo')
      }
    }
    const gen = variant === 'dark' ? darkUrl : lightUrl
    if (gen) return gen
  }

  // 3. Last-ditch raw logo.
  return brand.organizationLogoUrl || brand.socialLogoUrl || null
}

/** Guarantee an exact 1:1 image (Gemini image-to-image returns ~square; this is the guard). */
export async function ensureSquare(buf: Buffer): Promise<Buffer> {
  const m = await sharp(buf).metadata()
  const w = m.width ?? 0
  const h = m.height ?? 0
  if (!w || !h || w === h) return buf
  const side = Math.min(w, h)
  return sharp(buf).resize(side, side, { fit: 'cover', position: 'centre' }).png().toBuffer()
}

interface SaveDiagramOpts {
  jobId: string
  sitePage: { id: string; userId: string }
  section: { position: number; anchor: string; heading: string; afterH2Offset: number }
  mermaidSyntax: string
  svgContent: string
  gen: { inputTokens: number; outputTokens: number; cost: number; provider: string; model: string }
  figuresToInsert: Array<{ afterH2Offset: number; figureHtml: string }>
  darkDiagramInitDirective: string
  altText: string  // concise visual description for img alt= and SVG <title>
  caption: string  // meaning-focused sentence shown as visible <figcaption>
  restyle: DiagramRestyleConfig | null  // AI restyle config (null → SVG only)
}

/** Match screenshot + crop background (mmdc `-b white`). */
const DIAGRAM_LIGHT_RASTER_BG = '#FFFFFF'

/**
 * Extract intrinsic dimensions from an SVG string for CLS-prevention width/height attributes.
 * Reads viewBox first (most reliable), falls back to explicit width/height attributes.
 */
function extractSvgViewBoxDimensions(svg: string): { width: number; height: number } | null {
  const vb = /\bviewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg)
  if (vb) {
    return { width: Math.round(Number.parseFloat(vb[1])), height: Math.round(Number.parseFloat(vb[2])) }
  }
  const w = /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg)
  const h = /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg)
  if (w && h) {
    return { width: Math.round(Number.parseFloat(w[1])), height: Math.round(Number.parseFloat(h[1])) }
  }
  return null
}

async function saveDiagramAndInsert(opts: SaveDiagramOpts): Promise<void> {
  const { jobId, sitePage, section, mermaidSyntax, svgContent, gen, figuresToInsert, darkDiagramInitDirective, altText, caption, restyle } =
    opts

  const cleanSvg = addSvgAccessibility(
    sanitizeSvg(svgContent),
    altText || section.heading,  // SVG <title> uses the visual alt text, not the caption
    section.heading,
    `diagram-title-${jobId.slice(0, 8)}-${section.position}`,
  )

  // SVG — primary format embedded in article HTML
  const svgKey = `articles/${sitePage.userId}/${jobId}/diagrams/${section.position}.svg`
  await uploadBufferWithKey(svgKey, Buffer.from(cleanSvg, 'utf8'), 'image/svg+xml')
  const svgUrl = getCdnUrl(svgKey)

  // PNG — light theme, tight crop + square pad (social / email fallback)
  const rawLight = await rasterizeSvg(cleanSvg, 1200, DIAGRAM_LIGHT_RASTER_BG)
  const light = await postprocessDiagramPng(rawLight.png, DIAGRAM_LIGHT_RASTER_BG)
  const pngKey = `articles/${sitePage.userId}/${jobId}/diagrams/${section.position}.png`
  await uploadBufferWithKey(pngKey, light.png, 'image/png')

  // AI restyle → branded, exact-1:1 image. On any failure we keep null and fall
  // back to the Mermaid SVG below. Fidelity verify pass (2026-09-18, 4-site
  // bench finding): the image model occasionally truncates/duplicates labels
  // on complex diagrams — verify each restyle against the source, retry once,
  // then fall back to the Mermaid render rather than ship corrupted text.
  let stylizedKey: string | null = null
  let stylizedW: number | null = null
  let stylizedH: number | null = null
  if (restyle?.geminiKey) {
    // Per-diagram authoritative text inventory (parsed from the mermaid
    // source) rides in BOTH the restyle prompt and the verify pass; retry
    // attempts additionally carry the previous verdict's issues as positive
    // exactly-once corrections. 3 attempts (Veit 2026-09-18); a model
    // REFUSAL consumes an attempt like any other failure (refusals proved
    // transient in benching).
    const inventory = extractLabelInventory(mermaidSyntax)
    const inventoryBlock = buildInventoryBlock(inventory)
    let lastIssues: string[] = []
    for (let attempt = 1; attempt <= 3 && !stylizedKey; attempt++) {
      const restyled = await restyleDiagram({
        squarePng: light.png,
        prompt: restyle.prompt + inventoryBlock + buildRetryFeedbackBlock(lastIssues),
        geminiKey: restyle.geminiKey,
        userId: sitePage.userId,
        jobId,
      })
      if (!restyled) continue // refusal/error — logged inside; burn the attempt

      const check = await verifyRestyledDiagram({
        geminiKey: restyle.geminiKey,
        sourcePng: light.png,
        restyledPng: restyled.png,
        jobId,
        expectedLabels: inventory.length ? inventory : undefined,
      })
      if (check.verdict === 'fail') {
        lastIssues = check.issues
        logger.warn(
          { jobId, position: section.position, attempt, issues: check.issues },
          attempt < 3
            ? '[enrichment] restyle failed fidelity verify — retrying'
            : '[enrichment] restyle failed fidelity verify on final attempt — keeping Mermaid render',
        )
        continue
      }

      const square = await ensureSquare(restyled.png)
      const branded = await overlayLogo(square, restyle.logoBuffer)
      const sdims = await sharp(branded).metadata()
      stylizedKey = `articles/${sitePage.userId}/${jobId}/diagrams/${section.position}-stylized.png`
      await uploadBufferWithKey(stylizedKey, branded, 'image/png')
      stylizedW = sdims.width ?? null
      stylizedH = sdims.height ?? null
    }
  }

  // Dark PNG is only used as a Mermaid fallback variant; skip it when the
  // stylized image (its own designed background) is the in-article figure.
  let pngDarkKey: string | null = null
  let darkW: number | null = null
  let darkH: number | null = null
  if (!stylizedKey) {
    try {
      const darkSvg = await renderMermaidToSvg(mermaidSyntax, darkDiagramInitDirective, DIAGRAM_DARK_BACKGROUND)
      const darkClean = sanitizeSvg(darkSvg)
      const rawDark = await rasterizeSvg(darkClean, 1200, DIAGRAM_DARK_BACKGROUND)
      const dark = await postprocessDiagramPng(rawDark.png, DIAGRAM_DARK_BACKGROUND)
      pngDarkKey = `articles/${sitePage.userId}/${jobId}/diagrams/${section.position}-dark.png`
      await uploadBufferWithKey(pngDarkKey, dark.png, 'image/png')
      darkW = dark.width
      darkH = dark.height
    } catch (err) {
      logger.warn({ jobId, position: section.position, err }, '[enrichment] dark PNG render failed — skipping')
    }
  }

  await prisma.articleDiagram.upsert({
    where: { sitePageId_position: { sitePageId: sitePage.id, position: section.position } },
    create: {
      sitePageId: sitePage.id,
      position: section.position,
      sectionAnchor: section.anchor,
      sectionTitle: section.heading,
      caption,
      mermaidSyntax,
      svgContent: cleanSvg,
      svgS3Key: svgKey,
      pngS3Key: pngKey,
      pngWidth: light.width,
      pngHeight: light.height,
      pngDarkS3Key: pngDarkKey,
      pngDarkWidth: darkW,
      pngDarkHeight: darkH,
      stylizedPngS3Key: stylizedKey,
      stylizedPngWidth: stylizedW,
      stylizedPngHeight: stylizedH,
      pngGeneratedAt: new Date(),
      llmProvider: gen.provider,
      llmModel: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      cost: gen.cost,
    },
    update: {
      caption,
      mermaidSyntax,
      svgContent: cleanSvg,
      svgS3Key: svgKey,
      pngS3Key: pngKey,
      pngWidth: light.width,
      pngHeight: light.height,
      pngDarkS3Key: pngDarkKey,
      pngDarkWidth: darkW,
      pngDarkHeight: darkH,
      stylizedPngS3Key: stylizedKey,
      stylizedPngWidth: stylizedW,
      stylizedPngHeight: stylizedH,
      pngGeneratedAt: new Date(),
      llmProvider: gen.provider,
      llmModel: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      cost: gen.cost,
    },
  })

  const pngUrl = getCdnUrl(pngKey)
  const existingMedia = await prisma.media.findFirst({
    where: { userId: sitePage.userId, s3Key: pngKey },
  })
  if (existingMedia) {
    await prisma.media.update({
      where: { id: existingMedia.id },
      data: {
        url: pngUrl,
        title: section.heading,
        altText: altText ?? section.heading,
        mimeType: 'image/png',
        width: light.width,
        height: light.height,
        jobId,
        source: 'diagram',
        deletedAt: null,
      },
    })
  } else {
    await prisma.media.create({
      data: {
        userId: sitePage.userId,
        s3Key: pngKey,
        url: pngUrl,
        source: 'diagram',
        title: section.heading,
        altText: altText ?? section.heading,
        mimeType: 'image/png',
        width: light.width,
        height: light.height,
        jobId,
      },
    }).catch(() => {/* non-fatal */})
  }

  // Prefer the branded, AI-restyled 1:1 image; fall back to the SVG (browsers
  // render it natively and it's AI-crawlable text). PNG is kept for bundle/email.
  const svgDims = extractSvgViewBoxDimensions(cleanSvg)
  const useStylized = !!stylizedKey
  const figureImgUrl = useStylized ? getCdnUrl(stylizedKey!) : svgUrl
  const figureWidth = useStylized ? stylizedW ?? undefined : svgDims?.width
  const figureHeight = useStylized ? stylizedH ?? undefined : svgDims?.height
  figuresToInsert.push({
    afterH2Offset: section.afterH2Offset,
    figureHtml: buildFigureHtml({
      imgUrl: figureImgUrl,
      diagramId: `${jobId.slice(0, 8)}-${section.position}`,
      alt: section.heading,
      altText,
      caption,
      width: figureWidth,
      height: figureHeight,
    }),
  })

  logger.info({ jobId, position: section.position, figureImgUrl, stylized: useStylized }, '[enrichment] diagram saved')
}

async function finishEnrichment(
  jobId: string,
  sitePageId: string,
  enrichedHtml: string,
  keyTakeawaysHtml: string | null,
  tocHtml: string | null,
  cost: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  // 1. Append `?` to question-phrased headings.
  // 2. Title-case all h1–h4 text so body headings match the TOC labels.
  const normalizedHtml = normalizeHeadingCase(normalizeH2Questions(enrichedHtml))

  await prisma.sitePage.update({
    where: { id: sitePageId },
    data: {
      bodyHtml: normalizedHtml,
      enrichmentStatus: 'completed',
      enrichedAt: new Date(),
      enrichmentError: null,
      keyTakeawaysHtml,
      tocHtml,
    },
  })

  await prisma.articleJob.update({
    where: { id: jobId },
    data: {
      status: 'enriched',
      enrichedAt: new Date(),
      totalCost: { increment: cost },
      totalTokens: { increment: inputTokens + outputTokens },
      currentStep: 25,
    },
  })

  // Final Google-guidelines check on the ENRICHED body (parity batch B) —
  // best-effort enqueue: a queue hiccup must never fail enrichment.
  try {
    const boss = await getBoss()
    await boss.send(QUEUES.FINAL_QUALITY_CHECK, { jobId }, { singletonKey: `final-quality-${jobId}-${Date.now()}` })
  } catch (err) {
    logger.warn({ jobId, err }, '[enrichment] final-quality enqueue failed (article stays reviewable)')
  }

  logger.info({ jobId, cost }, '[enrichment] article enriched successfully')
}
