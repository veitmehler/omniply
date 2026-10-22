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
  // Review requests sent in range (workflow webhook rows). Null until the
  // account has EVER logged one — a clinic whose workflow lacks the webhook
  // step would otherwise show an eternal, misleading 0.
  reviewRequests: number | null
  // Review-count growth over the range (live count minus baseline snapshot).
  reviewGrowth: number | null
  // Baseline day when tracking started INSIDE the range (partial history);
  // null once a snapshot at/before the range start exists.
  growthSince: string | null
}

/** Pure growth computation. Exported for tests.
 *  Baseline = latest snapshot at/before the range start, else the earliest
 *  snapshot we have (then growthSince names that partial-history day). */
export function computeReviewGrowth(
  current: number | null,
  snapshots: Array<{ day: string; count: number }>, // ascending by day
  rangeStartDay: string,
): { reviewGrowth: number | null; growthSince: string | null } {
  if (current === null || !snapshots.length) return { reviewGrowth: null, growthSince: null }
  let baseline: { day: string; count: number } | null = null
  for (const s of snapshots) {
    if (s.day <= rangeStartDay) baseline = s
    else break
  }
  if (baseline) return { reviewGrowth: current - baseline.count, growthSince: null }
  return { reviewGrowth: current - snapshots[0].count, growthSince: snapshots[0].day }
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
  // Every fresh probe also lands today's growth-baseline snapshot — the
  // daily cron guarantees density, this keeps actively-viewed dashboards
  // current between cron runs.
  if (reviewCount !== null) {
    const day = new Date().toISOString().slice(0, 10)
    await prisma.reviewCountSnapshot
      .upsert({
        where: { accountId_day: { accountId, day } },
        create: { accountId, day, count: reviewCount, rating },
        update: { count: reviewCount, rating },
      })
      .catch(() => null)
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
  const empty: PracticeStats = {
    appointments: null,
    unread: null,
    rating: null,
    reviewCount: null,
    reviewRequests: null,
    reviewGrowth: null,
    growthSince: null,
  }
  try {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
    if (!account?.ownerUserId) return empty
    const creds = await getGhlCredentials(account.ownerUserId)
    const now = Date.now()
    const since = new Date(now - days * 24 * 60 * 60 * 1000)
    const [appointments, unread, google, requestsInRange, requestsEver, snapshots] = await Promise.all([
      creds ? countGhlAppointments(creds.apiKey, creds.locationId, now - days * 24 * 60 * 60 * 1000, now) : null,
      creds ? countUnreadGhlConversations(creds.apiKey, creds.locationId) : null,
      googleRating(account.ownerUserId, accountId),
      prisma.reviewRequestEvent.count({ where: { accountId, createdAt: { gte: since } } }),
      prisma.reviewRequestEvent.findFirst({ where: { accountId }, select: { id: true } }),
      prisma.reviewCountSnapshot.findMany({
        where: { accountId },
        orderBy: { day: 'asc' },
        select: { day: true, count: true },
      }),
    ])
    const growth = computeReviewGrowth(google.reviewCount, snapshots, since.toISOString().slice(0, 10))
    return {
      appointments,
      unread,
      rating: google.rating,
      reviewCount: google.reviewCount,
      reviewRequests: requestsEver ? requestsInRange : null,
      ...growth,
    }
  } catch (err) {
    logger.warn({ accountId, err }, '[practice-stats] failed (band hidden)')
    return empty
  }
}
