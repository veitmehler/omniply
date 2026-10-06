/**
 * PMS integration surface (PMS framework v2 Phases C/D):
 *   POST /pms/import-csv    — patient-list CSV → contact pipe (onboarding
 *                             import + the periodic refresh ritual)
 *   POST /pms/cliniko/key   — store the clinic's Cliniko API key (validated
 *                             with a real call; returns the config pickers'
 *                             data: businesses/practitioners/types)
 *   GET  /pms/status        — key presence + sync cursors (Settings display)
 * All Clerk-authed. Booking mode/config stay admin-set until the rollout
 * Settings surface lands.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, encrypt, canonicalAccountUserId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { intakeContacts, parseCsv, mapCsvToRows } from '../lib/contacts/intake'
import { clinikoAccountOverview } from '../lib/booking/cliniko'

const MAX_CSV_CHARS = 2_000_000 // ~2 MB of text ≈ tens of thousands of rows

async function resolveUser(clerkId: string) {
  return prisma.user.findUnique({ where: { clerkId }, select: { id: true, accountId: true } })
}

export async function pmsRoutes(app: FastifyInstance) {
  app.post<{ Body: { csv?: string; source?: string } }>('/pms/import-csv', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const csvText = request.body?.csv
    if (!csvText?.trim()) return reply.status(400).send({ error: 'csv is required' })
    if (csvText.length > MAX_CSV_CHARS) return reply.status(400).send({ error: 'File too large — split it and import in parts.' })

    const mapped = mapCsvToRows(parseCsv(csvText))
    if (!mapped) {
      return reply.status(400).send({
        error: 'Could not find a phone or email column. The file needs headers like "First Name", "Last Name", "Mobile"/"Phone", "Email".',
      })
    }
    const source = (request.body?.source?.trim() || 'csv').slice(0, 30)
    const result = await intakeContacts(user.accountId, source, mapped.rows)
    logger.info({ accountId: user.accountId, source, ...result }, '[pms] csv import done')
    return { ok: true, ...result }
  })

  app.post<{ Body: { apiKey?: string } }>('/pms/cliniko/key', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const key = request.body?.apiKey?.trim()
    if (!key) return reply.status(400).send({ error: 'apiKey is required' })

    // Validate with the calls the integration actually needs (permission
    // lesson from the ElevenLabs key: verify capabilities, not existence).
    let overview
    try {
      overview = await clinikoAccountOverview(key)
    } catch (err) {
      logger.warn({ accountId: user.accountId, err: err instanceof Error ? err.message.slice(0, 200) : '' }, '[pms] cliniko key verification failed')
      return reply.status(400).send({
        error:
          'Cliniko rejected this key. In Cliniko: My Info → Manage API keys → create a key, and paste the whole value (it ends with a region code like “-au2”).',
      })
    }

    const ownerId = await canonicalAccountUserId(user.id)
    const encryptedKey = encrypt(key)
    const existing = await prisma.apiKey.findFirst({ where: { userId: ownerId, provider: 'cliniko' } })
    if (existing) await prisma.apiKey.update({ where: { id: existing.id }, data: { encryptedKey } })
    else await prisma.apiKey.create({ data: { userId: ownerId, provider: 'cliniko', encryptedKey } })

    logger.info({ accountId: user.accountId, businesses: overview.businesses.length }, '[pms] cliniko key stored')
    return { ok: true, ...overview }
  })

  app.get('/pms/status', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { agentBookingMode: true, ownerUserId: true },
    })
    const ownerId = account?.ownerUserId ?? user.id
    const [clinikoKey, sync] = await Promise.all([
      prisma.apiKey.findFirst({ where: { userId: ownerId, provider: 'cliniko' }, select: { id: true } }),
      prisma.pmsSyncState.findUnique({ where: { accountId: user.accountId } }),
    ])
    return {
      bookingMode: account?.agentBookingMode ?? 'off',
      cliniko: { connected: Boolean(clinikoKey) },
      sync: sync
        ? { provider: sync.provider, patientsCursor: sync.patientsCursor, appointmentsCursor: sync.appointmentsCursor, lastError: sync.lastError }
        : null,
    }
  })
}
