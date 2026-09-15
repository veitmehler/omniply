import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { prisma } from '@omniply/shared'
import { Prisma } from '@prisma/client'
import { getTwitterAnalytics } from '@omniply/shared'
import { getLinkedInAnalytics } from '@omniply/shared'

/**
 * POST /api/posts/[id]/sync-analytics - Sync analytics for a single post
 * This endpoint refreshes analytics for one specific post
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const userId = authResult.userId

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Find the post
    const post = await prisma.post.findFirst({
      where: {
        id,
        userId: user.id,
        status: 'published',
        publishedAt: {
          not: null,
        },
      },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    interface AnalyticsData {
      impressions?: number
      views?: number
      likes?: number
      retweets?: number
      replies?: number
      quoteTweets?: number
      clicks?: number
      comments?: number
      shares?: number
      [key: string]: unknown
    }

    console.log(`[Sync Analytics] Syncing analytics for post ${post.id} (${post.platform})`)

    let analytics: AnalyticsData | null = null

    if (post.platform === 'twitter' && post.tweetId) {
      // Fetch Twitter analytics
      analytics = await getTwitterAnalytics(user.id, post.tweetId)
    } else if (post.platform === 'linkedin' && post.postUrl) {
      // Extract LinkedIn post URN from URL
      // LinkedIn post URLs can be in format: https://www.linkedin.com/feed/update/{URN}
      // Or the postUrl might already be the URN itself (urn:li:share:...)
      let linkedInPostId: string | null = null
      
      // Check if postUrl is already a URN
      if (post.postUrl.startsWith('urn:li:share:')) {
        linkedInPostId = post.postUrl
      } else {
        // Try to extract from URL format: /feed/update/{URN}
        const urlMatch = post.postUrl.match(/\/feed\/update\/(urn:li:share:[^\/\?]+|[^\/\?]+)/)
        if (urlMatch) {
          linkedInPostId = urlMatch[1]
          // If it's not already a URN, construct it
          if (!linkedInPostId.startsWith('urn:li:share:')) {
            linkedInPostId = `urn:li:share:${linkedInPostId}`
          }
        }
      }

      if (linkedInPostId) {
        try {
          console.log('[Sync Analytics] Calling getLinkedInAnalytics with:', { userId: user.id, linkedInPostId })
          // Fetch LinkedIn analytics
          analytics = await getLinkedInAnalytics(user.id, linkedInPostId)
          console.log('[Sync Analytics] getLinkedInAnalytics returned:', analytics)
        } catch (error) {
          console.log('[Sync Analytics] Caught error from getLinkedInAnalytics:', {
            errorMessage: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorStack: error instanceof Error ? error.stack : undefined,
          })
          
          // Check if it's a permissions error
          if (error instanceof Error && error.message === 'LINKEDIN_PERMISSIONS_REQUIRED') {
            console.log('[Sync Analytics] Returning 403 for permissions error')
            return NextResponse.json({
              success: false,
              message: 'LinkedIn analytics requires additional permissions',
              error: 'permissions_required',
              details: 'LinkedIn analytics is currently unavailable. LinkedIn has restricted access to analytics. Please check on LinkedIn directly.',
            }, { status: 403 })
          }
          // Re-throw other errors
          console.log('[Sync Analytics] Re-throwing error (not permissions error)')
          throw error
        }
      } else {
        console.log('[Sync Analytics] linkedInPostId is null, cannot fetch analytics')
      }
    }

    const now = new Date()

    if (analytics) {
      // Update post with analytics data
      await prisma.post.update({
        where: { id: post.id },
        data: {
          analyticsData: analytics as Prisma.InputJsonValue,
          analyticsLastSyncedAt: now,
        },
      })

      console.log(`[Sync Analytics] Successfully synced analytics for post ${post.id}`)

      return NextResponse.json({
        success: true,
        message: 'Analytics synced successfully',
        analytics,
        lastSyncedAt: now.toISOString(),
      })
    } else {
      return NextResponse.json({
        success: false,
        message: 'Analytics not available for this post',
        error: 'Analytics data could not be fetched',
      }, { status: 404 })
    }
  } catch (error) {
    console.error('[Sync Analytics] Error syncing analytics:', error)
    return NextResponse.json(
      {
        error: 'Failed to sync analytics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

