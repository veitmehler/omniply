/**
 * Zero-touch account provisioning (purchase → working Omniply account).
 *
 * Triggered by the app INSTALL webhook (new SaaS subaccounts) and by the
 * install-link backfill. Idempotent per location. Creates: owner User (real
 * business email when the location has one, so the buyer's first SSO open
 * binds to it), Account (active, paid window open), GhlSettings with an
 * OAuth location token (auth type 'oauth'; refreshed on expiry — NO manual
 * Private Integration key), billing + review webhook tokens, and best-effort
 * custom values so the snapshot workflows are pre-wired.
 */
import { randomBytes } from 'node:crypto'
import { prisma, encrypt } from '@omniply/shared'
import { mintLocationToken } from './app-oauth'
import { logger } from '../logger'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

interface LocationDetails {
  name?: string
  email?: string
  timezone?: string
  website?: string
}

async function fetchLocation(locationId: string, token: string): Promise<LocationDetails> {
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION },
    })
    if (!res.ok) return {}
    const data = (await res.json()) as { location?: LocationDetails }
    return data.location ?? {}
  } catch {
    return {}
  }
}

/** Best-effort: pre-set the webhook-token custom values the snapshot workflows reference. */
async function setCustomValues(locationId: string, token: string, values: Record<string, string>): Promise<void> {
  const failed: string[] = []
  for (const [name, value] of Object.entries(values)) {
    try {
      const res = await fetch(`${GHL_BASE}/locations/${locationId}/customValues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Version: VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      })
      if (!res.ok) {
        failed.push(name)
        logger.error({ locationId, name, status: res.status }, '[auto-provision] custom value set FAILED')
      }
    } catch (err) {
      failed.push(name)
      logger.error({ err, locationId, name }, '[auto-provision] custom value set FAILED')
    }
  }
  if (failed.length > 0) {
    // Loud on purpose (2026-09-09): the snapshot ships placeholder values —
    // a location left un-backfilled means dead webhooks (DM agent, reviews,
    // billing events) that fail silently downstream.
    logger.error({ locationId, failed }, '[auto-provision] CUSTOM VALUES INCOMPLETE — snapshot placeholders still live')
  }
}

/** Internal locations (the selling subaccount etc.) must never become client accounts. */
function isExcluded(locationId: string): boolean {
  return (process.env.GHL_INTERNAL_LOCATIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(locationId)
}

/** Idempotent: provision a location into a ready-to-onboard Omniply account. */
export async function provisionLocation(
  locationId: string,
  source: string,
  preMinted?: { token: string; expiresAt: Date; userId?: string },
): Promise<string | null> {
  if (isExcluded(locationId)) {
    logger.info({ locationId, source }, '[auto-provision] internal location — skipped')
    return null
  }
  const existing = await prisma.ghlSettings.findFirst({ where: { ghlLocationId: locationId }, select: { id: true } })
  if (existing) {
    logger.info({ locationId, source }, '[auto-provision] location already provisioned')
    return null
  }

  // Minting the token doubles as install verification — it fails for
  // locations that don't actually have the app. Per-location consent flows
  // hand us the token directly instead.
  const minted = preMinted ?? (await mintLocationToken(locationId))
  if (!minted) {
    logger.warn({ locationId, source }, '[auto-provision] token mint failed — not provisioning')
    return null
  }

  const loc = await fetchLocation(locationId, minted.token)
  const email = loc.email?.trim().toLowerCase()

  // Owner user: the location's business email when free (the buyer's first
  // SSO open then binds to it via the email join); synthetic fallback.
  let ownerEmail = email && !(await prisma.user.findUnique({ where: { email } })) ? email : `${locationId}@ghl.local`

  const billingToken = randomBytes(24).toString('base64url')
  const reviewToken = randomBytes(24).toString('base64url')
  const dmToken = randomBytes(24).toString('base64url')

  const account = await prisma.account.create({
    data: {
      name: loc.name ?? `Location ${locationId}`,
      status: 'active',
      subscriptionStartedAt: new Date(),
      paidThrough: new Date(Date.now() + 33 * 24 * 3600 * 1000),
      ghlBillingToken: billingToken,
      ghlReviewToken: reviewToken,
      ghlDmToken: dmToken,
    },
  })
  const owner = await prisma.user.create({
    data: {
      clerkId: `ghlowner:${locationId}`,
      email: ownerEmail,
      name: loc.name ?? null,
      accountId: account.id,
    },
  })
  await prisma.account.update({ where: { id: account.id }, data: { ownerUserId: owner.id } })
  await prisma.ghlSettings.create({
    data: {
      userId: owner.id,
      ghlApiKey: encrypt(minted.token),
      ghlAuthType: 'oauth',
      ghlTokenExpiresAt: minted.expiresAt,
      ghlLocationId: locationId,
      ghlUserId: minted.userId ?? null,
    },
  })
  if (loc.timezone) {
    await prisma.settings.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id, theme: 'light', sidebarState: 'open', socialTimezone: loc.timezone },
      update: { socialTimezone: loc.timezone },
    })
  }

  const base = process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io'
  await setCustomValues(locationId, minted.token, {
    omniply_billing_token: `${base}/api/ghl/billing-events/${billingToken}`,
    omniply_review_token: `${base}/api/ghl/reviews/${reviewToken}`,
    omniply_dm_webhook: `${base}/api/agent/ghl-dm/${dmToken}`,
  })

  logger.info({ locationId, accountId: account.id, source, ownerEmail }, '[auto-provision] account provisioned')
  return account.id
}
