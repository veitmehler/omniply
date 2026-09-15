import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'

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

// GET /api/settings - Get user settings
export async function GET() {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(clerkId)

    // Get or create settings
    let settings = await prisma.settings.findUnique({
      where: { userId: user.id },
    })

    if (!settings) {
      // Create default settings
      settings = await prisma.settings.create({
        data: {
          userId: user.id,
          theme: 'light',
          sidebarState: 'open',
          defaultProvider: null,
          defaultModel: null,
          defaultImageProvider: null,
          defaultImageModel: null,
          defaultImageStyle: null,
          writingStyle: null,
          telegramChatId: null,
        },
      })
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

// PATCH /api/settings - Update user settings
export async function PATCH(request: NextRequest) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { theme, sidebarState, defaultProvider, defaultModel, defaultImageProvider, defaultImageModel, defaultImageStyle, defaultImagePromptLlmProvider, defaultImagePromptLlmModel, writingStyle, telegramChatId, autoGenerateNextCycle } = body

    console.log('Updating settings with:', {
      theme,
      sidebarState,
      defaultProvider,
      defaultModel: defaultModel ? 'present' : 'missing',
      defaultImageProvider,
      defaultImageModel: defaultImageModel ? 'present' : 'missing',
      defaultImageStyle: defaultImageStyle ? 'present' : 'missing',
      defaultImagePromptLlmProvider,
      defaultImagePromptLlmModel,
      writingStyle: writingStyle ? 'present' : 'missing',
      telegramChatId: telegramChatId ? 'present' : 'missing',
    })

    const user = await getOrCreateUser(clerkId)

    // Get or create settings
    let settings = await prisma.settings.findUnique({
      where: { userId: user.id },
    })

    if (!settings) {
      console.log('Creating new settings record')
      settings = await prisma.settings.create({
        data: {
          userId: user.id,
          theme: theme || 'light',
          sidebarState: sidebarState || 'open',
          defaultProvider: defaultProvider || null,
          defaultModel: defaultModel || null,
          defaultImageProvider: defaultImageProvider || null,
          defaultImageModel: defaultImageModel || null,
          defaultImageStyle: defaultImageStyle || null,
          defaultImagePromptLlmProvider: defaultImagePromptLlmProvider || null,
          defaultImagePromptLlmModel: defaultImagePromptLlmModel || null,
          writingStyle: writingStyle || null,
          telegramChatId: telegramChatId || null,
          autoGenerateNextCycle: Boolean(autoGenerateNextCycle),
        },
      })
    } else {
      console.log('Updating existing settings record')
      // Build update data object
      const updateData: {
        lastLogin: Date
        theme?: string
        sidebarState?: string
        defaultProvider?: string | null
        defaultModel?: string | null
        defaultImageProvider?: string | null
        defaultImageModel?: string | null
        defaultImageStyle?: string | null
        defaultImagePromptLlmProvider?: string | null
        defaultImagePromptLlmModel?: string | null
        writingStyle?: string | null
        telegramChatId?: string | null
        autoGenerateNextCycle?: boolean
      } = {
        lastLogin: new Date(),
      }

      if (theme !== undefined) updateData.theme = theme
      if (sidebarState !== undefined) updateData.sidebarState = sidebarState
      if (defaultProvider !== undefined) {
        updateData.defaultProvider = defaultProvider || null
      }
      if (defaultModel !== undefined) {
        updateData.defaultModel = defaultModel || null
      }
      if (defaultImageProvider !== undefined) {
        updateData.defaultImageProvider = defaultImageProvider || null
      }
      if (defaultImageModel !== undefined) {
        updateData.defaultImageModel = defaultImageModel || null
      }
      if (defaultImageStyle !== undefined) {
        updateData.defaultImageStyle = defaultImageStyle || null
      }
      if (defaultImagePromptLlmProvider !== undefined) {
        updateData.defaultImagePromptLlmProvider = defaultImagePromptLlmProvider || null
      }
      if (defaultImagePromptLlmModel !== undefined) {
        updateData.defaultImagePromptLlmModel = defaultImagePromptLlmModel || null
      }
      if (writingStyle !== undefined) {
        updateData.writingStyle = writingStyle || null
      }
      if (telegramChatId !== undefined) {
        updateData.telegramChatId = telegramChatId || null
      }
      if (autoGenerateNextCycle !== undefined) {
        updateData.autoGenerateNextCycle = Boolean(autoGenerateNextCycle)
      }

      console.log('Update data:', updateData)

      // Update existing settings
      settings = await prisma.settings.update({
        where: { userId: user.id },
        data: updateData,
      })
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error updating settings:', error)
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { 
        error: 'Failed to update settings',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

