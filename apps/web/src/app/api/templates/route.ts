import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'

// GET /api/templates - Get all templates for the authenticated user
export async function GET() {
  try {
    console.log('[Templates API] Starting GET request...')
    const authResult = { userId: await resolveClerkId() }
    console.log('[Templates API] Auth result:', authResult)
    const clerkId = authResult.userId

    if (!clerkId) {
      console.log('[Templates API] No userId found in auth')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[Templates API] User authenticated:', clerkId)

    // Get or create user from database
    let user = await prisma.user.findUnique({
      where: { clerkId },
    })

    // Auto-create user if they don't exist (first time accessing after auth)
    if (!user) {
      const clerkUser = await currentUser()
      
      if (!clerkUser) {
        return NextResponse.json({ error: 'User not found in Clerk' }, { status: 404 })
      }

      const email = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId
      )?.emailAddress

      if (!email) {
        return NextResponse.json({ error: 'No email found' }, { status: 400 })
      }

      const name = clerkUser.firstName
        ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`
        : email.split('@')[0]

      // Create user
      user = await prisma.user.create({
        data: {
          clerkId,
          name,
          email,
        },
      })
    }

    // Get all templates for this user
    const templates = await prisma.template.findMany({
      where: { userId: user.id },
      orderBy: [
        { isDefault: 'desc' }, // Default template first
        { createdAt: 'desc' },
      ],
    })

    console.log('[Templates API] Returning', templates.length, 'templates')
    return NextResponse.json(templates)
  } catch (error) {
    console.error('[Templates API] ERROR:', error)
    console.error('[Templates API] Error details:', error instanceof Error ? error.message : String(error))
    console.error('[Templates API] Stack trace:', error instanceof Error ? error.stack : 'No stack')
    return NextResponse.json(
      { 
        error: 'Failed to fetch templates',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

// POST /api/templates - Create a new template
export async function POST(request: NextRequest) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

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

    // Validation
    if (!name || !tone || !description || !linkedinTemplate || !twitterTemplate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get or create user from database
    let user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      const clerkUser = await currentUser()
      
      if (!clerkUser) {
        return NextResponse.json({ error: 'User not found in Clerk' }, { status: 404 })
      }

      const email = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId
      )?.emailAddress

      if (!email) {
        return NextResponse.json({ error: 'No email found' }, { status: 400 })
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

    // If setting as default, unset other defaults first
    if (isDefault) {
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

    // Create template
    const template = await prisma.template.create({
      data: {
        userId: user.id,
        name,
        tone,
        description,
        linkedinTemplate,
        twitterTemplate,
        facebookTemplate: facebookTemplate || null,
        instagramTemplate: instagramTemplate || null,
        telegramTemplate: telegramTemplate || null,
        threadsTemplate: threadsTemplate || null,
        isDefault: isDefault || false,
      },
    })

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    console.error('Error creating template:', error)
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    )
  }
}

