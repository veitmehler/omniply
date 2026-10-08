/**
 * Voice-assistant admin surface (.plans/voice-agent-elevenlabs
 * .implementation-plan.md V2): powers the dashboard notification card, the
 * integration wizard, and the Settings → Voice Assistant section.
 *
 * All routes are Clerk-authed (dashboard/embed user). Provisioning itself
 * runs against the CLINIC's ElevenLabs key stored via POST /key.
 */
import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import { prisma, encrypt, canonicalAccountUserId, listS3Keys, readS3Object } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { verifyElevenLabsKey, listElevenLabsVoices } from '../lib/elevenlabs/client'
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

    // Download-link visibility: how many onboarding voice recordings exist.
    const recordingsCount = await listS3Keys(`onboarding/${user.accountId}/voice/`)
      .then((k) => k.length)
      .catch(() => 0)

    return {
      dismissed: Boolean(account?.voiceAgentDismissedAt),
      hasApiKey: Boolean(apiKey),
      status: config?.status ?? 'none',
      voiceId: config?.voiceId ?? null,
      phoneNumber: config?.phoneNumber ?? null,
      mode: config?.mode ?? 'overflow',
      transferNumber: config?.transferNumber ?? null,
      lastError: config?.lastError ?? null,
      recordingsCount,
      usage,
      // Texting capability (SMS self-test plan): probe-maintained.
      smsAvailable: config?.voiceSmsAvailable ?? false,
      smsProbeStatus: config?.smsProbeStatus ?? null,
    }
  })

  // GET /api/voice-assistant/voices — the clinic's ElevenLabs voices for the
  // selector. Instant clones (category 'cloned') are listed but NOT usable:
  // ElevenLabs forbids custom-LLM agents with IVC voices (anti-impersonation).
  app.get('/voice-assistant/voices', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })
    const account = await prisma.account.findUnique({ where: { id: user.accountId }, select: { ownerUserId: true } })
    const apiKey = await clinicElevenLabsKey(account?.ownerUserId ?? user.id)
    if (!apiKey) return reply.status(400).send({ error: 'No ElevenLabs API key on file yet.' })

    const order: Record<string, number> = { professional: 0, premade: 1, generated: 2, cloned: 3 }
    const voices = (await listElevenLabsVoices(apiKey))
      .map((v) => ({
        voiceId: v.voice_id,
        name: v.name,
        category: v.category ?? 'premade',
        usable: v.category !== 'cloned',
      }))
      .sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.name.localeCompare(b.name))
    return { voices }
  })

  // POST /api/voice-assistant/voice — pick the agent's voice. Re-syncs the
  // live agent when one exists (provisioning is idempotent).
  app.post<{ Body: { voiceId?: string } }>('/voice-assistant/voice', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })
    const voiceId = request.body?.voiceId?.trim()
    if (!voiceId) return reply.status(400).send({ error: 'voiceId is required' })

    const account = await prisma.account.findUnique({ where: { id: user.accountId }, select: { ownerUserId: true } })
    const apiKey = await clinicElevenLabsKey(account?.ownerUserId ?? user.id)
    if (!apiKey) return reply.status(400).send({ error: 'No ElevenLabs API key on file yet.' })

    const match = (await listElevenLabsVoices(apiKey)).find((v) => v.voice_id === voiceId)
    if (!match) return reply.status(400).send({ error: 'That voice was not found in your ElevenLabs account.' })
    if (match.category === 'cloned') {
      return reply.status(400).send({
        error:
          'Instant voice clones can\'t be used with the AI receptionist — ElevenLabs allows only identity-verified Professional Voice Clones on AI agents. Create one in ElevenLabs (about 30 minutes of audio plus a spoken verification; your onboarding recordings help), and pick it here once it finishes training.',
      })
    }

    const config = await prisma.voiceAgentConfig.upsert({
      where: { accountId: user.accountId },
      create: { accountId: user.accountId, voiceId },
      update: { voiceId },
    })
    // A live agent picks the new voice up via the idempotent re-sync.
    if (config.agentId) await provisionVoiceAgent(user.id)
    logger.info({ accountId: user.accountId, voiceId, name: match.name }, '[voice-assistant] agent voice selected')
    return { ok: true, name: match.name }
  })

  // GET /api/voice-assistant/recordings — the clinic's onboarding voice
  // recordings as one ZIP, for creating a Professional Voice Clone in their
  // own ElevenLabs account.
  app.get('/voice-assistant/recordings', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await resolveUser(clerkId)
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    const keys = await listS3Keys(`onboarding/${user.accountId}/voice/`).catch(() => [] as string[])
    if (keys.length === 0) return reply.status(404).send({ error: 'No onboarding voice recordings on file.' })

    const archive = archiver('zip', { zlib: { level: 9 } })
    for (const key of keys) {
      const obj = await readS3Object(key)
      archive.append(obj.body, { name: key.split('/').pop() ?? 'recording.webm' })
    }
    void archive.finalize()
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="voice-recordings.zip"')
      .send(archive)
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
      // Don't pass the upstream response body to the UI — map the two
      // failure modes people actually hit to instructions they can act on.
      // The classic trap: pasting the key ID from the ElevenLabs key LIST
      // instead of the sk_ secret shown once in the creation dialog.
      const raw = err instanceof Error ? err.message : ''
      const invalidKey = /invalid_api_key|auth failed \(401\)|authentication_error/i.test(raw)
      logger.warn({ accountId: user.accountId, err: raw.slice(0, 200) }, '[voice-assistant] key verification failed')
      return reply.status(400).send({
        error: invalidKey
          ? "ElevenLabs rejected this value — it looks like a key ID, not the key itself. API keys start with sk_ and are shown only once, in the dialog when you create the key. Create a new key in ElevenLabs and copy the sk_… value from that dialog."
          : 'Could not verify the key with ElevenLabs. Please check the key and try again in a moment.',
      })
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
