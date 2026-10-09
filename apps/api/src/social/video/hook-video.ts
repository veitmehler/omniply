import path from 'node:path'
import fs from 'node:fs/promises'
import {
  buildTitleFadeFilters,
  defaultFontPath,
  downloadToFile,
  overlayBulletsOnVideo,
  overlayTitleAndBulletsOnVideo,
  probeVideo,
  runFfmpeg,
  type VideoProbe,
} from './ffmpeg'
import { generateSeedanceClip, downloadSeedanceClip } from './seedance'
import { slideshowDimensions } from './slideshow-video'
import { logger } from '../../lib/logger'

export interface HookVideoOptions {
  userId?: string | null
  title: string
  hookPrompt: string
  hookImageUrl?: string
  slideshowImageUrls: string[]
  outputPath: string
  tmpDir: string
  hookDuration?: '5'
  /** Uniform seconds-per-slide fallback when voiceover is disabled. Defaults to 4. */
  secondsPerSlide?: number
  /** Per-slide durations (seconds) — each slide holds its own duration. When
   *  provided, slideDurations.length must equal slideshowImageUrls.length. */
  slideDurations?: number[]
  /** Contiguous body-narration track (length == sum of slide durations). Muxed
   *  directly onto the slideshow body so narration starts on the first content slide. */
  voiceAudioPath?: string
  /** Override the Fal.ai video model for the intro clip (admin Step 217). Defaults to Seedance T2V. */
  falModel?: string
}

export interface HookVideoResult {
  probe: VideoProbe
  /** Local path to the raw (pre-title, pre-concat) Seedance clip — caller should upload to S3. */
  hookRawPath: string
  /** Effective intro length (after any in-graph trim) — narration/music duck offset. */
  introDuration: number
}

const MAX_INTRO_SECS = 5
const FEED_DIMS = slideshowDimensions('feed')

/** F6: Seedance intro clip with title overlay (visible from the first frame) + content slideshow with optional voiceover.
 *
 * Single-pass assembly: the caller has already produced the narration and the
 * per-slide durations from the ElevenLabs timestamps, so everything that is
 * known up front (intro length from one ffprobe, slide timings, the narration
 * start offset) is laid out in ONE filter graph and encoded exactly once:
 *
 *  - intro: trimmed in-graph when Seedance overshoots, scaled/padded, title
 *    box overlaid (fully visible from the first frame)
 *  - slides: image inputs with per-slide `-t` durations, scaled/padded
 *  - video: concat of intro + slides
 *  - audio: narration delayed by the intro duration (silent intro lead-in);
 *    silent track when voiceover is disabled
 */
export async function buildHookVideo(opts: HookVideoOptions): Promise<HookVideoResult> {
  logger.info(
    { slideCount: opts.slideshowImageUrls.length, hasVoiceAudio: !!opts.voiceAudioPath },
    'buildHookVideo: start — generating Seedance clip',
  )
  const hookUrl = await generateSeedanceClip({
    userId: opts.userId,
    prompt: opts.hookPrompt,
    imageUrl: opts.hookImageUrl,
    duration: opts.hookDuration ?? '5',
    resolution: '720p',
    aspectRatio: '1:1',
    model: opts.falModel,
  })
  logger.info({ hookUrl }, 'buildHookVideo: Seedance clip generated')

  const hookRaw = path.join(opts.tmpDir, 'hook-raw.mp4')
  await downloadSeedanceClip(hookUrl, hookRaw)

  // One probe gives both the in-graph trim decision (Seedance sometimes
  // returns clips much longer than the requested duration) and the exact
  // offset at which the narration must start.
  const introProbe = await probeVideo(hookRaw)
  const needsTrim = introProbe.duration > MAX_INTRO_SECS + 0.5
  const introDuration = needsTrim ? MAX_INTRO_SECS : introProbe.duration
  if (needsTrim) {
    logger.info(
      { originalDuration: introProbe.duration, trimmedTo: MAX_INTRO_SECS },
      'buildHookVideo: intro will be trimmed in-graph',
    )
  }

  const localImages: string[] = []
  for (let i = 0; i < opts.slideshowImageUrls.length; i++) {
    const localPath = path.join(opts.tmpDir, `slide-${i}.png`)
    await downloadToFile(opts.slideshowImageUrls[i], localPath)
    localImages.push(localPath)
  }
  if (localImages.length === 0) throw new Error('No images provided for hook video slideshow')

  const slideDurations = localImages.map(
    (_, i) => opts.slideDurations?.[i] ?? opts.secondsPerSlide ?? 4,
  )

  const { width, height } = FEED_DIMS
  const fps = 30
  const scalePad =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`

  // Title overlay laid out at the output resolution (text is rendered at
  // 1080p instead of being upscaled from the 720p Seedance frame). The title
  // is visible from the first frame, so it is baked straight into the intro
  // stream (no split/blend — see titleFadeGraph's ffmpeg-8 note).
  const { overlayChain } = await buildTitleFadeFilters(
    opts.tmpDir, opts.title, width, height, defaultFontPath(),
  )

  const introTrim = needsTrim ? `trim=duration=${MAX_INTRO_SECS},setpts=PTS-STARTPTS,` : ''
  const n = localImages.length
  const audioInputIndex = n + 1
  const introDelayMs = Math.round(introDuration * 1000)

  const filterParts = [
    `[0:v]${introTrim}${scalePad},${overlayChain}[v0]`,
    ...localImages.map((_, i) => `[${i + 1}:v]${scalePad}[v${i + 1}]`),
    `${Array.from({ length: n + 1 }, (_, i) => `[v${i}]`).join('')}concat=n=${n + 1}:v=1:a=0[vout]`,
    opts.voiceAudioPath
      ? `[${audioInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
        `adelay=${introDelayMs}|${introDelayMs},apad[aout]`
      : `[${audioInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[aout]`,
  ]

  logger.info(
    { introDuration, slideDurations, hasVoiceAudio: !!opts.voiceAudioPath },
    'buildHookVideo: single-pass encode start',
  )

  await runFfmpeg([
    '-i', hookRaw,
    ...localImages.flatMap((img, i) => ['-loop', '1', '-t', String(slideDurations[i]), '-i', img]),
    ...(opts.voiceAudioPath
      ? ['-i', opts.voiceAudioPath]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']),
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    opts.outputPath,
  ])

  const probe = await probeVideo(opts.outputPath)
  logger.info({ duration: probe.duration, width: probe.width, height: probe.height }, 'buildHookVideo: complete')
  return { probe, hookRawPath: hookRaw, introDuration }
}

export interface VideoReelOptions {
  userId?: string | null
  prompt: string
  /** Optional background image sent to Seedance for image-to-video. Omit for pure text-to-video. */
  backgroundImageUrl?: string
  /** Headline displayed above the bullets using Helvetica Neue Regular. */
  headline?: string
  bullets: string[]
  outputPath: string
  tmpDir: string
  /** Override the Fal.ai model slug. Defaults to Seedance v1 Lite text-to-video. */
  falModel?: string
}

/** F2/S2: 9:16 Seedance background + dark veil + headline + ✓ bullet list. */
export async function buildVideoReel(opts: VideoReelOptions): Promise<VideoProbe> {
  const seedanceUrl = await generateSeedanceClip({
    userId: opts.userId,
    prompt: opts.prompt,
    imageUrl: opts.backgroundImageUrl,
    duration: '6',
    resolution: '720p',
    aspectRatio: '9:16',
    model: opts.falModel,
  })

  const rawPath = path.join(opts.tmpDir, 'reel-raw.mp4')
  const finalPath = path.join(opts.tmpDir, 'reel-overlay.mp4')
  await downloadSeedanceClip(seedanceUrl, rawPath)

  if (opts.headline) {
    await overlayTitleAndBulletsOnVideo(rawPath, finalPath, opts.headline, opts.bullets)
  } else {
    await overlayBulletsOnVideo(rawPath, finalPath, opts.bullets)
  }

  await fs.copyFile(finalPath, opts.outputPath)
  return probeVideo(opts.outputPath)
}

export { loopVideo, assertStoryVideoConstraints } from './ffmpeg'
