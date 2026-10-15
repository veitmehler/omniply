import type { Post } from '@prisma/client'
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { dispatchPublish, isGhlManagedPlatform } from '../dispatcher'
import { sendFailureAlert } from '../../lib/alerts'
import { type AutomationLogContext, withPlatform, withPost, withSlotKey } from './log-context'

async function dispatchReadyPost(post: Post, logCtx: AutomationLogContext): Promise<boolean> {
  const slotCtx = post.slotKey ? withSlotKey(logCtx, post.slotKey) : logCtx
  const platformCtx = withPlatform(slotCtx, post.platform)
  const mediaUrls = post.mediaUrls?.length ? post.mediaUrls : undefined
  const imageUrl = mediaUrls?.[0] ?? post.imageUrl ?? undefined
  const videoUrl = post.videoUrl ?? undefined
  const scheduledAt = post.scheduledAt ?? new Date()

  // Story beats (engagement v2) are text-only ON PURPOSE off-Instagram:
  // IG gets the slide carousel, LinkedIn/Facebook publish the story as a
  // pure text post (mirror of the creation rule in schedule-posts.ts).
  // The old unconditional media guard failed every one of them with
  // "No media attached" (found live 2026-09-23).
  const textOnlyStory = post.postType === 'story_text' && post.platform !== 'instagram'
  if (!videoUrl && !imageUrl && !mediaUrls?.length && !textOnlyStory) {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'failed', errorMsg: 'No media attached' },
    })
    return false
  }

  try {
    if (isGhlManagedPlatform(post.platform)) {
      const result = await dispatchPublish(post.userId, post.platform, post.content, {
        imageUrl: mediaUrls ? undefined : imageUrl,
        mediaUrls,
        videoUrl,
        postAsStory: post.postAsStory,
        scheduledAt,
        preferPersonalProfile: post.postType === 'story_text',
        logCtx: platformCtx,
      })

      if (!result.success) {
        await prisma.post.update({
          where: { id: post.id },
          data: { status: 'failed', errorMsg: result.error },
        })
        logger.warn({ ...platformCtx, error: result.error }, '[social-automation] GHL dispatch failed')
        await sendFailureAlert({
          userId: post.userId,
          jobId: logCtx.jobId,
          errorType: 'social_ghl_schedule',
          message: `GHL schedule failed for ${post.platform} (${post.slotKey}): ${result.error}`,
          context: { ...platformCtx },
        })
        return false
      }

      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: 'scheduled',
          provider: 'ghl',
          ghlPostId: result.ghlPostId ?? null,
        },
      })
      logger.info(
        {
          ...withPost(platformCtx, post.id, result.ghlPostId ?? undefined),
          scheduledAt,
          provider: 'ghl',
          postType: post.postType,
        },
        '[social-automation] post dispatched to GHL',
      )
      return true
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'scheduled', provider: 'direct' },
    })
    logger.info(
      {
        ...withPost(platformCtx, post.id),
        scheduledAt,
        provider: 'direct',
        postType: post.postType,
      },
      '[social-automation] direct post marked scheduled',
    )
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'failed', errorMsg: message },
    })
    logger.error({ ...platformCtx, err }, '[social-automation] failed to dispatch post')
    await sendFailureAlert({
      userId: post.userId,
      jobId: logCtx.jobId,
      errorType: 'social_schedule',
      message: `Failed to schedule ${post.platform} (${post.slotKey}): ${message}`,
      context: { ...platformCtx },
    })
    return false
  }
}

export async function dispatchReadyPostsForRun(
  runId: string,
  opts?: { slotKey?: string },
): Promise<{ dispatched: number; failed: number }> {
  const run = await prisma.socialAutomationRun.findUnique({
    where: { id: runId },
    select: { userId: true, jobId: true },
  })
  if (!run) throw new Error(`Automation run not found: ${runId}`)

  const logCtx: AutomationLogContext = {
    runId,
    userId: run.userId,
    jobId: run.jobId ?? undefined,
  }

  const posts = await prisma.post.findMany({
    where: {
      automationRunId: runId,
      status: 'ready',
      ...(opts?.slotKey ? { slotKey: opts.slotKey } : {}),
    },
    orderBy: [{ slotKey: 'asc' }, { platform: 'asc' }],
  })

  let dispatched = 0
  let failed = 0

  for (const post of posts) {
    const ok = await dispatchReadyPost(post, logCtx)
    if (ok) dispatched++
    else failed++
  }

  return { dispatched, failed }
}

export async function finalizeDispatchCounts(runId: string): Promise<void> {
  const run = await prisma.socialAutomationRun.findUnique({ where: { id: runId } })
  if (!run) return

  const [scheduledPosts, failedPosts, readyPosts] = await Promise.all([
    prisma.post.count({ where: { automationRunId: runId, status: 'scheduled' } }),
    prisma.post.count({
      where: { automationRunId: runId, status: 'failed', slotKey: { not: null } },
    }),
    prisma.post.count({ where: { automationRunId: runId, status: 'ready' } }),
  ])

  const allFailed = scheduledPosts === 0 && failedPosts > 0
  const status = allFailed ? 'failed' : 'completed'
  const error =
    failedPosts > 0
      ? `${failedPosts} post(s) failed to schedule${readyPosts > 0 ? `; ${readyPosts} still ready` : ''}`
      : readyPosts > 0
        ? `${readyPosts} post(s) still awaiting dispatch`
        : null

  await prisma.socialAutomationRun.update({
    where: { id: runId },
    data: { status, currentSpec: null, error },
  })

  const runCtx: AutomationLogContext = {
    runId,
    userId: run.userId,
    jobId: run.jobId ?? undefined,
  }

  if (failedPosts > 0) {
    await sendFailureAlert({
      userId: run.userId,
      jobId: run.jobId ?? undefined,
      errorType: 'social_automation_run',
      message: `Social automation dispatch finished with ${failedPosts} failed post(s)`,
      context: { ...runCtx, scheduledPosts, failedPosts, readyPosts },
    })
  }

  logger.info(
    { ...runCtx, scheduledPosts, failedPosts, readyPosts, status },
    '[social-automation] dispatch finished',
  )
}

async function markSlotApproved(runId: string, slotKey: string): Promise<void> {
  await prisma.socialAutomationSpecResult.updateMany({
    where: { runId, slotKey },
    data: { approvedAt: new Date() },
  })
}

/** After partial or full dispatch, set run to ready (more slots pending) or completed/failed. */
export async function reconcileRunDispatchState(runId: string): Promise<void> {
  const readyPosts = await prisma.post.count({
    where: { automationRunId: runId, status: 'ready' },
  })
  if (readyPosts > 0) {
    await prisma.socialAutomationRun.update({
      where: { id: runId },
      data: { status: 'ready', currentSpec: null },
    })
    return
  }
  await finalizeDispatchCounts(runId)
}

/** Dispatch ready posts for one slot; run stays ready until all slots are dispatched. */
export async function dispatchSocialAutomationSlot(
  runId: string,
  slotKey: string,
): Promise<{ dispatched: number; failed: number }> {
  const run = await prisma.socialAutomationRun.findUnique({
    where: { id: runId },
    select: { status: true },
  })
  if (!run) throw new Error(`Automation run not found: ${runId}`)
  if (run.status !== 'ready' && run.status !== 'scheduling') {
    throw new Error(`Run is not ready for dispatch (status: ${run.status})`)
  }

  await markSlotApproved(runId, slotKey)

  const result = await dispatchReadyPostsForRun(runId, { slotKey })
  logger.info({ runId, slotKey, ...result }, '[social-automation] slot dispatch complete')

  await reconcileRunDispatchState(runId)
  return result
}

/** Dispatch all ready posts for a run (full approval). */
export async function dispatchSocialAutomationRun(runId: string): Promise<void> {
  const claim = await prisma.socialAutomationRun.updateMany({
    where: { id: runId, status: 'ready' },
    data: { status: 'scheduling', error: null, currentSpec: null },
  })
  if (claim.count === 0) {
    logger.info({ runId }, '[social-automation] dispatch skipped — run not in ready state')
    return
  }

  const specs = await prisma.socialAutomationSpecResult.findMany({
    where: { runId },
    select: { slotKey: true },
  })
  if (specs.length > 0) {
    await prisma.socialAutomationSpecResult.updateMany({
      where: { runId },
      data: { approvedAt: new Date() },
    })
  }

  logger.info({ runId }, '[social-automation] dispatch started')

  try {
    const result = await dispatchReadyPostsForRun(runId)
    logger.info({ runId, ...result }, '[social-automation] dispatch pass complete')
  } finally {
    await reconcileRunDispatchState(runId)
  }
}
