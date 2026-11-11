/**
 * Shared review ingest (google-reviews plan, cross-cutting dedup).
 *
 * The same review can arrive via the Places probe, the GHL Review-Received
 * webhook, and (later) the Business Profile API backfill. Everything funnels
 * through here: normalize → fingerprint (same helper the story-mining spider
 * uses) → RawReview upsert-by-fingerprint. Feeds the existing client-story
 * triage pipeline untouched.
 */
import { prisma } from '@omniply/shared'
import { reviewFingerprint } from '../../article-pipeline/client-stories/fingerprint'
import { triagePendingReviews } from '../../article-pipeline/client-stories/triage'
import { logger } from '../logger'

export interface IncomingReview {
  authorName: string | null
  rating: number | null
  text: string
  relativeTime?: string | null
}

/**
 * Insert new reviews for an account; silently skips known fingerprints.
 * Returns inserted count. `sourcePlaceId` (Places probe/poll paths) records
 * which listing the review came from, so a mis-resolved listing's rows can
 * be purged by place (places-trust plan).
 */
export async function ingestReviews(
  accountId: string,
  source: string,
  reviews: IncomingReview[],
  sourcePlaceId?: string,
): Promise<number> {
  let inserted = 0
  const newIds: string[] = []
  for (const r of reviews) {
    const text = r.text?.trim()
    if (!text || text.length < 20) continue // too short to ever be a story
    const fingerprint = reviewFingerprint(r.authorName, text)
    try {
      const row = await prisma.rawReview.create({
        data: {
          accountId,
          fingerprint,
          reviewText: text,
          starRating: r.rating ?? undefined,
          relativeDate: r.relativeTime ?? undefined,
          sourcePlaceId: sourcePlaceId ?? undefined,
        },
        select: { id: true },
      })
      inserted++
      newIds.push(row.id)
    } catch {
      // unique(accountId, fingerprint) — already known, from any source
    }
  }
  if (inserted > 0) {
    logger.info({ accountId, source, inserted, offered: reviews.length }, '[review-ingest] new reviews')
    // Story bank (2026-11-11): every capture path triages what it inserted. Before this only the
    // legacy scraper job did, so Places/GHL-captured reviews sat 'pending' forever. Fire-and-forget.
    void triagePendingReviews(accountId, newIds).catch((err) =>
      logger.warn({ accountId, source, err }, '[review-ingest] triage of new reviews failed'),
    )
  }
  return inserted
}
