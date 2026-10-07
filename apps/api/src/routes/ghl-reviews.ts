/**
 * GHL Review-Received webhook receiver (google-reviews plan Tier 3).
 *
 * The snapshot's "Review Received → Custom Webhook" workflow posts here with
 * the per-account URL token (custom value `omniply_review_token`, minted by
 * the admin endpoint — same pattern as billing events). Payload shapes vary
 * by GHL workflow config, so parsing is defensive: we accept several common
 * field names and always keep the text. Everything funnels through the shared
 * dedup ingest, so overlap with the Places probe or a GBP backfill is safe.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { ingestReviews } from '../lib/google/review-ingest'
import { logger } from '../lib/logger'

interface ReviewPayload {
  review?: { rating?: number | string; body?: string; reviewer?: string; source?: string }
  rating?: number | string
  body?: string
  text?: string
  comment?: string
  reviewer?: string
  author?: string
  name?: string
}

// Real reviews are rare events — 60/min absorbs any legitimate GHL burst
// while closing the unthrottled write path into the client-story pipeline.
const MAX_TEXT_CHARS = 8000
const MAX_AUTHOR_CHARS = 200

function asCappedString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export async function ghlReviewRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { token: string }; Body: ReviewPayload }>(
    '/ghl/reviews/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const account = await prisma.account.findUnique({
      where: { ghlReviewToken: request.params.token },
      select: { id: true },
    })
    if (!account) return reply.status(404).send({ error: 'Unknown token' })

    const b = request.body ?? {}
    const text = asCappedString(b.review?.body ?? b.body ?? b.text ?? b.comment, MAX_TEXT_CHARS)
    const author = asCappedString(b.review?.reviewer ?? b.reviewer ?? b.author ?? b.name, MAX_AUTHOR_CHARS) || null
    const ratingRaw = b.review?.rating ?? b.rating
    const rating = ratingRaw !== undefined ? Number(ratingRaw) || null : null

    if (!text.trim()) {
      // Rating-only reviews carry no story material; acknowledge and move on.
      logger.info({ accountId: account.id }, '[ghl-reviews] rating-only review (no text) — ignored')
      return reply.send({ ok: true, ingested: 0 })
    }
    const inserted = await ingestReviews(account.id, 'ghl-webhook', [{ authorName: author, rating, text }])
    return reply.send({ ok: true, ingested: inserted })
    },
  )
}
