import type { FastifyInstance } from 'fastify'
import { prisma, resolveAccountForClerkId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { createBatchFromDates, advanceBatch } from '../article-pipeline/content-batch'
import { billingWindows } from '../article-pipeline/billing-window'
import { hasArticleCadenceDate, checkArticleGenerationGate, readStorySpiderStatus } from '../article-pipeline/client-stories/gate'
import { generationGateForUser } from '../lib/account-billing'

/**
 * Unified content plan: merges, per day, the account's planned ARTICLE topic and
 * NEWSLETTER topic for a date range (default: next 30 days).
 *
 * Article precedence for a day: a user-scheduled Topic (their own) wins; an
 * admin article-calendar topic is the fallback/suggestion. The non-chosen source
 * is returned as an "alternative" so the UI can offer a swap.
 */

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface ArticleEntry {
  source: 'scheduled' | 'article_calendar'
  topic: string
  topicId?: string // a real Topic (scheduled) — editable/generatable
  calendarTopicId?: string // an admin ArticleCalendarTopic suggestion
  status?: string
  jobId?: string
  jobStatus?: string
}

export async function contentPlanRoutes(app: FastifyInstance) {
  // GET /content-plan?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get<{ Querystring: { from?: string; to?: string } }>('/content-plan', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const acct = await prisma.account.findUnique({
      where: { id: account.accountId },
      select: { articleCalendarId: true, subscriptionStartedAt: true, vertical: true },
    })
    const owner = await prisma.user.findUnique({
      where: { id: account.ownerUserId },
      select: { newsletterCalendarId: true },
    })

    // Default window: billing-cycle-anchored (current + next cycle = 60-day
    // planning window) when the account has a subscription anchor date; the
    // legacy rolling-30-day-from-today window otherwise (unset accounts are
    // unaffected). Explicit ?from=/?to= query overrides always win — used by
    // admin/debug tooling, not by the dashboard's default fetch.
    let executableUntil: Date | null = null
    let from: Date
    let to: Date
    if (request.query.from || request.query.to) {
      from = request.query.from ? new Date(request.query.from) : new Date()
      from.setUTCHours(0, 0, 0, 0)
      to = request.query.to ? new Date(request.query.to) : new Date(from.getTime() + 29 * 86400000)
      to.setUTCHours(23, 59, 59, 999)
    } else if (acct?.subscriptionStartedAt) {
      const w = billingWindows(acct.subscriptionStartedAt)
      from = w.from
      to = w.to
      executableUntil = w.executableUntil
    } else {
      from = new Date()
      from.setUTCHours(0, 0, 0, 0)
      to = new Date(from.getTime() + 29 * 86400000)
      to.setUTCHours(23, 59, 59, 999)
    }

    const [scheduledTopics, articleCalTopics, newsletterCalTopics, newsletterOverrides, ideaCount] = await Promise.all([
      // User-scheduled article topics (account-scoped via the prisma extension).
      prisma.topic.findMany({
        where: {
          userId: account.userId, // extension → userId IN account members
          scheduledDate: { gte: from, lte: to },
          status: { not: 'idea' },
          mode: { in: ['article_first', 'article_only'] },
        },
        select: {
          id: true,
          topic: true,
          scheduledDate: true,
          status: true,
          articleJobs: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      acct?.articleCalendarId
        ? prisma.articleCalendarTopic.findMany({
            where: { calendarId: acct.articleCalendarId, date: { gte: from, lte: to } },
            select: { id: true, date: true, topic: true },
          })
        : Promise.resolve([]),
      owner?.newsletterCalendarId
        ? prisma.newsletterTopic.findMany({
            where: { calendarId: owner.newsletterCalendarId, date: { gte: from, lte: to } },
            select: { id: true, date: true, topic: true },
          })
        : Promise.resolve([]),
      // Account-scoped overrides — wins over the calendar suggestion for a date.
      prisma.newsletterTopic.findMany({
        where: { accountId: account.accountId, date: { gte: from, lte: to } },
        select: { id: true, date: true, topic: true },
      }),
      prisma.topic.count({ where: { userId: account.userId, status: 'idea' } }),
    ])

    // Override wins over the calendar suggestion, per date.
    const newsletterCalByDate = new Map<string, (typeof newsletterCalTopics)[number]>()
    for (const t of newsletterCalTopics) newsletterCalByDate.set(dateKey(t.date), t)
    const newsletterOverrideByDate = new Map<string, (typeof newsletterOverrides)[number]>()
    for (const t of newsletterOverrides) newsletterOverrideByDate.set(dateKey(t.date), t)
    const newsletterTopics = [...newsletterCalByDate.entries()]
      .filter(([key]) => !newsletterOverrideByDate.has(key))
      .map(([, t]) => t)
      .concat(newsletterOverrides)

    // Generated newsletters keyed by their source topic.
    const nlTopicIds = newsletterTopics.map((t) => t.id)
    const newsletters = nlTopicIds.length
      ? await prisma.newsletter.findMany({
          where: { userId: account.ownerUserId, topicId: { in: nlTopicIds } },
          select: { id: true, topicId: true, status: true },
        })
      : []
    const nlByTopic = new Map(newsletters.map((n) => [n.topicId, n]))

    // Index by date.
    const scheduledByDate = new Map<string, (typeof scheduledTopics)[number]>()
    for (const t of scheduledTopics) if (t.scheduledDate) scheduledByDate.set(dateKey(t.scheduledDate), t)
    const articleCalByDate = new Map<string, (typeof articleCalTopics)[number]>()
    for (const t of articleCalTopics) articleCalByDate.set(dateKey(t.date), t)
    const nlByDate = new Map<string, (typeof newsletterTopics)[number]>()
    for (const t of newsletterTopics) nlByDate.set(dateKey(t.date), t)
    const overrideDateKeys = new Set([...newsletterOverrideByDate.keys()])

    // Build a contiguous day list.
    const days: Array<{
      date: string
      article: { primary: ArticleEntry | null; alternatives: ArticleEntry[] }
      newsletter: { topic: string; newsletterTopicId: string; newsletterId?: string; status?: string; isOverride: boolean } | null
    }> = []

    for (let ts = from.getTime(); ts <= to.getTime(); ts += 86400000) {
      const key = dateKey(new Date(ts))
      const scheduled = scheduledByDate.get(key)
      const cal = articleCalByDate.get(key)

      let primary: ArticleEntry | null = null
      const alternatives: ArticleEntry[] = []
      if (scheduled) {
        primary = {
          source: 'scheduled',
          topic: scheduled.topic,
          topicId: scheduled.id,
          status: scheduled.status,
          jobId: scheduled.articleJobs[0]?.id,
          jobStatus: scheduled.articleJobs[0]?.status,
        }
        if (cal) alternatives.push({ source: 'article_calendar', topic: cal.topic, calendarTopicId: cal.id })
      } else if (cal) {
        primary = { source: 'article_calendar', topic: cal.topic, calendarTopicId: cal.id }
      }

      const nl = nlByDate.get(key)
      const nlRow = nl ? nlByTopic.get(nl.id) : undefined

      days.push({
        date: key,
        article: { primary, alternatives },
        newsletter: nl
          ? {
              topic: nl.topic,
              newsletterTopicId: nl.id,
              newsletterId: nlRow?.id,
              status: nlRow?.status,
              isOverride: overrideDateKeys.has(key),
            }
          : null,
      })
    }

    // Story-spider status hint for the dashboard (Phase 6) — read-only, never triggers a run.
    const storySpiderStatus = acct?.subscriptionStartedAt
      ? await readStorySpiderStatus(account.accountId, billingWindows(acct.subscriptionStartedAt).from)
      : 'not_configured'

    return reply.send({
      from: dateKey(from),
      to: dateKey(to),
      vertical: acct?.vertical ?? 'chiro',
      days,
      ideaCount,
      executableUntil: executableUntil ? dateKey(executableUntil) : null,
      storySpiderStatus,
    })
  })

  // POST /content-plan/generate { dates: string[] } — bulk generate selected days.
  app.post<{ Body: { dates?: string[] } }>('/content-plan/generate', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const requestedDates = (request.body?.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (requestedDates.length === 0) return reply.status(400).send({ error: 'No valid dates provided' })

    // Lifecycle gate: paused/cancelled accounts never generate (status governs
    // generation — .plans/multi-tenancy-hardening.implementation-plan.md Phase A).
    const lifecycleGate = await generationGateForUser(account.userId)
    if (!lifecycleGate.allowed) return reply.status(402).send({ error: lifecycleGate.reason })

    // Production gate: independent of whatever the frontend disabled — a date
    // beyond the account's current paid cycle cannot be generated, only planned.
    // Not just a UX nicety; this is the actual enforcement point (see
    // .plans/content-plan-billing-window.implementation-plan.md Phase 3).
    const acctBilling = await prisma.account.findUnique({
      where: { id: account.accountId },
      select: { subscriptionStartedAt: true },
    })
    let dates = requestedDates
    let skippedDates: string[] = []
    if (acctBilling?.subscriptionStartedAt) {
      const executableUntilKey = dateKey(billingWindows(acctBilling.subscriptionStartedAt).executableUntil)
      dates = requestedDates.filter((d) => d <= executableUntilKey)
      skippedDates = requestedDates.filter((d) => d > executableUntilKey)
    }
    if (dates.length === 0) {
      return reply.status(400).send({
        error: 'Selected day(s) are beyond your current billing cycle — you can plan them, but not generate yet.',
        skippedDates,
      })
    }

    // Client-story gate: article dates only (see
    // .plans/client-story-review-mining.implementation-plan.md Phase 6) — a
    // newsletter-only batch never waits on review-spidering. Also the on-demand
    // trigger: if no run exists yet for this cycle, this call creates one.
    if (hasArticleCadenceDate(dates) && acctBilling?.subscriptionStartedAt) {
      const brand = await prisma.brandSettings.findFirst({
        where: { user: { accountId: account.accountId } },
        select: { googleBusinessProfileUrl: true },
      })
      if (brand?.googleBusinessProfileUrl?.trim()) {
        const cycleStart = billingWindows(acctBilling.subscriptionStartedAt).from
        const waitMessage = await checkArticleGenerationGate(account.accountId, cycleStart)
        if (waitMessage) return reply.status(409).send({ error: waitMessage })
      }
    }

    const created = await createBatchFromDates(account, dates)
    if (!created) return reply.status(400).send({ error: 'Nothing to generate on the selected days.' })

    // Kick off the first item immediately; the monitor cron drives the rest.
    await advanceBatch(created.batchId)
    return reply.status(202).send({
      batchId: created.batchId,
      itemCount: created.itemCount,
      ...(skippedDates.length > 0 ? { skippedDates } : {}),
    })
  })

  // GET /review-inbox — items ready to review + flagged, for the account.
  app.get('/review-inbox', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const [readyArticles, flaggedArticles, readyNewsletters, socialReadyRuns] = await Promise.all([
      prisma.articleJob.findMany({
        where: { userId: account.userId, status: 'enriched' }, // extension → account members
        select: {
          id: true,
          topic: { select: { topic: true } },
          sitePage: { select: { title: true } },
          enrichedAt: true,
          finalQualityVerdict: true,
        },
        orderBy: { enrichedAt: 'desc' },
        take: 50,
      }),
      prisma.articleJob.findMany({
        where: { userId: account.userId, status: 'needs_review' },
        select: { id: true, topic: { select: { topic: true } }, qualityVerdict: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.newsletter.findMany({
        where: { userId: account.ownerUserId, status: 'ready_for_review' },
        select: { id: true, topic: { select: { topic: true } }, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      // Social posts awaiting approval — 'ready' is the generation-complete preview
      // state (see social/automation/run.ts finalizeGenerationCounts). The dashboard
      // currently has no visibility into this at all; surfaced here so it can offer a
      // second "Review Social Posts" action alongside content approval.
      prisma.socialAutomationRun.findMany({
        where: { userId: account.userId, status: 'ready' }, // extension → account members
        select: { jobId: true, newsletterId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ])

    // Dedupe — a run only ever has one of jobId/newsletterId set, but multiple runs
    // could theoretically exist per article/newsletter over time.
    const socialReadyArticleJobIds = [...new Set(
      socialReadyRuns.map((r) => r.jobId).filter((id): id is string => !!id),
    )]
    const socialReadyNewsletterIds = [...new Set(
      socialReadyRuns.map((r) => r.newsletterId).filter((id): id is string => !!id),
    )]

    // Articles with an open edit request assigned to the CURRENT user (the teammate).
    const myEditReqs = await prisma.articleEditRequest.findMany({
      where: { assigneeUserId: account.userId, status: 'open' },
      select: { sitePage: { select: { jobId: true, title: true } } },
    })
    const assignedSeen = new Set<string>()
    const assignedToMe: Array<{ jobId: string; title: string }> = []
    for (const r of myEditReqs) {
      const jobId = r.sitePage?.jobId
      if (jobId && !assignedSeen.has(jobId)) {
        assignedSeen.add(jobId)
        assignedToMe.push({ jobId, title: r.sitePage?.title ?? 'Article' })
      }
    }

    return reply.send({
      articles: readyArticles.map((a) => {
        // Automated final Google-guidelines verdict (parity batch B): the
        // review UI badges pass/fail and offers the rewrite remedy inline.
        const fq = a.finalQualityVerdict as { verdict?: string; reasons?: string[] } | null
        return {
          jobId: a.id,
          title: a.sitePage?.title ?? a.topic.topic,
          at: a.enrichedAt,
          finalQuality: fq ? { verdict: fq.verdict ?? 'error', reasons: fq.reasons ?? [] } : null,
        }
      }),
      newsletters: readyNewsletters.map((n) => ({
        newsletterId: n.id,
        title: n.topic.topic,
        at: n.updatedAt,
      })),
      flagged: flaggedArticles.map((a) => ({
        jobId: a.id,
        title: a.topic.topic,
        reasons: (a.qualityVerdict as { reasons?: string[] } | null)?.reasons ?? [],
        at: a.createdAt,
      })),
      assignedToMe,
      socialReady: {
        articleJobIds: socialReadyArticleJobIds,
        newsletterIds: socialReadyNewsletterIds,
      },
    })
  })
}
