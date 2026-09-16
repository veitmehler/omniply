/**
 * Onboarding bootstrap (onboarding plan Phase 2a).
 *
 * Runs once per session, on the first state fetch: pulls the GHL Business
 * Profile into stepData.ghlPrefill and kicks the background website crawl —
 * BEFORE question one, so the confirm steps are ready when the user reaches
 * them. Idempotent: a `bootstrapped` flag makes re-entry a no-op.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getBoss, QUEUES } from '../queues/index'
import { getGhlCredentials } from '../lib/ghl/settings'
import type { OnboardingCrawlJobData } from '../handlers/onboarding-crawl'

const GHL_BASE = 'https://services.leadconnectorhq.com'

interface GhlLocation {
  name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
  website?: string
  timezone?: string
  email?: string
  phone?: string
  logoUrl?: string
  firstName?: string
  lastName?: string
  business?: Record<string, unknown>
  social?: Record<string, string>
}

async function fetchLocation(apiKey: string, locationId: string): Promise<GhlLocation | null> {
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { location?: GhlLocation }
    return data.location ?? (data as GhlLocation)
  } catch {
    return null
  }
}

export async function bootstrapOnboarding(
  accountId: string,
  ownerUserId: string,
  sessionId: string,
  stepData: Record<string, unknown>,
): Promise<void> {
  if (stepData.bootstrapped) return
  stepData.bootstrapped = true

  const creds = await getGhlCredentials(ownerUserId)
  if (creds) {
    const loc = await fetchLocation(creds.apiKey, creds.locationId)
    if (loc) {
      const business = (loc.business ?? {}) as Record<string, string>
      const socials = Object.fromEntries(
        Object.entries(loc.social ?? {}).filter(([, v]) => typeof v === 'string' && v.trim().length > 0),
      )
      stepData.ghlPrefill = {
        organizationName: business.name || loc.name || '',
        email: loc.email || business.email || '',
        phone: loc.phone || '',
        website: (loc.website || business.website || '').trim(),
        address: [loc.address, loc.city, loc.state, loc.postalCode].filter(Boolean).join(', '),
        // Structured components (run-3 batch item 2): Settings uses the
        // structured address fields — joining then asking the client to
        // un-join was absurd.
        addressLine1: loc.address || '',
        addressCity: loc.city || '',
        addressState: loc.state || '',
        addressPostal: loc.postalCode || '',
        country: loc.country || '',
        timezone: loc.timezone || business.timezone || '',
        logoUrl: loc.logoUrl || '',
        contactName: [loc.firstName, loc.lastName].filter(Boolean).join(' '),
        socials,
      }
      logger.info({ accountId, hasWebsite: !!stepData.ghlPrefill }, '[onboarding] GHL prefill loaded')
    }
  }

  // Kick the crawl the moment we know the website — the confirm steps show
  // `pending` until the handler flips crawlDone.
  const website = (stepData.ghlPrefill as { website?: string } | undefined)?.website
  if (website) {
    const boss = await getBoss()
    const data: OnboardingCrawlJobData = { accountId, websiteUrl: website.startsWith('http') ? website : `https://${website}` }
    await boss.send(QUEUES.ONBOARDING_CRAWL, data, {
      singletonKey: `onboarding-crawl-${accountId}`,
      expireInSeconds: 15 * 60,
    })
  } else {
    // No website known — confirm steps fall back to manual entry; the
    // business_confirm card asks for the URL and re-triggers the crawl.
    stepData.crawlDone = false
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { stepData: stepData as object },
  })
}
