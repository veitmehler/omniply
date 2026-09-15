import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { prisma } from '@omniply/shared'

async function getOrCreateUser(clerkId: string) {
  let user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(clerkId)
    const email = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
    if (!email) throw new Error('No email found')
    const name = clerkUser.firstName
      ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`
      : email.split('@')[0]
    user = await prisma.user.create({ data: { clerkId, name, email } })
  }
  return user
}

// GET /api/posts/calendar - posts + automation runs for calendar view
export async function GET(request: Request) {
  try {
    const authResult = { userId: await resolveClerkId() }
    if (!authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const user = await getOrCreateUser(authResult.userId)
    const now = new Date()
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1)
    const end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const posts = await prisma.post.findMany({
      where: {
        userId: user.id,
        OR: [
          { publishedAt: { gte: start, lte: end } },
          { scheduledAt: { gte: start, lte: end } },
        ],
      },
      include: {
        draft: { select: { id: true, title: true, contentRaw: true } },
        automationRun: {
          select: {
            id: true,
            scheduledDate: true,
            status: true,
            jobId: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { publishedAt: 'desc' }],
    })

    const postsByDate: Record<string, Array<{
      id: string
      platform: string
      status: string
      content: string
      publishedAt: Date | null
      scheduledAt: Date | null
      draftId: string | null
      draft: { title: string } | null
      postType: string | null
      slotKey: string | null
      automationRunId: string | null
      automationRun: { id: string; scheduledDate: string; status: string; jobId: string | null } | null
    }>> = {}

    for (const post of posts) {
      const dateKey = post.scheduledAt
        ? new Date(post.scheduledAt).toISOString().split('T')[0]
        : post.publishedAt
          ? new Date(post.publishedAt).toISOString().split('T')[0]
          : new Date(post.createdAt).toISOString().split('T')[0]

      if (!postsByDate[dateKey]) postsByDate[dateKey] = []

      postsByDate[dateKey].push({
        id: post.id,
        platform: post.platform,
        status: post.status,
        content: post.content.substring(0, 100),
        publishedAt: post.publishedAt,
        scheduledAt: post.scheduledAt,
        draftId: post.draftId,
        draft: post.draft,
        postType: post.postType,
        slotKey: post.slotKey,
        automationRunId: post.automationRunId,
        automationRun: post.automationRun,
      })
    }

    const startDateStr = start.toISOString().split('T')[0]
    const endDateStr = end.toISOString().split('T')[0]

    const automationRuns = await prisma.socialAutomationRun.findMany({
      where: {
        userId: user.id,
        scheduledDate: { gte: startDateStr, lte: endDateStr },
      },
      include: {
        specResults: { orderBy: { slotKey: 'asc' } },
        job: { select: { id: true, topic: { select: { topic: true } } } },
        _count: { select: { posts: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    })

    const runsByDate: Record<string, typeof automationRuns> = {}
    for (const run of automationRuns) {
      if (!runsByDate[run.scheduledDate]) runsByDate[run.scheduledDate] = []
      runsByDate[run.scheduledDate].push(run)
    }

    return NextResponse.json({ postsByDate, runsByDate })
  } catch (error) {
    console.error('Error fetching calendar posts:', error)
    return NextResponse.json({ error: 'Failed to fetch calendar posts' }, { status: 500 })
  }
}
