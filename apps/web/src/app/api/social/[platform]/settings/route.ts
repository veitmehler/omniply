import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { getSocialConnection } from '@omniply/shared'

type RouteContext = {
  params: Promise<{
    platform: string
  }>
}

// PATCH /api/social/[platform]/settings - Update post target type and selected page
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  let platform: string | undefined
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    platform = params.platform

    if (platform !== 'linkedin' && platform !== 'facebook') {
      return NextResponse.json(
        { error: 'Platform must be linkedin or facebook' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { postTargetType, selectedPageId } = body

    // Validate postTargetType
    if (postTargetType !== undefined && postTargetType !== 'personal' && postTargetType !== 'page') {
      return NextResponse.json(
        { error: 'postTargetType must be "personal" or "page"' },
        { status: 400 }
      )
    }

    // If postTargetType is 'page', selectedPageId should be provided
    // But we'll allow it to be set later, so we don't require it immediately
    // If postTargetType is 'personal', clear selectedPageId
    const finalSelectedPageId = postTargetType === 'personal' ? null : (selectedPageId || null)

    // Get user from Clerk ID
    const { prisma } = await import('@omniply/shared')
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // For LinkedIn, we need to determine which connection to update
    // If postTargetType is 'page', update company connection
    // If postTargetType is 'personal', update personal connection
    let connection = null
    if (platform === 'linkedin') {
      // Try to get the appropriate connection based on postTargetType
      const targetAppType = postTargetType === 'page' ? 'company' : 'personal'
      connection = await getSocialConnection(user.id, platform, targetAppType)
      
      // If not found, try the other one
      if (!connection) {
        connection = await getSocialConnection(user.id, platform, targetAppType === 'company' ? 'personal' : 'company')
      }
    } else {
      connection = await getSocialConnection(user.id, platform)
    }
    
    if (!connection) {
      return NextResponse.json(
        { error: `${platform} account not connected` },
        { status: 404 }
      )
    }

    // Update connection settings
    const updatedConnection = await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        ...(postTargetType !== undefined && { postTargetType }),
        ...(finalSelectedPageId !== undefined && { selectedPageId: finalSelectedPageId }),
      },
    })

    return NextResponse.json({
      success: true,
      connection: {
        id: updatedConnection.id,
        postTargetType: updatedConnection.postTargetType,
        selectedPageId: updatedConnection.selectedPageId,
      },
    })
  } catch (error) {
    console.error(`Error updating ${platform || 'unknown'} settings:`, error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

