import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { decrypt, maskApiKey } from '@omniply/shared'

// Valid provider names
const VALID_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter']

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

// GET /api/api-keys/[provider] - Get specific provider key (masked)
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

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 }
      )
    }

    const user = await getOrCreateUser(clerkId)

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        userId: user.id,
        provider,
      },
    })

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    // Return masked key
    return NextResponse.json({
      id: apiKey.id,
      provider: apiKey.provider,
      maskedKey: maskApiKey(decrypt(apiKey.encryptedKey)),
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    })
  } catch (error) {
    console.error('Error fetching API key:', error)
    return NextResponse.json(
      { error: 'Failed to fetch API key' },
      { status: 500 }
    )
  }
}

// DELETE /api/api-keys/[provider] - Remove API key
export async function DELETE(
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

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 }
      )
    }

    const user = await getOrCreateUser(clerkId)

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        userId: user.id,
        provider,
      },
    })

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    await prisma.apiKey.delete({
      where: { id: apiKey.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting API key:', error)
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    )
  }
}

