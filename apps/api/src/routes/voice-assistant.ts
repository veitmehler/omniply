/**
 * Voice-assistant admin surface (.plans/voice-agent-elevenlabs
 * .implementation-plan.md V2): powers the dashboard notification card, the
 * integration wizard, and the Settings → Voice Assistant section.
 *
 * All routes are Clerk-authed (dashboard/embed user). Provisioning itself
 * runs against the CLINIC's ElevenLabs key stored via POST /key.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, encrypt, canonicalAccountUserId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { verifyElevenLabsKey } from '../lib/elevenlabs/client'
import { getElevenLabsUsage } from '../lib/elevenlabs/convai'
import { clinicElevenLabsKey, provisionVoiceAgent } from '../lib/voice-agent/provision'

async function resolveUser(clerkId: string) {
  return prisma.user.findUnique({ where: { clerkId }, select: { id: true, accountId: true } })
}

export async function voiceAssistantRoutes(app: FastifyInstance) {
  // GET /api/voice-assistant/status — card visibility + wizard/settings state
  app.get('/voice-assistant/status', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const [account, config] = await Promise.all([
      prisma.account.findUnique({ where: { id: user.accountId }, select: { voiceAgentDismissedAt: true, ownerUserId: true } }),
      prisma.voiceAgentConfig.findUnique({ where: { accountId: user.accountId } }),
    ])
    const owner = account?.ownerUserId ?? user.id
    const apiKey = await clinicElevenLabsKey(owner)

    let usage = null
    if (apiKey && config?.status === 'ready') {
      usage = await getElevenLabsUsage(apiKey).catch(() => null)
    }

    return {
      dismissed: Boolean(account?.voiceAgentDismissedAt),
      hasApiKey: Boolean(apiKey),
      status: config?.status ?? 'none',
      voiceId: config?.voiceId ?? null,
      phoneNumber: config?.phoneNumber ?? null,
      mode: config?.mode ?? 'overflow',
      transferNumber: config?.transferNumber ?? null,
      lastError: config?.lastError ?? null,
      usage,
    }
  })

  // POST /api/voice-assistant/key — store the clinic's ElevenLabs key (owner row)
  app.post<{ Body: { apiKey?: string } }>('/voice-assistant/key', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const key = request.body?.apiKey?.trim()
    if (!key) return reply.status(400).send({ error: 'apiKey is required' })

    let tier: string | undefined
    try {
      const v = await verifyElevenLabsKey(key)
      tier = v.subscription
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Key verification failed' })
    }

    const ownerId = await canonicalAccountUserId(user.id)
    const encryptedKey = encrypt(key)
    const existing = await prisma.apiKey.findFirst({ where: { userId: ownerId, provider: 'elevenlabs' } })
    if (existing) await prisma.apiKey.update({ where: { id: existing.id }, data: { encryptedKey } })
    else await prisma.apiKey.create({ data: { userId: ownerId, provider: 'elevenlabs', encryptedKey } })

    logger.info({ accountId: user.accountId, tier }, '[voice-assistant] ElevenLabs key stored')
    return { ok: true, tier: tier ?? null }
  })

  // POST /api/voice-assistant/provision — run/retry provisioning
  app.post<{ Body: { mode?: 'overflow' | 'direct'; transferNumber?: string | null } }>(
    '/voice-assistant/provision',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const user = await resolveUser(clerkId)
      if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

      const body = request.body ?? {}
      const mode = body.mode === 'direct' ? 'direct' : body.mode === 'overflow' ? 'overflow' : undefined
      const transferNumber =
        body.transferNumber === undefined ? undefined : (body.transferNumber?.trim().slice(0, 32) || null)

      const result = await provisionVoiceAgent(user.id, { mode, transferNumber })
      // Completing (or retrying) setup un-dismisses the dashboard card state.
      if (result.status === 'ready') {
        await prisma.account.update({ where: { id: user.accountId }, data: { voiceAgentDismissedAt: null } })
      }
      return result
    },
  )

  // PUT /api/voice-assistant/config — mode / transfer number edits (re-syncs the agent)
  app.put<{ Body: { mode?: 'overflow' | 'direct'; transferNumber?: string | null } }>(
    '/voice-assistant/config',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const user = await resolveUser(clerkId)
      if (!user?.accountId) return reply.status(404).send({ error: 'No account' })
      const config = await prisma.voiceAgentConfig.findUnique({ where: { accountId: user.accountId } })
      if (!config) return reply.status(404).send({ error: 'Voice assistant not set up yet' })

      const body = request.body ?? {}
      const mode = body.mode === 'direct' ? 'direct' : body.mode === 'overflow' ? 'overflow' : undefined
      const transferNumber =
        body.transferNumber === undefined ? undefined : (body.transferNumber?.trim().slice(0, 32) || null)
      // provisionVoiceAgent is idempotent: it persists the edits and re-syncs
      // the ElevenLabs agent (transfer tool) in one pass.
      return provisionVoiceAgent(user.id, { mode, transferNumber })
    },
  )

  // POST /api/voice-assistant/dismiss — hide the dashboard card ("not yet")
  app.post('/voice-assistant/dismiss', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })
    await prisma.account.update({ where: { id: user.accountId }, data: { voiceAgentDismissedAt: new Date() } })
    return { ok: true }
  })
}
