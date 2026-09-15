/**
 * Shared rewrite trigger (parity batch B): re-runs Phase A steps 7–12 for a
 * finished article. Extracted from POST /articles/:jobId/rewrite so the
 * automated final quality check can invoke the identical remedy.
 * Accepts 'completed' (pre-approval) and 'enriched' (ready-for-review) jobs —
 * the rerun flows back through the gate and enrichment, overwriting the
 * existing SitePage body on completion.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { runPipelinePhaseA } from './executor'

export const REWRITABLE_STATUSES = ['completed', 'enriched'] as const

export async function triggerArticleRewrite(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const job = await prisma.articleJob.findUnique({ where: { id: jobId }, select: { id: true, status: true } })
  if (!job) return { ok: false, error: 'Article job not found' }
  if (!REWRITABLE_STATUSES.includes(job.status as (typeof REWRITABLE_STATUSES)[number])) {
    return { ok: false, error: `Cannot rewrite a job with status: ${job.status}` }
  }

  await prisma.pipelineStep.deleteMany({ where: { jobId, stepNumber: { gte: 7, lte: 12 } } })
  await prisma.articleJob.update({
    where: { id: jobId },
    data: { status: 'in_progress', currentStep: 6 },
  })
  runPipelinePhaseA(jobId).catch((err) => {
    logger.error({ jobId, err }, '[rewrite-trigger] phase A rerun failed')
  })
  return { ok: true }
}
