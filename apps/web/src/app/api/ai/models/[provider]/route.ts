import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { decrypt } from '@omniply/shared'
import OpenAI from 'openai'
// Anthropic and GoogleGenerativeAI are reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Anthropic from '@anthropic-ai/sdk'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GoogleGenerativeAI } from '@google/generative-ai'

// Helper function to get or create user
async function getOrCreateUser(clerkId: string) {
  let user = await prisma.user.findUnique({
    where: { clerkId },
  })

  if (!user) {
    const clerkUser = await currentUser()
    
    if (!clerkUser) {
      throw new Error('User not found in Clerk')
    }

    const email = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress

    if (!email) {
      throw new Error('No email found')
    }

    const name = clerkUser.firstName
      ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`
      : email.split('@')[0]

    user = await prisma.user.create({
      data: {
        clerkId,
        name,
        email,
      },
    })
  }

  return user
}

// Image-generation providers don't need a per-user key here: their model lists
// are static/curated and generation uses a system key (FAL_KEY etc.). Only the
// dynamic LLM providers need the user's key to list models.
const IMAGE_PROVIDERS = new Set(['fal', 'openai-dalle', 'replicate'])

// Decrypt only the requested provider's stored key. A missing or undecryptable
// key (e.g. encrypted with a different ENCRYPTION_KEY) must not 500 the whole
// listing — it's treated as "no key", so image providers still return their
// static list and LLM providers fall through to the no-key path.
async function getUserApiKey(userId: string, provider: string): Promise<string | undefined> {
  const row = await prisma.apiKey.findFirst({
    where: { userId, provider },
    select: { encryptedKey: true },
  })
  if (!row) return undefined
  try {
    return decrypt(row.encryptedKey)
  } catch (error) {
    console.error(`[ai/models] failed to decrypt stored ${provider} key:`, error)
    return undefined
  }
}

// GET /api/ai/models/[provider] - Get available models for a provider
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { provider } = await params
    const user = await getOrCreateUser(clerkId)

    // Skip the key lookup entirely for image providers (they don't need it).
    const apiKey = IMAGE_PROVIDERS.has(provider)
      ? undefined
      : await getUserApiKey(user.id, provider)

    if (!apiKey && !IMAGE_PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: `No API key found for ${provider}` },
        { status: 404 }
      )
    }

    let models: Array<{ value: string; label: string }> = []

    try {
      switch (provider) {
        case 'openai': {
          // Non-image providers are guaranteed a defined key past the 404 gate above.
          const openai = new OpenAI({ apiKey: apiKey! })
          const response = await openai.models.list()
          models = response.data
            .filter(model => 
              model.id.includes('gpt') && 
              !model.id.includes('instruct') &&
              !model.id.includes('vision')
            )
            .map(model => ({
              value: model.id,
              label: model.id.replace('gpt-', 'GPT-').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            }))
            .sort((a, b) => {
              // Sort by version number (higher first)
              const aVersion = a.value.match(/\d+\.?\d*/)?.[0] || '0'
              const bVersion = b.value.match(/\d+\.?\d*/)?.[0] || '0'
              return parseFloat(bVersion) - parseFloat(aVersion)
            })
          break
        }

        case 'anthropic': {
          // Fetch models from Anthropic API
          try {
            const response = await fetch('https://api.anthropic.com/v1/models', {
              headers: {
                'x-api-key': apiKey!,
                'anthropic-version': '2023-06-01',
              },
            })

            if (response.ok) {
              const data = await response.json() as { data: Array<{ id: string; display_name?: string }> }
              models = data.data
                .filter(model => model.id && model.id.startsWith('claude-'))
                .map(model => ({
                  value: model.id,
                  label: model.display_name || model.id.replace('claude-', 'Claude ').replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
                }))
                .sort((a, b) => {
                  // Sort by model version (newer first) and then alphabetically
                  const aVersion = a.value.match(/\d+\.\d+/)?.[0] || '0'
                  const bVersion = b.value.match(/\d+\.\d+/)?.[0] || '0'
                  if (aVersion !== bVersion) {
                    return bVersion.localeCompare(aVersion)
                  }
                  return a.label.localeCompare(b.label)
                })
            } else {
              throw new Error('API request failed')
            }
          } catch {
            // Fallback to known models if API fails
            models = [
              { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
              { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
              { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
              { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
            ]
          }
          break
        }

        case 'gemini': {
          // Fetch models from Google Gemini API
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
            
            if (response.ok) {
              const data = await response.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> }
              if (data.models) {
                models = data.models
                  .filter(model => 
                    model.name && 
                    model.name.startsWith('models/') &&
                    model.supportedGenerationMethods?.includes('generateContent')
                  )
                  .map(model => ({
                    value: model.name.replace('models/', ''),
                    label: model.displayName || model.name.replace('models/', '').replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
                  }))
                  .sort((a, b) => {
                    // Sort by version number (higher/newer first)
                    const aVersion = a.value.match(/\d+\.\d+/)?.[0] || a.value.match(/\d+/)?.[0] || '0'
                    const bVersion = b.value.match(/\d+\.\d+/)?.[0] || b.value.match(/\d+/)?.[0] || '0'
                    return parseFloat(bVersion) - parseFloat(aVersion)
                  })
              } else {
                throw new Error('No models in response')
              }
            } else {
              throw new Error('API request failed')
            }
          } catch {
            // Fallback to known models if API fails
            models = [
              { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
              { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
              { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
            ]
          }
          break
        }

        case 'openrouter': {
          // Fetch models from OpenRouter
          const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          })

          if (response.ok) {
            const data = await response.json() as { data: Array<{ id: string; name?: string }> }
            models = data.data
              .filter((model: { id: string; name?: string }) => 
                model.id && 
                (model.id.includes('openai') || 
                 model.id.includes('anthropic') || 
                 model.id.includes('google') ||
                 model.id.includes('meta-llama'))
              )
              .map((model: { id: string; name?: string }) => ({
                value: model.id,
                label: model.name || model.id,
              }))
              .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label))
          } else {
            // Fallback to common models if API fails
            models = [
              { value: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
              { value: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
              { value: 'anthropic/claude-3.5-sonnet', label: 'Anthropic Claude 3.5 Sonnet' },
              { value: 'google/gemini-pro', label: 'Google Gemini Pro' },
              { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Meta Llama 3.1 70B' },
            ]
          }
          break
        }

        // Image generation providers
        case 'fal': {
          // Fal.ai models - Fal.ai has 600+ models, but these are the most popular for image generation
          // Fal.ai doesn't provide a public API to list models, so we maintain a curated list
          // You can explore more models at https://fal.ai/explore
          models = [
            { value: 'fal-ai/flux/schnell', label: 'Flux Schnell (Fast)' },
            { value: 'fal-ai/flux/dev', label: 'Flux Dev (High Quality)' },
            { value: 'fal-ai/flux-pro', label: 'Flux Pro (Premium)' },
            { value: 'fal-ai/flux/dev-lite', label: 'Flux Dev Lite' },
            { value: 'fal-ai/stable-diffusion-v35-large', label: 'Stable Diffusion v3.5 Large' },
            { value: 'fal-ai/imagen4/preview/fast', label: 'Imagen 4 Preview (Fast)' },
            { value: 'fal-ai/bytedance/seedream/v3/text-to-image', label: 'ByteDance SeedDream v3' },
            { value: 'fal-ai/bagel', label: 'Bagel' },
            { value: 'fal-ai/sana/v1.5/4.8b', label: 'Sana v1.5 (4.8B)' },
            { value: 'rundiffusion-fal/rundiffusion-photo-flux', label: 'RunDiffusion Photo Flux' },
            { value: 'fal-ai/stable-diffusion-v3-medium', label: 'Stable Diffusion v3 Medium' },
            { value: 'fal-ai/stable-cascade', label: 'Stable Cascade' },
          ]
          break
        }

        case 'openai-dalle': {
          // OpenAI DALL-E models
          models = [
            { value: 'dall-e-3', label: 'DALL-E 3 (Recommended)' },
            { value: 'dall-e-2', label: 'DALL-E 2' },
          ]
          break
        }

        case 'replicate': {
          // Replicate models - fetch from API if possible, otherwise use common models
          try {
            const response = await fetch('https://api.replicate.com/v1/models', {
              headers: {
                'Authorization': `Token ${apiKey}`,
              },
            })

            if (response.ok) {
              const data = await response.json() as { results: Array<{ name: string; description?: string }> }
              models = data.results
                .filter(model => 
                  model.name.includes('stable-diffusion') || 
                  model.name.includes('flux') ||
                  model.name.includes('midjourney')
                )
                .map(model => ({
                  value: model.name,
                  label: model.description || model.name,
                }))
                .slice(0, 20) // Limit to top 20
            } else {
              throw new Error('API request failed')
            }
          } catch {
            // Fallback to common Replicate models
            models = [
              { value: 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf', label: 'Stable Diffusion v2.1' },
              { value: 'black-forest-labs/flux:latest', label: 'Flux (Latest)' },
              { value: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b', label: 'Stable Diffusion XL' },
            ]
          }
          break
        }

        default:
          return NextResponse.json(
            { error: `Unknown provider: ${provider}` },
            { status: 400 }
          )
      }

      return NextResponse.json({ models })
    } catch (error) {
      console.error(`Error fetching models for ${provider}:`, error)
      
      // Return fallback models if API call fails
      const fallbackModels: Record<string, Array<{ value: string; label: string }>> = {
        openai: [
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
          { value: 'gpt-4o', label: 'GPT-4o' },
          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
        ],
        anthropic: [
          { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
          { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
          { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
        ],
        gemini: [
          { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
          { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
          { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
        ],
        openrouter: [
          { value: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
          { value: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
          { value: 'anthropic/claude-3.5-sonnet', label: 'Anthropic Claude 3.5 Sonnet' },
          { value: 'google/gemini-pro', label: 'Google Gemini Pro' },
          { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Meta Llama 3.1 70B' },
        ],
        fal: [
          { value: 'fal-ai/flux/schnell', label: 'Flux Schnell (Fast)' },
          { value: 'fal-ai/flux/dev', label: 'Flux Dev (High Quality)' },
          { value: 'fal-ai/flux-pro', label: 'Flux Pro (Premium)' },
          { value: 'fal-ai/flux/dev-lite', label: 'Flux Dev Lite' },
          { value: 'fal-ai/stable-diffusion-v35-large', label: 'Stable Diffusion v3.5 Large' },
          { value: 'fal-ai/imagen4/preview/fast', label: 'Imagen 4 Preview (Fast)' },
          { value: 'fal-ai/bytedance/seedream/v3/text-to-image', label: 'ByteDance SeedDream v3' },
          { value: 'fal-ai/bagel', label: 'Bagel' },
          { value: 'fal-ai/sana/v1.5/4.8b', label: 'Sana v1.5 (4.8B)' },
          { value: 'rundiffusion-fal/rundiffusion-photo-flux', label: 'RunDiffusion Photo Flux' },
          { value: 'fal-ai/stable-diffusion-v3-medium', label: 'Stable Diffusion v3 Medium' },
          { value: 'fal-ai/stable-cascade', label: 'Stable Cascade' },
          { value: 'fal-ai/stable-diffusion-v15', label: 'Stable Diffusion v1.5' },
        ],
        'openai-dalle': [
          { value: 'dall-e-3', label: 'DALL-E 3 (Recommended)' },
          { value: 'dall-e-2', label: 'DALL-E 2' },
        ],
        replicate: [
          { value: 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf', label: 'Stable Diffusion v2.1' },
          { value: 'black-forest-labs/flux:latest', label: 'Flux (Latest)' },
        ],
      }

      return NextResponse.json({
        models: fallbackModels[provider] || [],
        error: 'Failed to fetch models from API, using fallback list',
      })
    }
  } catch (error) {
    console.error('Error in GET /api/ai/models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}

