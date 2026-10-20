/**
 * Biological Age Check public routes (wellness vertical — the spine-check
 * routes' sibling; same capture philosophy).
 *
 * POST /api/age-check/capture — quiz submission: upsert the lead into the
 *   studio's GHL (matched guide's tags first = drip branch), grant Drive
 *   reader on ALL live guides, record a LeadCapture row for the rotation
 *   estimator.
 *
 * GET /api/age-check/p/:accountId — hosted quiz page (non-WordPress studios
 *   + linktree fallback). Cached in-memory per account.
 */
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { sendFailureAlert } from '../lib/alerts'
import { driveConfigured, grantReader } from '../lib/gdrive/client'
import { getGhlCredentials } from '../lib/ghl/settings'
import { upsertGhlContact, getGuideLinkFieldId } from '../lib/ghl/client'
import { GUIDE_SLUG_BY_PILLAR, buildStandaloneAgeCheckHtml } from '../age-check/generate'

const PILLARS = ['move', 'sleep', 'unwind', 'fuel'] as const
type Pillar = (typeof PILLARS)[number]

export interface AgeCapture {
  accountId: string
  firstName: string
  email: string
  phone: string | null
  calendarAge: number
  bodyAge: number
  delta: number
  weakestPillar: Pillar
  scores: Record<Pillar, number>
}

/** Strict parse + clamp; null on anything malformed. Exported for tests. */
export function parseAgeCapture(body: unknown): AgeCapture | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const accountId = typeof b.accountId === 'string' ? b.accountId.trim() : ''
  const firstName = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 30) : null
  const weakest = typeof b.weakestPillar === 'string' ? (b.weakestPillar as Pillar) : null
  if (!accountId || accountId.length > 64) return null
  if (!firstName) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return null
  if (!weakest || !PILLARS.includes(weakest)) return null

  const calendarAge = Math.round(Number(b.calendarAge) || 0)
  if (calendarAge < 18 || calendarAge > 100) return null
  const bodyAge = Math.min(110, Math.max(18, Math.round(Number(b.bodyAge) || 0)))
  const delta = Math.min(30, Math.max(-30, Math.round(Number(b.delta) || 0)))

  const rawScores = (typeof b.scores === 'object' && b.scores !== null ? b.scores : {}) as Record<string, unknown>
  const clamp = (v: unknown) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
  const scores = {
    move: clamp(rawScores.move),
    sleep: clamp(rawScores.sleep),
    unwind: clamp(rawScores.unwind),
    fuel: clamp(rawScores.fuel),
  }
  return { accountId, firstName, email, phone, calendarAge, bodyAge, delta, weakestPillar: weakest, scores }
}

// Hosted-page cache: generation fetches brand + guides + logo.
const PAGE_CACHE_MS = 5 * 60 * 1000
const pageCache = new Map<string, { html: string; at: number }>()

export async function ageCheckRoutes(app: FastifyInstance) {
  app.post('/age-check/capture', async (request, reply) => {
    const parsed = parseAgeCapture(request.body)
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
    const matched = docs.find((d) => d.slug === GUIDE_SLUG_BY_PILLAR[parsed.weakestPillar]) ?? docs[0] ?? null

    // 1. Drive grant-all FIRST (quiz leads never hit a request-access wall).
    if (driveConfigured()) {
      for (const doc of docs) {
        await grantReader(doc.driveFileId!, parsed.email, false).catch((err) =>
          logger.warn({ documentId: doc.id, err }, '[age-check] drive grant failed (request-access flow remains)'),
        )
      }
    }

    // 2. Record the capture (rotation estimator counts distinct emails).
    let captureId: string | null = null
    if (matched) {
      const capture = await prisma.leadCapture.create({
        data: {
          documentId: matched.id,
          accountId: account.id,
          requesterEmail: parsed.email,
          proposalId: `age-check:${randomUUID()}`,
          status: 'ghl_failed', // upgraded below on success
        },
      })
      captureId = capture.id
    }

    // 3. GHL upsert — matched guide's tags first (drip branch selector),
    //    then the age-check marker tag.
    const guideTags = matched ? (matched.ghlTagNames.length ? matched.ghlTagNames : [`leadgen-${matched.slug}`]) : []
    const tags = [...guideTags, 'age-check-lead']
    try {
      const creds = await getGhlCredentials(ownerUserId)
      if (!creds) throw new Error('No GHL credentials for account owner')
      // Quiz takers join the newsletter audience (the capture screen's
      // consent copy promises it — same §4b-3 rule as the spine check).
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
        source: 'age-check',
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
        { accountId: account.id, weakest: parsed.weakestPillar, delta: parsed.delta },
        '[age-check] lead captured → GHL',
      )
      return reply.send({ ok: true })
    } catch (err) {
      logger.error({ accountId: account.id, err }, '[age-check] GHL push failed (access granted; poller retries)')
      await sendFailureAlert({
        errorType: 'age-check-ghl-failed',
        message: `Age Check lead (${parsed.email}) captured but the GHL push failed: ${err instanceof Error ? err.message : String(err)}. Drive access WAS granted; the leadgen poller retries the push.`,
        context: { accountId: account.id, captureId },
      }).catch(() => {})
      // The lead's experience is unaffected (results shown client-side).
      return reply.send({ ok: true })
    }
  })

  app.get<{ Params: { accountId: string } }>('/age-check/p/:accountId', async (request, reply) => {
    const accountId = request.params.accountId
    if (!/^[a-z0-9-]{10,40}$/i.test(accountId)) return reply.code(404).send({ error: 'not found' })

    // Embeddable from any studio site (iframe publishing).
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

    const html = await buildStandaloneAgeCheckHtml(account.ownerUserId)
    if (!html) return reply.code(404).send({ error: 'not available' })

    pageCache.set(accountId, { html, at: Date.now() })
    if (pageCache.size > 200) {
      const oldest = pageCache.keys().next().value
      if (oldest) pageCache.delete(oldest)
    }
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html)
  })
}
