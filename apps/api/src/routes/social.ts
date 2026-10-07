import type { FastifyInstance } from 'fastify'
import { prisma, accountMemberIdsForUser } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { safeErrorDetail } from '../lib/safe-error'
import {
  generateCarouselAssets,
  generatePitchStoryAssets,
  generateQuoteCardAsset,
  regenerateCarouselSlide,
} from '../social/generate-assets'
import type { CarouselSlidePlan } from '../social/compositors/carousel'
import { generateLoopedReelAsset } from '../social/generate-video-assets'
import { enqueueVideoGeneration } from '../social/enqueue-video'
import { maxSlidesForPlatforms } from '../social/platform-limits'

async function resolveUser(clerkId: string) {
  return prisma.user.findUnique({ where: { clerkId } })
}

const videoRateLimit = {
  max: 3,
  timeWindow: '1 minute' as const,
  keyGenerator: (req: { clerkId?: string; ip: string }) => req.clerkId ?? req.ip,
}

export async function socialRoutes(app: FastifyInstance) {
  // POST /api/social/generate/quote
  app.post('/social/generate/quote', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: { clerkId?: string; ip: string }) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as {
      content?: string
      variant?: 'feed' | 'story'
      quoteText?: string
      attribution?: string
      jobId?: string
    }

    if (!body.content?.trim() && !body.quoteText?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: content or quoteText' })
    }

    try {
      const result = await generateQuoteCardAsset({
        userId: user.id,
        content: body.content?.trim() ?? body.quoteText!.trim(),
        variant: body.variant ?? 'feed',
        quoteText: body.quoteText,
        attribution: body.attribution,
        jobId: body.jobId,
      })
      return reply.send({ success: true, ...result })
    } catch (err) {
      request.log.error({ err }, 'Error in /social/generate/quote')
      return reply.status(500).send({
        error: 'Failed to generate quote card',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/carousel
  app.post('/social/generate/carousel', { config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: (req: { clerkId?: string; ip: string }) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as {
      content?: string
      platforms?: string[]
      slideCount?: number
      jobId?: string
    }

    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: content' })
    }

    const platforms = body.platforms ?? []
    const maxSlides = maxSlidesForPlatforms(platforms)
    const slideCount = body.slideCount
      ? Math.min(Math.max(2, body.slideCount), maxSlides)
      : maxSlides

    try {
      const result = await generateCarouselAssets({
        userId: user.id,
        content: body.content.trim(),
        platforms,
        slideCount,
        jobId: body.jobId,
      })
      return reply.send({
        success: true,
        ...result,
        slideCount: result.slides.length,
        platformLimit: maxSlides,
      })
    } catch (err) {
      request.log.error({ err }, 'Error in /social/generate/carousel')
      return reply.status(500).send({
        error: 'Failed to generate carousel',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/carousel/regenerate-slide — re-render one slide
  app.post('/social/generate/carousel/regenerate-slide', { config: { rateLimit: videoRateLimit } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as {
      jobId?: string
      slideIndex?: number
      totalSlides?: number
      slidePlan?: CarouselSlidePlan
    }
    if (
      !body.slidePlan ||
      typeof body.slideIndex !== 'number' ||
      typeof body.totalSlides !== 'number'
    ) {
      return reply.status(400).send({ error: 'Missing slidePlan, slideIndex, or totalSlides' })
    }

    try {
      const result = await regenerateCarouselSlide({
        userId: user.id,
        slidePlan: body.slidePlan,
        slideIndex: body.slideIndex,
        totalSlides: body.totalSlides,
        jobId: body.jobId,
      })
      return reply.send({ success: true, ...result })
    } catch (err) {
      request.log.error({ err }, 'Error in /social/generate/carousel/regenerate-slide')
      return reply.status(500).send({
        error: 'Failed to regenerate carousel slide',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/pitch
  app.post('/social/generate/pitch', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: { clerkId?: string; ip: string }) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as {
      title?: string
      pitchType?: 'carousel' | 'hook'
      jobId?: string
    }

    if (!body.title?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: title' })
    }
    if (!body.pitchType || !['carousel', 'hook'].includes(body.pitchType)) {
      return reply.status(400).send({ error: 'pitchType must be "carousel" or "hook"' })
    }

    try {
      const result = await generatePitchStoryAssets({
        userId: user.id,
        title: body.title.trim(),
        pitchType: body.pitchType,
        jobId: body.jobId,
      })
      return reply.send({ success: true, ...result })
    } catch (err) {
      request.log.error({ err }, 'Error in /social/generate/pitch')
      return reply.status(500).send({
        error: 'Failed to generate pitch story',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/video-reel
  app.post('/social/generate/video-reel', { config: { rateLimit: videoRateLimit } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as { content?: string; jobId?: string }
    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: content' })
    }

    try {
      const { jobId } = await enqueueVideoGeneration({
        userId: user.id,
        postType: 'video_reel',
        content: body.content.trim(),
      })
      return reply.status(202).send({ success: true, jobId, status: 'pending' })
    } catch (err) {
      request.log.error({ err }, 'Error enqueuing video reel')
      return reply.status(500).send({
        error: 'Failed to start video reel generation',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/hook-video
  app.post('/social/generate/hook-video', { config: { rateLimit: videoRateLimit } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as { content?: string; title?: string; jobId?: string }
    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: content' })
    }

    try {
      const { jobId } = await enqueueVideoGeneration({
        userId: user.id,
        postType: 'hook_video',
        content: body.content.trim(),
        title: body.title,
      })
      return reply.status(202).send({ success: true, jobId, status: 'pending' })
    } catch (err) {
      request.log.error({ err }, 'Error enqueuing hook video')
      return reply.status(500).send({
        error: 'Failed to start hook video generation',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/social/generate/quote-video
  app.post('/social/generate/quote-video', { config: { rateLimit: videoRateLimit } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as { content?: string; jobId?: string }
    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: content' })
    }

    try {
      const { jobId } = await enqueueVideoGeneration({
        userId: user.id,
        postType: 'quote_video',
        content: body.content.trim(),
      })
      return reply.status(202).send({ success: true, jobId, status: 'pending' })
    } catch (err) {
      request.log.error({ err }, 'Error enqueuing quote video')
      return reply.status(500).send({
        error: 'Failed to start quote video generation',
        details: safeErrorDetail(err),
      })
    }
  })

  // GET /api/social/generate/video-status/:jobId — poll a dashboard video job
  app.get('/social/generate/video-status/:jobId', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { jobId } = request.params as { jobId: string }
    const row = await prisma.videoGenerationJob.findUnique({ where: { id: jobId } })
    if (!row || !(await accountMemberIdsForUser(user.id)).includes(row.userId)) {
      return reply.status(404).send({ error: 'Video job not found' })
    }

    return reply.send({
      jobId: row.id,
      status: row.status,
      postType: row.postType,
      videoUrl: row.videoUrl,
      error: row.error,
    })
  })

  // POST /api/social/generate/loop-video
  app.post('/social/generate/loop-video', { config: { rateLimit: videoRateLimit } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await resolveUser(clerkId)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as { sourceVideoUrl?: string; loopCount?: number; jobId?: string }
    if (!body.sourceVideoUrl?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: sourceVideoUrl' })
    }

    try {
      const result = await generateLoopedReelAsset({
        userId: user.id,
        sourceVideoUrl: body.sourceVideoUrl.trim(),
        loopCount: body.loopCount,
        jobId: body.jobId,
      })
      return reply.send({ success: true, ...result })
    } catch (err) {
      request.log.error({ err }, 'Error in /social/generate/loop-video')
      return reply.status(500).send({
        error: 'Failed to loop video',
        details: safeErrorDetail(err),
      })
    }
  })
}
