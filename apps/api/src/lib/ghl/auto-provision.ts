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

/** Verticals a snapshot may declare; anything else falls back to chiro. */
const KNOWN_VERTICALS = new Set(['chiro', 'wellness'])

/** The snapshot's self-description (funnel provisioning 2026-10-22): each
 *  vertical's snapshot carries an `omniply_vertical_<v>` MARKER custom value,
 *  so a location born from that vertical's SaaS plan arrives labeled before
 *  our webhook ever fires. The vertical is encoded in the KEY NAME, not the
 *  value, because GHL snapshot cloning copies custom-value keys but STRIPS
 *  their values (found at the Whealth pilot). A non-empty `omniply_vertical`
 *  value (hand-set) still wins. Absent (the chiro snapshot) = chiro. */
async function fetchSnapshotVertical(locationId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}/customValues`, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION },
    })
    if (!res.ok) return 'chiro'
    const data = (await res.json()) as { customValues?: { name?: string; value?: string }[] }
    const list = data.customValues ?? []
    const direct = list.find((cv) => cv.name === 'omniply_vertical')?.value?.trim().toLowerCase()
    if (direct) {
      if (KNOWN_VERTICALS.has(direct)) return direct
      logger.warn({ locationId, direct }, '[auto-provision] unknown omniply_vertical value — ignoring')
    }
    for (const cv of list) {
      const m = /^omniply_vertical_([a-z0-9_-]+)$/.exec(cv.name ?? '')
      if (!m) continue
      if (KNOWN_VERTICALS.has(m[1])) return m[1]
      logger.warn({ locationId, marker: cv.name }, '[auto-provision] unknown vertical marker — defaulting to chiro')
    }
    return 'chiro'
  } catch {
    return 'chiro'
  }
}

/** Best-effort: pre-set the webhook-token custom values the snapshot workflows reference.
 *  UPSERT, not POST (fixed 2026-10-22, found at the Whealth pilot): snapshot-cloned
 *  locations ALREADY carry these keys — GHL clones custom-value KEYS but strips
 *  their VALUES — and POST on an existing name fails, leaving the webhooks empty. */
async function setCustomValues(locationId: string, token: string, values: Record<string, string>): Promise<void> {
  let existing: { id?: string; name?: string }[] = []
  try {
    const listRes = await fetch(`${GHL_BASE}/locations/${locationId}/customValues`, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION },
    })
    if (listRes.ok) existing = ((await listRes.json()) as { customValues?: { id?: string; name?: string }[] }).customValues ?? []
  } catch (err) {
    logger.warn({ err, locationId }, '[auto-provision] custom value listing failed — falling back to create-only')
  }
  const failed: string[] = []
  for (const [name, value] of Object.entries(values)) {
    try {
      const found = existing.find((cv) => cv.name === name && cv.id)
      const res = await fetch(
        `${GHL_BASE}/locations/${locationId}/customValues${found ? `/${found.id}` : ''}`,
        {
          method: found ? 'PUT' : 'POST',
          headers: { Authorization: `Bearer ${token}`, Version: VERSION, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, value }),
        },
      )
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
  const vertical = await fetchSnapshotVertical(locationId, minted.token)

  const account = await prisma.account.create({
    data: {
      name: loc.name ?? `Location ${locationId}`,
      vertical,
      status: 'active',
      subscriptionStartedAt: new Date(),
      paidThrough: new Date(Date.now() + 33 * 24 * 3600 * 1000),
      ghlBillingToken: billingToken,
      ghlReviewToken: reviewToken,
      ghlDmToken: dmToken,
      // Direct agent booking endpoint token (MCP plan Phase 2) — minted at
      // birth so the discovery trail never advertises a missing endpoint.
      agentMcpToken: randomBytes(24).toString('base64url'),
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
    omniply_review_request_webhook: `${base}/api/ghl/review-requests/${reviewToken}`,
    omniply_dm_webhook: `${base}/api/agent/ghl-dm/${dmToken}`,
  })

  // Staff contacts are NOT created here (Veit 2026-10-09): in SaaS mode the
  // sub-account is born at purchase, so users with phones cannot exist yet —
  // this window always found nobody. ensureStaffContacts runs at the
  // onboarding finale instead (routes/onboarding.ts), when setup is done.

  logger.info({ locationId, accountId: account.id, source, ownerEmail, vertical }, '[auto-provision] account provisioned')
  return account.id
}
