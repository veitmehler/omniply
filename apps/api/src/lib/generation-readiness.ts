/**
 * Generation-Readiness Validator (onboarding plan — the guarantee mechanism).
 *
 * ONE canonical answer to "can this account generate content with nothing
 * else needed?". Onboarding completion requires it green; the admin surface
 * reads it as the account-health check. Every row names the field, why it
 * matters, and which onboarding step owns it.
 */
import { prisma } from '@omniply/shared'

export interface ReadinessGap {
  field: string
  why: string
  step: string
}

export interface Readiness {
  ready: boolean
  missing: ReadinessGap[]
}

export async function generationReadiness(accountId: string): Promise<Readiness> {
  const missing: ReadinessGap[] = []
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, ownerUserId: true, articleCalendarId: true },
  })
  if (!account?.ownerUserId) {
    return { ready: false, missing: [{ field: 'account.ownerUserId', why: 'No owner user', step: 'provisioning' }] }
  }
  const ownerId = account.ownerUserId

  const [owner, brand, settings, ghl, wpCount, offerCount, sessionRow] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: { newsletterCalendarId: true } }),
    prisma.brandSettings.findUnique({ where: { userId: ownerId } }),
    prisma.settings.findUnique({ where: { userId: ownerId } }),
    prisma.ghlSettings.findUnique({ where: { userId: ownerId }, select: { ghlApiKey: true, ghlLocationId: true, ghlUserId: true } }),
    prisma.wordPressConnection.count({ where: { userId: ownerId } }),
    prisma.newsletterOffer.count({ where: { userId: ownerId, enabled: true } }),
    prisma.onboardingSession.findUnique({ where: { accountId }, select: { stepData: true } }),
  ])
  const stepData = (sessionRow?.stepData as Record<string, unknown>) ?? {}

  const need = (cond: unknown, field: string, why: string, step: string) => {
    if (!cond) missing.push({ field, why, step })
  }

  // GHL plumbing (provisioning)
  need(ghl?.ghlApiKey && ghl.ghlLocationId && ghl.ghlUserId, 'ghlSettings', 'Publishing runs through GHL', 'provisioning')

  // Brand identity
  need(brand?.organizationName?.trim(), 'brandSettings.organizationName', 'Used across all content', 'business_confirm')
  need(brand?.industry?.trim(), 'brandSettings.industry', 'Plain-language pass silently skips without it', 'brand_profile_confirm')
  need(brand?.primarySpecialization?.trim(), 'brandSettings.primarySpecialization', 'Drives calendar routing + {{specialization}}', 'brand_profile_confirm')
  need(brand?.businessDescription?.trim(), 'brandSettings.businessDescription', 'Core article/newsletter context', 'brand_profile_confirm')
  need(brand?.who?.trim(), 'brandSettings.who', 'Target-audience variable', 'brand_profile_confirm')
  need(brand?.ourExperience?.trim(), 'brandSettings.ourExperience', 'E-E-A-T experience blurb', 'brand_profile_confirm')
  need(brand?.articleGoal?.trim(), 'brandSettings.articleGoal', 'Strategic goal injected into articles', 'brand_profile_confirm')

  // Template / visual identity
  need(brand?.nlLogoUrl?.trim(), 'brandSettings.nlLogoUrl', 'Newsletter/email header logo', 'logo_confirm')
  need(brand?.nlHeaderBgColor?.trim(), 'brandSettings.nlHeaderBgColor', 'Newsletter header band', 'template_reveal')
  need(brand?.nlLinkColor?.trim(), 'brandSettings.nlLinkColor', 'Newsletter link/accent color', 'template_reveal')

  // Voice + CTAs
  need(settings?.writingStyle?.trim(), 'settings.writingStyle', 'Every generator writes in this voice', 'writing_sample')
  need(brand?.socialCallToAction?.trim(), 'brandSettings.socialCallToAction', 'Social posts need a destination', 'cta')
  const phoneBooking = brand?.bookingMode === 'phone' && !!brand?.organizationPhone?.trim()
  need(brand?.bookingUrl?.trim() || phoneBooking, 'brandSettings.bookingUrl', 'Every CTA resolves to the booking page (or phone-mode + clinic phone)', 'booking_url')
  need(settings?.socialTimezone?.trim(), 'settings.socialTimezone', 'Post scheduling timezone', 'business_confirm')

  // Distribution
  const wpDeclined = stepData.wordpressDeclined === true
  need(wpCount > 0 || wpDeclined, 'wordpressConnection', '85% publish to WP; explicit HTML-export opt-out otherwise', 'wordpress')

  // Content assets
  need(offerCount >= 1, 'newsletterOffers', 'Newsletter offer cards start from these', 'offers')

  // Calendars (assigned at completion from confirmed specialization)
  need(account.articleCalendarId, 'account.articleCalendarId', 'Article topics come from the routed calendar', 'final')
  need(owner?.newsletterCalendarId, 'user.newsletterCalendarId', 'Newsletter topics come from the routed calendar', 'final')

  // NOTE: no elevenLabs gate — the step was removed from client onboarding
  // (P3); voice is a post-onboarding dashboard decision and hook-video slots
  // degrade gracefully without a cloned voice.

  return { ready: missing.length === 0, missing }
}
