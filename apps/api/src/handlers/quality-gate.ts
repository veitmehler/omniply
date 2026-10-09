import PgBoss from 'pg-boss'
import type { Prisma } from '@prisma/client'
import { logger } from '../lib/logger'
import { Sentry } from '../lib/sentry'
import { prisma } from '@omniply/shared'
import { runQualityCheck, rewriteArticleBody, type QualityVerdict } from '../article-pipeline/quality-gate'
import { approveArticleJob } from '../article-pipeline/approval-service'
import { sendFailureAlert } from '../lib/alerts'

export interface QualityGateJobData {
  jobId: string
}

/** Max automatic rewrite attempts before routing to human review. */
const MAX_ATTEMPTS = 2

/**
 * Auto quality gate: evaluate the Phase A body, then either auto-approve (→ Phase
 * B + enrichment), rewrite + re-gate, or flag for human review after MAX_ATTEMPTS.
 */
export async function qualityGateHandler(jobs: PgBoss.Job<QualityGateJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { jobId } = job.data
    logger.info({ jobId, pgBossJobId: job.id }, '[quality-gate] running')

    const articleJob = await prisma.articleJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, qualityAttempts: true },
    })
    if (!articleJob) {
      logger.warn({ jobId }, '[quality-gate] job not found — skipping')
      continue
    }
    // Only gate jobs that finished Phase A and aren't already past the gate.
    if (!['reviewing', 'completed', 'needs_review'].includes(articleJob.status)) {
      logger.info({ jobId, status: articleJob.status }, '[quality-gate] not in a gateable state — skipping')
      continue
    }

    let verdict: QualityVerdict
    try {
      verdict = await runQualityCheck(jobId)
    } catch (err) {
      // LLM/eval failure — don't silently ship. Flag for human review.
      logger.error({ jobId, err }, '[quality-gate] evaluation failed')
      Sentry.captureException(err, { tags: { queue: 'article-quality-gate', jobId } })
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { status: 'needs_review', qualityStatus: 'error' },
      })
      await sendFailureAlert({
        jobId,
        errorType: 'quality_gate_error',
        message: 'Quality gate evaluation failed; article routed to human review.',
        context: { error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {})
      continue
    }

    await prisma.articleJob.update({
      where: { id: jobId },
      data: { qualityStatus: verdict.verdict, qualityVerdict: verdict as unknown as Prisma.InputJsonValue },
    })
    logger.info({ jobId, verdict: verdict.verdict, severity: verdict.severity }, '[quality-gate] verdict')

    if (verdict.verdict === 'pass') {
      // Auto-approve → Phase B (SEO/image/schema/excerpt) → enqueues enrichment.
      try {
        await approveArticleJob(jobId)
        logger.info({ jobId }, '[quality-gate] passed — auto-approved')
      } catch (err) {
        logger.error({ jobId, err }, '[quality-gate] auto-approve failed')
        Sentry.captureException(err, { tags: { queue: 'article-quality-gate', jobId, phase: 'auto-approve' } })
        throw err // let pg-boss retry the approval
      }
      continue
    }

    // revise / fail → rewrite + re-gate, bounded by MAX_ATTEMPTS.
    const attempts = articleJob.qualityAttempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { status: 'needs_review', qualityStatus: 'needs_review', qualityAttempts: attempts },
      })
      await sendFailureAlert({
        jobId,
        errorType: 'article_needs_review',
        message: `Article failed the quality gate after ${attempts} attempts — needs human review.`,
        context: {
          verdict: verdict.verdict,
          reasons: verdict.reasons,
          releaseAt: `https://chiro.omniply.io/admin/articles/${jobId}`,
        },
      }).catch(() => {})
      logger.info({ jobId, attempts }, '[quality-gate] max attempts reached — needs_review')
      continue
    }

    const rewritten = await rewriteArticleBody(jobId, verdict.reasons)
    await prisma.articleJob.update({
      where: { id: jobId },
      data: { qualityAttempts: attempts, status: 'reviewing' },
    })
    if (!rewritten) {
      // Couldn't rewrite — go straight to human review.
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { status: 'needs_review', qualityStatus: 'needs_review' },
      })
      await sendFailureAlert({
        jobId,
        errorType: 'article_needs_review',
        message: 'Article needs revision but the automatic rewrite failed — needs human review.',
        context: {
          reasons: verdict.reasons,
          releaseAt: `https://chiro.omniply.io/admin/articles/${jobId}`,
        },
      }).catch(() => {})
      continue
    }

    // Re-gate the rewritten body with a fresh job.
    const { getBoss, QUEUES } = await import('../queues/index')
    const boss = await getBoss()
    await boss.send(QUEUES.ARTICLE_QUALITY_GATE, { jobId })
    logger.info({ jobId, attempts }, '[quality-gate] rewritten — re-queued for re-gate')
  }
}
