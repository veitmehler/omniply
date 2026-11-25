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
import { recordMediaCost, recordMediaSpend, geminiImageKind, FAL_IMAGE_MODEL } from '../lib/media-costs'

const DEFAULT_FAL_MODEL = FAL_IMAGE_MODEL
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

const NO_TEXT_OPENING = 'An image with NO text in it.'
const NO_TEXT_RULE =
  'The image contains no text of any kind: no words, letters, numbers, titles, headlines, captions, labels, signs, logos or watermarks. Do not write the article\'s title, or any part of it, into the image.'

/**
 * The prompt a featured image is generated from (Veit, 2026-11-25: "NO text on
 * the image. Must be a rule").
 *
 * The image prompt written at step 15 names the article ("captures the essence
 * of the article titled \"...\""), and the image model sometimes took that as
 * an order to print the title. One came out reading "Why Your lower Back Aching
 * Aches after Siting all Day?". So the rule is added here, in code, on every
 * call, whatever the prompt says: the quoted title becomes a plain description
 * of the subject, and a no-text rule opens and closes the prompt. The body is
 * cut to fit so the closing rule is never the part that gets truncated.
 */
export function featuredImagePrompt(raw: string): string {
  const body = (raw || '')
    .replace(/\*\*\s*image generation prompt:?\s*\*\*:?/i, '')
    .replace(/\b(article|post|blog post|piece|guide)\s+(?:titled|called|entitled|named)\s+["“”']([^"“”]{3,200})["“”']/gi, '$1 on this subject: $2')
    .replace(/\s+\n/g, '\n')
    .trim()
  const room = 2_000 - NO_TEXT_OPENING.length - NO_TEXT_RULE.length - 4
  return `${NO_TEXT_OPENING}\n${body.slice(0, room)}\n\n${NO_TEXT_RULE}`
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

  const prompt = featuredImagePrompt(imagePrompt)

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
        await recordMediaCost(userId, 'article_featured_image', geminiImageKind(falModel), falModel)
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
      recordMediaSpend('fal-ai', falModel)
      await recordMediaCost(
        userId,
        'article_featured_image',
        falModel.includes('schnell') ? 'fal-flux-schnell' : falModel.includes('recraft') ? 'fal-recraft' : falModel.includes('flux/dev') ? 'fal-flux-dev' : 'fal-flux-pro',
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
