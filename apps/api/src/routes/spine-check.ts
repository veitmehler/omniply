/**
 * Spine Check public routes (spine-check plan).
 *
 * POST /api/spine-check/capture — quiz submission: upsert the lead into the
 *   clinic's GHL (tags select the drip branch: the matched guide's tag lands
 *   first), grant Drive reader on ALL live guides (silent grant-all — quiz
 *   leads never see a request-access wall), and record a LeadCapture row so
 *   the ~500-share rotation estimator keeps counting.
 *
 * GET /api/spine-check/p/:accountId — hosted quiz page (non-WordPress
 *   clinics + linktree fallback). Cached in-memory per account.
 */
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { sendFailureAlert } from '../lib/alerts'
import { driveConfigured, grantReader } from '../lib/gdrive/client'
import { getGhlCredentials } from '../lib/ghl/settings'
import { upsertGhlContact, getGuideLinkFieldId } from '../lib/ghl/client'
import { GUIDE_SLUG_BY_DOMAIN } from '../spine-check/generate'
import { buildStandaloneSpineCheckHtml } from '../spine-check/generate'

const DOMAINS = ['desk', 'sleep', 'morning', 'niggle'] as const
type Domain = (typeof DOMAINS)[number]

export interface SpineCapture {
  accountId: string
  firstName: string
  email: string
  phone: string | null
  weakestDomain: Domain
  scores: Record<Domain, number>
  total: number
}

/** Strict parse + clamp; null on anything malformed. Exported for tests. */
export function parseSpineCapture(body: unknown): SpineCapture | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const accountId = typeof b.accountId === 'string' ? b.accountId.trim() : ''
  const firstName = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 30) : null
  const weakest = typeof b.weakestDomain === 'string' ? (b.weakestDomain as Domain) : null
  if (!accountId || accountId.length > 64) return null
  if (!firstName) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return null
  if (!weakest || !DOMAINS.includes(weakest)) return null

  const rawScores = (typeof b.scores === 'object' && b.scores !== null ? b.scores : {}) as Record<string, unknown>
  const clamp = (v: unknown) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
  const scores = {
    desk: clamp(rawScores.desk),
    sleep: clamp(rawScores.sleep),
    morning: clamp(rawScores.morning),
    niggle: clamp(rawScores.niggle),
  }
  return { accountId, firstName, email, phone, weakestDomain: weakest, scores, total: clamp(b.total) }
}

// Hosted-page cache: generation fetches brand + guides + logo.
const PAGE_CACHE_MS = 5 * 60 * 1000
const pageCache = new Map<string, { html: string; at: number }>()

export async function spineCheckRoutes(app: FastifyInstance) {
  app.post('/spine-check/capture', async (request, reply) => {
    const parsed = parseSpineCapture(request.body)
    if (!parsed) return reply.code(400).send({ error: 'invalid submission' })

    const account = await prisma.account.findUnique({
      where: { id: parsed.accountId },
      select: { id: true, ownerUserId: true },
    })
    if (!account?.ownerUserId) return reply.code(404).send({ error: 'unknown account' })
    const ownerUserId = account.ownerUserId

    const docs = await prisma.leadGenDocument.findMany({
      where: { accountId: account.id, status: 'live', driveFileId: { not: null } },
      select: { id: true, slug: true, driveFileId: true, driveLink: true, ghlTagNames: true },
    })
    const matched = docs.find((d) => d.slug === GUIDE_SLUG_BY_DOMAIN[parsed.weakestDomain]) ?? docs[0] ?? null

    // 1. Drive grant-all FIRST (quiz leads must never hit a request-access
    //    wall when the drip links arrive). Best-effort per file.
    if (driveConfigured()) {
      for (const doc of docs) {
        await grantReader(doc.driveFileId!, parsed.email, false).catch((err) =>
          logger.warn({ documentId: doc.id, err }, '[spine-check] drive grant failed (request-access flow remains)'),
        )
      }
    }

    // 2. Record the capture (feeds the rotation estimator: distinct emails
    //    since rotatedAt). Synthetic proposalId namespace keeps uniqueness.
    let captureId: string | null = null
    if (matched) {
      const capture = await prisma.leadCapture.create({
        data: {
          documentId: matched.id,
          accountId: account.id,
          requesterEmail: parsed.email,
          proposalId: `spine-check:${randomUUID()}`,
          status: 'ghl_failed', // upgraded below on success
        },
      })
      captureId = capture.id
    }

    // 3. GHL upsert — the matched guide's tags land first (drip branch
    //    selector), then the spine-check marker tag.
    const guideTags = matched ? (matched.ghlTagNames.length ? matched.ghlTagNames : [`leadgen-${matched.slug}`]) : []
    const tags = [...guideTags, 'spine-check-lead']
    try {
      const creds = await getGhlCredentials(ownerUserId)
      if (!creds) throw new Error('No GHL credentials for account owner')
      // Quiz takers join the newsletter audience (§4b-3 — the consent copy
      // promises it, and the quiz capture screen discloses it).
      const nlTag = await prisma.ghlSettings
        .findFirst({ where: { userId: ownerUserId }, select: { newsletterTagName: true } })
        .then((s) => s?.newsletterTagName?.trim() || null)
        .catch(() => null)
      if (nlTag) tags.push(nlTag)
      let customFields: { id: string; value: string }[] | undefined
      if (matched?.driveLink) {
        const fieldId = await getGuideLinkFieldId(creds.apiKey, creds.locationId).catch(() => null)
        if (fieldId) customFields = [{ id: fieldId, value: matched.driveLink }]
      }
      const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
        email: parsed.email,
        tags,
        source: 'spine-check',
        firstName: parsed.firstName,
        ...(parsed.phone ? { phone: parsed.phone } : {}),
        ...(customFields ? { customFields } : {}),
      })
      if (captureId) {
        await prisma.leadCapture.update({
          where: { id: captureId },
          data: { status: 'captured', ghlContactId: result.contactId },
        })
      }
      logger.info(
        { accountId: account.id, weakest: parsed.weakestDomain, total: parsed.total },
        '[spine-check] lead captured → GHL',
      )
      return reply.send({ ok: true })
    } catch (err) {
      logger.error({ accountId: account.id, err }, '[spine-check] GHL push failed (access granted; poller retries)')
      await sendFailureAlert({
        errorType: 'spine-check-ghl-failed',
        message: `Spine Check lead (${parsed.email}) captured but the GHL push failed: ${err instanceof Error ? err.message : String(err)}. Drive access WAS granted; the leadgen poller retries the push.`,
        context: { accountId: account.id, captureId },
      }).catch(() => {})
      // The lead's experience is unaffected (results shown client-side, Drive
      // granted); the poller's retryFailedGhlCaptures picks the row up.
      return reply.send({ ok: true })
    }
  })

  app.get<{ Params: { accountId: string } }>('/spine-check/p/:accountId', async (request, reply) => {
    const accountId = request.params.accountId
    if (!/^[a-z0-9-]{10,40}$/i.test(accountId)) return reply.code(404).send({ error: 'not found' })

    // Embeddable from any clinic site (iframe publishing).
    reply.header('Content-Security-Policy', 'frame-ancestors *')
    const hit = pageCache.get(accountId)
    if (hit && Date.now() - hit.at < PAGE_CACHE_MS) {
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(hit.html)
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { ownerUserId: true },
    })
    if (!account?.ownerUserId) return reply.code(404).send({ error: 'not found' })

    const html = await buildStandaloneSpineCheckHtml(account.ownerUserId)
    if (!html) return reply.code(404).send({ error: 'not available' })

    pageCache.set(accountId, { html, at: Date.now() })
    if (pageCache.size > 200) {
      const oldest = pageCache.keys().next().value
      if (oldest) pageCache.delete(oldest)
    }
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html)
  })
}
