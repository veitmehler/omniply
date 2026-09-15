import { NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'

// Default templates to seed
const DEFAULT_TEMPLATES = [
  {
    name: 'Professional',
    tone: 'professional',
    description: 'Business-focused, clear, and authoritative',
    isDefault: true,
    linkedinTemplate: `🚀 {idea}

Here are my key takeaways:
• {point1}
• {point2}
• {point3}

What's your experience with this? Let me know in the comments!

#Business #Professional #Leadership`,
    twitterTemplate: `{idea}

Key insights:
• {point1}
• {point2}
• {point3}

What do you think?`,
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
  {
    name: 'Casual',
    tone: 'casual',
    description: 'Friendly, conversational, and relatable',
    isDefault: false,
    linkedinTemplate: `Hey everyone! 👋

{idea}

Here's what I've learned:
→ {point1}
→ {point2}
→ {point3}

Anyone else experience this? Drop a comment!

#CasualChat #RealTalk`,
    twitterTemplate: `{idea}

Quick thoughts:
- {point1}
- {point2}
- {point3}

Your take? 🤔`,
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
  {
    name: 'Inspirational',
    tone: 'inspirational',
    description: 'Motivational and uplifting',
    isDefault: false,
    linkedinTemplate: `✨ {idea}

Remember:
💡 {point1}
💪 {point2}
🎯 {point3}

Keep pushing forward. You've got this!

#Motivation #Inspiration #Growth`,
    twitterTemplate: `{idea} ✨

Remember:
→ {point1}
→ {point2}
→ {point3}

You've got this! 💪`,
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
  {
    name: 'Question-Based',
    tone: 'question-based',
    description: 'Drives engagement through questions',
    isDefault: false,
    linkedinTemplate: `{idea}

Here's what I'm curious about:
❓ {point1}
❓ {point2}
❓ {point3}

What's your perspective? I'd love to hear your thoughts in the comments!

#Discussion #Community #YourThoughts`,
    twitterTemplate: `{idea}

Questions:
• {point1}?
• {point2}?
• {point3}?

Share your thoughts! 👇`,
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
  {
    name: 'Storytelling',
    tone: 'storytelling',
    description: 'Narrative-driven and engaging',
    isDefault: false,
    linkedinTemplate: `Let me tell you about {idea}

The journey taught me:
📖 {point1}
📖 {point2}
📖 {point3}

Have you experienced something similar? I'd love to hear your story!

#Story #Journey #Experience`,
    twitterTemplate: `Story time: {idea}

What I learned:
1. {point1}
2. {point2}
3. {point3}

What's your story? 📖`,
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
]

// POST /api/templates/seed - Seed default templates for user
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

    // Check if user already has templates
    const existingTemplates = await prisma.template.count({
      where: { userId: user.id },
    })

    if (existingTemplates > 0) {
      return NextResponse.json(
        { message: 'Templates already exist', count: existingTemplates },
        { status: 200 }
      )
    }

    // Create default templates
    const templates = await prisma.template.createMany({
      data: DEFAULT_TEMPLATES.map((template) => ({
        ...template,
        userId: user.id,
      })),
    })

    return NextResponse.json({
      message: 'Templates seeded successfully',
      count: templates.count,
    })
  } catch (error) {
    console.error('Error seeding templates:', error)
    return NextResponse.json(
      { error: 'Failed to seed templates' },
      { status: 500 }
    )
  }
}

