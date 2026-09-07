import fs from 'node:fs/promises'
import path from 'node:path'
import {
  withTempDir,
  downloadToFile,
  loopVideo,
  assertStoryVideoConstraints,
  overlayTitleAndBulletsOnVideo,
  overlayBulletsOnVideo,
  overlayTitleOnVideoFadeIn,
  overlayTitleOnVideoStripFadeIn,
  cropCenterToStoryAspect,
  rescaleVideo,
  probeVideo,
  concatVideos,
  muxVoiceover,
  runFfmpeg,
  defaultFontPath,
} from './video/ffmpeg'
import { buildVideoReel, buildHookVideo } from './video/hook-video'
import { generateSeedanceClip, downloadSeedanceClip } from './video/seedance'
import { relativeLuminance } from '../article-pipeline/enrichment/diagram-theme'
import { buildQuoteVideo, buildLoopedStoryReel } from './video/quote-video'
import { buildSlideshowVideo } from './video/slideshow-video'
import { registerSocialMedia, registerSocialVideo } from './media-register'
import {
  generateCarouselAssets,
  generateQuoteCardAsset,
  type GeneratedCarousel,
} from './generate-assets'
import { extractReelBullets } from './generators/reel-bullets'
import { selectQuotesForCards } from './generators/quote-selection'
import { generateVideoReelPrompt } from './generators/video-reel-prompt'
import { generatePitchSlideText } from './generators/pitch-slide-text'
import { buildPitchSlidePng, cropBufferToStoryAspect } from './compositors/carousel'
import { loadSocialBrandTheme } from './brand-theme'
import { loadPromptTemplate } from '../article-pipeline/enrichment/prompt-template'
import { buildPerSlideNarration } from './video/narration'
import { addBackgroundMusic } from './video/music'
import { getVoiceSettings } from '../lib/elevenlabs/settings'
import { logger } from '../lib/logger'

function generationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export interface GeneratedVideoReel {
  postType: 'video_reel'
  videoUrl: string
  mediaId: string
  bullets: string[]
  /** Pre-overlay Seedance background URL — stored so S2 can reuse F2's background. */
  rawVideoUrl: string
  rawMediaId: string
}

export interface GeneratedHookVideo {
  postType: 'hook_video'
  videoUrl: string
  mediaId: string
  title: string
  /** Carousel image URLs generated for this hook video (index 0 = hook slide, 1+ = content). */
  carouselImageUrls: string[]
  /** Raw (pre-overlay) background image URLs — parallel array to carouselImageUrls. */
  carouselBackgroundImageUrls: string[]
  /** Raw Seedance hook clip (1:1, no title, no slideshow body) — S6 reuses this instead of generating a new one. */
  hookRawVideoUrl: string
}

export interface GeneratedQuoteVideo {
  postType: 'quote_video'
  videoUrl: string
  mediaId: string
  voiceoverUsed: boolean
}

export interface GeneratedLoopedReel {
  postType: 'video_reel'
  videoUrl: string
  mediaId: string
  loopCount: number
}

async function uploadVideoFile(opts: {
  userId: string
  filePath: string
  s3Key: string
  title: string
  width: number
  height: number
  jobId?: string
}): Promise<{ videoUrl: string; mediaId: string }> {
  const buffer = await fs.readFile(opts.filePath)
  const registered = await registerSocialVideo({
    userId: opts.userId,
    buffer,
    s3Key: opts.s3Key,
    title: opts.title,
    width: opts.width,
    height: opts.height,
    jobId: opts.jobId,
  })
  return { videoUrl: registered.url, mediaId: registered.mediaId }
}

export async function generateVideoReelAsset(opts: {
  userId: string
  content: string
  /** Article title / topic — used as {{topic}} in the video prompt. Falls back to first line of content. */
  topic?: string
  /** First H2 section text — used as {{details}} in the video prompt. Falls back to content slice. */
  h2Content?: string
  jobId?: string
}): Promise<GeneratedVideoReel> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  const [brand, videoModelTemplate] = await Promise.all([
    loadSocialBrandTheme(opts.userId),
    loadPromptTemplate(207, { userId: opts.userId }),
  ])

  const falModel = videoModelTemplate?.defaultModel ?? 'fal-ai/bytedance/seedance/v1/lite/text-to-video'

  const topic = opts.topic?.trim() ||
    opts.content.replace(/<[^>]+>/g, ' ').split(/[\n.!?]/)[0]?.trim().slice(0, 200) ||
    brand.organizationName
  const details = opts.h2Content?.trim() ||
    opts.content.replace(/<[^>]+>/g, ' ').slice(0, 1500)

  const [{ headline, bullets }, videoPrompt] = await Promise.all([
    extractReelBullets({
      userId: opts.userId,
      content: opts.content,
      topic,
      details,
      specialInstructions: brand.videoSpecialInstructions,
    }),
    generateVideoReelPrompt({
      userId: opts.userId,
      topic,
      details,
      specialInstructions: brand.videoSpecialInstructions,
      videoModel: falModel,
    }),
  ])

  return withTempDir('video-reel-', async (tmpDir) => {
    const outputPath = path.join(tmpDir, 'reel.mp4')
    const probe = await buildVideoReel({
      prompt: videoPrompt,
      headline,
      bullets,
      outputPath,
      tmpDir,
      falModel,
    })

    // Music on the final reel only — the raw background must stay clean
    // because S2 re-overlays and re-scores it independently.
    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
    })

    // Upload the raw (pre-overlay) background so S2 can reuse it with fresh bullets.
    const rawPath = path.join(tmpDir, 'reel-raw.mp4')
    const [uploaded, rawUploaded] = await Promise.all([
      uploadVideoFile({
        userId: opts.userId,
        filePath: musicPath,
        s3Key: `social/${opts.userId}/${jobId}/video-reel-${genId}.mp4`,
        title: 'Video reel',
        width: probe.width,
        height: probe.height,
        jobId,
      }),
      uploadVideoFile({
        userId: opts.userId,
        filePath: rawPath,
        s3Key: `social/${opts.userId}/${jobId}/video-reel-raw-${genId}.mp4`,
        title: 'Video reel (raw background)',
        width: probe.width,
        height: probe.height,
        jobId,
      }),
    ])

    return {
      postType: 'video_reel' as const,
      ...uploaded,
      bullets,
      rawVideoUrl: rawUploaded.videoUrl,
      rawMediaId: rawUploaded.mediaId,
    }
  })
}

/**
 * Key-Takeaways music video (Phase 3, .plans/social-sections-kt-video plan):
 * a 5–7s content-related Seedance clip, washed with a DARK brand-color
 * overlay, the article's Key Takeaways as WHITE bullets VERBATIM, and
 * library music at −12 dB. No voiceover by design — the short loop is the
 * watch-time mechanic (readers replay to finish the bullets).
 */
export async function generateKtMusicVideoAsset(opts: {
  userId: string
  /** VERBATIM Key Takeaways text — parsed into bullets, never rewritten. */
  keyTakeawaysText: string
  topic: string
  jobId?: string
}): Promise<{ postType: 'kt_music_video'; videoUrl: string; mediaId: string; width: number; height: number }> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  const [brand, videoModelTemplate] = await Promise.all([
    loadSocialBrandTheme(opts.userId),
    loadPromptTemplate(207, { userId: opts.userId }),
  ])
  const falModel = videoModelTemplate?.defaultModel ?? 'fal-ai/bytedance/seedance/v1/lite/text-to-video'

  // Verbatim bullets: split lines, strip list markers, keep the words untouched.
  const bullets = opts.keyTakeawaysText
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0)
    // The source text often opens with its own "Key Takeaways" heading —
    // that's a label, not a takeaway.
    .filter((l) => !/^key takeaways?\s*:?$/i.test(l))
    .slice(0, 6)
  if (bullets.length === 0) throw new Error('KT music video: no takeaway bullets found')

  // Dark brand overlay: primary brand color, darkened until white text clears
  // it comfortably (relative luminance ≤ 0.10 — a bright brand blue at 0.18
  // still read as a light wash in QA).
  const veilColor = darkBrandVeilHex(brand.primaryColor)

  // Content-related background clip (user spec: content imagery, not brand-
  // palette abstract) — same prompt generator the video reel uses.
  const videoPrompt = await generateVideoReelPrompt({
    userId: opts.userId,
    topic: opts.topic,
    details: opts.keyTakeawaysText.slice(0, 1500),
    specialInstructions: brand.videoSpecialInstructions,
    videoModel: falModel,
  })

  return withTempDir('kt-music-video-', async (tmpDir) => {
    const seedanceUrl = await generateSeedanceClip({
      prompt: videoPrompt,
      duration: '6',
      resolution: '720p',
      aspectRatio: '9:16',
      model: falModel,
    })
    const rawPath = path.join(tmpDir, 'kt-raw.mp4')
    await downloadSeedanceClip(seedanceUrl, rawPath)

    const overlaidPath = path.join(tmpDir, 'kt-overlaid.mp4')
    await overlayBulletsOnVideo(rawPath, overlaidPath, bullets, undefined, veilColor, 0.85)

    const probe = await probeVideo(overlaidPath)
    const musicPath = await addBackgroundMusic(overlaidPath, tmpDir, {
      videoDuration: probe.duration,
      baseGainDb: 12,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/kt-music-video-${genId}.mp4`,
      title: 'Key Takeaways video',
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return { postType: 'kt_music_video' as const, ...uploaded, width: probe.width, height: probe.height }
  })
}

/** Darken a brand hex until white text reads comfortably on it (L ≤ 0.18). */
function darkBrandVeilHex(brandHex: string | null | undefined): string {
  const hex = /^#?[0-9a-fA-F]{6}$/.test((brandHex ?? '').trim())
    ? (brandHex as string).trim().replace(/^#/, '')
    : '052234'
  let r = parseInt(hex.slice(0, 2), 16)
  let g = parseInt(hex.slice(2, 4), 16)
  let b = parseInt(hex.slice(4, 6), 16)
  for (let i = 0; i < 8 && relativeLuminance(rgbHex(r, g, b)) > 0.1; i++) {
    r = Math.round(r * 0.75)
    g = Math.round(g * 0.75)
    b = Math.round(b * 0.75)
  }
  return `0x${hex2(r)}${hex2(g)}${hex2(b)}`
}
const hex2 = (n: number) => n.toString(16).padStart(2, '0')
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`

/**
 * S2: reuse F2's raw Seedance background but generate fresh bullets from a
 * different content section, producing a unique story video.
 */
export async function generateStoriesReelAsset(opts: {
  userId: string
  /** Raw (pre-overlay) background video URL from F2. */
  rawVideoUrl: string
  /** Content for this slot's bullet generation (different H2 section from F2). */
  content: string
  topic?: string
  jobId?: string
}): Promise<GeneratedVideoReel> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  const brand = await loadSocialBrandTheme(opts.userId)

  const topic = opts.topic?.trim() ||
    opts.content.replace(/<[^>]+>/g, ' ').split(/[\n.!?]/)[0]?.trim().slice(0, 200) ||
    brand.organizationName

  const { headline, bullets } = await extractReelBullets({
      userId: opts.userId,
    content: opts.content,
    topic,
    details: opts.content.replace(/<[^>]+>/g, ' ').slice(0, 1500),
    specialInstructions: brand.videoSpecialInstructions,
  })

  return withTempDir('stories-reel-', async (tmpDir) => {
    const rawPath    = path.join(tmpDir, 'reel-raw.mp4')
    const loopedPath = path.join(tmpDir, 'reel-looped.mp4')
    const finalPath  = path.join(tmpDir, 'reel-overlay.mp4')

    await downloadToFile(opts.rawVideoUrl, rawPath)

    // Loop the ~6s background 3× (stream copy — no re-encode) BEFORE the
    // overlay so the bullets stay on screen for the full story read time.
    await loopVideo(rawPath, loopedPath, 3)

    if (headline) {
      await overlayTitleAndBulletsOnVideo(loopedPath, finalPath, headline, bullets)
    } else {
      await overlayBulletsOnVideo(loopedPath, finalPath, bullets)
    }

    const probe = await probeVideo(finalPath)
    assertStoryVideoConstraints(probe)

    const musicPath = await addBackgroundMusic(finalPath, tmpDir, {
      videoDuration: probe.duration,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/stories-reel-${genId}.mp4`,
      title: 'Stories reel',
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return {
      postType: 'video_reel' as const,
      ...uploaded,
      bullets,
      rawVideoUrl: opts.rawVideoUrl,
      rawMediaId: '',
    }
  })
}

export async function generateHookVideoAsset(opts: {
  userId: string
  content: string
  title?: string
  slideCount?: number
  jobId?: string
}): Promise<GeneratedHookVideo> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const slideCount = Math.min(Math.max(6, opts.slideCount ?? 6), 12)

  logger.info({ userId: opts.userId, jobId, slideCount, genId }, 'generateHookVideoAsset: start')

  // Admin-configurable F6 models (Step 217 = intro video, Step 218 = slideshow images).
  const [videoTpl, imageTpl] = await Promise.all([loadPromptTemplate(217, { userId: opts.userId }), loadPromptTemplate(218, { userId: opts.userId })])
  const hookVideoModel = videoTpl?.defaultModel ?? 'fal-ai/bytedance/seedance/v1/lite/text-to-video'
  const hookImageModel = imageTpl?.defaultModel ?? 'fal-ai/flux/schnell'

  const [carousel, brand, voice] = await Promise.all([
    generateCarouselAssets({
      userId: opts.userId,
      content: opts.content,
      slideCount,
      jobId,
      imageModel: hookImageModel,
    }),
    loadSocialBrandTheme(opts.userId),
    getVoiceSettings(opts.userId),
  ])

  const title = opts.title?.trim() || carousel.slides[0]?.headline || 'Watch this'

  // Content slides are everything after the hook/title slide (index 0).
  // The title is overlaid directly on the Seedance intro clip, so slide 0 is not
  // needed in the slideshow and would create a duplicate title frame.
  const contentSlideUrls = carousel.imageUrls.slice(1)

  // Build spoken text for each content slide from its headline + body paragraphs.
  // Slide 0 (hook) is omitted — title is spoken on the Seedance intro instead.
  const contentSlideTexts = carousel.slidePlans.slice(1).map((plan) => {
    const parts: string[] = []
    if (plan.headlineText?.trim()) parts.push(plan.headlineText.trim())
    if (plan.bodyText?.trim()) {
      const para = plan.bodyText.trim().replace(/\n+/g, ' ')
      parts.push(para)
    }
    return parts.join('. ')
  })

  const topic = title
  const details = opts.content.replace(/<[^>]+>/g, ' ').slice(0, 1500)

  // Generate Seedance video prompt (narration is now derived from slide plans)
  const hookVideoPrompt = await generateVideoReelPrompt({
      userId: opts.userId,
    topic,
    details,
    specialInstructions: brand.videoSpecialInstructions,
    videoModel: hookVideoModel,
  })

  return withTempDir('hook-video-', async (tmpDir) => {
    const outputPath = path.join(tmpDir, 'hook.mp4')

    // Voiceover: synthesize one narration clip per content slide so each slide
    // is held for exactly the length of its own speech, and the contiguous body
    // audio is muxed after the intro by buildHookVideo.
    let voiceAudioPath: string | undefined
    let slideDurations: number[] | undefined
    const secondsPerSlide = 4 // fallback when voiceover is disabled

    const hasText = contentSlideTexts.some((t) => t.trim().length > 0)

    logger.info(
      {
        hasText,
        voiceoverEnabled: voice.voiceoverEnabled,
        hasApiKey: !!voice.apiKey,
        hasVoiceId: !!voice.voiceId,
        slideCount: contentSlideTexts.length,
      },
      'generateHookVideoAsset: voiceover check',
    )

    if (hasText && voice.voiceoverEnabled && voice.apiKey && voice.voiceId) {
      try {
        logger.info({ slideCount: contentSlideTexts.length }, 'generateHookVideoAsset: narration start')
        const narration = await buildPerSlideNarration({
          apiKey: voice.apiKey,
          voiceId: voice.voiceId,
          modelId: voice.modelId,
          stability: voice.stability,
          similarity: voice.similarity,
          speed: voice.speed,
          // Index-aligned with contentSlideUrls so durations map to slides.
          slideTexts: contentSlideTexts,
          tmpDir,
        })
        voiceAudioPath = narration.audioPath
        slideDurations = narration.slideDurations
        logger.info(
          { slideDurations, audioPath: narration.audioPath },
          'generateHookVideoAsset: narration complete',
        )
      } catch (err) {
        logger.error({ err }, 'generateHookVideoAsset: narration failed — falling back to silent slideshow')
      }
    }

    logger.info(
      { hasVoiceAudio: !!voiceAudioPath, slideDurations },
      'generateHookVideoAsset: calling buildHookVideo',
    )
    const { probe, hookRawPath, introDuration } = await buildHookVideo({
      title,
      hookPrompt: hookVideoPrompt,
      falModel: hookVideoModel,
      // Pure T2V — no image input so Seedance has a clean background without
      // any baked-in text from the carousel hook slide.
      hookImageUrl: undefined,
      slideshowImageUrls: contentSlideUrls,
      outputPath,
      tmpDir,
      secondsPerSlide,
      slideDurations,
      voiceAudioPath,
    })
    logger.info({ width: probe.width, height: probe.height }, 'generateHookVideoAsset: video built')

    // Music: full level over the title intro, ducked when narration starts.
    // Silent (no-voiceover) videos get full-level music throughout.
    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
      duckAtSec: voiceAudioPath ? introDuration : undefined,
    })

    // Upload raw hook clip to S3 so S6 can reuse it (crop to 9:16) without
    // paying for a new Fal.ai generation.
    const [uploaded, rawHookUploaded] = await Promise.all([
      uploadVideoFile({
        userId: opts.userId,
        filePath: musicPath,
        s3Key: `social/${opts.userId}/${jobId}/hook-video-${genId}.mp4`,
        title: `Hook video — ${title.slice(0, 40)}`,
        width: probe.width,
        height: probe.height,
        jobId,
      }),
      uploadVideoFile({
        userId: opts.userId,
        filePath: hookRawPath,
        s3Key: `social/${opts.userId}/${jobId}/hook-raw-${genId}.mp4`,
        title: `Hook raw clip — ${title.slice(0, 40)}`,
        width: probe.width,
        height: probe.height,
        jobId,
      }),
    ])

    return {
      postType: 'hook_video',
      ...uploaded,
      title,
      carouselImageUrls: carousel.imageUrls,
      carouselBackgroundImageUrls: carousel.backgroundImageUrls,
      hookRawVideoUrl: rawHookUploaded.videoUrl,
    }
  })
}

export async function generateQuoteVideoAsset(opts: {
  userId: string
  content: string
  quoteCount?: number
  jobId?: string
  useNarrationPrompt?: boolean
}): Promise<GeneratedQuoteVideo> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const quoteCount = Math.min(Math.max(2, opts.quoteCount ?? 3), 5)

  return withTempDir('quote-video-', async (tmpDir) => {
    const quoteUrls: string[] = []
    // Collect per-slide spoken text for timestamp-based slide sync.
    const slideTexts: string[] = []

    // Extract all quotes in ONE call so the slides cover different ideas —
    // independent per-card extraction on the same content returns the same
    // insight reworded N times.
    let batchQuotes: Awaited<ReturnType<typeof selectQuotesForCards>> = []
    try {
      const brand = await loadSocialBrandTheme(opts.userId)
      batchQuotes = await selectQuotesForCards({
      userId: opts.userId,
        content: opts.content,
        organizationName: brand.organizationName,
        count: quoteCount,
      })
    } catch (err) {
      logger.warn({ err }, 'generateQuoteVideoAsset: batch quote selection failed — falling back to per-card extraction')
    }

    for (let i = 0; i < quoteCount; i++) {
      const card = await generateQuoteCardAsset({
        userId: opts.userId,
        content: opts.content,
        variant: 'story',
        // Distinct pre-extracted quote when available; per-card extraction otherwise.
        quoteText: batchQuotes[i]?.quote,
        attribution: batchQuotes[i]?.attribution,
        jobId,
      })
      quoteUrls.push(card.imageUrl)
      // Use the actual quote text so ElevenLabs timing maps exactly to each slide.
      slideTexts.push(card.quoteText.trim())
    }

    const outputPath = path.join(tmpDir, 'quote-video.mp4')
    const { probe, voiceoverUsed } = await buildQuoteVideo({
      userId: opts.userId,
      quoteImageUrls: quoteUrls,
      slideTexts,
      outputPath,
      secondsPerSlide: 4,
    })

    // No title slide — narrated quote videos run music ducked from the start.
    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
      duckAtSec: voiceoverUsed ? 0 : undefined,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/quote-video-${genId}.mp4`,
      title: 'Quote video',
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return { postType: 'quote_video' as const, ...uploaded, voiceoverUsed }
  })
}

/**
 * S4: 9:16 story video.
 * Slide 1 = F4 raw hook background, center-cropped to 1080×1920, with title
 *   overlaid as a full-width strip (fade-in).
 * Slide 2 = F4 raw background (content slide 1) center-cropped to 9:16 with a
 *   full-frame dark overlay + uniquely LLM-generated pitch text (centered, white).
 */
export async function generateStoryCarouselVideo(opts: {
  userId: string
  /** Title to overlay on the first slide (S4 title screen). */
  title: string
  /** imageUrls[0] = pre-baked F4 hook slide (unused for title, only for fallback). */
  imageUrls: string[]
  /** backgroundImageUrls[0] = raw hook background; [1] = raw background for content slide 1. */
  backgroundImageUrls: string[]
  /** S4's own article section text — used to generate the pitch copy. */
  content: string
  topic: string
  jobId?: string
}): Promise<{ postType: 'pitch_carousel'; videoUrl: string; mediaId: string }> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  // Raw background for the title slide (slide 0) and the pitch slide (slide 1)
  const titleBgUrl = opts.backgroundImageUrls[0] ?? opts.imageUrls[0]
  const pitchBgUrl = opts.backgroundImageUrls[1] ?? opts.backgroundImageUrls[0]
  if (!titleBgUrl) throw new Error('generateStoryCarouselVideo: no backgroundImageUrls provided')
  if (!pitchBgUrl) throw new Error('generateStoryCarouselVideo: no backgroundImageUrls provided')

  // Fetch both backgrounds in parallel, and generate the pitch text + voice settings
  const [titleBgResp, pitchBgResp, pitchCopy, voice, brand] = await Promise.all([
    fetch(titleBgUrl),
    fetch(pitchBgUrl),
    generatePitchSlideText({ topic: opts.topic, content: opts.content, pitchType: 'carousel', userId: opts.userId }),
    getVoiceSettings(opts.userId),
    loadSocialBrandTheme(opts.userId),
  ])

  const [titleBgBuffer, pitchBgBuffer] = await Promise.all([
    titleBgResp.arrayBuffer().then(Buffer.from),
    pitchBgResp.arrayBuffer().then(Buffer.from),
  ])

  // Crop title background to 1080×1920, composite pitch slide overlay
  const [titleBgCropped, pitchPng] = await Promise.all([
    cropBufferToStoryAspect(titleBgBuffer),
    buildPitchSlidePng(pitchBgBuffer, pitchCopy.pitch, pitchCopy.cta),
  ])

  // Register pitch PNG to S3 so buildSlideshowVideo can download it by URL
  const pitchRegistered = await registerSocialMedia({
    userId: opts.userId,
    buffer: pitchPng,
    s3Key: `social/${opts.userId}/${jobId}/story-pitch-${genId}.png`,
    title: 'Story pitch slide',
    altText: `${pitchCopy.pitch} ${pitchCopy.cta}`,
    source: 'carousel_slide',
    jobId,
    width: 1080,
    height: 1920,
  })

  const titleDur = 4 + Math.floor(Math.random() * 4)

  return withTempDir('story-carousel-', async (tmpDir) => {
    // --- Optional voiceover for the pitch slide (slide 2) ---
    // Narrate the pitch copy when voiceover is enabled; the slide then holds for
    // the narration's length instead of a random duration.
    let pitchDur = 10 + Math.floor(Math.random() * 5)
    let narrationAudioPath: string | undefined
    // Narrate the pitch AND the CTA line ("watch the full video / view the full
    // carousel on our profile") so the voiceover speaks the call to action too.
    const pitchNarrationText = [pitchCopy.pitch, pitchCopy.cta]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(' ')
    if (voice.voiceoverEnabled && voice.apiKey && voice.voiceId && pitchNarrationText) {
      try {
        const narration = await buildPerSlideNarration({
          apiKey: voice.apiKey,
          voiceId: voice.voiceId,
          modelId: voice.modelId,
          stability: voice.stability,
          similarity: voice.similarity,
          speed: voice.speed,
          slideTexts: [pitchNarrationText],
          tmpDir,
        })
        pitchDur = narration.slideDurations[0] + 1.0 // small tail after speech
        narrationAudioPath = narration.audioPath
      } catch (err) {
        logger.error({ err }, 'generateStoryCarouselVideo: pitch narration failed — silent pitch slide')
      }
    }

    // --- Slide 1: title screen ---
    const titleBgPng    = path.join(tmpDir, 'title-bg.png')
    const titleVideoRaw = path.join(tmpDir, 'title-raw.mp4')
    const titleVideoOut = path.join(tmpDir, 'title-titled.mp4')
    await fs.writeFile(titleBgPng, titleBgCropped)
    await runFfmpeg([
      '-loop', '1', '-t', String(titleDur),
      '-i', titleBgPng,
      '-pix_fmt', 'yuv420p', '-r', '30',
      titleVideoRaw,
    ])
    await overlayTitleOnVideoStripFadeIn(titleVideoRaw, titleVideoOut, opts.title, defaultFontPath(), 1.0, 0.5, darkBrandVeilHex(brand.primaryColor))

    // --- Slide 2: pitch slide ---
    const pitchVideoPath = path.join(tmpDir, 'pitch-slide.mp4')
    await buildSlideshowVideo({
      imageUrls: [pitchRegistered.url],
      outputPath: pitchVideoPath,
      variant: 'story',
      secondsPerSlide: pitchDur,
    })

    // --- Concat (silent) ---
    const concatPath = path.join(tmpDir, 'story-carousel.mp4')
    await concatVideos([titleVideoOut, pitchVideoPath], concatPath)

    // Mux the pitch narration so it starts when the pitch slide begins (after the title).
    let outputPath = concatPath
    if (narrationAudioPath) {
      const voicedPath = path.join(tmpDir, 'story-carousel-voiced.mp4')
      await muxVoiceover(concatPath, narrationAudioPath, titleDur, voicedPath)
      outputPath = voicedPath
    }

    const probe = await probeVideo(outputPath)

    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
      duckAtSec: narrationAudioPath ? titleDur : undefined,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/story-carousel-${genId}.mp4`,
      title: 'Story carousel video',
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return { postType: 'pitch_carousel', ...uploaded }
  })
}

/**
 * S6: 9:16 story video that REUSES F6's raw Seedance hook clip (no new Fal.ai call)
 * followed by a pitch slide built from F6's raw content background.
 *
 * Flow:
 *  1. Download F6's stored raw hook clip (1:1, 720p, no title)
 *  2. Center-crop to 9:16, then upscale to 1080×1920
 *  3. Overlay title with fade-in (matching F6's own title treatment)
 *  4. Download F6 raw background image, composite dark overlay + LLM pitch text (9:16)
 *  5. Concat intro clip + pitch slide
 */
export async function generateStoryHookVideo(opts: {
  userId: string
  title: string
  /** Article section text for the pitch copy. */
  content: string
  topic: string
  /** F6's stored raw Seedance clip (1:1, no title overlay). */
  hookRawVideoUrl: string
  /** F6's backgroundImageUrls[1] — raw background (no text) from F6 content slide 1. */
  backgroundImageUrl: string
  jobId?: string
}): Promise<{ postType: 'pitch_hook'; videoUrl: string; mediaId: string }> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  // Generate pitch text while we prepare the video assets
  const [pitchCopy, voice, hookBrand] = await Promise.all([
    generatePitchSlideText({
      userId: opts.userId,
      topic: opts.topic,
      content: opts.content,
      pitchType: 'hook',
    }),
    getVoiceSettings(opts.userId),
    loadSocialBrandTheme(opts.userId),
  ])

  // Download raw background and composite the 9:16 pitch slide PNG
  const bgResp   = await fetch(opts.backgroundImageUrl)
  const bgBuffer = Buffer.from(await bgResp.arrayBuffer())
  const pitchPng = await buildPitchSlidePng(bgBuffer, pitchCopy.pitch, pitchCopy.cta)

  // Register pitch PNG to S3 so buildSlideshowVideo can download it by URL
  const pitchRegistered = await registerSocialMedia({
    userId: opts.userId,
    buffer: pitchPng,
    s3Key: `social/${opts.userId}/${jobId}/story-pitch-${genId}.png`,
    title: 'Story pitch slide',
    altText: `${pitchCopy.pitch} ${pitchCopy.cta}`,
    source: 'carousel_slide',
    jobId,
    width: 1080,
    height: 1920,
  })

  return withTempDir('story-hook-', async (tmpDir) => {
    const hookDownloaded = path.join(tmpDir, 'hook-raw.mp4')
    const hookCropped    = path.join(tmpDir, 'hook-cropped.mp4')
    const hookScaled     = path.join(tmpDir, 'hook-scaled.mp4')
    const hookTitled     = path.join(tmpDir, 'hook-titled.mp4')
    const bodyPath       = path.join(tmpDir, 'hook-body.mp4')
    const concatPath     = path.join(tmpDir, 'story-hook.mp4')

    // Step 1 — Download F6's raw hook clip (reuse, no new Fal.ai cost)
    await downloadToFile(opts.hookRawVideoUrl, hookDownloaded)

    // Step 2 — Center-crop 1:1 to 9:16 (540×960), then upscale to 1080×1920
    await cropCenterToStoryAspect(hookDownloaded, hookCropped)
    await rescaleVideo(hookCropped, hookScaled, 1080, 1920)

    // Step 3 — Overlay title as a full-width strip with fade-in (9:16 strip design)
    await overlayTitleOnVideoStripFadeIn(hookScaled, hookTitled, opts.title, defaultFontPath(), 1.0, 0.5, darkBrandVeilHex(hookBrand.primaryColor))

    // The intro clip length is where the pitch slide (and its narration) begins.
    const introDur = (await probeVideo(hookTitled)).duration

    // Optional voiceover for the pitch slide: narrate the pitch copy when enabled;
    // the slide holds for the narration's length instead of a random duration.
    let secondsPerSlide = 10 + Math.floor(Math.random() * 5)
    let narrationAudioPath: string | undefined
    // Narrate the pitch AND the CTA line ("watch the full video / view the full
    // carousel on our profile") so the voiceover speaks the call to action too.
    const pitchNarrationText = [pitchCopy.pitch, pitchCopy.cta]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(' ')
    if (voice.voiceoverEnabled && voice.apiKey && voice.voiceId && pitchNarrationText) {
      try {
        const narration = await buildPerSlideNarration({
          apiKey: voice.apiKey,
          voiceId: voice.voiceId,
          modelId: voice.modelId,
          stability: voice.stability,
          similarity: voice.similarity,
          speed: voice.speed,
          slideTexts: [pitchNarrationText],
          tmpDir,
        })
        secondsPerSlide = narration.slideDurations[0] + 1.0 // small tail after speech
        narrationAudioPath = narration.audioPath
      } catch (err) {
        logger.error({ err }, 'generateStoryHookVideo: pitch narration failed — silent pitch slide')
      }
    }

    // Step 4 — Pitch slide as a timed clip (already 1080×1920)
    await buildSlideshowVideo({
      imageUrls: [pitchRegistered.url],
      outputPath: bodyPath,
      variant: 'story',
      secondsPerSlide,
    })

    // Step 5 — Concat intro clip + pitch slide (silent)
    await concatVideos([hookTitled, bodyPath], concatPath)

    // Mux the pitch narration so it starts when the pitch slide begins (after the intro).
    let outputPath = concatPath
    if (narrationAudioPath) {
      const voicedPath = path.join(tmpDir, 'story-hook-voiced.mp4')
      await muxVoiceover(concatPath, narrationAudioPath, introDur, voicedPath)
      outputPath = voicedPath
    }

    const probe = await probeVideo(outputPath)

    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
      duckAtSec: narrationAudioPath ? introDur : undefined,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/story-hook-${genId}.mp4`,
      title: `Story hook — ${opts.title.slice(0, 40)}`,
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return { postType: 'pitch_hook', ...uploaded }
  })
}

export async function generateLoopedReelAsset(opts: {
  userId: string
  sourceVideoUrl: string
  loopCount?: number
  jobId?: string
}): Promise<GeneratedLoopedReel> {
  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const loopCount = opts.loopCount ?? 3

  return withTempDir('loop-reel-', async (tmpDir) => {
    const outputPath = path.join(tmpDir, 'loop-reel.mp4')
    const probe = await buildLoopedStoryReel(opts.sourceVideoUrl, outputPath, loopCount)

    const musicPath = await addBackgroundMusic(outputPath, tmpDir, {
      videoDuration: probe.duration,
    })

    const uploaded = await uploadVideoFile({
      userId: opts.userId,
      filePath: musicPath,
      s3Key: `social/${opts.userId}/${jobId}/loop-reel-${genId}.mp4`,
      title: `Looped reel (${loopCount}×)`,
      width: probe.width,
      height: probe.height,
      jobId,
    })

    return { postType: 'video_reel' as const, ...uploaded, loopCount }
  })
}
