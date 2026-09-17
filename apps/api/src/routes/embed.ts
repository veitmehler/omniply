/**
 * Embedded-app session exchange (onboarding plan Phase 0).
 *
 * The iframe posts the encrypted GHL SSO payload here; we decrypt it, resolve
 * (or create) the user, attach them to the account whose provisioned
 * GhlSettings.ghlLocationId matches the SSO activeLocation, and hand back our
 * short-lived bearer token plus routing state (onboarding pending/complete).
 *
 * If no account matches the location the subaccount hasn't been provisioned
 * yet (admin runbook not run) — we return provisioningPending WITHOUT creating
 * anything, so a stray install can't spawn orphan accounts.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { decryptGhlSso, signEmbedToken, ghlClerkId } from '../lib/embed-auth'

/**
 * Synthetic clerkId for a per-account SSO user row. The bare "ghl:<uid>" form
 * is kept for the user's first account (and all pre-existing rows); additional
 * accounts get an account-suffixed id so the global clerkId unique holds.
 */
async function freeGhlClerkId(ghlUserId: string, accountId: string): Promise<string> {
  const base = ghlClerkId(ghlUserId)
  const taken = await prisma.user.findUnique({ where: { clerkId: base }, select: { id: true } })
  return taken ? `${base}:${accountId}` : base
}

export async function embedRoutes(app: FastifyInstance) {
  // Install-flow landing stub: GHL app installs may require an OAuth redirect
  // URL even for SSO-only custom-page apps. We don't exchange the code — data
  // access rides the per-client Private Integration key — so this just
  // acknowledges the install and points the user at the sidebar app.
  app.get<{ Querystring: { code?: string } }>('/embed/oauth-callback', async (request, reply) => {
    // Exchange the install code for the agency grant (auto-provisioning
    // foundation), then backfill-provision every installed location. Fire and
    // forget — the page responds immediately either way.
    const code = request.query.code
    if (code) {
      void (async () => {
        try {
          const { exchangeInstallCode, listInstalledLocations } = await import('../lib/ghl/app-oauth')
          const { provisionLocation } = await import('../lib/ghl/auto-provision')
          const grant = await exchangeInstallCode(code)
          if (grant?.type === 'company') {
            const locations = await listInstalledLocations()
            logger.info({ count: locations.length }, '[embed] backfill-provisioning installed locations')
            for (const loc of locations) await provisionLocation(loc, 'install-backfill')
          } else if (grant?.type === 'location' && grant.locationId) {
            await provisionLocation(grant.locationId, 'location-consent', {
              token: grant.token,
              expiresAt: grant.expiresAt,
              userId: grant.userId,
            })
          }
        } catch (err) {
          logger.error({ err }, '[embed] install-code exchange/backfill failed')
        }
      })()
    }
    reply.type('text/html; charset=utf-8')
    return reply.send(
      `<!doctype html><html><head><meta charset="utf-8"/><title>Omniply</title></head>
<body style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(180deg,#0A1826,#05090F);color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
<div style="max-width:420px;padding:40px">
<div style="width:64px;height:64px;margin:0 auto 24px;border:3px solid #38A8F8;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;color:#38A8F8">&#10003;</div>
<h1 style="font-size:26px;margin:0 0 12px">Omniply is connected</h1>
<p style="font-size:16px;line-height:1.6;color:rgba(255,255,255,.75);margin:0">Your workspace is being prepared. Close this tab and open <strong style="color:#fff">Omniply</strong> from your sidebar.</p>
</div></body></html>`,
    )
  })

  app.post<{ Body: { encryptedData?: string } }>(
    '/embed/session',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const ssoSecret = process.env.GHL_SSO_SECRET
      if (!ssoSecret) {
        logger.error('[embed] GHL_SSO_SECRET not configured')
        return reply.status(503).send({ error: 'Embedded mode not configured' })
      }
      const encrypted = request.body?.encryptedData
      if (!encrypted) return reply.status(400).send({ error: 'encryptedData required' })

      // Key rotation: try the current secret, then the previous one (set
      // GHL_SSO_SECRET_PREVIOUS during app re-creation / key rotation windows).
      let ctx
      try {
        ctx = decryptGhlSso(encrypted, ssoSecret)
      } catch (err) {
        const previous = process.env.GHL_SSO_SECRET_PREVIOUS
        if (previous) {
          try {
            ctx = decryptGhlSso(encrypted, previous)
            logger.warn('[embed] SSO decrypted with PREVIOUS secret — GHL is still encrypting under the old app key; update GHL_SSO_SECRET')
          } catch {
            logger.warn({ err }, '[embed] SSO decrypt failed with current AND previous secrets')
            return reply.status(401).send({ error: 'Invalid SSO payload' })
          }
        } else {
          logger.warn({ err }, '[embed] SSO decrypt failed')
          return reply.status(401).send({ error: 'Invalid SSO payload' })
        }
      }

      const locationId = ctx.activeLocation
      if (!locationId) {
        // Agency-level open (no location context) — nothing to attach to.
        return reply.status(400).send({ error: 'Open the app from a sub-account, not the agency view' })
      }

      // Which account owns this location? (Provisioned by the admin runbook.)
      const ghlSettings = await prisma.ghlSettings.findFirst({
        where: { ghlLocationId: locationId },
        select: { userId: true },
      })
      const ownerUser = ghlSettings
        ? await prisma.user.findUnique({ where: { id: ghlSettings.userId }, select: { accountId: true } })
        : null
      if (!ownerUser?.accountId) {
        logger.info({ locationId }, '[embed] unprovisioned location opened the app')
        return reply.status(200).send({ provisioningPending: true })
      }
      const accountId = ownerUser.accountId

      // Resolve or create the user, SCOPED TO THIS ACCOUNT. The same GHL human
      // (agency admin, multi-clinic owner) may open several sub-accounts, each
      // its own tenant — one User row per (account, ghlUserId). Authorization
      // comes from GHL: the signed SSO payload proves this user may access this
      // location, and the account is derived from the location, so cross-tenant
      // sessions are impossible by construction.
      let user = await prisma.user.findFirst({ where: { ghlUserId: ctx.userId, accountId } })
      if (!user) {
        // Legacy row from the pre-account rollout — adopt it into this account.
        const orphan = await prisma.user.findFirst({ where: { ghlUserId: ctx.userId, accountId: null } })
        if (orphan) user = await prisma.user.update({ where: { id: orphan.id }, data: { accountId } })
      }
      if (!user && ctx.email) {
        // Join key within this account: an auto-provisioned placeholder owner
        // or an open-web user with the same email IS this person.
        const match = await prisma.user.findFirst({ where: { email: ctx.email, accountId } })
        if (match?.clerkId.startsWith('ghlowner:')) {
          // Buyer claiming their placeholder — take it over in place.
          user = await prisma.user.update({
            where: { id: match.id },
            data: { clerkId: await freeGhlClerkId(ctx.userId, accountId), ghlUserId: ctx.userId, name: ctx.userName ?? match.name },
          })
          logger.info({ userId: user.id, accountId }, '[embed] buyer claimed placeholder owner via email match')
        } else if (match && !match.ghlUserId) {
          user = await prisma.user.update({ where: { id: match.id }, data: { ghlUserId: ctx.userId } })
        }
      }
      if (!user) {
        // NO silent auto-join (Veit 2026-09-16; also audit finding #15): a
        // seat must exist BEFORE this person opens the app — created either
        // via Settings → Team or automatically when they're sent an edit
        // request. Roster membership (by email) is the gate.
        const roster = ctx.email
          ? await prisma.accountMember.findFirst({ where: { accountId, email: ctx.email.toLowerCase() } })
          : null
        if (!roster) {
          logger.info({ accountId, ghlUserId: ctx.userId }, '[embed] SSO user has no seat — access denied')
          return reply.status(200).send({ seatRequired: true })
        }
        const email =
          ctx.email && !(await prisma.user.findUnique({ where: { email: ctx.email }, select: { id: true } }))
            ? ctx.email
            : `${ctx.userId}.${accountId}@ghl.local`
        user = await prisma.user.create({
          data: {
            clerkId: await freeGhlClerkId(ctx.userId, accountId),
            ghlUserId: ctx.userId,
            email,
            name: ctx.userName ?? roster.name ?? null,
            accountId,
          },
        })
        logger.info({ userId: user.id, accountId }, '[embed] roster member activated seat via SSO')
      }

      // Auto-provisioned accounts have a placeholder owner until the buyer's
      // first open: promote this user to owner and re-home the GHL settings.
      const accountRow = await prisma.account.findUnique({
        where: { id: accountId },
        select: { onboardingCompletedAt: true, status: true, ownerUserId: true },
      })
      try {
        if (accountRow?.ownerUserId && accountRow.ownerUserId !== user.id) {
          const owner = await prisma.user.findUnique({
            where: { id: accountRow.ownerUserId },
            select: { id: true, clerkId: true },
          })
          if (owner?.clerkId.startsWith('ghlowner:')) {
            await prisma.ghlSettings.updateMany({ where: { userId: owner.id }, data: { userId: user.id } })
            await prisma.settings.updateMany({ where: { userId: owner.id }, data: { userId: user.id } })
            await prisma.account.update({ where: { id: accountId }, data: { ownerUserId: user.id } })
            await prisma.user.delete({ where: { id: owner.id } }).catch(() => {})
            logger.info({ accountId, userId: user.id }, '[embed] promoted first SSO user to account owner')
          }
        }
        await prisma.ghlSettings.updateMany({
          where: { userId: user.id, ghlUserId: null },
          data: { ghlUserId: ctx.userId },
        })
      } catch (err) {
        // Best-effort — a promotion hiccup must never block the session.
        logger.warn({ err, accountId }, '[embed] owner promotion skipped')
      }
      const account = accountRow

      const token = signEmbedToken({ sub: user.clerkId, accountId })
      return reply.send({
        token,
        tokenType: 'emb',
        expiresInSeconds: 15 * 60,
        user: { id: user.id, email: user.email, name: user.name },
        accountId,
        accountStatus: account?.status ?? 'active',
        onboardingCompleted: !!account?.onboardingCompletedAt,
      })
    },
  )
}
