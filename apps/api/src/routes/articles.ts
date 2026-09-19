import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma, ghlSettingsForUser } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { runPipelinePhaseA } from '../article-pipeline/executor'
import { triggerArticleRewrite } from '../article-pipeline/rewrite-trigger'
import { approveArticleJob } from '../article-pipeline/approval-service'
import { getBoss, QUEUES } from '../queues/index'
import { VALID_TARGETS } from '../article-pipeline/output/registry'
import {
  injectHeadingIds,
  extractHeadingsForToc,
  buildTocHtml,
  findFirstH2Index,
} from '../article-pipeline/enrichment/html-parser'
import { readS3Object } from '@omniply/shared'
import { enqueueSyndication } from '../article-pipeline/syndication/enqueue'
import { enqueuePromoEmail } from '../article-pipeline/promo-email/enqueue'
import { enqueueSocialAutomation } from '../social/automation/enqueue'
import { enqueueSocialDispatch } from '../social/automation/enqueue-dispatch'
import { logger } from '../lib/logger'
import { verticalForUser } from '../lib/prompt-resolver'

function calculateReadingTimeFromHtml(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text.split(' ').filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

/**
 * Strips the existing static TOC (if any), rebuilds it from the current
 * headings, and re-injects it at the same position (before the first <h2>).
 * This keeps the export-ready bodyHtml in sync after preview edits.
 */
function regenerateToc(html: string): string {
  // 1. Remove existing TOC block.
  const stripped = html.replace(/<nav[^>]*\barticle-toc\b[^>]*>[\s\S]*?<\/nav>/gi, '')

  // 2. Inject/refresh heading IDs.
  const withIds = injectHeadingIds(stripped)

  // 3. Build new TOC from updated headings.
  const entries = extractHeadingsForToc(withIds)
  const tocHtml = buildTocHtml(entries)
  if (!tocHtml) return withIds

  // 4. Insert before the first <h2> (preserving position relative to key takeaways).
  const firstH2 = findFirstH2Index(withIds)
  if (firstH2 <= 0) return tocHtml + '\n' + withIds
  return withIds.slice(0, firstH2) + tocHtml + '\n' + withIds.slice(firstH2)
}

// Social-run states that count as "in flight" for the listing's Social Posts
// tab — everything from enqueue until the set is fully scheduled or failed.
const SOCIAL_ACTIVE_RUN_STATUSES = ['pending', 'processing', 'ready', 'scheduling']

export async function articleRoutes(app: FastifyInstance) {
  // ── GET /api/articles — list jobs for current user ────────────────────────
  app.get('/articles', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { status, limit = '20', offset = '0' } = request.query as {
      status?: string
      limit?: string
      offset?: string
    }

    // Phase B (approval chain) keeps DB status 'completed' while currentStep
    // runs 13+. The UI badges those as "Processing", so the status filter must
    // agree: surface them under 'approved' and exclude them from 'completed'.
    // 'social_active' is a virtual status: articles whose social-media set is
    // still in flight (generating, awaiting review, or scheduling).
    const statusFilter =
      status === 'approved'
        ? { OR: [{ status: 'approved' }, { status: 'completed', currentStep: { gte: 13 } }] }
        : status === 'completed'
          ? { status: 'completed', currentStep: { lt: 13 } }
          : status === 'social_active'
            ? { socialAutomationRuns: { some: { status: { in: SOCIAL_ACTIVE_RUN_STATUSES } } } }
            : status
              ? { status }
              : {}

    const jobs = await prisma.articleJob.findMany({
      where: {
        userId: user.id,
        ...statusFilter,
      },
      include: {
        topic: { select: { topic: true, mode: true } },
        _count: { select: { pipelineSteps: true, errorLogs: true } },
        // In-flight social set, if any — lets the listing show a live
        // creation/review/scheduling indicator per article.
        socialAutomationRuns: {
          where: { status: { in: SOCIAL_ACTIVE_RUN_STATUSES } },
          select: { status: true, completedSpecs: true, totalSpecs: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
    })

    return reply.send({ jobs })
  })

  // ── GET /api/articles/:jobId — job detail ─────────────────────────────────
  app.get<{ Params: { jobId: string } }>('/articles/:jobId', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      include: {
        topic: true,
        pipelineSteps: { orderBy: { stepNumber: 'asc' } },
        sitePage: {
          include: {
            featuredImage: { select: { id: true, url: true, altText: true } },
            diagrams: {
              select: {
                id: true,
                position: true,
                sectionTitle: true,
                caption: true,
                svgS3Key: true,
                pngS3Key: true,
                pngDarkS3Key: true,
              },
              orderBy: { position: 'asc' },
            },
          },
        },
        errorLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        llmUsage: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    })

    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    // Attach CDN URLs to diagrams so the frontend doesn't need to know the CDN base
    const cdnBase = (process.env.CDN_BASE ?? '').replace(/\/$/, '')

    // Belt-and-suspenders: if sitePage.citations hasn't been written yet by the
    // approval flow, derive it from the step 12 output so the "Review Content"
    // copy/paste area always has citations available pre-approval.
    let sitePageCitations = job.sitePage?.citations ?? null
    if (!sitePageCitations) {
      const step12 = job.pipelineSteps.find(
        (s) => s.stepNumber === 12 && s.status === 'completed' && s.output,
      )
      if (step12?.output) {
        try { sitePageCitations = JSON.parse(step12.output) } catch { /* ignore */ }
      }
    }

    const enrichedJob = {
      ...job,
      sitePage: job.sitePage
        ? {
            ...job.sitePage,
            citations: sitePageCitations,
            diagrams: (job.sitePage.diagrams ?? []).map((d) => ({
              ...d,
              cdnUrl: d.pngS3Key ? `${cdnBase}/${d.pngS3Key}` : null,
              svgCdnUrl: d.svgS3Key ? `${cdnBase}/${d.svgS3Key}` : null,
              darkCdnUrl: d.pngDarkS3Key ? `${cdnBase}/${d.pngDarkS3Key}` : null,
            })),
          }
        : null,
    }

    return reply.send({ job: enrichedJob })
  })

  // ── PATCH /api/articles/:jobId/content — editable preview saves ────────────
  app.patch<{ Params: { jobId: string } }>(
    '/articles/:jobId/content',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const sitePageRow = await prisma.sitePage.findFirst({
        where: { jobId, userId: user.id },
        select: { id: true },
      })
      if (!sitePageRow) return reply.status(404).send({ error: 'Article job not found' })

      const body = request.body as Record<string, unknown>
      const update: Prisma.SitePageUpdateInput = {}
      let hasField = false

      if (typeof body.bodyHtml === 'string') {
        const bodyWithToc = regenerateToc(body.bodyHtml)
        update.bodyHtml = bodyWithToc
        update.readingTime = calculateReadingTimeFromHtml(bodyWithToc)
        hasField = true
      }
      if (typeof body.seoTitle === 'string') {
        const t = body.seoTitle.trim()
        update.seoTitle = t
        update.title = t
        hasField = true
      }
      if (typeof body.seoDescription === 'string') {
        update.seoDescription = body.seoDescription.trim() || null
        hasField = true
      }
      if (typeof body.excerpt === 'string') {
        update.excerpt = body.excerpt.trim() || null
        hasField = true
      }

      if (!hasField) {
        return reply.status(400).send({ error: 'No valid fields to update' })
      }

      await prisma.sitePage.update({
        where: { id: sitePageRow.id },
        data: update,
      })

      return reply.send({ ok: true })
    },
  )

  // ── GET /api/articles/:jobId/events — SSE status stream ──────────────────
  app.get<{ Params: { jobId: string } }>('/articles/:jobId/events', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params

    // Verify ownership before starting the stream
    const ownership = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      select: { id: true },
    })
    if (!ownership) return reply.status(404).send({ error: 'Article job not found' })

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    // SSE keeps streaming through approval + enrichment; stops only at truly terminal states
    const TERMINAL_STATUSES = new Set(['enriched', 'failed'])
    let closed = false

    const sendEvent = (data: Record<string, unknown>) => {
      if (closed) return
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    const poll = async () => {
      try {
        const job = await prisma.articleJob.findUnique({
          where: { id: jobId },
          include: {
            pipelineSteps: {
              select: {
                stepNumber: true,
                stepName: true,
                status: true,
                cost: true,
                duration: true,
                completedAt: true,
              },
              orderBy: { stepNumber: 'asc' },
            },
          },
        })
        if (!job) {
          sendEvent({ type: 'error', message: 'Job not found' })
          end()
          return
        }

        sendEvent({
          type: 'update',
          status: job.status,
          currentStep: job.currentStep,
          totalCost: job.totalCost,
          totalTokens: job.totalTokens,
          steps: job.pipelineSteps,
        })

        if (TERMINAL_STATUSES.has(job.status)) {
          sendEvent({ type: 'done', status: job.status })
          end()
        }
      } catch (err) {
        sendEvent({ type: 'error', message: 'Polling failed' })
        end()
      }
    }

    const end = () => {
      if (closed) return
      closed = true
      clearInterval(intervalId)
      reply.raw.end()
    }

    // Send initial state immediately then poll every 2s
    await poll()
    const intervalId = setInterval(poll, 2000)

    request.raw.on('close', end)
    request.raw.on('error', end)

    // Fastify should not send its own response
    return reply
  })

  // ── POST /api/articles/:jobId/resume — resume a failed job ────────────────
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/resume', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    if (!['failed', 'pending'].includes(job.status)) {
      return reply.status(400).send({ error: `Cannot resume a job with status: ${job.status}` })
    }

    // Fire-and-forget — resume runs in the background
    runPipelinePhaseA(jobId).catch((err) => {
      request.log.error({ jobId, err }, '[articles] resume failed')
    })

    return reply.send({ ok: true, message: 'Pipeline resume started' })
  })

  // ── POST /api/articles/:jobId/approve — trigger Phase B approval chain ───
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/approve', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      select: { id: true, status: true },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    if (job.status !== 'completed') {
      return reply.status(400).send({
        error: `Cannot approve a job with status: ${job.status}. Job must be 'completed' first.`,
      })
    }

    // Fire-and-forget — approval runs in the background; client watches via SSE
    approveArticleJob(jobId).catch((err) => {
      request.log.error({ jobId, err }, '[articles] approval failed')
    })

    return reply.status(202).send({ ok: true, message: 'Approval chain started' })
  })

  // ── POST /api/articles/:jobId/re-enrich — retry enrichment from scratch ──
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/re-enrich', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      include: { sitePage: true },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    if (!['approved', 'enriched'].includes(job.status)) {
      return reply.status(400).send({
        error: `Cannot re-enrich a job with status: ${job.status}. Job must be 'approved' or 'enriched' (not published).`,
      })
    }

    if (job.sitePage) {
      // Wipe existing diagrams + GEO rows + restore original bodyHtml.
      // The worker also does this idempotently at run-start, but clearing here
      // gives immediate UI feedback before the job is even dequeued.
      await prisma.sectionEnrichment.deleteMany({ where: { sitePageId: job.sitePage.id } })
      await prisma.articleDiagram.deleteMany({ where: { sitePageId: job.sitePage.id } })
      await prisma.sitePage.update({
        where: { id: job.sitePage.id },
        data: {
          bodyHtml: job.sitePage.originalBodyHtml,
          enrichmentStatus: 'pending',
          enrichmentError: null,
          enrichedAt: null,
          keyTakeawaysHtml: null,
          tocHtml: null,
        },
      })
    }
    // Clear enrichment errors immediately so the Errors panel is empty while
    // the new run is queued — the worker will also clear them at run start.
    await prisma.errorLog.deleteMany({ where: { jobId, errorType: { startsWith: 'enrichment_' } } })

    await prisma.articleJob.update({
      where: { id: jobId },
      data: { status: 'approved', enrichedAt: null },
    })

    const boss = await getBoss()
    const enrichmentBossId = await boss.send(QUEUES.ARTICLE_ENRICHMENT, { jobId })
    if (enrichmentBossId) {
      await prisma.articleJob.update({ where: { id: jobId }, data: { enrichmentJobId: enrichmentBossId } })
    }

    return reply.status(202).send({ ok: true, message: 'Re-enrichment enqueued' })
  })

  // ── POST /api/articles/:jobId/publish — enriched → published (irreversible) ─
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/publish', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      include: {
        topic: { select: { publishingDate: true, scheduledDate: true, mode: true } },
        sitePage: { select: { id: true } },
      },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    if (job.status !== 'enriched') {
      return reply.status(400).send({
        error: `Cannot publish a job with status: ${job.status}. Job must be 'enriched' first.`,
      })
    }

    // Block publishing while a teammate still has open edit requests.
    if (job.sitePage?.id) {
      const openEdits = await prisma.articleEditRequest.count({
        where: { sitePageId: job.sitePage.id, status: 'open' },
      })
      if (openEdits > 0) {
        return reply.status(409).send({
          error: `Cannot publish: ${openEdits} edit request(s) are still open. Resolve them first.`,
        })
      }
    }

    await prisma.articleJob.update({
      where: { id: jobId },
      data: { status: 'published' },
    })

    // Fire-and-forget background generation — both are idempotent with dedup keys
    if (job.sitePage?.id) {
      const settings = await prisma.settings.findUnique({ where: { userId: user.id } })
      const publishingDate = job.topic.publishingDate ?? job.topic.scheduledDate ?? new Date() ?? new Date()

      enqueueSyndication(jobId, user.id).catch((err) =>
        logger.error({ jobId, err }, '[publish] failed to enqueue syndication'),
      )

      // AZAVEA VERTICAL ONLY: always publish internally on approval (the UI's
      // wordpress request is also substituted below; this covers publishes
      // where no WP connection exists). Skipped if an internal attempt is
      // already in flight or done.
      if ((await verticalForUser(user.id)) === 'azavea') {
        void (async () => {
          const existing = await prisma.outputAttempt.findFirst({
            where: { jobId, target: 'internal', status: { in: ['pending', 'success'] } },
          })
          if (existing) return
          const attempt = await prisma.outputAttempt.create({
            data: { jobId, userId: user.id, target: 'internal', status: 'pending', payloadHash: 'internal-auto' },
          })
          const boss = await getBoss()
          await boss.send(QUEUES.ARTICLE_OUTPUT, { jobId, target: 'internal', attemptId: attempt.id, config: {} })
        })().catch((err) => logger.error({ jobId, err }, '[publish] failed to enqueue internal publish'))
      }

      // Promotional email → GHL Email Campaign, scheduled for the publish day.
      // Gated on the global per-user setting; full config is re-checked in the worker.
      const ghl = await ghlSettingsForUser(user.id)
      if (ghl?.promoEmailEnabled && ghl.promoEmailTagId) {
        enqueuePromoEmail({ jobId, userId: user.id, publishingDate }).catch((err) =>
          logger.error({ jobId, err }, '[publish] failed to enqueue promo email'),
        )
      }

      // Skip the day's social set (3 feed + 3 stories via the weekly matrix —
      // see social/automation/weekly-matrix.ts) for "Article only" jobs, in
      // addition to the global socialAutomationEnabled setting. Syndication
      // (LinkedIn/Medium article) still runs — that's article distribution.
      // Dashboard→WP hand-off (Veit 2026-09-18): the client dashboard's
      // approve calls only /publish — the WordPress export used to require
      // the workflow page's explicit output call, so clinic articles never
      // reached their site from the dashboard flow. Auto-enqueue with
      // connection defaults (typically 'draft') when a connection exists.
      // Azavea publishes internally above; idempotent on existing attempts.
      if ((await verticalForUser(user.id)) !== 'azavea') {
        void (async () => {
          const conn = await prisma.wordPressConnection.findFirst({
            where: { userId: user.id },
            select: { id: true },
          })
          if (!conn) return
          const existing = await prisma.outputAttempt.findFirst({
            where: { jobId, target: 'wordpress', status: { in: ['pending', 'success'] } },
          })
          if (existing) return
          const attempt = await prisma.outputAttempt.create({
            data: { jobId, userId: user.id, target: 'wordpress', status: 'pending', payloadHash: 'dashboard-auto' },
          })
          const boss = await getBoss()
          // The wordpress target REQUIRES connectionId (no implicit fallback
          // to the user's only connection — learned from a failed attempt on
          // the live E2E). Topic-pinned connection wins, else the user's.
          const topicConn = await prisma.topic
            .findFirst({ where: { articleJobs: { some: { id: jobId } } }, select: { wordPressConnectionId: true } })
            .catch(() => null)
          await boss.send(QUEUES.ARTICLE_OUTPUT, {
            jobId,
            target: 'wordpress',
            attemptId: attempt.id,
            config: { connectionId: topicConn?.wordPressConnectionId ?? conn.id },
          })
          logger.info({ jobId }, '[publish] dashboard auto-enqueued WordPress export (connection defaults)')
        })().catch((err) => logger.error({ jobId, err }, '[publish] WP auto-export enqueue failed'))
      }

      if (settings?.socialAutomationEnabled !== false && job.topic.mode !== 'article_only') {
        enqueueSocialAutomation({
          userId: user.id,
          jobId,
          sitePageId: job.sitePage.id,
          publishingDate,
          timeZone: settings?.socialTimezone ?? 'America/New_York',
        }).catch((err) =>
          logger.error({ jobId, err }, '[publish] failed to enqueue social automation'),
        )
      }
    }

    return reply.send({ ok: true })
  })

  // ── POST /api/articles/:jobId/rewrite — re-run steps 7–12 only (completed) ─
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/rewrite', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
      select: { id: true, status: true },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    // Shared trigger (parity batch B): also accepts 'enriched' so the
    // review surface can request a rewrite of a ready article.
    const result = await triggerArticleRewrite(jobId)
    if (!result.ok) return reply.status(400).send({ error: result.error })
    return reply.send({ ok: true, message: 'Article rewrite started' })
  })

  // ── POST /api/articles/:jobId/output/:target ─────────────────────────────
  app.post<{
    Params: { jobId: string; target: string }
    Body: Record<string, unknown>
  }>('/articles/:jobId/output/:target', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId, target: requestedTarget } = request.params
    if (!VALID_TARGETS.includes(requestedTarget)) {
      return reply.status(400).send({ error: `Invalid target. Valid: ${VALID_TARGETS.join(', ')}` })
    }
    // AZAVEA VERTICAL ONLY: its essays publish internally (omniply.io/articles),
    // so a 'wordpress' request is substituted with 'internal'. Clinics are
    // untouched: their vertical never matches, and html/bundle pass through
    // for everyone (the clinic HTML download path stays exactly as-is).
    let target = requestedTarget
    if (requestedTarget === 'wordpress' && (await verticalForUser(user.id)) === 'azavea') {
      target = 'internal'
    }

    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })
    if (job.status !== 'published') {
      return reply.status(400).send({
        error: `Job must be published before exporting (current: ${job.status}). Click Publish on the workflow detail page first.`,
      })
    }

    const config = request.body ?? {}
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ jobId, target, config }))
      .digest('hex')
      .slice(0, 16)

    const attempt = await prisma.outputAttempt.create({
      data: {
        jobId,
        userId: user.id,
        target,
        status: 'pending',
        payloadHash,
      },
    })

    const boss = await getBoss()
    await boss.send(QUEUES.ARTICLE_OUTPUT, {
      jobId,
      target,
      attemptId: attempt.id,
      config,
    })

    return reply.status(202).send({ outputAttemptId: attempt.id })
  })

  // ── GET /api/articles/:jobId/output/attempts ──────────────────────────────
  app.get<{ Params: { jobId: string } }>('/articles/:jobId/output/attempts', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({ where: { id: jobId, userId: user.id } })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    const attempts = await prisma.outputAttempt.findMany({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
    })

    return reply.send({ attempts })
  })

  // ── GET /api/articles/:jobId/output/attempts/:attemptId ──────────────────
  app.get<{
    Params: { jobId: string; attemptId: string }
  }>('/articles/:jobId/output/attempts/:attemptId', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId, attemptId } = request.params
    const attempt = await prisma.outputAttempt.findFirst({
      where: { id: attemptId, jobId, userId: user.id },
    })
    if (!attempt) return reply.status(404).send({ error: 'Attempt not found' })

    return reply.send({ attempt })
  })

  // ── POST /api/articles/:jobId/rerun — full rerun from step 1 ─────────────
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/rerun', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params
    const job = await prisma.articleJob.findFirst({
      where: { id: jobId, userId: user.id },
    })
    if (!job) return reply.status(404).send({ error: 'Article job not found' })

    // Wipe completed steps so the executor starts fresh
    await prisma.pipelineStep.deleteMany({ where: { jobId } })
    await prisma.articleJob.update({
      where: { id: jobId },
      data: { status: 'pending', currentStep: 0, totalCost: 0, totalTokens: 0 },
    })

    runPipelinePhaseA(jobId).catch((err) => {
      request.log.error({ jobId, err }, '[articles] rerun failed')
    })

    return reply.send({ ok: true, message: 'Pipeline rerun started' })
  })

  // ── GET /api/articles/:jobId/citations-debug — inspect raw citation data ─
  // Temporary diagnostic endpoint. Returns the raw db citations field, the
  // step-12 pipeline output, and a sample of inline <a> hrefs from bodyHtml.
  // Safe to keep in production — read-only, auth-gated, reveals no secrets.
  app.get<{ Params: { jobId: string } }>(
    '/articles/:jobId/citations-debug',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
        include: {
          sitePage: { select: { citations: true, bodyHtml: true } },
          pipelineSteps: {
            where: { stepNumber: 12 },
            select: { stepNumber: true, status: true, output: true },
          },
        },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })

      // Extract a sample of external hrefs from bodyHtml for cross-checking
      const bodyHtml = job.sitePage?.bodyHtml ?? ''
      const hrefMatches = [...bodyHtml.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      const inlineLinks = hrefMatches.slice(0, 20).map((m) => ({
        url: m[1],
        text: m[2].replace(/<[^>]+>/g, '').trim().slice(0, 80),
      }))

      return reply.send({
        sitePage: {
          citations: job.sitePage?.citations ?? null,
          inlineLinksFromBody: inlineLinks,
          inlineLinkCount: hrefMatches.length,
        },
        step12: job.pipelineSteps[0] ?? null,
      })
    },
  )

  // ── GET /api/articles/:jobId/diagram-svg/:diagramId — proxy SVG from S3 ─
  // ── POST /api/articles/:jobId/syndication/generate ────────────────────────
  // Generates LinkedIn Article + Medium article from the published main article.
  // Enqueues async syndication generation. Idempotent — safe to call as manual retry.
  app.post<{ Params: { jobId: string } }>(
    '/articles/:jobId/syndication/generate',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
        select: { id: true, status: true },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })
      if (job.status !== 'published') {
        return reply.status(400).send({
          error: `Job must be published before generating platform articles (current: ${job.status})`,
        })
      }

      const result = await enqueueSyndication(jobId, user.id)
      return reply.status(result.enqueued ? 201 : 200).send(result)
    },
  )

  // ── GET /api/articles/:jobId/syndication ──────────────────────────────────
  app.get<{ Params: { jobId: string } }>(
    '/articles/:jobId/syndication',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })

      const articles = await prisma.syndicationArticle.findMany({
        where: { jobId, userId: user.id },
        select: {
          platform:     true,
          title:        true,
          content:      true,
          status:       true,
          errorMessage: true,
          createdAt:    true,
          inputTokens:  true,
          outputTokens: true,
          cost:         true,
          provider:     true,
          model:        true,
        },
        orderBy: { platform: 'asc' },
      })

      return reply.send({ articles })
    },
  )

  // ── GET /api/articles/:jobId/promo-email ──────────────────────────────────
  app.get<{ Params: { jobId: string } }>(
    '/articles/:jobId/promo-email',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
        select: { id: true },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })

      const campaign = await prisma.articleEmailCampaign.findUnique({
        where: { jobId },
        select: {
          subject:       true,
          bodyHtml:      true,
          status:        true,
          ghlCampaignId: true,
          tagName:       true,
          scheduledFor:  true,
          sentAt:        true,
          errorMessage:  true,
          createdAt:     true,
        },
      })

      return reply.send({ campaign })
    },
  )

  // ── GET /api/articles/:jobId/social-automation ────────────────────────────
  app.get<{ Params: { jobId: string } }>(
    '/articles/:jobId/social-automation',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
        select: { id: true },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })

      const runs = await prisma.socialAutomationRun.findMany({
        where: { jobId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          specResults: { orderBy: { slotKey: 'asc' } },
          _count: { select: { posts: true } },
        },
      })

      return reply.send({ runs })
    },
  )

  // ── POST /api/articles/:jobId/social-automation/:runId/approve ────────────
  app.post<{ Params: { jobId: string; runId: string } }>(
    '/articles/:jobId/social-automation/:runId/approve',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId, runId } = request.params
      const run = await prisma.socialAutomationRun.findFirst({
        where: { id: runId, jobId, userId: user.id },
      })
      if (!run) return reply.status(404).send({ error: 'Automation run not found' })

      const result = await enqueueSocialDispatch(runId)
      if (!result.enqueued) {
        return reply.status(400).send({ error: result.message ?? 'Dispatch not enqueued' })
      }
      return reply.status(202).send({ ok: true, enqueued: true })
    },
  )

  // ── POST /api/articles/:jobId/generate-social-set ─────────────────────────
  app.post<{ Params: { jobId: string } }>(
    '/articles/:jobId/generate-social-set',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId } = request.params
      const job = await prisma.articleJob.findFirst({
        where: { id: jobId, userId: user.id },
        include: {
          topic: true,
          sitePage: { select: { id: true } },
        },
      })
      if (!job) return reply.status(404).send({ error: 'Article job not found' })
      if (job.status !== 'published') {
        return reply.status(400).send({
          error: `Article must be published before generating social posts (current: ${job.status}). Click Publish first.`,
        })
      }
      if (!job.sitePage?.id) {
        return reply.status(400).send({ error: 'Article has no site page content yet' })
      }

      const settings = await prisma.settings.findUnique({ where: { userId: user.id } })
      const publishingDate = job.topic.publishingDate ?? job.topic.scheduledDate ?? new Date()

      const result = await enqueueSocialAutomation({
        userId: user.id,
        jobId: job.id,
        sitePageId: job.sitePage.id,
        publishingDate,
        timeZone: settings?.socialTimezone ?? 'America/New_York',
      })

      return reply.status(result.enqueued ? 202 : 200).send(result)
    },
  )

  // Avoids browser CORS restrictions when fetching SVG text content for
  // embedding in the Gemini review copy/paste area.
  app.get<{ Params: { jobId: string; diagramId: string } }>(
    '/articles/:jobId/diagram-svg/:diagramId',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { jobId, diagramId } = request.params

      const diagram = await prisma.articleDiagram.findFirst({
        where: { id: diagramId, sitePage: { jobId, userId: user.id } },
        select: { svgS3Key: true },
      })

      if (!diagram) return reply.status(404).send({ error: 'Diagram not found' })
      if (!diagram.svgS3Key) return reply.status(404).send({ error: 'SVG not available' })

      try {
        const { body, contentType } = await readS3Object(diagram.svgS3Key)
        return reply
          .header('Content-Type', contentType.includes('svg') ? 'image/svg+xml' : contentType)
          .header('Cache-Control', 'public, max-age=86400')
          .send(body)
      } catch (err) {
        request.log.error({ jobId, diagramId, err }, '[articles] diagram-svg proxy failed')
        return reply.status(502).send({ error: 'Failed to fetch SVG from storage' })
      }
    },
  )
}
