/**
 * Shared rewrite trigger (parity batch B): re-runs Phase A steps 7–12 for a
 * finished article. Extracted from POST /articles/:jobId/rewrite so the
 * automated final quality check can invoke the identical remedy.
 * Accepts 'completed' (pre-approval) and 'enriched' (ready-for-review) jobs —
 * the rerun flows back through the gate and enrichment, overwriting the
 * existing SitePage body on completion.
 *
 * B9 fix (2026-11-05): this used to set status 'in_progress' and call
 * runPipelinePhaseA in-process, fire-and-forget. The executor's atomic claim
 * (updateMany: status NOT IN ['in_progress'] → 'in_progress') then ALWAYS saw
 * 'in_progress' and aborted as a duplicate — the rewrite was a guaranteed
 * no-op that stranded the job at currentStep 6 with steps 7–12 deleted.
 * The trigger now leaves the claim to the executor (status 'pending') and
 * enqueues through pg-boss, which also buys crash-safety, retries, and the
 * pipeline handler's failure-alert path.
 */
import { prisma } from '@omniply/shared'
import { getBoss, QUEUES } from '../queues'

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
    data: { status: 'pending', currentStep: 6 },
  })
  const boss = await getBoss()
  await boss.send(
    QUEUES.ARTICLE_PIPELINE,
    { jobId },
    { singletonKey: jobId, expireInSeconds: 3600, retryLimit: 2, retryDelay: 120 },
  )
  return { ok: true }
}
