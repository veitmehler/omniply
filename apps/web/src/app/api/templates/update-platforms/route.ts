import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'

// Default platform templates to add to existing templates
const PLATFORM_TEMPLATES_BY_TONE: Record<string, {
  facebookTemplate: string
  instagramTemplate: string
  telegramTemplate: string
  threadsTemplate: string
}> = {
  professional: {
    facebookTemplate: `🚀 {idea}

Here are my key takeaways:
• {point1}
• {point2}
• {point3}

What's your experience with this? I'd love to hear your thoughts in the comments below!

#Business #Professional #Leadership`,
    instagramTemplate: `🚀 {idea}

Here are my key takeaways:
• {point1}
• {point2}
• {point3}

What's your experience with this? Share your thoughts below! 👇

#Business #Professional #Leadership #Motivation`,
    telegramTemplate: `🚀 {idea}

Here are my key takeaways:
• {point1}
• {point2}
• {point3}

What's your experience with this? Share your thoughts below!

#Business #Professional #Leadership`,
    threadsTemplate: `🚀 {idea}

Key takeaways:
• {point1}
• {point2}
• {point3}

What's your experience?`,
  },
  casual: {
    facebookTemplate: `Hey everyone! 👋

{idea}

Here's what I've learned:
→ {point1}
→ {point2}
→ {point3}

Anyone else experience this? Drop a comment below!

#CasualChat #RealTalk`,
    instagramTemplate: `Hey everyone! 👋

{idea}

Here's what I've learned:
→ {point1}
→ {point2}
→ {point3}

Anyone else experience this? Drop a comment below! 💬

#CasualChat #RealTalk #Community`,
    telegramTemplate: `Hey everyone! 👋

{idea}

Here's what I've learned:
→ {point1}
→ {point2}
→ {point3}

Anyone else experience this? Drop a comment!

#CasualChat #RealTalk`,
    threadsTemplate: `Hey everyone! 👋

{idea}

Quick thoughts:
→ {point1}
→ {point2}
→ {point3}

Your take?`,
  },
  inspirational: {
    facebookTemplate: `✨ {idea}

Remember:
💡 {point1}
💪 {point2}
🎯 {point3}

Keep pushing forward. You've got this! Share this with someone who needs to hear it today.

#Motivation #Inspiration #Growth`,
    instagramTemplate: `✨ {idea}

Remember:
💡 {point1}
💪 {point2}
🎯 {point3}

Keep pushing forward. You've got this! 💪

Tag someone who needs to hear this today 👇

#Motivation #Inspiration #Growth #Mindset`,
    telegramTemplate: `✨ {idea}

Remember:
💡 {point1}
💪 {point2}
🎯 {point3}

Keep pushing forward. You've got this!

#Motivation #Inspiration #Growth`,
    threadsTemplate: `✨ {idea}

Remember:
💡 {point1}
💪 {point2}
🎯 {point3}

You've got this! 💪`,
  },
  'question-based': {
    facebookTemplate: `{idea}

Here's what I'm curious about:
❓ {point1}
❓ {point2}
❓ {point3}

What's your perspective? I'd love to hear your thoughts in the comments below!

#Discussion #Community #YourThoughts`,
    instagramTemplate: `{idea}

Here's what I'm curious about:
❓ {point1}
❓ {point2}
❓ {point3}

What's your perspective? Drop your thoughts below! 👇

#Discussion #Community #YourThoughts #Engage`,
    telegramTemplate: `{idea}

Here's what I'm curious about:
❓ {point1}
❓ {point2}
❓ {point3}

What's your perspective? Share your thoughts!

#Discussion #Community #YourThoughts`,
    threadsTemplate: `{idea}

Questions:
❓ {point1}
❓ {point2}
❓ {point3}

Your thoughts?`,
  },
  storytelling: {
    facebookTemplate: `Let me tell you about {idea}

The journey taught me:
📖 {point1}
📖 {point2}
📖 {point3}

Have you experienced something similar? I'd love to hear your story in the comments!

#Story #Journey #Experience`,
    instagramTemplate: `Let me tell you about {idea}

The journey taught me:
📖 {point1}
📖 {point2}
📖 {point3}

Have you experienced something similar? Share your story below! 👇

#Story #Journey #Experience #LifeLessons`,
    telegramTemplate: `Let me tell you about {idea}

The journey taught me:
📖 {point1}
📖 {point2}
📖 {point3}

Have you experienced something similar? Share your story!

#Story #Journey #Experience`,
    threadsTemplate: `Story time: {idea}

What I learned:
📖 {point1}
📖 {point2}
📖 {point3}

What's your story?`,
  },
}

// POST /api/templates/update-platforms - Update existing templates with new platform fields
export async function POST() {
  try {
    const clerkId = await resolveClerkId()

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Get all templates for this user that are missing platform templates
    // Check for null or empty string values
    const templates = await prisma.template.findMany({
      where: {
        userId: user.id,
        OR: [
          { facebookTemplate: null },
          { facebookTemplate: '' },
          { instagramTemplate: null },
          { instagramTemplate: '' },
          { telegramTemplate: null },
          { telegramTemplate: '' },
          { threadsTemplate: null },
          { threadsTemplate: '' },
        ],
      },
    })

    if (templates.length === 0) {
      return NextResponse.json({
        message: 'All templates already have platform fields',
        updated: 0,
      })
    }

    // Update each template with platform templates based on tone
    let updatedCount = 0
    for (const template of templates) {
      const platformTemplates = PLATFORM_TEMPLATES_BY_TONE[template.tone]
      if (platformTemplates) {
        const updateData: {
          facebookTemplate?: string
          instagramTemplate?: string
          telegramTemplate?: string
          threadsTemplate?: string
        } = {}
        
        // Only update fields that are null or empty
        if (!template.facebookTemplate || template.facebookTemplate.trim() === '') {
          updateData.facebookTemplate = platformTemplates.facebookTemplate
        }
        if (!template.instagramTemplate || template.instagramTemplate.trim() === '') {
          updateData.instagramTemplate = platformTemplates.instagramTemplate
        }
        if (!template.telegramTemplate || template.telegramTemplate.trim() === '') {
          updateData.telegramTemplate = platformTemplates.telegramTemplate
        }
        if (!template.threadsTemplate || template.threadsTemplate.trim() === '') {
          updateData.threadsTemplate = platformTemplates.threadsTemplate
        }
        
        // Only update if there are fields to update
        if (Object.keys(updateData).length > 0) {
          await prisma.template.update({
            where: { id: template.id },
            data: updateData,
          })
          updatedCount++
        }
      }
    }

    return NextResponse.json({
      message: 'Templates updated successfully',
      updated: updatedCount,
      total: templates.length,
    })
  } catch (error) {
    console.error('Error updating templates:', error)
    return NextResponse.json(
      { error: 'Failed to update templates' },
      { status: 500 }
    )
  }
}

