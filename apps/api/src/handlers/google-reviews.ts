/**
 * Google reviews jobs (google-reviews plan Tiers 1+2).
 *
 * PLACES_REVIEW_POLL (weekly cron): dual-sort Places probe for every account
 * with a resolved googlePlaceId — harvests the rotating top-5s. Dormant
 * without GOOGLE_MAPS_API_KEY.
 *
 * GOOGLE_REVIEWS_BACKFILL (on OAuth connect): full review history via the
 * Business Profile API. Account/location discovery is verified on first real
 * use — the whole tier is dormant until Google approves our API access.
 */
import type PgBoss from 'pg-boss'
import { prisma, decrypt } from '@omniply/shared'
import { placesConfigured, probePlace } from '../lib/google/places'
import { listingTrusted } from '../lib/google/listing-trust'
import { ingestReviews } from '../lib/google/review-ingest'
import { logger } from '../lib/logger'

export async function placesReviewPollHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
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
  let skipped = 0
  for (const b of brands) {
    const accountId = b.user?.accountId
    if (!accountId || !b.googlePlaceId) continue
    const probe = await probePlace(b.googlePlaceId)
    if (!probe) continue
    // Trust gate (places-trust plan): never harvest another business's
    // reviews from a mis-resolved, unconfirmed listing.
    if (!listingTrusted({ listingName: probe.name, brandName: b.organizationName, confirmedAt: b.googleListingConfirmedAt })) {
      skipped++
      logger.warn(
        { accountId, placeId: b.googlePlaceId, listing: probe.name, brand: b.organizationName },
        '[places-poll] listing name mismatch — poll skipped',
      )
      continue
    }
    await ingestReviews(accountId, 'places-poll', probe.reviews, b.googlePlaceId)
  }
  logger.info({ accounts: brands.length, skipped }, '[places-poll] weekly review poll done')
}

interface BackfillJobData {
  accountId: string
}

export async function googleReviewsBackfillHandler(jobs: PgBoss.Job<BackfillJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { accountId } = job.data
    try {
      const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
      if (!account?.ownerUserId) continue
      const keyRow = await prisma.apiKey.findFirst({ where: { userId: account.ownerUserId, provider: 'google_business' } })
      if (!keyRow) continue

      // Refresh-token → access token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: decrypt(keyRow.encryptedKey),
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
          grant_type: 'refresh_token',
        }),
      })
      const { access_token } = (await tokenRes.json()) as { access_token?: string }
      if (!access_token) throw new Error('access token refresh failed (revoked?)')
      const auth = { Authorization: `Bearer ${access_token}` }

      // Discover account → locations → paginate ALL reviews.
      const acctRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth })
      const accounts = ((await acctRes.json()) as { accounts?: { name?: string }[] }).accounts ?? []
      let total = 0
      for (const a of accounts) {
        const locRes = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name`,
          { headers: auth },
        )
        const locations = ((await locRes.json()) as { locations?: { name?: string }[] }).locations ?? []
        for (const loc of locations) {
          let pageToken: string | undefined
          do {
            const url =
              `https://mybusiness.googleapis.com/v4/${a.name}/${loc.name}/reviews?pageSize=50` +
              (pageToken ? `&pageToken=${pageToken}` : '')
            const revRes = await fetch(url, { headers: auth })
            if (!revRes.ok) break
            const data = (await revRes.json()) as {
              reviews?: { reviewer?: { displayName?: string }; starRating?: string; comment?: string }[]
              nextPageToken?: string
            }
            const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
            total += await ingestReviews(
              accountId,
              'gbp-backfill',
              (data.reviews ?? [])
                .filter((r) => r.comment?.trim())
                .map((r) => ({
                  authorName: r.reviewer?.displayName ?? null,
                  rating: r.starRating ? (stars[r.starRating] ?? null) : null,
                  text: r.comment!,
                })),
            )
            pageToken = data.nextPageToken
          } while (pageToken)
        }
      }
      logger.info({ accountId, total }, '[gbp-backfill] complete')
    } catch (err) {
      logger.error({ err, accountId }, '[gbp-backfill] FAILED')
    }
  }
}
