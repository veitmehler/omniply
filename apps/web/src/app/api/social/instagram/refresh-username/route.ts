import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { prisma, accountMemberIdsForUser } from '@omniply/shared'
import { refreshInstagramUsername } from '@omniply/shared'

/**
 * POST /api/social/instagram/refresh-username
 * Refresh Instagram username for a connection
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Refresh Instagram Username API] Request received')
    
    const clerkId = await resolveClerkId()
    if (!clerkId) {
      console.log('[Refresh Instagram Username API] Unauthorized - no clerkId')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      console.log('[Refresh Instagram Username API] User not found')
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { connectionId } = body

    if (!connectionId) {
      console.log('[Refresh Instagram Username API] Missing connectionId')
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 })
    }

    console.log('[Refresh Instagram Username API] Looking for connection:', connectionId)

    // Verify connection belongs to user
    const connection = await prisma.socialConnection.findUnique({
      where: { id: connectionId },
    })

    if (!connection) {
      console.log('[Refresh Instagram Username API] Connection not found')
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    if (!(await accountMemberIdsForUser(user.id)).includes(connection.userId)) {
      console.log('[Refresh Instagram Username API] Unauthorized - connection belongs to a different account')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (connection.platform !== 'instagram') {
      console.log('[Refresh Instagram Username API] Connection is not Instagram:', connection.platform)
      return NextResponse.json({ error: 'Connection is not Instagram' }, { status: 400 })
    }

    console.log('[Refresh Instagram Username API] Refreshing username for connection:', connectionId)

    // Refresh username
    const username = await refreshInstagramUsername(connectionId)

    if (username) {
      console.log('[Refresh Instagram Username API] Successfully refreshed username:', username)
      return NextResponse.json({ success: true, username })
    } else {
      console.log('[Refresh Instagram Username API] Could not fetch username')
      // Return 200 with success: false instead of 404
      // This is a known limitation - Meta's API doesn't always return Instagram account details
      // The username will be fetched automatically on the first post attempt
      return NextResponse.json({ 
        success: false, 
        error: 'Could not fetch username via API. This is a known Meta API limitation. The username will be automatically fetched when you publish your first Instagram post.' 
      })
    }
  } catch (error) {
    console.error('[Refresh Instagram Username API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh username' },
      { status: 500 }
    )
  }
}

