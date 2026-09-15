import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { encrypt, decrypt, maskApiKey } from '@omniply/shared'

// Valid provider names
const VALID_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter', 'fal', 'openai-dalle', 'replicate', 'telegram', 'elevenlabs']

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

// GET /api/api-keys - Get all API keys for user (masked)
export async function GET() {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(clerkId)

    // Get all API keys for this user
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        provider: true,
        encryptedKey: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Return masked keys. A single key that can't be decrypted (e.g. encrypted
    // with a different ENCRYPTION_KEY) must not 500 the whole list — surface it
    // with a marker so the user can still see and re-enter or delete it.
    const maskedKeys = apiKeys.map((key) => {
      let maskedKey: string
      try {
        maskedKey = maskApiKey(decrypt(key.encryptedKey))
      } catch (error) {
        console.error(`[api-keys] failed to decrypt stored ${key.provider} key:`, error)
        maskedKey = '(unable to decrypt)'
      }
      return {
        id: key.id,
        provider: key.provider,
        maskedKey,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      }
    })

    return NextResponse.json(maskedKeys)
  } catch (error) {
    console.error('Error fetching API keys:', error)
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500 }
    )
  }
}

// POST /api/api-keys - Create or update API key for a provider
export async function POST(request: NextRequest) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { provider, apiKey } = body

    // Validation
    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, apiKey' },
        { status: 400 }
      )
    }

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 }
      )
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key must be a non-empty string' },
        { status: 400 }
      )
    }

    const user = await getOrCreateUser(clerkId)

    // Encrypt the API key
    const encryptedKey = encrypt(apiKey.trim())

    // Check if API key already exists for this provider
    const existingKey = await prisma.apiKey.findFirst({
      where: {
        userId: user.id,
        provider,
      },
    })

    let result
    if (existingKey) {
      // Update existing key
      result = await prisma.apiKey.update({
        where: { id: existingKey.id },
        data: {
          encryptedKey,
        },
      })
    } else {
      // Create new key
      result = await prisma.apiKey.create({
        data: {
          userId: user.id,
          provider,
          encryptedKey,
        },
      })
    }

    // Return masked key
    return NextResponse.json({
      id: result.id,
      provider: result.provider,
      maskedKey: maskApiKey(apiKey),
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    })
  } catch (error) {
    console.error('Error saving API key:', error)
    return NextResponse.json(
      { error: 'Failed to save API key' },
      { status: 500 }
    )
  }
}

