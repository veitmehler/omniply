import type { SocialAutomationRun } from '@prisma/client'
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { sendFailureAlert } from '../../lib/alerts'
import { getGhlCredentials } from '../../lib/ghl/settings'
import { ensureFutureScheduleDate, slotToUtc } from './schedule'
import { finalizeGenerationCounts } from './spec-processor'
import { buildArticleContentContext } from './content'
import { listAutomationPlatforms } from './platforms'
import type { SpecPreviewPayload } from './preview-types'
import { type AutomationLogContext, withPlatform, withPost, withSlotKey } from './log-context'
import { generateStorySlidesAsset } from '../generate-assets'
import { socialImageModel } from './matrix-processor'
import { articleMaterialFromCtx } from '../generators/story-arc'
import { generateAuthorityPost } from '../generators/authority-post'
import { drawAuthorityType, swapAuthorityType, isAuthorityType, type AuthorityType } from '../generators/authority-rotation'
import { withTimeout } from '../../lib/net/with-timeout'

/**
 * Authority run processor (.plans/authority-content-engine plan, v1).
 *
 * A run with slotVariant='authority' is ONE typed post from one published
 * article, flowing through the exact same lifecycle as matrix runs: spec
 * result + ready posts + previewJson → existing approval UI → existing
 * dispatch. runSocialAutomation branches here, so the safety sweeper's
 * auto-recovery re-enters THIS processor instead of the weekday matrix.
 *
 * Surfaces (user decision 2026-10-15 — ALL of them):
 * - linkedin (company page): native text, no media.
 * - linkedin_personal (own Post row; dispatch maps it to GHL's personal
 *   LinkedIn account): native text. Only created when the mapping exists.
 * - facebook + instagram: the post's hook line rendered through the existing
 *   brand-tint motif compositor as a single feed image; full text as caption.
 */

const AUTHORITY_SLOT_KEY = 'P1'
const AUTHORITY_POST_HOUR = 15 // clear of the azavea cadence slots (7/12/19)
const AUTHORITY_DEADLINE_MS = 15 * 60 * 1000

// IG captions are not clickable — same URL-line strip as the story pregen.
const URL_LINE_RX = /https?:\/\/|\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|net|org|ai|co|app|dev|us)\b(?:\/\S*)?/i
function stripUrlLines(text: string): string {
  const lines = text.split('\n').filter((l) => !URL_LINE_RX.test(l))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n')
}

export async function processAuthorityRun(run: SocialAutomationRun): Promise<void> {
  const logCtx: AutomationLogContext = { runId: run.id, userId: run.userId, jobId: run.jobId ?? undefined }
  const specCtx = withSlotKey(logCtx, AUTHORITY_SLOT_KEY)
  if (!run.jobId) throw new Error(`Authority run missing source article: ${run.id}`)
  const jobId = run.jobId

  // Reprocess safety: wipe this run's undispatched posts before rebuilding.
  await prisma.post.deleteMany({ where: { automationRunId: run.id, status: 'ready' } })

  // A retry must NOT redraw (a second draw would skew the bag): reuse the
  // type recorded on the spec result's assetsJson when one exists.
  const existing = await prisma.socialAutomationSpecResult.findUnique({
    where: { runId_slotKey: { runId: run.id, slotKey: AUTHORITY_SLOT_KEY } },
    select: { assetsJson: true },
  })
  const priorType = (existing?.assetsJson as { authorityType?: unknown } | null)?.authorityType

  await prisma.socialAutomationSpecResult.upsert({
    where: { runId_slotKey: { runId: run.id, slotKey: AUTHORITY_SLOT_KEY } },
    create: { runId: run.id, slotKey: AUTHORITY_SLOT_KEY, status: 'pending' },
    update: { status: 'pending', error: null, postsCreated: 0, approvedAt: null },
  })
  await prisma.socialAutomationRun.update({
    where: { id: run.id },
    data: { totalSpecs: 1, completedSpecs: 0, failedSpecs: 0, currentSpec: AUTHORITY_SLOT_KEY },
  })

  try {
    await withTimeout(
      async () => {
        const sitePage = await prisma.sitePage.findFirst({ where: { jobId } })
        if (!sitePage) throw new Error(`Article context missing for authority run ${run.id}`)
        const articleCtx = buildArticleContentContext(sitePage)

        const drawnType: AuthorityType = isAuthorityType(priorType) ? priorType : await drawAuthorityType(run.userId)

        const result = await generateAuthorityPost({
          userId: run.userId,
          articleTitle: articleCtx.title,
          articleMaterial: articleMaterialFromCtx(articleCtx),
          register: drawnType,
          logCtx: specCtx,
        })
        if (result.usedType !== drawnType && !isAuthorityType(priorType)) {
          await swapAuthorityType(run.userId, drawnType, result.usedType)
        }

        // Single tinted-motif image: the hook line through the existing
        // story-slide compositor (one slide → hook banner, no swipe arrow).
        const image = await generateStorySlidesAsset({
          userId: run.userId,
          slides: [result.hookLine],
          jobId: `${jobId}-AUTH`,
          imageModel: await socialImageModel(),
        })
        const imageUrl = image.imageUrls[0]
        if (!imageUrl) throw new Error('Authority post: tint image render produced no URL')

        const settings = await prisma.settings.findUnique({ where: { userId: run.userId } })
        const timeZone = settings?.socialTimezone ?? 'America/New_York'
        const scheduledAt = ensureFutureScheduleDate(slotToUtc(run.scheduledDate, AUTHORITY_POST_HOUR, 0, timeZone))

        const ready = await listAutomationPlatforms(run.userId, false)
        const creds = await getGhlCredentials(run.userId)
        const surfaces: { platform: string; withImage: boolean; caption: string }[] = []
        if (ready.includes('linkedin')) {
          surfaces.push({ platform: 'linkedin', withImage: false, caption: result.postText })
          if (creds?.accountIds.linkedinPersonal) {
            surfaces.push({ platform: 'linkedin_personal', withImage: false, caption: result.postText })
          }
        }
        if (ready.includes('facebook')) surfaces.push({ platform: 'facebook', withImage: true, caption: result.postText })
        if (ready.includes('instagram')) {
          surfaces.push({ platform: 'instagram', withImage: true, caption: stripUrlLines(result.postText) })
        }
        if (surfaces.length === 0) throw new Error('No platforms configured for authority post')

        const preview: SpecPreviewPayload = {
          slotKey: AUTHORITY_SLOT_KEY,
          postType: 'authority_text',
          isStory: false,
          scheduledAt: scheduledAt.toISOString(),
          platforms: [],
          assets: { imageUrl, title: result.hookLine },
        }

        let built = 0
        for (const s of surfaces) {
          const platformCtx = withPlatform(specCtx, s.platform)
          try {
            const created = await prisma.post.create({
              data: {
                userId: run.userId,
                platform: s.platform,
                content: s.caption,
                status: 'ready',
                scheduledAt,
                imageUrl: s.withImage ? imageUrl : null,
                mediaUrls: [],
                videoUrl: null,
                postType: 'authority_text',
                postAsStory: false,
                provider: 'ghl',
                automationRunId: run.id,
                slotKey: AUTHORITY_SLOT_KEY,
              },
            })
            preview.platforms.push({
              platform: s.platform,
              caption: s.caption,
              imageUrl: s.withImage ? imageUrl : undefined,
              status: 'ready',
              postId: created.id,
            })
            logger.info(
              { ...withPost(platformCtx, created.id), scheduledAt, authorityType: result.usedType },
              '[authority] post ready for preview',
            )
            built++
          } catch (err) {
            logger.error({ ...platformCtx, err }, '[authority] failed to build ready post')
          }
        }
        if (built === 0) throw new Error('All authority platform builds failed')

        await prisma.socialAutomationSpecResult.update({
          where: { runId_slotKey: { runId: run.id, slotKey: AUTHORITY_SLOT_KEY } },
          data: {
            status: 'completed',
            postsCreated: built,
            assetsJson: {
              postType: 'authority_text',
              imageUrl,
              title: result.hookLine,
              authorityType: result.usedType,
              drawnType,
              storySlides: [result.hookLine],
            } as object,
            previewJson: preview as object,
            error: null,
          },
        })
      },
      AUTHORITY_DEADLINE_MS,
      'authority-run',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.socialAutomationSpecResult.update({
      where: { runId_slotKey: { runId: run.id, slotKey: AUTHORITY_SLOT_KEY } },
      data: { status: 'failed', error: message },
    })
    await sendFailureAlert({
      userId: run.userId,
      jobId,
      errorType: 'social_automation_spec',
      message: `Authority post: ${message}`,
      context: { ...specCtx },
    })
    logger.error({ ...specCtx, err }, '[authority] run failed')
  }

  await finalizeGenerationCounts(run.id)
}
