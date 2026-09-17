import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateQuoteCardAsset = vi.fn()
const generateCarouselAssets = vi.fn()
const generateVideoReelAsset = vi.fn()
const generateHookVideoAsset = vi.fn()

vi.mock('../../generate-assets', () => ({
  generateQuoteCardAsset: (...a: unknown[]) => generateQuoteCardAsset(...a),
  generateCarouselAssets: (...a: unknown[]) => generateCarouselAssets(...a),
}))
vi.mock('../../generate-video-assets', () => ({
  generateVideoReelAsset: (...a: unknown[]) => generateVideoReelAsset(...a),
  generateHookVideoAsset: (...a: unknown[]) => generateHookVideoAsset(...a),
}))
vi.mock('../../../article-pipeline/enrichment/prompt-template', () => ({
  loadPromptTemplate: vi.fn().mockResolvedValue(null),
}))
vi.mock('@omniply/shared', () => ({ prisma: {} }))
vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { generateMatrixAsset } from '../matrix-processor'

const baseOpts = {
  userId: 'u1',
  assetJobId: 'job-P1',
  resolved: { slot: { text: 'section body', title: 'Section Title', quoteText: undefined }, diagramBackground: null },
  contextTitle: 'Article Title',
  slideCount: 8,
  diagramLogoVariant: 'light' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateMatrixAsset — video_reel graceful degradation (Phase 5)', () => {
  it('returns the video asset normally when Fal succeeds', async () => {
    generateVideoReelAsset.mockResolvedValue({ videoUrl: 'https://cdn/reel.mp4', rawVideoUrl: 'https://cdn/raw.mp4' })
    const result = await generateMatrixAsset({ ...baseOpts, postType: 'video_reel' })
    expect(result).toEqual({ postType: 'video_reel', videoUrl: 'https://cdn/reel.mp4', rawVideoUrl: 'https://cdn/raw.mp4' })
    expect(generateQuoteCardAsset).not.toHaveBeenCalled()
  })

  it('falls back to a quote card when video generation fails', async () => {
    generateVideoReelAsset.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    generateQuoteCardAsset.mockResolvedValue({ imageUrl: 'https://cdn/quote.png' })

    const result = await generateMatrixAsset({ ...baseOpts, postType: 'video_reel' })

    expect(result).toEqual({ postType: 'quote', imageUrl: 'https://cdn/quote.png' })
    expect(generateQuoteCardAsset).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', content: 'section body', variant: 'feed', jobId: 'job-P1' }),
    )
  })

  it('throws a combined error (with the original video failure as .cause) when the fallback also fails', async () => {
    const videoErr = Object.assign(new Error('fal-ai seedance (403) failed after 6500ms: Forbidden'), { status: 403 })
    const quoteErr = new Error('quote card render failed')
    generateVideoReelAsset.mockRejectedValue(videoErr)
    generateQuoteCardAsset.mockRejectedValue(quoteErr)

    await expect(generateMatrixAsset({ ...baseOpts, postType: 'video_reel' })).rejects.toMatchObject({
      message: expect.stringContaining('video_reel fallback (quote card) also failed'),
      cause: videoErr,
    })
  })
})

describe('generateMatrixAsset — hook_video graceful degradation (Phase 5)', () => {
  it('returns the hook_video asset normally when it succeeds', async () => {
    generateHookVideoAsset.mockResolvedValue({
      videoUrl: 'https://cdn/hook.mp4',
      title: 'Hook Title',
      carouselImageUrls: ['a.png'],
      carouselBackgroundImageUrls: ['a-bg.png'],
      hookRawVideoUrl: 'https://cdn/hook-raw.mp4',
    })
    const result = await generateMatrixAsset({ ...baseOpts, postType: 'hook_video' })
    expect(result.postType).toBe('hook_video')
    expect(generateCarouselAssets).not.toHaveBeenCalled()
  })

  it('falls back to a plain image carousel when hook_video generation fails', async () => {
    generateHookVideoAsset.mockRejectedValue(new Error('seedance timed out after 480000ms'))
    const slidePlans = [{ type: 'hook', headlineText: 'Slide 1 headline', bodyText: null, imagePrompt: 'p' }]
    generateCarouselAssets.mockResolvedValue({
      imageUrls: ['s1.png', 's2.png'],
      slides: [{ headline: 'Slide 1 headline' }],
      backgroundImageUrls: ['s1-bg.png', 's2-bg.png'],
      slidePlans,
    })

    const result = await generateMatrixAsset({ ...baseOpts, postType: 'hook_video' })

    expect(result).toEqual({
      postType: 'carousel',
      mediaUrls: ['s1.png', 's2.png'],
      imageUrl: 's1.png',
      title: 'Slide 1 headline',
      backgroundImageUrls: ['s1-bg.png', 's2-bg.png'],
      carouselSlides: slidePlans,
      carouselVariant: null,
    })
    // No diagramBackground passed on the fallback path — it's a plain carousel, not diagram mode.
    expect(generateCarouselAssets).toHaveBeenCalledWith(
      expect.not.objectContaining({ diagramBackground: expect.anything() }),
    )
  })

  it('throws a combined error when both hook_video and the carousel fallback fail', async () => {
    const hookErr = new Error('hook video failed')
    const carouselErr = new Error('carousel also failed')
    generateHookVideoAsset.mockRejectedValue(hookErr)
    generateCarouselAssets.mockRejectedValue(carouselErr)

    await expect(generateMatrixAsset({ ...baseOpts, postType: 'hook_video' })).rejects.toMatchObject({
      message: expect.stringContaining('hook_video fallback (image carousel) also failed'),
      cause: hookErr,
    })
  })
})
