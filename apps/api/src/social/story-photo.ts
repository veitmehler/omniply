/**
 * Story photo (Veit 2026-09-17): one cheap Nano Banana photograph behind a
 * story-carousel content slide — visual variety that tells the slide's story.
 * Client accounts only (the azavea motif design is exempt at the call site).
 */
import { getSystemApiKey } from '../lib/system-keys'
import { generateWithGeminiImage } from '@omniply/shared'
import { registerSocialMedia } from './media-register'
import { logger } from '../lib/logger'

const STORY_PHOTO_MODEL = 'gemini-3.1-flash-image'

export async function generateStoryPhoto(
  userId: string,
  jobId: string,
  slideText: string,
): Promise<string | null> {
  const key = await getSystemApiKey('gemini')
  if (!key) return null
  const prompt =
    `Editorial photograph for a chiropractic clinic's social media, illustrating this message: "${slideText.slice(0, 280)}". ` +
    'Warm, professional, natural light, real-world setting, shallow depth of field. ' +
    'STRICTLY: no text, no letters, no captions, no logos, no watermarks, no medical gore, tasteful and family-friendly.'
  try {
    const buffer = await generateWithGeminiImage(key, prompt, STORY_PHOTO_MODEL, '1:1')
    const reg = await registerSocialMedia({
      userId,
      buffer,
      s3Key: `social/${userId}/${jobId}/story-photo-${Date.now()}.png`,
      title: 'Story photo',
      altText: slideText.slice(0, 120),
      source: 'carousel_slide',
      jobId,
    })
    return reg.url
  } catch (err) {
    logger.warn({ err, userId }, '[story-photo] generation failed — motif fallback')
    return null
  }
}
