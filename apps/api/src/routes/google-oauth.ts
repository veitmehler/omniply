/**
 * Google OAuth for per-clinic review access (google-reviews plan Tier 1).
 *
 * DORMANT until GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
 * GOOGLE_OAUTH_REDIRECT_URI are set (our OAuth app verification + Google's
 * Business Profile API access application are LONG-LEAD external items). The
 * onboarding step auto-degrades while unset; these routes 503.
 *
 * Flow: onboarding step mints the state row (authenticated context) → popup
 * → /start?state=… → Google consent (business.manage, offline access) →
 * /callback → encrypted refresh token in the apiKey table (provider
 * 'google_business', owner user) → backfill job. /start deliberately does
 * NOT take an account id: popup navigations can't carry auth, and a bare
 * ?account= param was an account-id oracle + let anyone bind their own
 * Google account to a tenant (2026-10-07 security cherry-pick).
 */
import type { FastifyInstance } from 'fastify'
import { prisma, encrypt } from '@omniply/shared'
import { getBoss, QUEUES } from '../queues/index'
import { logger } from '../lib/logger'

const SCOPE = 'https://www.googleapis.com/auth/business.manage'

function configured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI,
  )
}

export async function googleOauthRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string } }>('/google/oauth/start', async (request, reply) => {
    if (!configured()) return reply.status(503).send({ error: 'Google OAuth not configured' })
    const state = request.query.state
    if (!state) return reply.status(400).send({ error: 'state required' })
    const row = await prisma.oAuthState.findUnique({ where: { state } })
    if (!row || row.platform !== 'google_business' || row.expiresAt < new Date()) {
      return reply.status(403).send({ error: 'Invalid or expired link — please retry from onboarding' })
    }
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(process.env.GOOGLE_OAUTH_CLIENT_ID!)}` +
      `&redirect_uri=${encodeURIComponent(process.env.GOOGLE_OAUTH_REDIRECT_URI!)}` +
      `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
      '&access_type=offline&prompt=consent' +
      `&state=${state}`
    return reply.redirect(url)
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/google/oauth/callback',
    async (request, reply) => {
      if (!configured()) return reply.status(503).send({ error: 'Google OAuth not configured' })
      const { code, state, error } = request.query
      const done = (msg: string) =>
        reply
          .type('text/html')
          .send(`<!doctype html><body style="font-family:sans-serif;padding:40px;text-align:center"><p>${msg}</p><p>You can close this window.</p><script>setTimeout(()=>window.close(),2500)</script></body>`)

      if (error) return done('Google connection was cancelled.')
      if (!code || !state) return reply.status(400).send({ error: 'code/state required' })

      const row = await prisma.oAuthState.findUnique({ where: { state } })
      if (!row || row.platform !== 'google_business' || row.expiresAt < new Date()) {
        return done('This connection link expired — please try again from onboarding.')
      }
      await prisma.oAuthState.delete({ where: { state } }).catch(() => {})
      const [, accountId, userId] = row.clerkId.split(':')

      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
            client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
            redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
            grant_type: 'authorization_code',
          }),
        })
        const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string }
        if (!tokens.refresh_token) throw new Error('no refresh_token in exchange')

        const existing = await prisma.apiKey.findFirst({ where: { userId, provider: 'google_business' } })
        if (existing) {
          await prisma.apiKey.update({ where: { id: existing.id }, data: { encryptedKey: encrypt(tokens.refresh_token) } })
        } else {
          await prisma.apiKey.create({ data: { userId, provider: 'google_business', encryptedKey: encrypt(tokens.refresh_token) } })
        }
        const boss = await getBoss()
        await boss.send(
          QUEUES.GOOGLE_REVIEWS_BACKFILL,
          { accountId },
          { singletonKey: `gbp-backfill-${accountId}`, expireInSeconds: 3600 },
        )
        logger.info({ accountId }, '[google-oauth] connected; backfill enqueued')
        return done('Google connected! Your reviews are being imported.')
      } catch (err) {
        logger.error({ err, accountId }, '[google-oauth] token exchange failed')
        return done('Something went wrong connecting Google — you can retry from onboarding.')
      }
    },
  )
}
