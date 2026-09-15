import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { dispatchPublish, isGhlManagedPlatform } from '@/lib/social/dispatcher'

// Helper function to get or create user
async function getOrCreateUser(clerkId: string) {
  let user = await prisma.user.findUnique({
    where: { clerkId },
  })

  if (!user) {
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(clerkId)

    const email = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress

    if (!email) {
      throw new Error('No email found')
    }

    const firstName = clerkUser.firstName || ''
    const lastName = clerkUser.lastName || ''
    const name = firstName
      ? `${firstName}${lastName ? ' ' + lastName : ''}`
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

// GET /api/posts - Get all posts for the authenticated user
export async function GET(request: Request) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const userId = authResult.userId

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Get or create user
    const user = await getOrCreateUser(userId)

    // Build where clause
    const where: {
      userId: string
      status?: string
      OR?: Array<{
        publishedAt?: { gte?: Date; lte?: Date }
        scheduledAt?: { gte?: Date; lte?: Date }
      }>
    } = {
      userId: user.id,
    }

    if (status) {
      where.status = status
    }

    if (startDate || endDate) {
      where.OR = []
      if (startDate) {
        where.OR.push({
          publishedAt: { gte: new Date(startDate) },
        })
        where.OR.push({
          scheduledAt: { gte: new Date(startDate) },
        })
      }
      if (endDate) {
        where.OR.push({
          publishedAt: { lte: new Date(endDate) },
        })
        where.OR.push({
          scheduledAt: { lte: new Date(endDate) },
        })
      }
    }

    // Fetch all posts for this user
    const posts = await prisma.post.findMany({
      where,
      orderBy: [
        { scheduledAt: 'asc' },
        { publishedAt: 'desc' },
      ],
      include: {
        draft: {
          select: {
            title: true,
            contentRaw: true,
          },
        },
      },
    })

    return NextResponse.json(posts)
  } catch (error) {
    console.error('Error fetching posts:', error)
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
  }
}

// POST /api/posts - Create a new post
export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    const authResult = { userId: await resolveClerkId() }
    const userId = authResult.userId

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    body = await request.json()
    const {
      draftId,
      platform,
      content,
      postUrl,
      tweetId,
      imageUrl,
      status = 'published',
      scheduledAt,
      errorMsg,
      parentPostId,
      threadOrder,
      provider,
      ghlPostId,
      mediaUrls,
      videoUrl,
      postAsStory,
      postType,
    } = body

    // Validate required fields
    if (!platform || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: platform, content' },
        { status: 400 }
      )
    }

    // Validate scheduledAt if provided
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid scheduledAt date format' },
          { status: 400 }
        )
      }
      if (scheduledDate <= new Date()) {
        return NextResponse.json(
          { error: 'scheduledAt must be in the future' },
          { status: 400 }
        )
      }
    }

    // Get or create user
    const user = await getOrCreateUser(userId)

    // Check if a post already exists for this draft and platform
    // For threads, only check if the summary post (no parentPostId) exists
    if (draftId && !scheduledAt && !parentPostId) {
      const existingPost = await prisma.post.findFirst({
        where: {
          draftId,
          platform,
          status: 'published',
          parentPostId: null, // Only check for summary posts
        },
      })

      if (existingPost) {
        return NextResponse.json(
          { error: `Post already published to ${platform}` },
          { status: 400 }
        )
      }
    }

    const isScheduled = !!scheduledAt
    const finalStatus = isScheduled ? 'scheduled' : status
    const finalPublishedAt = isScheduled ? null : new Date()
    const finalScheduledAt = isScheduled ? new Date(scheduledAt) : null
    let resolvedProvider = provider as string | undefined
    let resolvedGhlPostId = ghlPostId as string | undefined

    // Schedule Facebook / Instagram / LinkedIn through GHL at creation time
    if (isScheduled && isGhlManagedPlatform(platform)) {
      const ghlResult = await dispatchPublish(user.id, platform, content, {
        imageUrl: imageUrl || undefined,
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : undefined,
        videoUrl: videoUrl || undefined,
        postAsStory: !!postAsStory,
        scheduledAt: finalScheduledAt ?? undefined,
      })

      if (!ghlResult.success) {
        return NextResponse.json({ error: ghlResult.error }, { status: 400 })
      }

      resolvedProvider = ghlResult.provider ?? 'ghl'
      resolvedGhlPostId = ghlResult.ghlPostId
    }

    const shouldStoreImage = imageUrl && (threadOrder === null || threadOrder === undefined || threadOrder === 0)

    const post = await prisma.post.create({
      data: {
        userId: user.id,
        draftId: draftId || null,
        parentPostId: parentPostId || null,
        threadOrder: threadOrder !== undefined ? threadOrder : null,
        platform,
        content,
        postUrl: postUrl || null,
        tweetId: tweetId || null,
        imageUrl: shouldStoreImage ? imageUrl : null,
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
        videoUrl: videoUrl || null,
        postType: postType || null,
        postAsStory: !!postAsStory,
        provider: resolvedProvider ?? null,
        ghlPostId: resolvedGhlPostId ?? null,
        status: finalStatus,
        publishedAt: finalPublishedAt,
        scheduledAt: finalScheduledAt,
        errorMsg: errorMsg || null,
      },
    })
    
    console.log(`[Posts API] Post created successfully:`, {
      id: post.id,
      platform: post.platform,
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString(),
    })

    // If draftId is provided and status is published, check if all platforms are published
    // For threads, only check if the summary post (no parentPostId) is published
    if (draftId && finalStatus === 'published' && !parentPostId) {
      const draft = await prisma.draft.findUnique({
        where: { id: draftId },
      })

      if (draft) {
        // Get all published posts for this draft (only summary posts, not replies)
        const publishedPosts = await prisma.post.findMany({
          where: {
            draftId,
            status: 'published',
            parentPostId: null, // Only count summary posts
          },
          select: {
            platform: true,
          },
        })

        const publishedPlatforms = publishedPosts.map(p => p.platform)
        
        // Get all posts (scheduled + published) for this draft to determine which platforms were generated
        const allDraftPosts = await prisma.post.findMany({
          where: {
            draftId,
            parentPostId: null, // Only count summary posts
          },
          select: {
            platform: true,
          },
        })
        
        // Get unique platforms that have posts for this draft
        const draftPlatforms = [...new Set(allDraftPosts.map(p => p.platform))]

        // Check if all platforms for this draft are published
        const allPublished = draftPlatforms.length > 0 && draftPlatforms.every(platform => 
          publishedPlatforms.includes(platform)
        )

        // Only mark draft as published if all platforms are published
        if (allPublished) {
          await prisma.draft.update({
            where: { id: draftId },
            data: {
              status: 'published',
              publishedAt: new Date(),
            },
          })
        }
      }
    }

    return NextResponse.json(post, { status: 201 })
  } catch (error) {
    console.error('[Posts API] Error creating post:', error)
    console.error('[Posts API] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      body: {
        draftId: body?.draftId,
        platform: body?.platform,
        hasContent: !!body?.content,
        scheduledAt: body?.scheduledAt,
        parentPostId: body?.parentPostId,
        tweetId: body?.tweetId,
      },
    })
    return NextResponse.json(
      { 
        error: 'Failed to create post',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

