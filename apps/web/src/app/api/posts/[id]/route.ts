import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'

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

// GET /api/posts/[id] - Get a single post
export async function GET(
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
    const user = await getOrCreateUser(userId)

    const post = await prisma.post.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        draft: {
          select: {
            title: true,
            contentRaw: true,
          },
        },
      },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json(post)
  } catch (error) {
    console.error('Error fetching post:', error)
    return NextResponse.json({ error: 'Failed to fetch post' }, { status: 500 })
  }
}

// PATCH /api/posts/[id] - Update a post
export async function PATCH(
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
    const user = await getOrCreateUser(userId)
    const body = await request.json()

    // Check if post exists and belongs to user
    const existingPost = await prisma.post.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Validate scheduledAt if provided
    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        // Canceling schedule - convert to published if it was scheduled
        if (existingPost.status === 'scheduled') {
          body.status = 'published'
          body.publishedAt = new Date()
          body.scheduledAt = null
        }
      } else {
        const scheduledDate = new Date(body.scheduledAt)
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
        // Rescheduling - update status and dates
        body.status = 'scheduled'
        body.scheduledAt = scheduledDate
        body.publishedAt = null
      }
    }

    // Update the post
    const updatedPost = await prisma.post.update({
      where: { id },
      data: {
        ...body,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json(updatedPost)
  } catch (error) {
    console.error('Error updating post:', error)
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 })
  }
}

// DELETE /api/posts/[id] - Delete a post
export async function DELETE(
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
    const user = await getOrCreateUser(userId)

    // Check if post exists and belongs to user
    const existingPost = await prisma.post.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Delete the post
    await prisma.post.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting post:', error)
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 })
  }
}

