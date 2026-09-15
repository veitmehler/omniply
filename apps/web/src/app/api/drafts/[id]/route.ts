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

// GET /api/drafts/[id] - Get a single draft
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

    const draft = await prisma.draft.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        posts: {
          select: {
            id: true,
            platform: true,
            publishedAt: true,
            scheduledAt: true,
            status: true,
            postUrl: true,
            parentPostId: true, // Include to filter out reply posts
            analyticsData: true, // Include analytics data
            analyticsLastSyncedAt: true, // Include last sync timestamp
          },
        },
      },
    })

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    // Parse twitterContent if it's a JSON string (thread)
    let twitterContent: string | string[] | null = draft.twitterContent
    if (twitterContent && typeof twitterContent === 'string') {
      try {
        const parsed = JSON.parse(twitterContent)
        if (Array.isArray(parsed)) {
          twitterContent = parsed as string[]
        }
      } catch {
        // Keep as string if not valid JSON
      }
    }

    return NextResponse.json({
      ...draft,
      twitterContent,
    })
  } catch (error) {
    console.error('Error fetching draft:', error)
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 })
  }
}

// PATCH /api/drafts/[id] - Update a draft
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

    // Check if draft exists and belongs to user
    const existingDraft = await prisma.draft.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingDraft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    // Update the draft
    const updatedDraft = await prisma.draft.update({
      where: { id },
      data: {
        ...body,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json(updatedDraft)
  } catch (error) {
    console.error('Error updating draft:', error)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }
}

// DELETE /api/drafts/[id] - Delete a draft
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

    // Check if draft exists and belongs to user
    const existingDraft = await prisma.draft.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingDraft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    // Delete all associated posts first (including replies)
    // This ensures we don't leave orphaned posts in the database
    await prisma.post.deleteMany({
      where: { draftId: id },
    })

    // Delete the draft
    await prisma.draft.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting draft:', error)
    return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 })
  }
}

