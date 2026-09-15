import { NextResponse } from 'next/server'
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

// GET /api/social/connections - List user's connected platforms
export async function GET() {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(clerkId)

    // Get all social connections for this user
    // Note: appType field may not exist until migration is applied
    try {
      const connections = await prisma.socialConnection.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          platform: true,
          appType: true, // Include appType to distinguish LinkedIn personal vs company
          platformUserId: true,
          platformUsername: true,
          isActive: true,
          lastUsed: true,
          createdAt: true,
          updatedAt: true,
          postTargetType: true,
          selectedPageId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      return NextResponse.json(connections)
    } catch (dbError: unknown) {
      interface PrismaError extends Error {
        code?: string
        message: string
      }
      const prismaError = dbError as PrismaError
      // If appType column doesn't exist yet (migration not applied), query without it
      if (prismaError.message?.includes('appType') || prismaError.message?.includes('column') || prismaError.code === 'P2001') {
        console.warn('[Social Connections API] appType column not found, querying without it (migration may not be applied yet)')
        const connections = await prisma.socialConnection.findMany({
          where: { userId: user.id },
          select: {
            id: true,
            platform: true,
            // appType: true, // Skip appType until migration is applied
            platformUserId: true,
            platformUsername: true,
            isActive: true,
            lastUsed: true,
            createdAt: true,
            updatedAt: true,
            postTargetType: true,
            selectedPageId: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        })

        // Add null appType for backward compatibility
        const connectionsWithAppType = connections.map(conn => ({
          ...conn,
          appType: conn.platform === 'linkedin' ? 'personal' : null,
        }))

        return NextResponse.json(connectionsWithAppType)
      }
      throw dbError // Re-throw if it's a different error
    }
  } catch (error) {
    console.error('Error fetching social connections:', error)
    return NextResponse.json(
      { error: 'Failed to fetch social connections' },
      { status: 500 }
    )
  }
}

