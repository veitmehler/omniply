import type { FastifyInstance } from 'fastify'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '@omniply/shared'
import { cleanText } from '../lib/utils'
import { requireAuth } from '../middleware/auth'
import { safeErrorDetail } from '../lib/safe-error'
import { getSystemApiKey } from '../lib/system-keys'
import { weeklyExtraPostQuota, quotaExceededMessage } from '../lib/extra-post-cap'
import { generationGateForUser } from '../lib/account-billing'

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function getOrCreateUser(clerkId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (user) return user

  return prisma.user.create({
    data: { clerkId, name: clerkId, email: `${clerkId}@placeholder.local` },
  })
}

const SYSTEM_PROVIDER_ORDER = ['openai', 'anthropic', 'gemini', 'openrouter'] as const
const SYSTEM_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-3.5-flash',
  openrouter: 'openai/gpt-4o-mini',
}

/** Resolves the first available system LLM provider+key, optionally preferring one. */
async function resolveSystemProvider(preferredProvider?: string | null): Promise<{
  provider: string; apiKey: string; model: string
} | null> {
  const order = preferredProvider && (SYSTEM_PROVIDER_ORDER as readonly string[]).includes(preferredProvider)
    ? [preferredProvider, ...SYSTEM_PROVIDER_ORDER.filter((p) => p !== preferredProvider)]
    : [...SYSTEM_PROVIDER_ORDER]

  for (const prov of order) {
    const apiKey = await getSystemApiKey(prov)
    if (apiKey) return { provider: prov, apiKey, model: SYSTEM_DEFAULT_MODELS[prov] ?? 'gpt-4o-mini' }
  }
  return null
}

function cleanSingleTweet(tweet: string): string {
  let cleaned = cleanText(tweet)
  cleaned = cleaned.replace(/^=>\s*/, '').replace(/^#\s*.*?:\s*/i, '').trim()
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/g, '').replace(/```\s*$/g, '')
  cleaned = cleaned.replace(/^\d+\/\d+\s*/, '').trim()
  cleaned = cleaned.replace(/\s*\d+\/\s*/g, ' ').trim()
  cleaned = cleaned.replace(/^\d+\/\d+\s+\d+\/\s*/, '').trim()
  return cleaned.replace(/\s+/g, ' ').trim()
}

function cleanGeneratedContent(content: string): string {
  if (!content) return ''
  let cleaned = cleanText(content)
  const patternsToRemove = [
    /^#\s*TARGET\s*AUDIENCE\s*ANALYSIS:[\s\S]*?---/i,
    /^#\s*TARGET\s*AUDIENCE\s*ANALYSIS:[\s\S]*?(?=\n#|\n\n|$)/i,
    /^#\s*LINKEDIN\s*POST:?\s*/i,
    /^#\s*TWITTER\s*POST:?\s*/i,
    /^#\s*X\s*POST:?\s*/i,
    /^LINKEDIN\s*POST:?\s*/i,
    /^TWITTER\s*POST:?\s*/i,
    /^X\s*POST:?\s*/i,
    /^---[\s\S]*?---/,
    /^#\s*PRIMARY\s*AUDIENCE:[\s\S]*?---/i,
    /^#\s*SECONDARY\s*AUDIENCE:[\s\S]*?---/i,
  ]
  for (const pattern of patternsToRemove) cleaned = cleaned.replace(pattern, '').trim()
  cleaned = cleaned.replace(/^#{1,6}\s+.*?\n/gm, '')
  cleaned = cleaned.replace(/^=>\s*/gm, '')
  cleaned = cleaned.replace(/^---+\s*$/gm, '')
  cleaned = cleaned.replace(/^\s+|\s+$/g, '')
  const sections = cleaned.split(/---+/)
  if (sections.length > 1) {
    const postSection = sections.find((s) => {
      const t = s.trim()
      return (
        t.length > 20 &&
        !t.match(/^(PRIMARY|SECONDARY|TARGET)\s*AUDIENCE/i) &&
        !t.match(/^#\s*(ANALYSIS|AUDIENCE|POST)/i)
      )
    })
    cleaned = (postSection || sections[sections.length - 1]).trim()
  }
  return cleaned.trim()
}

function extractKeyPoints(idea: string) {
  const sentences = idea.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length >= 3) {
    return { point1: sentences[0].trim(), point2: sentences[1].trim(), point3: sentences[2].trim() }
  }
  return {
    point1: 'Start with why, not what',
    point2: 'Listen more than you talk',
    point3: 'Execution beats perfection',
  }
}

function applyTemplate(template: string, idea: string): string {
  if (!template) return idea
  const points = extractKeyPoints(idea)
  return template
    .replace(/{idea}/g, idea)
    .replace(/{point1}/g, points.point1)
    .replace(/{point2}/g, points.point2)
    .replace(/{point3}/g, points.point3)
}

// ─── LLM adapters ────────────────────────────────────────────────────────────

async function generateWithOpenAI(
  apiKey: string, prompt: string, maxTokens: number, model: string, writingStyle?: string | null,
): Promise<string> {
  const openai = new OpenAI({ apiKey })
  let systemMessage = buildSystemMessage(writingStyle)
  const response = await openai.chat.completions.create({
    model: model || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  })
  return response.choices[0]?.message?.content || ''
}

async function generateWithAnthropic(
  apiKey: string, prompt: string, maxTokens: number, model: string, writingStyle?: string | null,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey })
  const systemMessage = buildSystemMessage(writingStyle)
  const response = await anthropic.messages.create({
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    system: systemMessage,
    messages: [{ role: 'user', content: prompt }],
  })
  const textContent = response.content.find((b: { type: string }) => b.type === 'text') as
    | { text: string }
    | undefined
  return textContent?.text || ''
}

async function generateWithGemini(
  apiKey: string, prompt: string, maxTokens: number, model: string, writingStyle?: string | null,
  characterLimit?: number,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  let systemMessage = buildSystemMessage(writingStyle)
  if (characterLimit) {
    systemMessage += `\n\n# CRITICAL CHARACTER LIMIT:\n\nYour response MUST be EXACTLY ${characterLimit} characters or FEWER. Count carefully. SHORTEN if needed.`
  }
  const genModel = genAI.getGenerativeModel({
    model: model || 'gemini-pro',
    systemInstruction: systemMessage,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
  })
  const result = await genModel.generateContent(prompt)
  const response = await result.response

  if (response.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${response.promptFeedback.blockReason}`)
  }
  const candidate = response.candidates?.[0]
  if (candidate?.finishReason === 'SAFETY') {
    throw new Error('Gemini filtered content due to safety concerns')
  }

  let text = response.text() || ''
  if (!text.trim()) throw new Error('Gemini returned empty response')

  // Retry if the response looks like it echoed the prompt
  if (text.trim().length < 50 || text.includes('# RAW IDEA:') || text.includes('# CONTEXT:')) {
    const retryResult = await genModel.generateContent(
      `Based on: "${prompt.match(/RAW IDEA:\s*\n\s*(.+?)(?:\n\n|$)/i)?.[1]?.trim() || 'the provided idea'}", create an engaging social media post. ${characterLimit ? `Keep it under ${characterLimit} characters.` : ''} Return ONLY the post content.`
    )
    const retryText = (await retryResult.response).text()
    if (retryText.trim().length > 50) text = retryText
    else throw new Error('Gemini failed to generate content. Try a different provider.')
  }

  return text
}

async function generateWithOpenRouter(
  apiKey: string, prompt: string, maxTokens: number, model: string, writingStyle?: string | null,
): Promise<string> {
  const systemMessage = buildSystemMessage(writingStyle)
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://chiro.omniply.io',
      'X-Title': 'Levercast',
    },
    body: JSON.stringify({
      model: model || 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error?.message || 'OpenRouter API error')
  }
  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}

function buildSystemMessage(writingStyle?: string | null): string {
  let msg = `# ROLE:\n\nYou are a world-class social media content creator. You create highly engaging, authentic posts that have the greatest chance of going viral.\n\nYou analyze the topic and write them in a way that resonates with the perfect target audience for the topic.\n\nYou are the world's best at what you do.\n\nFirst you will receive your context, then you will receive your task.`
  if (writingStyle?.trim()) msg += `\n\n# WRITING STYLE:\n\n${writingStyle.trim()}`
  return msg
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function aiRoutes(app: FastifyInstance) {
  // POST /api/ai/generate
  app.post('/generate', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req: any) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { rawIdea, platform, templateId, provider, twitterFormat } = request.body as {
      rawIdea?: string
      platform?: string | string[]
      templateId?: string
      provider?: string
      twitterFormat?: string
    }

    if (!rawIdea || !platform) {
      return reply.status(400).send({ error: 'Missing required fields: rawIdea, platform' })
    }

    try {
      const user = await getOrCreateUser(clerkId)

      // Lifecycle gate first (multi-tenancy Phase A): paused/cancelled accounts
      // never generate, regardless of quota.
      if (user.role !== 'admin') {
        const lifecycleGate = await generationGateForUser(user.id)
        if (!lifecycleGate.allowed) return reply.status(402).send({ error: lifecycleGate.reason })
      }

      // Weekly extra-post cap (throughput plan Phase 2): dashboard ad-hoc post
      // generation is capped per account per rolling 7 days. Admins are exempt.
      if (user.role !== 'admin') {
        const quota = await weeklyExtraPostQuota(user.id)
        if (quota.remaining <= 0) {
          return reply.status(429).send({
            error: quotaExceededMessage(quota),
            cap: quota.cap,
            used: quota.used,
            resetsAt: quota.resetsAt,
          })
        }
      }

      let settings = await prisma.settings.findUnique({ where: { userId: user.id } })
      if (!settings) {
        settings = await prisma.settings.create({
          data: { userId: user.id, theme: 'light', sidebarState: 'open' },
        })
      }

      // Resolve platforms
      const getAllPlatforms = async (): Promise<string[]> => {
        const connections = await prisma.socialConnection.findMany({
          where: { userId: user.id, isActive: true },
          select: { platform: true },
        })
        const platforms = connections.map((c) => c.platform)
        const uniquePlatforms = [...new Set(platforms)]
        const hasTelegram = await prisma.apiKey.findFirst({
          where: { userId: user.id, provider: 'telegram' },
        })
        if (hasTelegram) uniquePlatforms.push('telegram')
        return uniquePlatforms.length > 0 ? uniquePlatforms : ['linkedin', 'twitter']
      }

      let platformsToGenerate: string[]
      if (platform === 'all' || platform === 'both') {
        platformsToGenerate = await getAllPlatforms()
      } else if (Array.isArray(platform)) {
        platformsToGenerate = platform.filter((p) =>
          ['linkedin', 'twitter', 'facebook', 'instagram', 'telegram', 'threads'].includes(p),
        )
      } else {
        platformsToGenerate = [platform as string]
      }

      // Resolve template
      let template: {
        linkedinTemplate: string | null; twitterTemplate: string | null
        facebookTemplate: string | null; instagramTemplate: string | null
        telegramTemplate: string | null; threadsTemplate: string | null
      } | null = null

      if (templateId) {
        template = await prisma.template.findFirst({ where: { id: templateId, userId: user.id } })
      } else {
        const templates = await prisma.template.findMany({
          where: { userId: user.id }, orderBy: { isDefault: 'desc' },
        })
        template = templates.find((t) => t.isDefault) || templates[0] || null
      }

      // Select system provider
      const resolved = await resolveSystemProvider(provider ?? null)
      if (!resolved) {
        return reply.status(503).send({
          error: 'No LLM provider is configured. Please ask your administrator to set up API keys.',
        })
      }
      const { provider: selectedProvider, apiKey, model: selectedModel } = resolved

      const result: Record<string, string> = {}

      for (const plat of platformsToGenerate) {
        const isTwitterThread = plat === 'twitter' && twitterFormat === 'thread'
        const templateText = isTwitterThread
          ? null
          : plat === 'linkedin' ? template?.linkedinTemplate
          : plat === 'facebook' ? template?.facebookTemplate ?? null
          : plat === 'instagram' ? template?.instagramTemplate ?? null
          : plat === 'telegram' ? template?.telegramTemplate ?? null
          : plat === 'threads' ? template?.threadsTemplate ?? null
          : template?.twitterTemplate

        const charLimits: Record<string, number> = {
          linkedin: 2500, twitter: 270, facebook: 1800,
          instagram: 1800, telegram: 900, threads: 450,
        }
        const characterLimit = charLimits[plat] || 3000

        let maxTokens: number
        if (selectedProvider === 'gemini') {
          maxTokens = 4000
        } else {
          maxTokens = ['linkedin', 'facebook', 'instagram', 'telegram'].includes(plat) ? 1000
            : plat === 'threads' ? 300
            : isTwitterThread ? 2000 : 200
        }

        // Build prompt
        let prompt = `# CONTEXT:\n\n## RAW IDEA:\n\n${rawIdea}\n\n`
        if (isTwitterThread) {
          prompt += `## TEMPLATE STRUCTURE:\n\nNo template structure. Create a thread with multiple posts.\n\n`
        } else if (templateText) {
          prompt += `## TEMPLATE STRUCTURE:\n\n${applyTemplate(templateText, rawIdea)}\n\n`
        } else {
          prompt += `## TEMPLATE STRUCTURE:\n\nNo specific template provided. Use your expertise to create an engaging post.\n\n`
        }

        prompt += `# TASK:\n\n`
        prompt += `1. Carefully review your CONTEXT.\n\n`
        prompt += `2. Identify the exact target audience for the RAW IDEA (do this mentally, do not include it in your response).\n\n`

        if (isTwitterThread) {
          prompt += `3. Your task now is to create a Twitter/X thread with multiple posts based on the RAW IDEA.\n\n`
          prompt += `STRUCTURE:\n`
          prompt += `1. Post 1 (Summary): Create an engaging summary/hook post (under 270 characters) that introduces the topic and encourages readers to continue. This will be the main tweet.\n\n`
          prompt += `2. Posts 2-N (Replies): Extract 1-8 key insights from the RAW IDEA. Each insight should be its own reply post (under 270 characters each).\n\n`
          prompt += `3. Randomly decide how many insights (between 1-8) based on the depth and complexity of the RAW IDEA.\n\n`
          prompt += `FORMAT: Return the thread as a JSON array where:\n`
          prompt += `- First element: The summary post (no numbering, just the post text)\n`
          prompt += `- Remaining elements: Key insights as plain text WITHOUT any numbering prefixes (no "2/", "3/", etc.)\n`
          prompt += `Example: ["Summary tweet here", "Key insight 1 text", "Key insight 2 text", "Key insight 3 text"]\n\n`
          prompt += `CRITICAL: Do NOT include numbering like "2/", "3/", "4/" in the reply posts. Just write the insight text directly. We will add numbering programmatically.\n\n`
          prompt += `CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code fences, headers, explanations, or other text. Return ONLY the JSON array.`
        } else {
          const platformName = {
            linkedin: 'LinkedIn', twitter: 'Twitter/X', facebook: 'Facebook',
            instagram: 'Instagram', telegram: 'Telegram', threads: 'Threads',
          }[plat] || plat

          prompt += `3. Your task now is to create a ${platformName} post based on the RAW IDEA.\n\n`
          if (templateText) {
            prompt += `4. You will create the post following the TEMPLATE STRUCTURE.\n\n`
            prompt += `5. MAKE SURE the post follows the TEMPLATE STRUCTURE but feels natural, engaging, and resonates with your selected target audience.\n\n`
          } else {
            prompt += `4. Create a post that feels natural, engaging, and resonates with your selected target audience.\n\n`
          }

          prompt += `CRITICAL: Return ONLY the post content. Do NOT include any analysis, headers, explanations, or metadata. Return ONLY the actual post text that would be published on ${platformName}.\n\n`
          prompt += `CRITICAL: The post MUST be exactly ${characterLimit} characters or fewer. This is a HARD LIMIT. Count your characters and ensure you stay within this limit. If it's too long, SHORTEN it.`
        }

        try {
          let generatedContent = ''
          const writingStyle = settings.writingStyle || null

          switch (selectedProvider) {
            case 'openai':
              generatedContent = await generateWithOpenAI(apiKey, prompt, maxTokens, selectedModel || 'gpt-4o-mini', writingStyle)
              break
            case 'anthropic':
              generatedContent = await generateWithAnthropic(apiKey, prompt, maxTokens, selectedModel || 'claude-3-5-sonnet-20241022', writingStyle)
              break
            case 'gemini':
              generatedContent = await generateWithGemini(apiKey, prompt, maxTokens, selectedModel || 'gemini-pro', writingStyle, isTwitterThread ? undefined : characterLimit)
              break
            case 'openrouter':
              generatedContent = await generateWithOpenRouter(apiKey, prompt, maxTokens, selectedModel || 'openai/gpt-4o-mini', writingStyle)
              break
            default:
              throw new Error(`Unsupported provider: ${selectedProvider}`)
          }

          generatedContent = cleanText(generatedContent)

          if (isTwitterThread) {
            let cleanedContent = generatedContent.trim()
            cleanedContent = cleanedContent.replace(/^```json\s*/i, '').replace(/^```\s*/g, '').replace(/```\s*$/g, '')
            const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/)
            if (jsonMatch) cleanedContent = jsonMatch[0]

            try {
              const parsed = JSON.parse(cleanedContent.trim())
              if (Array.isArray(parsed) && parsed.length > 0) {
                const validTweets = parsed
                  .map((tweet, index) => {
                    let cleaned = cleanSingleTweet(String(tweet))
                    if (index > 0) cleaned = `${index + 1}/${parsed.length} ${cleaned}`
                    return cleaned
                  })
                  .filter((t) => t.length > 0 && t.length <= 270)

                if (validTweets.length === 0) throw new Error('No valid tweets in thread')
                result[plat] = JSON.stringify(validTweets)
              } else {
                throw new Error('Invalid thread format')
              }
            } catch {
              result[plat] = rawIdea
            }
          } else {
            generatedContent = cleanGeneratedContent(generatedContent)
            // Truncate to platform limits
            const hardLimits: Record<string, number> = {
              twitter: 280, threads: 500, telegram: 1000, facebook: 2000, instagram: 2000, linkedin: 3000,
            }
            const hardLimit = hardLimits[plat]
            if (hardLimit && generatedContent.length > hardLimit) {
              const truncated = generatedContent.substring(0, hardLimit - 3)
              const lastSpace = truncated.lastIndexOf(' ')
              generatedContent =
                lastSpace > hardLimit * 0.85
                  ? truncated.substring(0, lastSpace).trim() + '...'
                  : truncated + '...'
            }
            result[plat] = generatedContent || rawIdea
          }
        } catch (err) {
          request.log.error({ err, plat, provider: selectedProvider }, 'Content generation error')
          result[plat] = (!isTwitterThread && templateText)
            ? applyTemplate(templateText, rawIdea)
            : rawIdea
        }
      }

      return reply.send({ content: result, provider: selectedProvider })
    } catch (err) {
      request.log.error({ err }, 'Error in /ai/generate')
      return reply.status(500).send({
        error: 'Failed to generate content',
        details: safeErrorDetail(err),
      })
    }
  })

  // POST /api/ai/analyze-writing-style
  // GET /api/ai/extra-post-quota — dashboard shows remaining weekly ad-hoc posts.
  app.get('/extra-post-quota', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await getOrCreateUser(clerkId)
    const quota = await weeklyExtraPostQuota(user.id)
    return reply.send({ ...quota, exempt: user.role === 'admin' })
  })

  app.post('/analyze-writing-style', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: any) => req.clerkId ?? req.ip } } }, async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { sampleText } = request.body as { sampleText?: string }

    if (!sampleText || typeof sampleText !== 'string' || sampleText.trim().split(/\s+/).length < 500) {
      return reply.status(400).send({ error: 'Sample text must be at least 500 words' })
    }

    try {
      const user = await getOrCreateUser(clerkId)

      let settings = await prisma.settings.findUnique({ where: { userId: user.id } })
      if (!settings) {
        settings = await prisma.settings.create({
          data: { userId: user.id, theme: 'light', sidebarState: 'open' },
        })
      }

      const resolved = await resolveSystemProvider()
      if (!resolved) {
        return reply.status(503).send({
          error: 'No LLM provider is configured. Please ask your administrator to set up API keys.',
        })
      }
      const { provider: selectedProvider, apiKey, model: selectedModel } = resolved

      const systemMessage = `# ROLE:

You are an expert writing analyst and AI prompt engineer. Your mission is to meticulously analyze the writing style of the provided text and then generate a high-fidelity, reusable prompt that can replicate this style for any new content and topic.

# OUTPUT INSTRUCTIONS:

Return ONLY a clear, concise description (2 paragraphs) that can be used as writing style instructions for AI content generation. Do not include any analysis, explanations, or meta-commentary. Just the style description.

CRITICAL: Do NOT quote, excerpt, or paraphrase ANY specific phrases, sentences, or named concepts from the analyzed text. No quotation marks anywhere in your output. Describe the STYLE in the abstract (sentence rhythm, tone, framing devices, structural habits) so that a model following your description produces the same voice WITHOUT ever reproducing wording from the sample.`

      const userPrompt = `# ARTICLE TO ANALYZE:\n\n${sampleText.trim()}`

      let writingStyleDescription = ''

      switch (selectedProvider) {
        case 'openai': {
          const openai = new OpenAI({ apiKey })
          const resp = await openai.chat.completions.create({
            model: selectedModel || 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: userPrompt }],
            max_tokens: 300, temperature: 0.3,
          })
          writingStyleDescription = resp.choices[0]?.message?.content || ''
          break
        }
        case 'anthropic': {
          const anthropic = new Anthropic({ apiKey })
          const resp = await anthropic.messages.create({
            model: selectedModel || 'claude-3-5-sonnet-20241022',
            max_tokens: 300, system: systemMessage,
            messages: [{ role: 'user', content: userPrompt }],
          })
          writingStyleDescription = resp.content[0].type === 'text' ? (resp.content[0] as { text: string }).text : ''
          break
        }
        case 'gemini': {
          const genAI = new GoogleGenerativeAI(apiKey)
          const genModel = genAI.getGenerativeModel({ model: selectedModel || 'gemini-pro' })
          const result = await genModel.generateContent(`${systemMessage}\n\n${userPrompt}`)
          writingStyleDescription = (await result.response).text()
          break
        }
        case 'openrouter': {
          const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_URL || 'https://chiro.omniply.io',
              'X-Title': 'Levercast',
            },
            body: JSON.stringify({
              model: selectedModel || 'openai/gpt-4o-mini',
              messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: userPrompt }],
              max_tokens: 300, temperature: 0.3,
            }),
          })
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(err.error?.message || 'OpenRouter API error')
          }
          const data = await resp.json()
          writingStyleDescription = data.choices?.[0]?.message?.content || ''
          break
        }
        default:
          throw new Error(`Unsupported provider: ${selectedProvider}`)
      }

      writingStyleDescription = writingStyleDescription.trim()
        .replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim()
        .replace(/^["']|["']$/g, '').trim()

      if (!writingStyleDescription) throw new Error('Failed to generate writing style description')

      return reply.send({ writingStyle: writingStyleDescription })
    } catch (err) {
      request.log.error({ err }, 'Error in /ai/analyze-writing-style')
      return reply.status(500).send({
        error: 'Failed to analyze writing style',
        details: safeErrorDetail(err),
      })
    }
  })
}
