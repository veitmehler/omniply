import { ghlSettingsForUser } from '@omniply/shared'
import { decrypt, encrypt } from '@omniply/shared'
import type { GhlAccountIds } from './types'
import { registerGhlKeyLocation } from './client'

type GhlSettingsRow = NonNullable<Awaited<ReturnType<typeof ghlSettingsForUser>>>

/**
 * Decrypted, guaranteed-freshest API key for a settings row (2026-09-02:
 * second silent token death — refresh previously lived ONLY in
 * getGhlCredentials, so promo/newsletter paths ran on stale tokens).
 * Minted location OAuth tokens live ~24h: refresh proactively when expiry is
 * near OR unknown-but-oauth; every key is registered so ghlRequest's 401
 * retry can self-heal anything this misses.
 */
async function freshApiKey(row: GhlSettingsRow): Promise<string | null> {
  if (!row.ghlApiKey || !row.ghlLocationId) return null

  const nearExpiry =
    row.ghlTokenExpiresAt != null && row.ghlTokenExpiresAt.getTime() - Date.now() < 10 * 60 * 1000
  const oauthWithoutExpiry = row.ghlAuthType === 'oauth' && row.ghlTokenExpiresAt == null

  if (nearExpiry || oauthWithoutExpiry) {
    const { mintLocationToken } = await import('./app-oauth')
    const minted = await mintLocationToken(row.ghlLocationId)
    if (minted) {
      const { prisma } = await import('@omniply/shared')
      await prisma.ghlSettings.update({
        where: { id: row.id },
        data: { ghlApiKey: encrypt(minted.token), ghlTokenExpiresAt: minted.expiresAt, ghlAuthType: 'oauth' },
      })
      registerGhlKeyLocation(minted.token, row.ghlLocationId)
      return minted.token
    }
  }

  const apiKey = decrypt(row.ghlApiKey)
  if (!apiKey) return null
  registerGhlKeyLocation(apiKey, row.ghlLocationId)
  return apiKey
}

export interface GhlCredentials {
  apiKey: string
  locationId: string
  ghlUserId: string
  accountIds: GhlAccountIds
}

export async function getGhlCredentials(userId: string): Promise<GhlCredentials | null> {
  const row = await ghlSettingsForUser(userId)
  if (!row?.ghlApiKey || !row.ghlLocationId || !row.ghlUserId) {
    return null
  }

  const apiKey = await freshApiKey(row)
  if (!apiKey) return null

  return {
    apiKey,
    locationId: row.ghlLocationId,
    ghlUserId: row.ghlUserId,
    accountIds: (row.accountIds ?? {}) as GhlAccountIds,
  }
}

export async function getGhlAccountId(
  userId: string,
  platform: string,
): Promise<string | null> {
  const creds = await getGhlCredentials(userId)
  if (!creds) return null
  return creds.accountIds[platform as keyof GhlAccountIds] ?? null
}

export function encryptGhlApiKey(apiKey: string): string {
  return encrypt(apiKey.trim())
}

export interface PromoEmailConfig {
  apiKey: string
  locationId: string
  /** GHL user id that owns created campaigns — required by the email API. */
  ghlUserId: string
  tagId: string
  tagName: string | null
  sendTime: string // "HH:mm"
  timezone: string
  fromName: string | null
  fromEmail: string | null
}

/**
 * Returns the promotional-email config only when the feature is fully usable:
 * enabled, a decryptable API key, a locationId, a GHL user id (campaign owner),
 * and a target tag. Otherwise null so callers can cheaply skip.
 */
export async function getPromoEmailConfig(userId: string): Promise<PromoEmailConfig | null> {
  const row = await ghlSettingsForUser(userId)
  if (
    !row?.promoEmailEnabled ||
    !row.ghlApiKey ||
    !row.ghlLocationId ||
    !row.ghlUserId ||
    !row.promoEmailTagId
  ) {
    return null
  }
  const apiKey = await freshApiKey(row)
  if (!apiKey) return null

  return {
    apiKey,
    locationId: row.ghlLocationId,
    ghlUserId: row.ghlUserId,
    tagId: row.promoEmailTagId,
    tagName: row.promoEmailTagName,
    sendTime: row.promoEmailSendTime ?? '09:00',
    timezone: row.promoEmailTimezone ?? 'America/New_York',
    fromName: row.promoEmailFromName,
    fromEmail: row.promoEmailFromEmail,
  }
}

export interface NewsletterEmailConfig {
  apiKey: string
  locationId: string
  ghlUserId: string
  /** Audience = union of these tags (multi-tag, Veit 2026-09-17). */
  tagIds: string[]
  tagId: string
  tagName: string | null
  sendTime: string // "HH:mm"
  timezone: string
  fromName: string | null
  fromEmail: string
}

/**
 * Returns the newsletter delivery config only when fully usable: a decryptable
 * API key, locationId, GHL user id (campaign owner), a target tag, and a From
 * email. Otherwise null so the approve route can return a clear error.
 */
export async function getNewsletterEmailConfig(userId: string): Promise<NewsletterEmailConfig | null> {
  const row = await ghlSettingsForUser(userId)
  const multi = Array.isArray(row?.newsletterTagIds)
    ? (row!.newsletterTagIds as { id?: string; name?: string }[]).filter((t) => t.id)
    : []
  const tagIds = multi.length ? multi.map((t) => t.id!) : row?.newsletterTagId ? [row.newsletterTagId] : []
  if (!row?.ghlApiKey || !row.ghlLocationId || !row.ghlUserId || tagIds.length === 0 || !row.newsletterFromEmail) {
    return null
  }
  const apiKey = await freshApiKey(row)
  if (!apiKey) return null

  return {
    apiKey,
    locationId: row.ghlLocationId,
    ghlUserId: row.ghlUserId,
    tagIds,
    tagId: tagIds[0],
    tagName: multi[0]?.name ?? row.newsletterTagName,
    sendTime: row.newsletterSendTime ?? '09:00',
    timezone: row.newsletterTimezone ?? 'America/New_York',
    fromName: row.newsletterFromName,
    fromEmail: row.newsletterFromEmail,
  }
}

/** Canonical newsletter audience tags (Veit 2026-09-17). */
export const NEWSLETTER_AUDIENCE_TAGS = ['newsletter-subscriber', 'spine-check-lead']

/**
 * Auto-configure newsletter delivery at onboarding (finale, best-effort):
 * find-or-create the canonical audience tags in the client's GHL location and
 * default the From identity from the captured business details. Never
 * overwrites values the client already set.
 */
export async function configureNewsletterDelivery(userId: string): Promise<void> {
  const { listGhlTags, createGhlTag } = await import('./client')
  const { prisma } = await import('@omniply/shared')
  const row = await ghlSettingsForUser(userId)
  if (!row?.ghlApiKey || !row.ghlLocationId) return
  const apiKey = await freshApiKey(row)
  if (!apiKey) return

  const existing = await listGhlTags(apiKey, row.ghlLocationId).catch(() => [])
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]))
  const tags: { id: string; name: string }[] = []
  for (const name of NEWSLETTER_AUDIENCE_TAGS) {
    let tag = byName.get(name)
    if (!tag) {
      try {
        tag = await createGhlTag(apiKey, row.ghlLocationId, name)
      } catch {
        continue // best-effort; Settings can fix later
      }
    }
    if (tag?.id) tags.push({ id: tag.id, name: tag.name })
  }

  const brand = await prisma.brandSettings.findFirst({
    where: { userId },
    select: { organizationEmail: true, organizationName: true },
  })
  const userSettings = await prisma.settings.findUnique({ where: { userId }, select: { socialTimezone: true } })

  await prisma.ghlSettings.update({
    where: { id: row.id },
    data: {
      ...(tags.length ? { newsletterTagIds: tags } : {}),
      ...(row.newsletterFromEmail ? {} : brand?.organizationEmail ? { newsletterFromEmail: brand.organizationEmail } : {}),
      ...(row.newsletterFromName ? {} : brand?.organizationName ? { newsletterFromName: brand.organizationName } : {}),
      ...(row.newsletterTimezone ? {} : userSettings?.socialTimezone ? { newsletterTimezone: userSettings.socialTimezone } : {}),
    },
  })
}
