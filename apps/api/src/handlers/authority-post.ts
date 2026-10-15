import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getBoss, QUEUES } from '../queues/index'
import { SOCIAL_GENERATE_EXPIRE_SECONDS } from '../social/automation/enqueue'
import { generationGateForUser } from '../lib/account-billing'

/**
 * Authority engine cadence (.plans/authority-content-engine plan, v1):
 * one typed authority post per day per azavea account, sourced from the
 * oldest published article that hasn't fed one yet. The run (slotVariant
 * 'authority') flows through the normal SOCIAL_GENERATE queue — see
 * social/automation/authority-processor.ts — and lands in the existing
 * approval UI on the source article. When the article pool is dry the cron
 * no-ops (v2 adds typed beats as a second source).
 *
 * Kill-switch: AUTHORITY_ENGINE_ENABLED=0.
 */
export async function authorityPostHandler(_jobs: PgBoss.Job<object>[]): Promise<void> {
  if (process.env.AUTHORITY_ENGINE_ENABLED === '0') {
    logger.info({}, '[authority-cron] disabled via AUTHORITY_ENGINE_ENABLED=0')
    return
  }

  const accounts = await prisma.account.findMany({
    where: { vertical: 'azavea', status: 'active' },
    select: { id: true, ownerUserId: true },
  })
  const today = new Date().toISOString().slice(0, 10)
  const boss = await getBoss()

  for (const account of accounts) {
    const userId = account.ownerUserId
    if (!userId) continue
    try {
      const gate = await generationGateForUser(userId)
      if (!gate.allowed) {
        logger.info({ accountId: account.id, reason: gate.reason }, '[authority-cron] generation gate closed')
        continue
      }

      // Idempotent per posting day: one authority run per account per date.
      const todayRun = await prisma.socialAutomationRun.findFirst({
        where: { userId, slotVariant: 'authority', scheduledDate: today, status: { notIn: ['failed', 'cancelled'] } },
        select: { id: true },
      })
      if (todayRun) continue

      // Source pool: published articles that haven't fed an authority post.
      const usedRuns = await prisma.socialAutomationRun.findMany({
        where: { userId, slotVariant: 'authority', status: { notIn: ['failed', 'cancelled'] }, jobId: { not: null } },
        select: { jobId: true },
      })
      const usedJobIds = usedRuns.map((r) => r.jobId).filter((j): j is string => !!j)

      const candidates = await prisma.articleJob.findMany({
        where: { userId, status: { in: ['published', 'exported'] }, id: { notIn: usedJobIds } },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: { id: true },
      })

      let picked: { jobId: string; sitePageId: string } | null = null
      for (const c of candidates) {
        const page = await prisma.sitePage.findFirst({ where: { jobId: c.id }, select: { id: true } })
        if (page) {
          picked = { jobId: c.id, sitePageId: page.id }
          break
        }
      }
      if (!picked) {
        logger.info({ accountId: account.id }, '[authority-cron] no unused published article — pool dry, skipping')
        continue
      }

      const run = await prisma.socialAutomationRun.create({
        data: {
          userId,
          jobId: picked.jobId,
          sitePageId: picked.sitePageId,
          scheduledDate: today,
          slotVariant: 'authority',
          status: 'pending',
          totalSpecs: 1,
          groupId: `${picked.jobId}-authority`,
        },
      })
      await boss.send(
        QUEUES.SOCIAL_GENERATE,
        { runId: run.id },
        { singletonKey: `social-generate-${picked.jobId}-authority`, expireInSeconds: SOCIAL_GENERATE_EXPIRE_SECONDS },
      )
      logger.info({ accountId: account.id, runId: run.id, jobId: picked.jobId, today }, '[authority-cron] run enqueued')
    } catch (err) {
      logger.error({ accountId: account.id, err }, '[authority-cron] failed')
    }
  }
}
