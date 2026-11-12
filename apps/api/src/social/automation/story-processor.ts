import type { SocialAutomationRun, SocialPostSpec } from '@prisma/client'
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { sendFailureAlert } from '../../lib/alerts'
import { ensureFutureScheduleDate, slotToUtc } from './schedule'
import { buildPostsForSpec } from './schedule-posts'
import type { SpecAssets } from './generate-spec'
import type { SlotContent } from './content'
import type { StorySlot } from './weekly-matrix'
import { resolveNewsletterSlotContent } from './newsletter-content'
import { generateQuoteCardAsset, generateTipsBulletStoryAsset } from '../generate-assets'
import { generateStoryCarouselVideo, generateStoryHookVideo } from '../generate-video-assets'
import type { MatrixRunContext } from './matrix-processor'
import type { AutomationLogContext } from './log-context'
import { withSlotKey } from './log-context'
import { withTimeout } from '../../lib/net/with-timeout'

/**
 * Hard deadline for one story slot's full pipeline. Backstop only — every
 * external call inside is already individually timed out (Phase 1). Shorter
 * than the feed-slot deadline since pitch stories reuse an already-generated
 * feed asset (no fresh Fal image/video generation) and tips/quote stories are
 * local composites.
 */
const STORY_SLOT_DEADLINE_MS = 15 * 60 * 1000

/** Story companion posts trail their feed post by a randomized 2–8 minutes. */
export function storyOffsetMinutes(): number {
  return 2 + Math.floor(Math.random() * 7) // 2..8 inclusive
}

/** Source text used to write a pitch slide's teaser copy (topic + a content summary). */
function pitchContentText(ctx: MatrixRunContext): string {
  if (ctx.newsletterCtx) return ctx.newsletterCtx.feature.body || ctx.contextTitle
  if (ctx.articleCtx) {
    const a = ctx.articleCtx
    return [a.introText, a.h2SectionText].filter(Boolean).join('\n\n') || a.title
  }
  return ctx.contextTitle
}

/** Standalone content for a quote / tips story (pitch stories reuse the feed asset instead). */
function resolveStoryContent(story: StorySlot, ctx: MatrixRunContext): SlotContent {
  if (story.storyType === 'quote') {
    if (ctx.newsletterCtx) {
      // Newsletter quote: sourced from the feature so it doesn't duplicate the tips story.
      return resolveNewsletterSlotContent(story.source ?? 'nl_feature', ctx.newsletterCtx)
    }
    if (ctx.articleCtx) {
      const a = ctx.articleCtx
      const text = [a.introText, a.keyTakeawaysText, a.h2SectionText].filter(Boolean).join('\n\n')
      return { text: text || a.title, title: a.title }
    }
  }
  if (story.storyType === 'tips_bullets' && ctx.newsletterCtx) {
    return { text: ctx.newsletterCtx.tips.join('\n'), title: 'Tips of the Day' }
  }
  // Pitch stories (promote the day's feed asset): the caption writer needs the article's
  // substance, not only its title — a title-only source made Sonnet 5.5 narrate the gap in
  // the caption itself (Whealth social bench 2026-11-11).
  if (story.storyType === 'pitch_carousel' || story.storyType === 'pitch_hook') {
    return { text: pitchContentText(ctx), title: ctx.contextTitle }
  }
  return { text: ctx.contextTitle, title: ctx.contextTitle }
}

/** Generate one story asset, reusing the companion feed asset for pitch types. */
async function generateStoryAsset(opts: {
  run: SocialAutomationRun
  story: StorySlot
  ctx: MatrixRunContext
  priorAssets: Map<string, SpecAssets>
  assetJobId: string
}): Promise<SpecAssets> {
  const { run, story, ctx, priorAssets, assetJobId } = opts
  const topic = ctx.contextTitle

  switch (story.storyType) {
    case 'pitch_carousel': {
      const feed = story.promotesFeedKey ? priorAssets.get(story.promotesFeedKey) : undefined
      if (!feed?.mediaUrls?.length) throw new Error(`Feed carousel ${story.promotesFeedKey} required before ${story.slotKey}`)
      if (!feed?.backgroundImageUrls?.length) throw new Error(`Feed carousel backgrounds required before ${story.slotKey}`)
      const s4 = await generateStoryCarouselVideo({
        userId: run.userId,
        title: feed.title ?? topic,
        imageUrls: feed.mediaUrls,
        backgroundImageUrls: feed.backgroundImageUrls,
        content: pitchContentText(ctx),
        topic: feed.title ?? topic,
        jobId: assetJobId,
      })
      return { postType: 'pitch_carousel', videoUrl: s4.videoUrl }
    }
    case 'pitch_hook': {
      const feed = story.promotesFeedKey ? priorAssets.get(story.promotesFeedKey) : undefined
      const backgroundImageUrl = feed?.backgroundImageUrls?.[1] ?? feed?.backgroundImageUrls?.[0]
      if (!feed?.hookRawVideoUrl) throw new Error(`Feed hook clip ${story.promotesFeedKey} required before ${story.slotKey}`)
      if (!backgroundImageUrl) throw new Error(`Feed hook backgrounds required before ${story.slotKey}`)
      const title = feed.title ?? topic
      const s6 = await generateStoryHookVideo({
        userId: run.userId,
        title,
        content: pitchContentText(ctx),
        topic: title,
        hookRawVideoUrl: feed.hookRawVideoUrl,
        backgroundImageUrl,
        jobId: assetJobId,
      })
      return { postType: 'pitch_hook', videoUrl: s6.videoUrl, title }
    }
    case 'tips_bullets': {
      const nl = ctx.newsletterCtx
      const bullets = nl?.tips ?? []
      if (!bullets.length) throw new Error('No Tips of the Day for the tips story')
      const backgroundUrl = run.newsletterId
        ? (await prisma.newsletter.findUnique({ where: { id: run.newsletterId }, select: { summaryImageUrl: true } }))
            ?.summaryImageUrl ?? null
        : null
      const tips = await generateTipsBulletStoryAsset({
        userId: run.userId,
        title: 'Tips of the Day',
        bullets,
        backgroundUrl,
        jobId: assetJobId,
      })
      return { postType: 'tips_story', imageUrl: tips.imageUrl }
    }
    case 'quote':
    default: {
      const content = resolveStoryContent(story, ctx)
      const card = await generateQuoteCardAsset({
        userId: run.userId,
        content: content.text,
        variant: 'story',
        quoteText: content.quoteText,
        jobId: assetJobId,
      })
      return { postType: 'quote', imageUrl: card.imageUrl }
    }
  }
}

/** Process one story slot: generate → schedule (feed hour + random offset) → record. */
export async function processStorySlot(opts: {
  run: SocialAutomationRun
  story: StorySlot
  ctx: MatrixRunContext
  priorAssets: Map<string, SpecAssets>
  timeZone: string
  logCtx: AutomationLogContext
}): Promise<{ ok: boolean; error?: string }> {
  const { run, story, ctx, priorAssets, timeZone, logCtx } = opts
  const specCtx = withSlotKey(logCtx, story.slotKey)

  await prisma.socialAutomationSpecResult.upsert({
    where: { runId_slotKey: { runId: run.id, slotKey: story.slotKey } },
    create: { runId: run.id, slotKey: story.slotKey, status: 'pending' },
    update: { status: 'pending', error: null, postsCreated: 0, approvedAt: null },
  })

  try {
    const { assets, buildResult } = await withTimeout(
      async () => {
        const assetJobId = `${run.jobId ?? run.newsletterId}-${story.slotKey}`
        const assets = await generateStoryAsset({ run, story, ctx, priorAssets, assetJobId })

        const scheduledAt = ensureFutureScheduleDate(
          slotToUtc(run.scheduledDate, story.anchorHour, storyOffsetMinutes(), timeZone),
        )
        const syntheticSpec = { isStory: true, postType: assets.postType, slotKey: story.slotKey } as unknown as SocialPostSpec

        const captionText = resolveStoryContent(story, ctx)
        const buildResult = await buildPostsForSpec({
          logCtx: specCtx,
          spec: syntheticSpec,
          assets,
          scheduledAt,
          articleCtx: {
            title: captionText.title ?? ctx.contextTitle,
            introText: captionText.text,
            keyTakeawaysText: captionText.text,
            h2Sections: [{ heading: captionText.title ?? ctx.contextTitle, text: captionText.text }],
            h2Title: captionText.title ?? ctx.contextTitle,
            h2SectionText: captionText.text,
          },
        })

        if (buildResult.failed > 0 && buildResult.built === 0) {
          throw new Error(`All ${buildResult.failed} platform build(s) failed`)
        }

        return { assets, buildResult }
      },
      STORY_SLOT_DEADLINE_MS,
      `story-slot:${story.slotKey}`,
    )

    await prisma.socialAutomationSpecResult.update({
      where: { runId_slotKey: { runId: run.id, slotKey: story.slotKey } },
      data: {
        status: 'completed',
        postsCreated: buildResult.built,
        assetsJson: assets as object,
        previewJson: buildResult.preview as object,
        error: buildResult.failed > 0 ? `${buildResult.failed} platform(s) failed` : null,
      },
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.socialAutomationSpecResult.update({
      where: { runId_slotKey: { runId: run.id, slotKey: story.slotKey } },
      data: { status: 'failed', error: message },
    })
    await sendFailureAlert({
      userId: run.userId,
      jobId: run.jobId ?? undefined,
      errorType: 'social_automation_spec',
      message: `Story ${story.slotKey}: ${message}`,
      context: { ...specCtx },
    })
    logger.error({ ...specCtx, err }, '[social-automation] story slot failed')
    return { ok: false, error: message }
  }
}
