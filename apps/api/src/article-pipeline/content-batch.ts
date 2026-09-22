/**
 * Bulk content generation from the content plan.
 *
 * A ContentBatch holds article + newsletter items that run SEQUENTIALLY (one per
 * account at a time, to smooth cost + LLM rate limits). `advanceBatch` is the
 * state machine — called once when the batch is created and again on each monitor
 * tick: it marks finished items, starts the next pending one, and when all are
 * ready/flagged sends a single "ready to review" email.
 *
 *   article item  → ArticleJob → Phase A → quality gate → enrichment
 *                   ready = ArticleJob.status 'enriched'; flagged = 'needs_review'
 *   newsletter item → Newsletter → ready = status 'ready_for_review'
 */
import { prisma, type ResolvedAccount } from '@omniply/shared'
import { getBoss, QUEUES } from '../queues/index'
import { logger } from '../lib/logger'
import { sendTransactionalEmail } from '../lib/alerts'
import { omniplyTabLink } from '../lib/omniply-link'
import { resolveNewsletterTopicForDate } from '../newsletter/resolve'

/** A generating item older than this (no completion) is presumed dead → failed. */
const ITEM_TIMEOUT_MS = 45 * 60 * 1000

function dayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 86400000)
  return { start, end }
}

/**
 * Create a batch from selected dates. For each date: pick the account's article
 * primary (a scheduled Topic, else materialize the admin calendar suggestion)
 * and the newsletter topic. Returns the batch id, or null if nothing to generate.
 */
export async function createBatchFromDates(
  account: ResolvedAccount,
  dates: string[],
): Promise<{ batchId: string; itemCount: number } | null> {
  const acct = await prisma.account.findUnique({
    where: { id: account.accountId },
    select: { articleCalendarId: true, vertical: true },
  })
  const owner = await prisma.user.findUnique({
    where: { id: account.ownerUserId },
    select: { newsletterCalendarId: true },
  })

  const items: Array<{
    kind: 'article' | 'newsletter'
    date: Date
    topicId?: string
    newsletterTopicId?: string
  }> = []

  for (const date of dates) {
    const { start, end } = dayBounds(date)

    // Article: a scheduled Topic wins; else adopt the admin calendar suggestion.
    const scheduled = await prisma.topic.findFirst({
      where: {
        userId: account.userId, // extension → account members
        scheduledDate: { gte: start, lt: end },
        status: { not: 'idea' },
        mode: { in: ['article_first', 'article_only'] },
      },
      select: { id: true, articleJobs: { where: { status: { not: 'failed' } }, select: { id: true }, take: 1 } },
    })
    if (scheduled) {
      // Idempotence: a topic that already has a live/completed job is done —
      // never regenerate it (payment bursts may re-offer already-handled days).
      if (scheduled.articleJobs.length === 0) {
        items.push({ kind: 'article', date: start, topicId: scheduled.id })
      }
    } else if (acct?.articleCalendarId) {
      const cal = await prisma.articleCalendarTopic.findFirst({
        where: { calendarId: acct.articleCalendarId, date: { gte: start, lt: end } },
        select: { topic: true, angle: true, keywords: true, outlineFrameworkNumber: true },
      })
      if (cal) {
        // Azavea-gated (vertical-platform plan): the azavea vertical's
        // calendar angles carry the belief-arc brief + pinned framework, so
        // they must reach the Topic. Clinic calendars ALSO have angles, but
        // mapping them would change existing clinic output — deliberate
        // no-op there until decided separately (see azavea-own-content notes).
        const isAzavea = acct.vertical === 'azavea'
        const brief = isAzavea
          ? [cal.angle, cal.keywords.length ? `Target keywords: ${cal.keywords.join(', ')}` : null]
              .filter(Boolean)
              .join('\n\n') || null
          : null
        const planned = await prisma.topic.create({
          data: {
            userId: account.userId,
            topic: cal.topic,
            scheduledDate: start,
            status: 'pending',
            source: 'article_calendar',
            mode: 'article_first',
            ...(isAzavea && brief ? { outlineSpecialInstructions: brief } : {}),
            ...(isAzavea && cal.outlineFrameworkNumber != null
              ? { outlineFrameworkNumber: cal.outlineFrameworkNumber, outlineFrameworkSource: 'calendar' }
              : {}),
          },
        })
        items.push({ kind: 'article', date: start, topicId: planned.id })
      }
    }

    // Newsletter: an account override wins, else the routed calendar's topic for the date.
    const nt = await resolveNewsletterTopicForDate(account.accountId, owner?.newsletterCalendarId ?? null, date)
    if (nt) items.push({ kind: 'newsletter', date: start, newsletterTopicId: nt.id })
  }

  if (items.length === 0) return null

  const batch = await prisma.contentBatch.create({
    data: {
      accountId: account.accountId,
      createdByUserId: account.userId,
      items: { create: items.map((i) => ({ ...i, status: 'pending' })) },
    },
    select: { id: true },
  })
  return { batchId: batch.id, itemCount: items.length }
}

type Item = {
  id: string
  kind: string
  topicId: string | null
  articleJobId: string | null
  newsletterTopicId: string | null
  newsletterId: string | null
  status: string
  updatedAt: Date
}

/** Start generating one item (idempotent). */
async function startItem(item: Item, ownerUserId: string): Promise<void> {
  const boss = await getBoss()
  if (item.kind === 'article') {
    if (item.articleJobId || !item.topicId) {
      await prisma.contentBatchItem.update({ where: { id: item.id }, data: { status: 'generating' } })
      return
    }
    const topic = await prisma.topic.findUnique({ where: { id: item.topicId }, select: { userId: true } })
    if (!topic) {
      await prisma.contentBatchItem.update({ where: { id: item.id }, data: { status: 'failed' } })
      return
    }
    const job = await prisma.articleJob.create({
      data: { topicId: item.topicId, userId: topic.userId, status: 'pending' },
    })
    // retryLimit 2 = parity with newsletters; cheap because the executor resumes
    // from completed steps (only failed steps re-run). See throughput plan 1f.
    await boss.send(
      QUEUES.ARTICLE_PIPELINE,
      { jobId: job.id },
      { expireInSeconds: 3600, singletonKey: job.id, retryLimit: 2, retryDelay: 120 },
    )
    await prisma.contentBatchItem.update({
      where: { id: item.id },
      data: { status: 'generating', articleJobId: job.id },
    })
  } else {
    // newsletter
    if (!item.newsletterTopicId) {
      await prisma.contentBatchItem.update({ where: { id: item.id }, data: { status: 'failed' } })
      return
    }
    const existing = await prisma.newsletter.findUnique({
      where: { userId_topicId: { userId: ownerUserId, topicId: item.newsletterTopicId } },
      select: { id: true, status: true },
    })
    let newsletterId: string
    if (existing) {
      // Already reviewed/approved → treat as ready, don't regenerate.
      if (existing.status !== 'failed' && existing.status !== 'pending') {
        await prisma.contentBatchItem.update({
          where: { id: item.id },
          data: { status: 'generating', newsletterId: existing.id },
        })
        return
      }
      newsletterId = existing.id
      await prisma.newsletter.update({ where: { id: existing.id }, data: { status: 'pending' } })
    } else {
      const created = await prisma.newsletter.create({
        data: { userId: ownerUserId, topicId: item.newsletterTopicId, status: 'pending' },
      })
      newsletterId = created.id
    }
    await boss.send(
      QUEUES.NEWSLETTER_GENERATE,
      { userId: ownerUserId, topicId: item.newsletterTopicId },
      { singletonKey: `nl-${ownerUserId}-${item.newsletterTopicId}`, retryLimit: 2, retryDelay: 60, expireInSeconds: 3600 },
    )
    await prisma.contentBatchItem.update({
      where: { id: item.id },
      data: { status: 'generating', newsletterId },
    })
  }
}

/** Check a generating item's underlying status → terminal state or null. */
async function checkItem(item: Item): Promise<'ready' | 'flagged' | 'failed' | null> {
  if (item.kind === 'article') {
    if (!item.articleJobId) return 'failed'
    const job = await prisma.articleJob.findUnique({ where: { id: item.articleJobId }, select: { status: true } })
    if (!job) return 'failed'
    if (job.status === 'enriched') return 'ready'
    if (job.status === 'needs_review') return 'flagged'
    if (job.status === 'failed') return 'failed'
    return null
  } else {
    if (!item.newsletterId) return 'failed'
    const nl = await prisma.newsletter.findUnique({ where: { id: item.newsletterId }, select: { status: true } })
    if (!nl) return 'failed'
    if (nl.status === 'ready_for_review' || nl.status === 'approved' || nl.status === 'scheduled') return 'ready'
    if (nl.status === 'failed') return 'failed'
    return null
  }
}

/**
 * Drive a batch forward: mark finished items, start the next pending one
 * (sequential), and finalize + email when everything is done.
 */
export async function advanceBatch(batchId: string): Promise<void> {
  const batch = await prisma.contentBatch.findUnique({
    where: { id: batchId },
    include: { items: { orderBy: { date: 'asc' } } },
  })
  if (!batch || batch.status !== 'running') return

  const owner = await prisma.user.findFirst({
    where: { accountId: batch.accountId },
    select: { id: true, accountId: true },
  })
  // Owner = the account's canonical user (its own ownerUserId).
  const account = await prisma.account.findUnique({
    where: { id: batch.accountId },
    select: { ownerUserId: true },
  })
  const ownerUserId = account?.ownerUserId ?? owner?.id ?? batch.createdByUserId

  // 1. Resolve currently-generating items (and time out dead ones).
  for (const item of batch.items.filter((i) => i.status === 'generating')) {
    const result = await checkItem(item as Item)
    if (result) {
      await prisma.contentBatchItem.update({ where: { id: item.id }, data: { status: result } })
    } else if (Date.now() - item.updatedAt.getTime() > ITEM_TIMEOUT_MS) {
      logger.warn({ batchId, itemId: item.id }, '[content-batch] item timed out → failed')
      await prisma.contentBatchItem.update({ where: { id: item.id }, data: { status: 'failed' } })
    }
  }

  // Reload after updates.
  const items = await prisma.contentBatchItem.findMany({
    where: { batchId },
    orderBy: { date: 'asc' },
  })
  const generating = items.filter((i) => i.status === 'generating')
  const pending = items.filter((i) => i.status === 'pending')

  // 2. Dual-lane advancement (.plans/production-throughput.implementation-plan.md 1h):
  // keep ONE article item AND ONE newsletter item generating concurrently — the
  // two kinds share no state, and the Phase-1 semaphores bound every real
  // resource. Within each kind, items stay serial (date order preserved for the
  // review flow; keeps Anthropic-cap contention sane).
  let started = false
  for (const kind of ['article', 'newsletter'] as const) {
    if (generating.some((i) => i.kind === kind)) continue
    const next = pending.find((i) => i.kind === kind)
    if (next) {
      await startItem(next as Item, ownerUserId)
      started = true
    }
  }
  if (started || generating.length > 0) return

  // 3. Finalize when nothing is left to do.
  if (generating.length === 0 && pending.length === 0) {
    const ready = items.filter((i) => i.status === 'ready').length
    const flagged = items.filter((i) => i.status === 'flagged').length
    const failed = items.filter((i) => i.status === 'failed').length
    await prisma.contentBatch.update({
      where: { id: batchId },
      data: { status: 'completed', completedAt: new Date() },
    })
    await sendBatchReadyEmail(batch.createdByUserId, ready, flagged, failed)
    logger.info({ batchId, ready, flagged, failed }, '[content-batch] completed')
  }
}

async function sendBatchReadyEmail(userId: string, ready: number, flagged: number, failed: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  if (!user?.email) return

  const lines = [`${ready} item(s) are ready for you to review and approve.`]
  if (flagged) lines.push(`${flagged} need a closer look (flagged by the quality check).`)
  if (failed) lines.push(`${failed} failed to generate.`)

  // One-click into the Omniply tab (GHL clients have no login on our app —
  // the old /dashboard link was a dead end for them).
  const { href, label } = await omniplyTabLink(userId)

  await sendTransactionalEmail({
    to: user.email,
    subject: `Your content is ready to review (${ready} ready${flagged ? `, ${flagged} flagged` : ''})`,
    html: `<p>Hi ${user.name ?? 'there'},</p><p>${lines.join('<br/>')}</p><p><a href="${href}">${label} — review &amp; approve →</a></p>`,
    text: `Hi ${user.name ?? 'there'},\n\n${lines.join('\n')}\n\n${label} — review & approve: ${href}`,
  }).catch(() => {})
}
