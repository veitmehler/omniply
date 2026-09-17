import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../middleware/account'
import { prisma, ghlSettingsForUser, canonicalAccountUserId } from '@omniply/shared'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { decrypt, encrypt, maskApiKey } from '@omniply/shared'
import { getGhlOAuthStartUrl, listGhlAccounts, listGhlTags } from '../lib/ghl/client'
import type { GhlAccountIds } from '../lib/ghl/types'
import { GHL_PLATFORMS } from '../lib/ghl/types'
import { getGhlCredentials } from '../lib/ghl/settings'

export async function ghlRoutes(app: FastifyInstance) {
  // GET /ghl/location-users — ALL users of the client's GHL location (edit-
  // request assignees; empirically verified with existing tokens 2026-09-16).
  app.get('/ghl/location-users', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return
    const owner = await prisma.account.findUnique({ where: { id: account.accountId }, select: { ownerUserId: true } })
    const creds = await getGhlCredentials(owner?.ownerUserId ?? account.userId)
    if (!creds) return reply.send({ users: [] })
    try {
      const res = await fetch(`https://services.leadconnectorhq.com/users/?locationId=${creds.locationId}`, {
        headers: { Authorization: `Bearer ${creds.apiKey}`, Version: '2021-07-28' },
      })
      if (!res.ok) {
        logger.warn({ status: res.status }, '[ghl] location-users fetch failed')
        return reply.send({ users: [] })
      }
      const data = (await res.json()) as { users?: Array<{ name?: string; firstName?: string; lastName?: string; email?: string; roles?: { role?: string } }> }
      const users = (data.users ?? [])
        .filter((u) => u.email)
        .map((u) => ({
          name: u.name ?? [u.firstName, u.lastName].filter(Boolean).join(' ') ?? null,
          email: String(u.email).toLowerCase(),
          role: u.roles?.role ?? null,
        }))
      return reply.send({ users })
    } catch (err) {
      logger.warn({ err }, '[ghl] location-users fetch threw')
      return reply.send({ users: [] })
    }
  })

  // GET /api/ghl/settings
  app.get('/ghl/settings', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const row = await ghlSettingsForUser(user.id)

    if (!row) {
      return {
        configured: false,
        ghlLocationId: '',
        ghlUserId: '',
        accountIds: {},
        maskedApiKey: '',
        lastVerifiedAt: null,
        lastError: null,
        promoEmail: {
          enabled: true,
          tagId: null,
          tagName: null,
          sendTime: '09:00',
          timezone: 'America/New_York',
          fromName: null,
          fromEmail: null,
        },
      }
    }

    const decrypted = row.ghlApiKey ? decrypt(row.ghlApiKey) : ''

    return {
      configured: !!(row.ghlApiKey && row.ghlLocationId && row.ghlUserId),
      ghlLocationId: row.ghlLocationId ?? '',
      ghlUserId: row.ghlUserId ?? '',
      accountIds: (row.accountIds ?? {}) as GhlAccountIds,
      maskedApiKey: decrypted ? maskApiKey(decrypted) : '',
      hasApiKey: !!row.ghlApiKey,
      // 'oauth' = connected via the Omniply marketplace app (auto-renewing
      // token) — the Settings UI renders read-only in that state.
      authType: row.ghlAuthType ?? 'pi',
      lastVerifiedAt: row.lastVerifiedAt,
      lastError: row.lastError,
      promoEmail: {
        enabled: row.promoEmailEnabled,
        tagId: row.promoEmailTagId,
        tagName: row.promoEmailTagName,
        sendTime: row.promoEmailSendTime ?? '09:00',
        timezone: row.promoEmailTimezone ?? 'America/New_York',
        fromName: row.promoEmailFromName,
        fromEmail: row.promoEmailFromEmail,
      },
    }
  })

  // PUT /api/ghl/settings
  app.put('/ghl/settings', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const body = request.body as {
      ghlApiKey?: string
      ghlLocationId?: string
      ghlUserId?: string
      accountIds?: GhlAccountIds
      promoEmail?: {
        enabled?: boolean
        tagId?: string | null
        tagName?: string | null
        sendTime?: string
        timezone?: string
        fromName?: string | null
        fromEmail?: string | null
      }
    }

    const existing = await ghlSettingsForUser(user.id)

    // Validate + build promotional-email update (only when the client sends it).
    const promoUpdate: Record<string, unknown> = {}
    if (body.promoEmail !== undefined) {
      const p = body.promoEmail
      if (p.sendTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.sendTime)) {
        return reply.status(400).send({ error: 'promoEmail.sendTime must be HH:mm (24h)' })
      }
      if (p.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: p.timezone })
        } catch {
          return reply.status(400).send({ error: `Invalid timezone: ${p.timezone}` })
        }
      }
      if (p.enabled && !(p.tagId ?? existing?.promoEmailTagId)) {
        return reply.status(400).send({ error: 'Select a tag before enabling promotional emails' })
      }
      if (p.enabled && !(p.fromEmail ?? existing?.promoEmailFromEmail)) {
        return reply.status(400).send({ error: 'Set a "From email" before enabling promotional emails' })
      }
      if (p.enabled !== undefined) promoUpdate.promoEmailEnabled = p.enabled
      if (p.tagId !== undefined) promoUpdate.promoEmailTagId = p.tagId || null
      if (p.tagName !== undefined) promoUpdate.promoEmailTagName = p.tagName || null
      if (p.sendTime !== undefined) promoUpdate.promoEmailSendTime = p.sendTime
      if (p.timezone !== undefined) promoUpdate.promoEmailTimezone = p.timezone
      if (p.fromName !== undefined) promoUpdate.promoEmailFromName = p.fromName || null
      if (p.fromEmail !== undefined) promoUpdate.promoEmailFromEmail = p.fromEmail || null
    }

    const ghlLocationId = body.ghlLocationId?.trim() || existing?.ghlLocationId || null
    const ghlUserId = body.ghlUserId?.trim() || existing?.ghlUserId || null

    if (!ghlLocationId || !ghlUserId) {
      return reply.status(400).send({ error: 'ghlLocationId and ghlUserId are required' })
    }

    let ghlApiKey = existing?.ghlApiKey ?? null
    if (body.ghlApiKey?.trim()) {
      ghlApiKey = encrypt(body.ghlApiKey.trim())
    }

    if (!ghlApiKey) {
      return reply.status(400).send({ error: 'ghlApiKey is required' })
    }

    const accountIds = body.accountIds ?? (existing?.accountIds as GhlAccountIds | null) ?? {}

    // GHL settings are account-shared → write to the account owner's row.
    const ownerUserId = await canonicalAccountUserId(user.id)
    const row = await prisma.ghlSettings.upsert({
      where: { userId: ownerUserId },
      create: {
        userId: ownerUserId,
        ghlApiKey,
        ghlLocationId,
        ghlUserId,
        accountIds,
        ...promoUpdate,
      },
      update: {
        ghlApiKey,
        ghlLocationId,
        ghlUserId,
        ...(body.accountIds !== undefined ? { accountIds } : {}),
        ...promoUpdate,
      },
    })

    return {
      configured: true,
      ghlLocationId: row.ghlLocationId,
      ghlUserId: row.ghlUserId,
      accountIds: row.accountIds,
      maskedApiKey: maskApiKey(decrypt(ghlApiKey)),
      promoEmail: {
        enabled: row.promoEmailEnabled,
        tagId: row.promoEmailTagId,
        tagName: row.promoEmailTagName,
        sendTime: row.promoEmailSendTime ?? '09:00',
        timezone: row.promoEmailTimezone ?? 'America/New_York',
        fromName: row.promoEmailFromName,
        fromEmail: row.promoEmailFromEmail,
      },
    }
  })

  // GET /api/ghl/accounts — list connected social accounts from GHL
  app.get('/ghl/accounts', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const row = await ghlSettingsForUser(user.id)
    if (!row?.ghlApiKey || !row.ghlLocationId) {
      return reply.status(400).send({ error: 'Save your GHL API key and Location ID first' })
    }
    const ownerUserId = await canonicalAccountUserId(user.id)

    const apiKey = decrypt(row.ghlApiKey)
    if (!apiKey) {
      return reply.status(400).send({ error: 'Could not decrypt GHL API key' })
    }

    try {
      const accounts = await listGhlAccounts(apiKey, row.ghlLocationId)
      await prisma.ghlSettings.update({
        where: { userId: ownerUserId },
        data: { lastVerifiedAt: new Date(), lastError: null },
      })

      if (accounts.length === 0) {
        logger.warn(
          { userId: user.id, locationId: row.ghlLocationId },
          '[ghl] /ghl/accounts returned 0 accounts — likely wrong locationId or missing API key scopes',
        )
        return {
          accounts,
          warning:
            'Omniply returned 0 accounts. Check that (1) your Location ID is correct, (2) social media profiles are connected in Social Planner → Settings → Integrations for that location, and (3) your Private Integration key has social-media-posting scope.',
        }
      }

      return { accounts }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ userId: user.id, locationId: row.ghlLocationId, err }, '[ghl] listGhlAccounts threw')
      await prisma.ghlSettings.update({
        where: { userId: ownerUserId },
        data: { lastError: message },
      }).catch(() => {})
      return reply.status(400).send({ error: message })
    }
  })

  // GET /api/ghl/tags — list location tags (for the promotional-email smart-list picker)
  app.get('/ghl/tags', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const row = await ghlSettingsForUser(user.id)
    if (!row?.ghlApiKey || !row.ghlLocationId) {
      return reply.status(400).send({ error: 'Save your GHL API key and Location ID first' })
    }

    const apiKey = decrypt(row.ghlApiKey)
    if (!apiKey) {
      return reply.status(400).send({ error: 'Could not decrypt GHL API key' })
    }

    try {
      const tags = await listGhlTags(apiKey, row.ghlLocationId)
      return { tags }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ userId: user.id, locationId: row.ghlLocationId, err }, '[ghl] listGhlTags threw')
      return reply.status(400).send({ error: message })
    }
  })

  // GET /api/ghl/oauth-url/:platform
  app.get('/ghl/oauth-url/:platform', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const { platform } = request.params as { platform: string }
    if (!GHL_PLATFORMS.includes(platform as typeof GHL_PLATFORMS[number])) {
      return reply.status(400).send({ error: `Unsupported platform: ${platform}` })
    }

    return { url: getGhlOAuthStartUrl(platform) }
  })
}
