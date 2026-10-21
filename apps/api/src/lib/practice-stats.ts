/**
 * "Practice" band of the AI Employee dashboard embed (2026-10-21): the
 * whole-practice numbers that replace the remaining native GHL widgets so
 * the dashboard can be a single branded panel.
 *
 * Every stat is best-effort and independently null — the panel hides what
 * it can't get rather than failing the AI band. Review-requests-sent was
 * deliberately dropped (no public GHL reputation API; the rating is the
 * outcome metric). Google rating comes from Place Details via the clinic's
 * confirmed googlePlaceId — the number patients actually see.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from './logger'
import { getGhlCredentials } from './ghl/settings'
import { countGhlAppointments, countUnreadGhlConversations } from './ghl/client'
import { placesConfigured, probePlace } from './google/places'

export interface PracticeStats {
  appointments: number | null // all calendars, panel range, cancelled excluded
  unread: number | null // live unread-conversation count
  rating: number | null // Google rating (live, cached)
  reviewCount: number | null
}

// Ratings move slowly and Place Details costs per call — cache per account.
const RATING_CACHE_MS = 6 * 60 * 60 * 1000
const ratingCache = new Map<string, { at: number; rating: number | null; reviewCount: number | null }>()

async function googleRating(ownerUserId: string, accountId: string): Promise<{ rating: number | null; reviewCount: number | null }> {
  const hit = ratingCache.get(accountId)
  if (hit && Date.now() - hit.at < RATING_CACHE_MS) return hit
  let rating: number | null = null
  let reviewCount: number | null = null
  try {
    if (placesConfigured()) {
      const brand = await brandSettingsForUser(ownerUserId)
      if (brand?.googlePlaceId) {
        const probe = await probePlace(brand.googlePlaceId)
        rating = probe?.rating ?? null
        reviewCount = probe?.totalReviews ?? null
      }
    }
  } catch (err) {
    logger.warn({ accountId, err }, '[practice-stats] rating probe failed (tile hidden)')
  }
  const entry = { at: Date.now(), rating, reviewCount }
  ratingCache.set(accountId, entry)
  if (ratingCache.size > 500) {
    const oldest = ratingCache.keys().next().value
    if (oldest) ratingCache.delete(oldest)
  }
  return entry
}

export async function practiceStatsForAccount(accountId: string, days: number): Promise<PracticeStats> {
  const empty: PracticeStats = { appointments: null, unread: null, rating: null, reviewCount: null }
  try {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
    if (!account?.ownerUserId) return empty
    const creds = await getGhlCredentials(account.ownerUserId)
    const now = Date.now()
    const [appointments, unread, google] = await Promise.all([
      creds ? countGhlAppointments(creds.apiKey, creds.locationId, now - days * 24 * 60 * 60 * 1000, now) : null,
      creds ? countUnreadGhlConversations(creds.apiKey, creds.locationId) : null,
      googleRating(account.ownerUserId, accountId),
    ])
    return { appointments, unread, rating: google.rating, reviewCount: google.reviewCount }
  } catch (err) {
    logger.warn({ accountId, err }, '[practice-stats] failed (band hidden)')
    return empty
  }
}
