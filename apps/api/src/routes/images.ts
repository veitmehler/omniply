import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { getSystemApiKey } from '../lib/system-keys'
import {
  generateImagePromptWithLLM,
  generateSimpleImagePrompt,
  generateWithFalAI,
  generateWithOpenAIDALLE,
  generateWithReplicate,
} from '@omniply/shared'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { requireAuth } from '../middleware/auth'
import { safeErrorDetail } from '../lib/safe-error'
import { sniffImageMime, extForImageMime } from '../lib/image-sniff'

// ─── S3 helpers ──────────────────────────────────────────────────────────────

function getS3Client(): S3Client {
  const accessKeyId = process.env.ACCESS_KEY_ID
  const secretAccessKey = process.env.SECRET_ACCESS_KEY
  const region = process.env.S3_REGION ?? 'us-east-1'
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials: ACCESS_KEY_ID and SECRET_ACCESS_KEY must be set')
  }
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET env var is not set')
  return bucket
}

function getCdnBase(): string {
  const cdnBase = process.env.CDN_BASE
  if (!cdnBase) throw new Error('CDN_BASE env var is not set')
  return cdnBase.replace(/\/$/, '')
}

/**
 * Upload a Buffer to S3 and return the CDN URL.
 */
async function uploadBufferToS3(
  buffer: Buffer,
  userId: string,
  contentType: string,
  extension: string,
): Promise<{ url: string; path: string }> {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 9)
  const filePath = `${userId}/${timestamp}-${randomId}.${extension}`

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: filePath,
      Body: buffer,
      ContentType: contentType,
    }),
  )

  return { url: `${getCdnBase()}/${filePath}`, path: filePath }
}

/**
 * Delete a file from S3 by its storage path.
 */
async function deleteFromS3(filePath: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: filePath }))
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function getOrCreateUser(clerkId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (user) return user
  return prisma.user.create({
    data: { clerkId, name: clerkId, email: `${clerkId}@placeholder.local` },
  })
}

const IMAGE_SYSTEM_KEY_MAP: Record<string, string> = {
  fal: 'fal-ai',
  'openai-dalle': 'openai',
  replicate: 'replicate',
}

const LLM_PROVIDER_ORDER = ['openai', 'anthropic', 'gemini'] as const
const LLM_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-3.5-flash',
}

async function resolveSystemLLMProvider(): Promise<{
  provider: string; apiKey: string; model: string
} | null> {
  for (const prov of LLM_PROVIDER_ORDER) {
    const apiKey = await getSystemApiKey(prov)
    if (apiKey) return { provider: prov, apiKey, model: LLM_DEFAULT_MODELS[prov] }
  }
  return null
}

function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    fal: 'fal-ai/flux/schnell',
    'openai-dalle': 'dall-e-3',
    replicate: 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf',
  }
  return defaults[provider] || ''
}

function getSizeFromAspectRatio(aspectRatio?: string): string {
  const sizeMap: Record<string, string> = {
    '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
    '4:3': '1024x768', '3:4': '768x1024',
  }
  return sizeMap[aspectRatio || '1:1'] || '1024x1024'
}

function extractFilePathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    if (url.includes('supabase.co/storage')) {
      const match = urlObj.pathname.match(/\/storage\/v1\/object\/public\/post-images\/(.+)$/)
      return match ? match[1] : null
    }
    const path = urlObj.pathname.replace(/^\//, '')
    return path || null
  } catch {
    return null
  }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function imageRoutes(app: FastifyInstance) {
  // POST /api/images/generate
  app.post('/generate', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: any) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { postContent, styleInstructions, provider, model, aspectRatio, draftId, prompt: userPrompt } =
      request.body as {
        postContent?: string
        styleInstructions?: string
        provider?: string
        model?: string
        aspectRatio?: string
        draftId?: string
        prompt?: string
      }

    if (!postContent || typeof postContent !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: postContent' })
    }
    if (!provider || !['fal', 'openai-dalle', 'replicate'].includes(provider)) {
      return reply.status(400).send({
        error: 'Invalid provider. Must be one of: fal, openai-dalle, replicate',
      })
    }

    try {
      const user = await getOrCreateUser(clerkId)

      const systemKeyName = IMAGE_SYSTEM_KEY_MAP[provider] ?? provider
      const imageApiKey = await getSystemApiKey(systemKeyName)
      if (!imageApiKey) {
        return reply.status(503).send({
          error: `No system API key configured for ${provider}. Ask your administrator to add it.`,
        })
      }

      const selectedModel: string = model || getDefaultModel(provider)

      // Build the prompt sent to the image model. If the caller supplied an
      // explicit prompt, use it VERBATIM (only appending the optional style
      // instructions) — "what you type is what's sent". Otherwise fall back to
      // synthesizing one from the post content via an LLM.
      let prompt: string
      let promptSource: 'user' | 'llm'
      if (userPrompt && userPrompt.trim()) {
        promptSource = 'user'
        const style = styleInstructions?.trim()
        prompt = style ? `${userPrompt.trim()}. ${style}` : userPrompt.trim()
      } else {
        promptSource = 'llm'
        // Pick a system LLM for prompt generation
        const llmResolved = await resolveSystemLLMProvider()

        // Generate image prompt via LLM
        if (llmResolved) {
          try {
            prompt = await generateImagePromptWithLLM(
              postContent, styleInstructions, provider, selectedModel,
              llmResolved.provider, llmResolved.model, llmResolved.apiKey,
            )
          } catch {
            prompt = generateSimpleImagePrompt(postContent, styleInstructions)
          }
        } else {
          prompt = generateSimpleImagePrompt(postContent, styleInstructions)
        }
      }

      request.log.info(
        { provider, model: selectedModel, promptSource, promptLength: prompt.length, prompt },
        'image generation prompt',
      )

      // Generate the image
      let imageBuffer: Buffer
      switch (provider) {
        case 'fal':
          imageBuffer = await generateWithFalAI(imageApiKey, prompt, selectedModel)
          break
        case 'openai-dalle':
          imageBuffer = await generateWithOpenAIDALLE(
            imageApiKey, prompt, selectedModel, getSizeFromAspectRatio(aspectRatio),
          )
          break
        case 'replicate':
          imageBuffer = await generateWithReplicate(imageApiKey, prompt, selectedModel)
          break
        default:
          return reply.status(400).send({ error: `Unsupported provider: ${provider}` })
      }

      // Upload to S3
      const { url, path } = await uploadBufferToS3(imageBuffer, user.id, 'image/png', 'png')

      await prisma.media.create({
        data: {
          userId: user.id,
          s3Key: path,
          url,
          source: 'ai_social',
          prompt,
          provider,
          mimeType: 'image/png',
          title: 'AI social image',
        },
      }).catch(() => {/* non-fatal */})

      // Optionally update draft
      if (draftId) {
        try {
          await prisma.draft.update({
            where: { id: draftId },
            data: { imageGenerationPrompt: prompt, imageGenerationProvider: provider },
          })
        } catch { /* non-fatal */ }
      }

      return reply.send({ success: true, url, path, prompt, promptSource })
    } catch (err) {
      request.log.error({ err }, 'Error in /images/generate')
      return reply.status(500).send({
        error: 'Failed to generate image',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/images/generate-prompt
  app.post('/generate-prompt', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { postContent, styleInstructions, imageProvider, imageModel, llmProvider, llmModel } =
      request.body as {
        postContent?: string
        styleInstructions?: string
        imageProvider?: string
        imageModel?: string
        llmProvider?: string
        llmModel?: string
      }

    if (!postContent || typeof postContent !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: postContent' })
    }
    if (!imageProvider || !['fal', 'openai-dalle', 'replicate'].includes(imageProvider)) {
      return reply.status(400).send({
        error: 'Invalid imageProvider. Must be one of: fal, openai-dalle, replicate',
      })
    }

    try {
      const llmResolved = await resolveSystemLLMProvider()
      const selectedImageModel = imageModel || getDefaultModel(imageProvider)

      let prompt: string
      if (llmResolved) {
        try {
          prompt = await generateImagePromptWithLLM(
            postContent, styleInstructions, imageProvider, selectedImageModel,
            llmResolved.provider, llmResolved.model, llmResolved.apiKey,
          )
        } catch (err) {
          let msg = 'Failed to generate prompt'
          if (err instanceof Error) {
            if (err.message.includes('overloaded')) msg = 'The model is overloaded. Please try again later.'
            else if (err.message.includes('rate limit')) msg = 'Rate limit exceeded. Please try again later.'
            else if (err.message.includes('invalid')) msg = 'Invalid API key or model. Please check your settings.'
            else if (err.message.includes('503')) msg = 'Service temporarily unavailable. Please try again later.'
            else msg = safeErrorDetail(err)
          }
          return reply.status(500).send({ error: msg, details: safeErrorDetail(err) })
        }
      } else {
        prompt = generateSimpleImagePrompt(postContent, styleInstructions)
      }

      return reply.send({ success: true, prompt })
    } catch (err) {
      request.log.error({ err }, 'Error in /images/generate-prompt')
      return reply.status(500).send({
        error: 'Failed to generate prompt',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/images/upload  (accepts JSON with base64 data URL)
  app.post('/upload', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { imageDataUrl, fileName } = request.body as {
      imageDataUrl?: string
      fileName?: string
    }

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return reply.status(400).send({ error: 'No imageDataUrl provided' })
    }
    if (!imageDataUrl.startsWith('data:image/')) {
      return reply.status(400).send({ error: 'Invalid image data URL format' })
    }
    if (imageDataUrl.length > 13 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Image size must be less than 10MB' })
    }

    try {
      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')

      // Trust the actual bytes, not the client-supplied data-URL prefix/filename.
      const sniffed = sniffImageMime(buffer)
      if (!sniffed) {
        return reply.status(400).send({ error: 'Unsupported or invalid image data' })
      }
      const contentType = sniffed
      const extension = extForImageMime(sniffed)

      const { url, path } = await uploadBufferToS3(buffer, user.id, contentType, extension)

      await prisma.media.create({
        data: {
          userId: user.id,
          s3Key: path,
          url,
          source: 'upload',
          mimeType: contentType,
          title: fileName ?? 'Uploaded image',
        },
      }).catch(() => {/* non-fatal */})

      return reply.send({ success: true, url, path })
    } catch (err) {
      request.log.error({ err }, 'Error in /images/upload')
      return reply.status(500).send({
        error: 'Failed to upload image',
        details: safeErrorDetail(err),
      })
    }
  })

  // DELETE /api/images/upload
  app.delete('/upload', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { url, path: filePath } = request.body as { url?: string; path?: string }
    if (!url && !filePath) {
      return reply.status(400).send({ error: 'Either url or path must be provided' })
    }

    try {
      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const finalPath = filePath || (url ? extractFilePathFromUrl(url) : null)
      if (!finalPath) {
        return reply.status(400).send({ error: 'Could not extract file path from URL' })
      }
      if (!finalPath.startsWith(`${user.id}/`)) {
        return reply.status(403).send({ error: 'Unauthorized: You can only delete your own images' })
      }

      await deleteFromS3(finalPath)
      return reply.send({ success: true, message: 'Image deleted successfully' })
    } catch (err) {
      request.log.error({ err }, 'Error in DELETE /images/upload')
      return reply.status(500).send({
        error: 'Failed to delete image',
        details: safeErrorDetail(err),
      })
    }
  })
}
