/**
 * Image Generation Service
 * Handles AI image generation using Fal.ai, OpenAI DALL-E, and Replicate APIs
 */

import { fal } from '@fal-ai/client'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Generate an image prompt from post content using LLM
 * Uses the user's configured LLM provider to create an optimized prompt for image generation
 */
export async function generateImagePromptWithLLM(
  postContent: string,
  styleInstructions: string | undefined,
  imageProvider: string,
  imageModel: string,
  llmProvider: string,
  llmModel: string,
  llmApiKey: string
): Promise<string> {
  const systemMessage = `# ROLE:

You are a social media image expert. You are a world expert in what images need to be attached to a social media post to attract the most attention for social media users to get interested in a post.

You are the best at what you do.

First you will receive your context, then you will receive your task.`

  const userPrompt = `# CONTEXT:

## CONTENT IDEA TO GENERATE AN IMAGE PROMPT FOR:

${postContent}

${styleInstructions && styleInstructions.trim() ? `## STYLE INSTRUCTIONS (MANDATORY - MUST BE INCLUDED):

${styleInstructions.trim()}

IMPORTANT: These style instructions MUST be prominently incorporated into your final prompt. Do not ignore them.` : ''}

## AI PROVIDER:

${imageProvider}

## AI MODEL:

${imageModel}

# TASK:

1. Carefully read and analyze your CONTEXT.

2. Your task now is to write a perfect image generation prompt for AI PROVIDER using the AI MODEL for the CONTENT IDEA TO GENERATE AN IMAGE PROMPT FOR.

${styleInstructions && styleInstructions.trim() ? `3. CRITICAL: You MUST incorporate the STYLE INSTRUCTIONS above into your final prompt. These are mandatory requirements that must be reflected in the generated image.` : '3. Create a compelling visual description that captures the essence of the content idea.'}

# OUTPUT FORMAT:

ONLY return the image generation prompt in Markdown language. 

No explanation. No commentary. No extra characters.`

  try {
    let generatedPrompt = ''

    switch (llmProvider) {
      case 'openai': {
        const openai = new OpenAI({ apiKey: llmApiKey })
        const response = await openai.chat.completions.create({
          model: llmModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
          temperature: 0.7,
        })
        generatedPrompt = response.choices[0]?.message?.content || ''
        break
      }
      case 'anthropic': {
        const anthropic = new Anthropic({ apiKey: llmApiKey })
        const response = await anthropic.messages.create({
          model: llmModel || 'claude-sonnet-5-5',
          max_tokens: 500,
          system: systemMessage,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        })
        generatedPrompt = response.content[0].type === 'text' ? response.content[0].text : ''
        break
      }
      case 'gemini': {
        try {
          const genAI = new GoogleGenerativeAI(llmApiKey)
          const model = genAI.getGenerativeModel({ model: llmModel || 'gemini-pro' })
          const result = await model.generateContent(`${systemMessage}\n\n${userPrompt}`)
          const response = await result.response
          generatedPrompt = response.text()
        } catch (error) {
          // Extract user-friendly error message from Gemini API errors
          if (error instanceof Error) {
            // Check for specific error patterns in Gemini error messages
            if (error.message.includes('overloaded') || error.message.includes('503')) {
              throw new Error('The model is overloaded. Please try again later.')
            } else if (error.message.includes('rate limit') || error.message.includes('429')) {
              throw new Error('Rate limit exceeded. Please try again later.')
            } else if (error.message.includes('invalid') || error.message.includes('401') || error.message.includes('403')) {
              throw new Error('Invalid API key or model. Please check your settings.')
            }
          }
          throw error
        }
        break
      }
      case 'openrouter': {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${llmApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            'X-Title': 'Levercast',
          },
          body: JSON.stringify({
            model: llmModel || 'openai/gpt-4o-mini',
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 500,
            temperature: 0.7,
          }),
        })
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(error.error?.message || 'OpenRouter API error')
        }
        
        const data = await response.json()
        generatedPrompt = data.choices?.[0]?.message?.content || ''
        break
      }
      default:
        throw new Error(`Unsupported LLM provider: ${llmProvider}`)
    }

    // Clean the prompt - remove markdown formatting if present, remove extra whitespace
    let cleanedPrompt = generatedPrompt.trim()
    
    // Remove markdown code blocks if present
    cleanedPrompt = cleanedPrompt.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim()
    
    // Remove any leading/trailing quotes
    cleanedPrompt = cleanedPrompt.replace(/^["']|["']$/g, '').trim()
    
    // If empty or too short, fall back to simple prompt
    if (!cleanedPrompt || cleanedPrompt.length < 10) {
      console.warn('[Image Prompt] LLM returned empty or too short prompt, falling back to simple prompt')
      return generateSimpleImagePrompt(postContent, styleInstructions)
    }

    return cleanedPrompt
  } catch (error) {
    console.error('[Image Prompt] Error generating prompt with LLM:', error)
    // Fall back to simple prompt on error
    return generateSimpleImagePrompt(postContent, styleInstructions)
  }
}

/**
 * Generate a simple image prompt from post content (fallback)
 * Used when LLM generation fails or is not available
 */
export function generateSimpleImagePrompt(
  postContent: string,
  styleInstructions?: string
): string {
  let prompt = postContent.trim()
  
  // Limit length and clean up
  if (prompt.length > 200) {
    prompt = prompt.substring(0, 200) + '...'
  }
  
  // Add style instructions if provided - prepend them for better emphasis
  if (styleInstructions && styleInstructions.trim()) {
    // Prepend style instructions to ensure they're prioritized
    prompt = `${styleInstructions.trim()}, ${prompt}`
  }
  
  return prompt
}

/**
 * Generate an image prompt from post content
 * @deprecated Use generateImagePromptWithLLM instead
 */
export function generateImagePrompt(
  postContent: string,
  styleInstructions?: string
): string {
  return generateSimpleImagePrompt(postContent, styleInstructions)
}

/**
 * Generate image using Fal.ai
 * @param apiKey - Fal.ai API key
 * @param prompt - Image generation prompt
 * @param model - Model identifier (e.g., "fal-ai/flux/schnell")
 * @returns Buffer containing the generated image
 */
export async function generateWithFalAI(
  apiKey: string,
  prompt: string,
  model: string = 'fal-ai/flux/schnell',
  // Fal image_size enum: square_hd | square | portrait_4_3 | portrait_16_9 |
  // landscape_4_3 | landscape_16_9. Default preserves prior behavior.
  imageSize: string = 'square_hd'
): Promise<Buffer> {
  // Configure Fal.ai client with API key
  fal.config({
    credentials: apiKey,
  })

  console.log('[Fal.ai API] Request:', {
    model,
    promptLength: prompt.length,
    imageSize,
  })

  try {
    // Use Fal.ai subscribe method to generate image
    // This handles queueing and polling automatically
    const result = await fal.subscribe(model, {
      input: {
        prompt,
        image_size: imageSize,
      },
      pollInterval: 2000, // Poll every 2 seconds
      logs: true,
      onQueueUpdate(update: unknown) {
        console.log('[Fal.ai API] Queue update:', update)
      },
    })

    console.log('[Fal.ai API] Response data:', JSON.stringify(result, null, 2))

    // Extract image URL from result
    // Fal.ai subscribe() returns { data: { images: [...] }, requestId: "..." }
    // Check result.data first, then fall back to result directly
    const responseData = result.data || result
    let imageUrl: string | null = null

    if (responseData.images && Array.isArray(responseData.images) && responseData.images.length > 0) {
      imageUrl = responseData.images[0].url || responseData.images[0]
    } else if (responseData.image?.url) {
      imageUrl = responseData.image.url
    } else if (responseData.image && typeof responseData.image === 'string') {
      imageUrl = responseData.image
    } else if (responseData.url) {
      imageUrl = responseData.url
    } else if (responseData.output && Array.isArray(responseData.output) && responseData.output.length > 0) {
      imageUrl = responseData.output[0].url || responseData.output[0]
    } else if (responseData.output && typeof responseData.output === 'string') {
      imageUrl = responseData.output
    }

    if (!imageUrl) {
      console.error('[Fal.ai API] No image URL found in response:', result)
      throw new Error(`Fal.ai did not return an image URL. Response structure: ${JSON.stringify(result)}`)
    }

    // Download the image
    return downloadImageFromUrl(imageUrl)
  } catch (error: unknown) {
    console.error('[Fal.ai API] Error:', error)
    
    interface FalError {
      message?: string
      detail?: string
      error?: string
    }

    const falError = error as FalError
    // Extract error message
    const errorMessage = falError?.message || falError?.detail || falError?.error || String(error)
    throw new Error(`Fal.ai API error: ${errorMessage}`)
  }
}

/**
 * Generate an image with a Google Gemini image model ("Nano Banana"), e.g.
 * gemini-3.1-flash-image / gemini-3-pro-image. Unlike diffusion models these
 * render legible text, so they can produce a full composed cover in one call.
 *
 * @param apiKey - Gemini API key
 * @param prompt - Image generation prompt
 * @param model - Model id (e.g. "gemini-3.1-flash-image")
 * @param aspectRatio - imageConfig aspect ratio ("1:1", "4:5", "16:9", …) — ignored when inputImage is set (the input drives the canvas)
 * @param inputImage - optional base64 image for image-to-image editing (e.g. logo recolor)
 * @returns Buffer containing the generated image
 * @throws if the response contains no image part (callers may fall back)
 */
export async function generateWithGeminiImage(
  apiKey: string,
  prompt: string,
  model: string = 'gemini-3.1-flash-image',
  aspectRatio: string = '1:1',
  inputImage?: { mimeType: string; data: string }
): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const reqParts: Array<Record<string, unknown>> = []
  if (inputImage) reqParts.push({ inline_data: { mime_type: inputImage.mimeType, data: inputImage.data } })
  reqParts.push({ text: prompt })
  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] }
  // For text-to-image we request an aspect ratio; for editing we let the input
  // image define the canvas (Gemini preserves it).
  if (!inputImage) generationConfig.imageConfig = { aspectRatio }
  const body = {
    contents: [{ parts: reqParts }],
    generationConfig,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Gemini image API error ${response.status}: ${text.slice(0, 400)}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) {
    throw new Error('Gemini image API returned no image (possible refusal/safety block)')
  }
  return Buffer.from(b64, 'base64')
}

/**
 * Generate image using OpenAI DALL-E
 * @param apiKey - OpenAI API key
 * @param prompt - Image generation prompt
 * @param model - Model identifier ("dall-e-2" or "dall-e-3")
 * @param size - Image size (default: "1024x1024")
 * @returns Buffer containing the generated image
 */
export async function generateWithOpenAIDALLE(
  apiKey: string,
  prompt: string,
  model: string = 'dall-e-3',
  size: string = '1024x1024'
): Promise<Buffer> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      quality: model === 'dall-e-3' ? 'standard' : undefined,
      response_format: model === 'dall-e-3' ? 'url' : 'url', // Always use URL for consistency
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(`OpenAI DALL-E API error: ${error.error?.message || error.message || response.statusText}`)
  }

  const data = await response.json()
  
  let imageUrl: string | null = null
  
  if (data.data && Array.isArray(data.data) && data.data.length > 0) {
    imageUrl = data.data[0].url
  } else if (data.url) {
    imageUrl = data.url
  }

  if (!imageUrl) {
    throw new Error('OpenAI DALL-E did not return an image URL')
  }

  // Download the image
  return downloadImageFromUrl(imageUrl)
}

/**
 * Generate image using Replicate
 * @param apiKey - Replicate API token
 * @param prompt - Image generation prompt
 * @param model - Model identifier (e.g., "stability-ai/stable-diffusion")
 * @returns Buffer containing the generated image
 */
export async function generateWithReplicate(
  apiKey: string,
  prompt: string,
  model: string = 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf'
): Promise<Buffer> {
  // Create prediction
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: model.includes(':') ? model.split(':')[1] : undefined,
      input: {
        prompt,
        image_size: '1024x1024',
      },
    }),
  })

  if (!createResponse.ok) {
    const error = await createResponse.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(`Replicate API error: ${error.detail || error.message || createResponse.statusText}`)
  }

  const prediction = await createResponse.json()
  const predictionId = prediction.id

  if (!predictionId) {
    throw new Error('Replicate did not return a prediction ID')
  }

  // Poll for completion (max 60 seconds)
  const maxAttempts = 60
  let attempts = 0
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
    
    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: {
        'Authorization': `Token ${apiKey}`,
      },
    })

    if (!statusResponse.ok) {
      throw new Error('Failed to check prediction status')
    }

    const statusData = await statusResponse.json()
    
    if (statusData.status === 'succeeded') {
      const imageUrl = Array.isArray(statusData.output) 
        ? statusData.output[0] 
        : statusData.output
      
      if (!imageUrl) {
        throw new Error('Replicate did not return an image URL')
      }

      return downloadImageFromUrl(imageUrl)
    } else if (statusData.status === 'failed' || statusData.status === 'canceled') {
      throw new Error(`Replicate prediction ${statusData.status}: ${statusData.error || 'Unknown error'}`)
    }
    
    attempts++
  }

  throw new Error('Replicate prediction timed out after 60 seconds')
}

/**
 * Download an image from a URL and return as Buffer
 * @param imageUrl - URL of the image to download
 * @returns Buffer containing the image data
 */
export async function downloadImageFromUrl(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl)
  
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
  }
  
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

