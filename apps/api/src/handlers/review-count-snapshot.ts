/**
 * Daily Google review-count snapshot (AI Employee dashboard review growth).
 *
 * One Place Details probe per trusted, confirmed listing per day → upsert
 * today's {count, rating} row. The dashboard's growth metric is the live
 * count minus the baseline snapshot at the range start, so density here is
 * what makes "+N in 30d" honest. Same trust gate as the weekly review poll:
 * never snapshot a mis-resolved listing's numbers.
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { placesConfigured, probePlace } from '../lib/google/places'
import { listingTrusted } from '../lib/google/listing-trust'
import { logger } from '../lib/logger'

export async function reviewCountSnapshotHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
  if (!placesConfigured()) return
  const brands = await prisma.brandSettings.findMany({
    where: { googlePlaceId: { not: null } },
    select: {
      googlePlaceId: true,
      organizationName: true,
      googleListingConfirmedAt: true,
      user: { select: { accountId: true } },
    },
  })
  const day = new Date().toISOString().slice(0, 10)
  let written = 0
  let skipped = 0
  for (const b of brands) {
    const accountId = b.user?.accountId
    if (!accountId || !b.googlePlaceId) continue
    const probe = await probePlace(b.googlePlaceId)
    if (!probe || typeof probe.totalReviews !== 'number') continue
    if (!listingTrusted({ listingName: probe.name, brandName: b.organizationName, confirmedAt: b.googleListingConfirmedAt })) {
      skipped++
      continue
    }
    await prisma.reviewCountSnapshot.upsert({
      where: { accountId_day: { accountId, day } },
      create: { accountId, day, count: probe.totalReviews, rating: probe.rating ?? null },
      update: { count: probe.totalReviews, rating: probe.rating ?? null },
    })
    written++
  }
  logger.info({ accounts: brands.length, written, skipped, day }, '[review-count-snapshot] daily snapshots done')
}
