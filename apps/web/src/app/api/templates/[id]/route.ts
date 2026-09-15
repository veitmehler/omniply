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

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/templates/[id] - Get single template
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const clerkId = await resolveClerkId()
    const { id } = await context.params

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(clerkId)

    const template = await prisma.template.findFirst({
      where: {
        id,
        userId: user.id, // Ensure user can only access their own templates
      },
    })

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error('Error fetching template:', error)
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    )
  }
}

// PATCH /api/templates/[id] - Update template
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const clerkId = await resolveClerkId()
    const { id } = await context.params

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      name, 
      tone, 
      description, 
      linkedinTemplate, 
      twitterTemplate, 
      facebookTemplate,
      instagramTemplate,
      telegramTemplate,
      threadsTemplate,
      isDefault 
    } = body

    const user = await getOrCreateUser(clerkId)

    // Check if template exists and belongs to user
    const existingTemplate = await prisma.template.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingTemplate) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // If setting as default, unset other defaults first
    if (isDefault && !existingTemplate.isDefault) {
      await prisma.template.updateMany({
        where: {
          userId: user.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      })
    }

    // Update template
    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(tone !== undefined && { tone }),
        ...(description !== undefined && { description }),
        ...(linkedinTemplate !== undefined && { linkedinTemplate }),
        ...(twitterTemplate !== undefined && { twitterTemplate }),
        ...(facebookTemplate !== undefined && { facebookTemplate }),
        ...(instagramTemplate !== undefined && { instagramTemplate }),
        ...(telegramTemplate !== undefined && { telegramTemplate }),
        ...(threadsTemplate !== undefined && { threadsTemplate }),
        ...(isDefault !== undefined && { isDefault }),
      },
    })

    return NextResponse.json(template)
  } catch (error) {
    console.error('Error updating template:', error)
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 }
    )
  }
}

// DELETE /api/templates/[id] - Delete template
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const clerkId = await resolveClerkId()
    const { id } = await context.params

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(clerkId)

    // Check if template exists and belongs to user
    const template = await prisma.template.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Don't allow deleting the default template if it's the only one
    if (template.isDefault) {
      const templateCount = await prisma.template.count({
        where: { userId: user.id },
      })

      if (templateCount === 1) {
        return NextResponse.json(
          { error: 'Cannot delete the only template' },
          { status: 400 }
        )
      }
    }

    // Delete template
    await prisma.template.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Template deleted successfully' })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    )
  }
}

