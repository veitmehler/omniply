/**
 * Fal.ai image generation for the article pipeline.
 * Uses system-owned API keys (not per-user keys).
 * Implements retry with exponential back-off.
 */

import { fal } from '@fal-ai/client'
import { getSystemApiKey } from '../lib/system-keys'
import { logger } from '../lib/logger'
import { loadPromptTemplate } from './enrichment/prompt-template'
import { withTimeout } from '../lib/net/with-timeout'
import { isRetryableNetworkError } from '../lib/net/retry'
import { instrumentCall } from '../lib/net/instrument'
import { generateWithGeminiImage, uploadBufferWithKey } from '@omniply/shared'
import { recordMediaCost } from '../lib/media-costs'

const DEFAULT_FAL_MODEL = 'fal-ai/flux-pro'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5_000
/** Bound each attempt — without this, a hung call never reaches the retry loop below. */
const FAL_IMAGE_TIMEOUT_MS = 3 * 60 * 1000

/** Read the configured image model from the DB (step 150), falling back to the
 * fal default. Accepts fal-ai/* and gemini* (direct Google) model ids. */
async function resolveImageModel(): Promise<string> {
  try {
    const t = await loadPromptTemplate(150)
    if (t?.defaultModel && (t.defaultModel.startsWith('fal-ai/') || t.defaultModel.startsWith('gemini'))) {
      return t.defaultModel
    }
  } catch {
    // non-fatal — use default
  }
  return DEFAULT_FAL_MODEL
}

interface FalResult {
  data?: { images?: Array<{ url: string } | string>; image?: { url: string } | string; url?: string }
  images?: Array<{ url: string } | string>
  image?: { url: string } | string
  url?: string
}

function extractImageUrl(result: FalResult): string | null {
  const d = (result.data ?? result) as FalResult
  if (d.images && Array.isArray(d.images) && d.images.length > 0) {
    const first = d.images[0]
    return typeof first === 'string' ? first : (first?.url ?? null)
  }
  if (d.image) {
    return typeof d.image === 'string' ? d.image : (d.image?.url ?? null)
  }
  if (d.url) return d.url
  return null
}

/** Generate a featured image and return a remote image URL. Routes by the
 * configured model: gemini* → direct Google API (buffer uploaded to S3);
 * fal-ai/* → Fal. Gemini failures fall back to the fal default model. */
export async function generateFeaturedImage(
  imagePrompt: string,
  jobId: string,
  userId?: string | null,
): Promise<string> {
  let falModel = await resolveImageModel()

  // Truncate prompt to avoid API limits
  const prompt = imagePrompt.slice(0, 2_000)

  if (falModel.startsWith('gemini')) {
    const geminiKey = await getSystemApiKey('gemini')
    if (geminiKey) {
      try {
        const buf = await instrumentCall({ provider: 'gemini', op: `image:${falModel}` }, () =>
          withTimeout(
            () => generateWithGeminiImage(geminiKey, prompt, falModel, '16:9'),
            FAL_IMAGE_TIMEOUT_MS,
            `gemini-image:${falModel}`,
          ),
        )
        const key = `tmp/featured/${jobId}-${Date.now()}.png`
        const { url } = await uploadBufferWithKey(key, buf, 'image/png')
        logger.info({ jobId, model: falModel }, '[image-gen] featured image generated (gemini direct)')
        await recordMediaCost(userId, 'article_featured_image', 'gemini-image', falModel)
        return url
      } catch (err) {
        logger.warn({ jobId, model: falModel, err }, '[image-gen] gemini featured image failed — falling back to fal')
      }
    } else {
      logger.warn({ jobId }, '[image-gen] no gemini system key — falling back to fal')
    }
    falModel = DEFAULT_FAL_MODEL
  }

  const apiKey = await getSystemApiKey('fal-ai')
  if (!apiKey) throw new Error('No Fal.ai system API key configured')

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fal.config({ credentials: apiKey })

      const result = await instrumentCall({ provider: 'fal-ai', op: `image:${falModel}` }, () =>
        withTimeout(
          (signal) =>
            fal.subscribe(falModel, {
              input: {
                prompt,
                image_size: 'landscape_16_9',
                num_inference_steps: 28,
                guidance_scale: 3.5,
              },
              pollInterval: 3_000,
              logs: false,
              abortSignal: signal,
            }),
          FAL_IMAGE_TIMEOUT_MS,
          `fal-image:${falModel}`,
        ),
      )

      const imageUrl = extractImageUrl(result as FalResult)
      if (!imageUrl) throw new Error('Fal.ai returned no image URL in response')

      logger.info({ jobId, attempt, model: falModel }, '[image-gen] featured image generated')
      await recordMediaCost(
        userId,
        'article_featured_image',
        falModel.includes('schnell') ? 'fal-flux-schnell' : falModel.includes('recraft') ? 'fal-recraft' : 'fal-flux-pro',
        falModel,
      )
      return imageUrl
    } catch (err) {
      lastErr = err
      logger.warn({ jobId, attempt, err }, '[image-gen] fal.ai attempt failed')
      // Auth/balance/validation failures (e.g. the 2026-07-08 Fal 403 "Exhausted
      // balance" incident) won't be fixed by retrying — fail fast instead of
      // burning the full retry budget on an error retries cannot resolve.
      if (!isRetryableNetworkError(err)) throw err
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt))
      }
    }
  }

  throw lastErr
}
