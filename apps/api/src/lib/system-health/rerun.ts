/**
 * System Health: re-run the work that failed while a service was down.
 *
 * Started only by an admin pressing the button on the dashboard; nothing here
 * runs by itself. Articles get a fresh job on their existing topic, exactly as
 * the calendar would create one, spaced a minute apart like a calendar burst so
 * seventeen articles do not all open at once. Failed newsletter editions go
 * back to pending and are queued under their usual key.
 *
 * Refused while a service the work needs is still out (buildSystemHealth's
 * rerun guard), and skipped per account when that account may not generate.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../logger'
import { getBoss, QUEUES } from '../../queues/index'
import { generationGateForUser } from '../account-billing'

const DAY = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 45
/** Seconds between article starts within one re-run. */
const ARTICLE_SPACING_S = 60

export interface RerunResult {
  articles: number
  newsletters: number
  skippedAccounts: string[]
}

/** Topics whose every job in the window failed: one entry per topic, with its owner. */
export async function failedArticleTopics(userId?: string): Promise<Array<{ topicId: string; userId: string }>> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY)
  const failed = await prisma.articleJob.findMany({
    where: { status: 'failed', createdAt: { gte: since }, ...(userId ? { userId } : {}) },
    select: { topicId: true, userId: true },
    orderBy: { createdAt: 'asc' },
  })
  const topicIds = [...new Set(failed.map((f) => f.topicId))]
  if (topicIds.length === 0) return []
  // A topic with a job that did not fail, or one already waiting or running, is left alone.
  const alive = new Set(
    (await prisma.articleJob.findMany({ where: { topicId: { in: topicIds }, status: { not: 'failed' } }, select: { topicId: true } })).map((r) => r.topicId),
  )
  const seen = new Set<string>()
  const out: Array<{ topicId: string; userId: string }> = []
  for (const f of failed) {
    if (alive.has(f.topicId) || seen.has(f.topicId)) continue
    seen.add(f.topicId)
    out.push({ topicId: f.topicId, userId: f.userId })
  }
  return out
}

export async function rerunFailedWork(opts: { userId?: string } = {}): Promise<RerunResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY)
  const topics = await failedArticleTopics(opts.userId)
  const newsletters = await prisma.newsletter.findMany({
    where: { status: 'failed', createdAt: { gte: since }, ...(opts.userId ? { userId: opts.userId } : {}) },
    select: { id: true, userId: true, topicId: true },
  })

  const gates = new Map<string, boolean>()
  const allowed = async (userId: string) => {
    if (!gates.has(userId)) gates.set(userId, (await generationGateForUser(userId)).allowed)
    return gates.get(userId)!
  }

  const boss = await getBoss()
  let articles = 0
  for (const t of topics) {
    if (!(await allowed(t.userId))) continue
    const job = await prisma.articleJob.create({ data: { topicId: t.topicId, userId: t.userId, status: 'pending' } })
    await boss.send(
      QUEUES.ARTICLE_PIPELINE,
      { jobId: job.id },
      { expireInSeconds: 3600, singletonKey: job.id, retryLimit: 2, retryDelay: 120, startAfter: articles * ARTICLE_SPACING_S },
    )
    articles++
  }

  let nl = 0
  for (const n of newsletters) {
    if (!(await allowed(n.userId))) continue
    await prisma.newsletter.update({ where: { id: n.id }, data: { status: 'pending' } })
    await boss.send(
      QUEUES.NEWSLETTER_GENERATE,
      { userId: n.userId, topicId: n.topicId },
      { singletonKey: `nl-${n.userId}-${n.topicId}`, retryLimit: 2, retryDelay: 60, expireInSeconds: 3600 },
    )
    nl++
  }

  const skippedAccounts = [...gates.entries()].filter(([, ok]) => !ok).map(([id]) => id)
  logger.info({ articles, newsletters: nl, skippedAccounts, scope: opts.userId ?? 'all' }, '[system-health] failed work re-queued by an admin')
  return { articles, newsletters: nl, skippedAccounts }
}
