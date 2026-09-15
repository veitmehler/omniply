/**
 * FINAL quality check (parity batch B, Veit 2026-09-15): the automated
 * replacement for "paste the finished article into Gemini". Runs when
 * enrichment completes, evaluating the ENRICHED body — the thing Google
 * actually sees — with the same Google-guidelines evaluator + judge the
 * Phase-1 gate uses. On a substantive fail it auto-triggers ONE steps-7–12
 * rewrite (the identical remedy the Articles page offers) and re-checks
 * after re-enrichment; still-failing articles surface honestly in the
 * review UI rather than burning further tokens.
 */
import type PgBoss from 'pg-boss'
import type { Prisma } from '@prisma/client'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { Sentry } from '../lib/sentry'
import { evaluateArticleQuality, judgeQualityVerdict } from '../article-pipeline/quality-gate'
import { triggerArticleRewrite } from '../article-pipeline/rewrite-trigger'

export interface FinalQualityCheckJobData {
  jobId: string
}

/** Max AUTOMATIC rewrites from the final check (Veit: cap at one). */
const MAX_AUTO_REWRITES = 1

export async function finalQualityCheckHandler(jobs: PgBoss.Job<FinalQualityCheckJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { jobId } = job.data
    const articleJob = await prisma.articleJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        finalQualityAttempts: true,
        sitePage: { select: { bodyHtml: true } },
      },
    })
    if (!articleJob) {
      logger.warn({ jobId }, '[final-quality] job not found — skipping')
      continue
    }
    if (articleJob.status !== 'enriched') {
      logger.info({ jobId, status: articleJob.status }, '[final-quality] not enriched — skipping')
      continue
    }
    const bodyHtml = articleJob.sitePage?.bodyHtml
    if (!bodyHtml?.trim()) {
      logger.warn({ jobId }, '[final-quality] no enriched body — skipping')
      continue
    }

    try {
      const evalRes = await evaluateArticleQuality(bodyHtml)
      const verdict = await judgeQualityVerdict(evalRes.text)
      const attempt = articleJob.finalQualityAttempts
      const stored = { ...verdict, attempt } as unknown as Prisma.InputJsonValue

      const failsSubstantively = verdict.verdict !== 'pass'
      if (failsSubstantively && attempt < MAX_AUTO_REWRITES) {
        await prisma.articleJob.update({
          where: { id: jobId },
          data: {
            finalQualityVerdict: stored,
            finalQualityAttempts: { increment: 1 },
            totalCost: { increment: evalRes.cost },
          },
        })
        logger.warn(
          { jobId, verdict: verdict.verdict, reasons: verdict.reasons },
          '[final-quality] FAILED — auto-rewrite (single attempt) triggered',
        )
        const r = await triggerArticleRewrite(jobId)
        if (!r.ok) logger.error({ jobId, error: r.error }, '[final-quality] auto-rewrite trigger failed')
        continue
      }

      await prisma.articleJob.update({
        where: { id: jobId },
        data: { finalQualityVerdict: stored, totalCost: { increment: evalRes.cost } },
      })
      logger.info(
        { jobId, verdict: verdict.verdict, attempt },
        failsSubstantively
          ? '[final-quality] still failing after auto-rewrite — surfaced for human review'
          : '[final-quality] passed',
      )
    } catch (err) {
      // Evaluation failure must never block review — record it and move on.
      logger.error({ jobId, err }, '[final-quality] evaluation failed (article stays reviewable)')
      Sentry.captureException(err, { tags: { queue: 'final-quality-check', jobId } })
      await prisma.articleJob
        .update({
          where: { id: jobId },
          data: {
            finalQualityVerdict: {
              verdict: 'error',
              reasons: ['Automated final check failed to run — review manually.'],
            } as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => {})
    }
  }
}
