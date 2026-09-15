import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { dispatchPublish } from '@/lib/social/dispatcher'

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
      (e) => e.id === clerkUser.primaryEmailAddressId,
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

/**
 * POST /api/posts/publish - Publish a post to social media
 * Facebook, Instagram, and LinkedIn route through Go HighLevel when configured.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { platform, content, imageUrl, mediaUrls, videoUrl, chatId } = body

    if (!platform || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: platform, content' },
        { status: 400 },
      )
    }

    const user = await getOrCreateUser(clerkId)

    const publishResult = await dispatchPublish(user.id, platform, content, {
      imageUrl: imageUrl || undefined,
      mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : undefined,
      videoUrl: videoUrl || undefined,
      chatId: chatId || undefined,
    })

    if (!publishResult.success) {
      return NextResponse.json({ error: publishResult.error }, { status: 400 })
    }

    const platformLabel: Record<string, string> = {
      linkedin: 'LinkedIn',
      facebook: 'Facebook',
      instagram: 'Instagram',
      telegram: 'Telegram',
      threads: 'Threads',
      twitter: 'Twitter/X',
    }

    return NextResponse.json({
      success: true,
      postUrl: publishResult.postUrl,
      tweetId: 'tweetId' in publishResult ? publishResult.tweetId : undefined,
      tweetIds: 'tweetIds' in publishResult ? publishResult.tweetIds : undefined,
      postId: 'postId' in publishResult ? publishResult.postId : undefined,
      provider: publishResult.provider,
      ghlPostId: publishResult.ghlPostId,
      imageUrl: imageUrl || undefined,
      message: `Post successfully submitted to ${platformLabel[platform] ?? platform}!`,
    })
  } catch (error) {
    console.error('Error publishing post:', error)
    return NextResponse.json(
      {
        error: 'Failed to publish post',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
