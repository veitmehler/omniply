import { fal } from '@fal-ai/client'
import { getSystemApiKey } from '../../lib/system-keys'
import { recordMediaCost } from '../../lib/media-costs'
import { logger } from '../../lib/logger'
import { withTimeout } from '../../lib/net/with-timeout'
import { withRetry } from '../../lib/net/retry'
import { instrumentCall } from '../../lib/net/instrument'

/** Default Seedance v1 lite image-to-video at 720p (~$0.18–0.34 per 5s clip). */
export const DEFAULT_SEEDANCE_I2V_MODEL = 'fal-ai/bytedance/seedance/v1/lite/image-to-video'
export const DEFAULT_SEEDANCE_T2V_MODEL = 'fal-ai/bytedance/seedance/v1/lite/text-to-video'

/**
 * Bound each Seedance call — the 2026-07-08 incident was exactly this call
 * hanging with no timeout, wedging the worker's single social-generate slot
 * for every client. 8 minutes covers legitimate video generation time.
 */
const SEEDANCE_TIMEOUT_MS = 8 * 60 * 1000

export interface SeedanceOptions {
  prompt: string
  imageUrl?: string
  duration?: '5' | '6' | '7' | '8' | '9' | '10'
  resolution?: '480p' | '720p'
  aspectRatio?: '1:1' | '9:16' | '16:9'
  jobId?: string
  /** Cost attribution (audit 2026-10-09) — the clip's owner. */
  userId?: string | null
  /** Override the Fal.ai model slug. Defaults to the appropriate Seedance T2V or I2V model. */
  model?: string
}

interface SeedanceResult {
  data?: { video?: { url?: string } | string; url?: string }
  video?: { url?: string } | string
}

function extractVideoUrl(result: unknown): string | null {
  const r = result as SeedanceResult
  const d = r.data ?? r
  if (typeof d.video === 'string') return d.video
  if (d.video && typeof d.video === 'object') return d.video.url ?? null
  if ('url' in d && typeof d.url === 'string') return d.url
  return null
}

/** Generate a short Seedance clip via fal.ai (system key). Returns remote MP4 URL. */
export async function generateSeedanceClip(opts: SeedanceOptions): Promise<string> {
  const apiKey = await getSystemApiKey('fal-ai')
  if (!apiKey) throw new Error('No Fal.ai system API key configured')

  const model = opts.model ?? (opts.imageUrl ? DEFAULT_SEEDANCE_I2V_MODEL : DEFAULT_SEEDANCE_T2V_MODEL)
  fal.config({ credentials: apiKey })

  const input = {
    prompt: opts.prompt.slice(0, 2000),
    resolution: opts.resolution ?? '720p',
    duration: opts.duration ?? '5',
    aspect_ratio: opts.aspectRatio ?? '1:1',
    ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
  }

  const result = await instrumentCall({ provider: 'fal-ai', op: `seedance:${model}` }, () =>
    withRetry(
      () =>
        withTimeout(
          (signal) =>
            fal.subscribe(model, {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              input: input as any,
              pollInterval: 4000,
              logs: false,
              abortSignal: signal,
            }),
          SEEDANCE_TIMEOUT_MS,
          `seedance:${model}`,
        ),
      {
        attempts: 2, // one retry — video generation is expensive; cap the blast radius
        onRetry: (err) => logger.warn({ jobId: opts.jobId, model, err }, '[seedance] retrying after failure'),
      },
    ),
  )

  const url = extractVideoUrl(result as SeedanceResult)
  if (!url) throw new Error('Seedance returned no video URL')

  logger.info({ jobId: opts.jobId, model }, '[seedance] clip generated')
  await recordMediaCost(opts.userId, 'social_video_clip', 'fal-seedance-video', model)
  return url
}

export async function downloadSeedanceClip(url: string, destPath: string): Promise<void> {
  const { downloadToFile } = await import('./ffmpeg')
  await downloadToFile(url, destPath)
}
