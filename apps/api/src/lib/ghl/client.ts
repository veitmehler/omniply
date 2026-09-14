import {
  GHL_API_VERSION,
  GHL_BASE_URL,
  type GhlMediaItem,
  type GhlPostStatus,
  type GhlPostType,
  type GhlSocialAccount,
  type GhlTag,
} from './types'
import { logger } from '../logger'

export interface GhlRequestOptions {
  method?: string
  body?: unknown
  /** Override the `Version` header (some endpoint families pin a different date). */
  version?: string
}

// ── 401 self-heal (2026-09-02: second silent token death) ────────────────────
// Minted location OAuth tokens live ~24h. The proactive refresh in
// lib/ghl/settings.ts is the primary mechanism; this registry is the safety
// net: loaders register decrypted key → locationId, and a 401 here re-mints
// from the agency grant, persists, and retries the request ONCE.
const keyLocations = new Map<string, string>()
const inflightRefresh = new Map<string, Promise<string | null>>()

/** Register a decrypted location API key so a 401 can self-heal. */
export function registerGhlKeyLocation(apiKey: string, locationId: string): void {
  if (apiKey && locationId) keyLocations.set(apiKey, locationId)
}

async function refreshLocationKey(locationId: string): Promise<string | null> {
  const existing = inflightRefresh.get(locationId)
  if (existing) return existing
  const p = (async () => {
    try {
      const { mintLocationToken } = await import('./app-oauth')
      const minted = await mintLocationToken(locationId)
      if (!minted) return null
      const { prisma, encrypt } = await import('@omniply/shared')
      await prisma.ghlSettings.updateMany({
        where: { ghlLocationId: locationId },
        data: {
          ghlApiKey: encrypt(minted.token),
          ghlTokenExpiresAt: minted.expiresAt,
          ghlAuthType: 'oauth',
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      })
      registerGhlKeyLocation(minted.token, locationId)
      logger.info({ locationId }, '[ghl] location token re-minted after 401')
      return minted.token
    } catch (err) {
      logger.error({ locationId, err }, '[ghl] token refresh after 401 failed')
      return null
    } finally {
      inflightRefresh.delete(locationId)
    }
  })()
  inflightRefresh.set(locationId, p)
  return p
}

async function ghlRequest<T>(
  apiKey: string,
  path: string,
  options: GhlRequestOptions = {},
  isRetry = false,
): Promise<T> {
  const url = `${GHL_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  const method = options.method ?? 'GET'

  logger.debug({ method, url }, '[ghl] request')

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Version: options.version ?? GHL_API_VERSION,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  const topLevelKeys =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data as object)
      : Array.isArray(data)
        ? ['<array>']
        : []

  logger.debug(
    { method, url, status: response.status, topLevelKeys },
    '[ghl] response',
  )

  if (!response.ok) {
    // Expired location token: re-mint from the agency grant and retry once.
    if (response.status === 401 && !isRetry) {
      const locationId = keyLocations.get(apiKey)
      if (locationId) {
        const fresh = await refreshLocationKey(locationId)
        if (fresh) return ghlRequest<T>(fresh, path, options, true)
      }
    }
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : `GHL API error (${response.status})`
    logger.error({ method, url, status: response.status, topLevelKeys, message }, '[ghl] request failed')
    throw new Error(message)
  }

  return data as T
}

/**
 * Extract an array of social accounts from whatever shape GHL returns.
 * GHL has returned accounts under several different keys across API versions:
 *   - data.results.accounts  (documented v1 shape)
 *   - data.accounts          (alternative v1)
 *   - data.data              (common v2 / LeadConnector pattern)
 *   - data itself as an array
 */
function extractAccountsFromResponse(data: unknown): GhlSocialAccount[] {
  if (!data || typeof data !== 'object') return []

  if (Array.isArray(data)) return data as GhlSocialAccount[]

  const d = data as Record<string, unknown>

  // Try known nested shapes first
  const candidates: unknown[] = [
    d.results && typeof d.results === 'object'
      ? (d.results as Record<string, unknown>).accounts
      : undefined,
    d.accounts,
    d.data,
    d.socialMediaAccounts,
    d.items,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as GhlSocialAccount[]
    }
  }

  // Return any non-empty array found under any key
  for (const val of Object.values(d)) {
    if (Array.isArray(val) && val.length > 0) {
      logger.warn(
        { foundUnderKeys: Object.keys(d).filter((k) => Array.isArray(d[k] as unknown)) },
        '[ghl] accounts found under unexpected key — parser needs updating',
      )
      return val as GhlSocialAccount[]
    }
  }

  return []
}

export async function listGhlAccounts(
  apiKey: string,
  locationId: string,
): Promise<GhlSocialAccount[]> {
  const data = await ghlRequest<unknown>(
    apiKey,
    `/social-media-posting/${locationId}/accounts`,
  )

  const accounts = extractAccountsFromResponse(data)

  if (accounts.length === 0) {
    const topLevelKeys =
      data && typeof data === 'object' && !Array.isArray(data)
        ? Object.keys(data as object)
        : Array.isArray(data)
          ? ['<array>']
          : ['<empty>']
    logger.warn(
      { locationId, topLevelKeys, rawDataType: typeof data },
      '[ghl] listGhlAccounts returned 0 accounts — check locationId and API key scopes',
    )
  } else {
    logger.info(
      {
        locationId,
        count: accounts.length,
        platforms: [...new Set(accounts.map((a) => a.platform).filter(Boolean))],
      },
      '[ghl] accounts loaded',
    )
  }

  return accounts
}

export interface CreateGhlPostInput {
  apiKey: string
  locationId: string
  userId: string
  accountIds: string[]
  summary: string
  type?: GhlPostType
  media?: GhlMediaItem[]
  status?: GhlPostStatus
  scheduleDate?: string
}

export interface CreateGhlPostResult {
  ghlPostId: string
  platformPostId?: string
  postUrl?: string
  status?: string
}

function extractPostId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const results = root.results as Record<string, unknown> | undefined
  const post = (results?.post ?? root.post ?? root) as Record<string, unknown> | undefined
  if (!post) return null
  const id = post._id ?? post.id ?? post.postId
  return typeof id === 'string' ? id : null
}

export async function createGhlPost(input: CreateGhlPostInput): Promise<CreateGhlPostResult> {
  const body: Record<string, unknown> = {
    accountIds: input.accountIds,
    type: input.type ?? 'post',
    userId: input.userId,
    summary: input.summary,
    status: input.status ?? 'scheduled',
  }

  if (input.media?.length) {
    body.media = input.media
  }
  if (input.scheduleDate) {
    body.scheduleDate = input.scheduleDate
  }

  const data = await ghlRequest<Record<string, unknown>>(
    input.apiKey,
    `/social-media-posting/${input.locationId}/posts`,
    { method: 'POST', body },
  )

  const ghlPostId = extractPostId(data)
  if (!ghlPostId) {
    throw new Error('GHL did not return a post id')
  }

  const results = data.results as Record<string, unknown> | undefined
  const post = (results?.post ?? {}) as Record<string, unknown>

  return {
    ghlPostId,
    platformPostId: typeof post.postId === 'string' ? post.postId : undefined,
    postUrl: typeof post.postId === 'string' ? String(post.postId) : undefined,
    status: typeof post.status === 'string' ? post.status : undefined,
  }
}

export async function getGhlPost(
  apiKey: string,
  locationId: string,
  postId: string,
): Promise<Record<string, unknown>> {
  return ghlRequest<Record<string, unknown>>(
    apiKey,
    `/social-media-posting/${locationId}/posts/${postId}`,
  )
}

export interface EditGhlPostInput {
  apiKey: string
  locationId: string
  postId: string
  summary?: string
  media?: GhlMediaItem[]
  status?: GhlPostStatus
  scheduleDate?: string
}

export async function editGhlPost(input: EditGhlPostInput): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {}
  if (input.summary !== undefined) body.summary = input.summary
  if (input.media !== undefined) body.media = input.media
  if (input.status !== undefined) body.status = input.status
  if (input.scheduleDate !== undefined) body.scheduleDate = input.scheduleDate

  return ghlRequest<Record<string, unknown>>(
    input.apiKey,
    `/social-media-posting/${input.locationId}/posts/${input.postId}`,
    { method: 'PUT', body },
  )
}

export function getGhlOAuthStartUrl(platform: string): string {
  return `${GHL_BASE_URL}/social-media-posting/oauth/${platform}/start`
}

// ── Tags (smart-list audience source) ────────────────────────────────────────

/**
 * List location tags — used to populate the promotional-email "smart list"
 * picker. Endpoint is the documented Locations API:
 *   GET /locations/{locationId}/tags  →  { tags: [{ id, name, locationId }] }
 */
export async function listGhlTags(apiKey: string, locationId: string): Promise<GhlTag[]> {
  const data = await ghlRequest<{ tags?: GhlTag[] } | GhlTag[]>(
    apiKey,
    `/locations/${locationId}/tags`,
  )
  const tags = Array.isArray(data) ? data : (data.tags ?? [])
  logger.info({ locationId, count: tags.length }, '[ghl] tags loaded')
  return tags
}

// ── Email campaigns (promotional email per published article) ────────────────
//
// Two-step Email Campaigns V2 flow (confirmed against a working production
// integration): (1) create a draft campaign with inline HTML, (2) schedule it
// with the tag audience + send time. GHL performs delivery.
//
// Paths (services.leadconnectorhq.com):
//   POST /emails/public/v2/locations/{locationId}/campaigns/email-campaign
//   POST /emails/public/v2/locations/{locationId}/campaigns/{campaignId}/schedule

const EMAIL_API_VERSION = '2021-07-28'

/** Sender/meta block duplicated into both create and schedule bodies. */
export interface GhlEmailMeta {
  subject: string
  fromName: string
  fromEmail: string
  previewText: string
}

export interface CreateGhlEmailCampaignInput {
  apiKey: string
  locationId: string
  /** Internal campaign name (not shown to recipients). */
  name: string
  meta: GhlEmailMeta
  /** Email-safe HTML body. */
  bodyHtml: string
  /** IANA timezone the schedule time is interpreted in. */
  timeZone: string
  /** GHL user id that owns the campaign. */
  userId: string
}

export interface CreateGhlEmailCampaignResult {
  campaignId: string
}

/** Pull a campaign id out of whatever shape GHL returns. */
function extractCampaignId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const nested =
    (root.campaign as Record<string, unknown> | undefined) ??
    (root.data as Record<string, unknown> | undefined) ??
    root
  const id = nested?.id ?? nested?._id ?? nested?.campaignId ?? root.campaignId ?? root.id
  return typeof id === 'string' ? id : null
}

export async function createGhlEmailCampaign(
  input: CreateGhlEmailCampaignInput,
): Promise<CreateGhlEmailCampaignResult> {
  const { meta } = input
  const body = {
    name: input.name,
    subject: meta.subject,
    previewText: meta.previewText,
    fromName: meta.fromName,
    fromEmail: meta.fromEmail,
    editorType: 'html',
    editorContent: input.bodyHtml,
    timeZone: input.timeZone,
    userId: input.userId,
    emailMeta: {
      subject: meta.subject,
      fromName: meta.fromName,
      fromEmail: meta.fromEmail,
      previewText: meta.previewText,
    },
  }

  const data = await ghlRequest<Record<string, unknown>>(
    input.apiKey,
    `/emails/public/v2/locations/${input.locationId}/campaigns/email-campaign`,
    { method: 'POST', body, version: EMAIL_API_VERSION },
  )

  const campaignId = extractCampaignId(data)
  if (!campaignId) {
    throw new Error('GHL did not return an email campaign id')
  }
  return { campaignId }
}

export interface ScheduleGhlEmailCampaignInput {
  apiKey: string
  locationId: string
  campaignId: string
  meta: GhlEmailMeta
  /** Tag ids the campaign is sent to (the "smart list"). */
  tagIds: string[]
  timeZone: string
  userId: string
  /**
   * Local wall-clock send time, "YYYY-MM-DDTHH:mm:ss" with NO timezone suffix.
   * GHL interprets it in `timeZone` — passing a UTC `Z` string sends at the
   * wrong time. Use formatLocalSendAt() to build this from a UTC Date.
   */
  sendAt: string
}

/** Schedule a previously-created campaign to send to `tagIds` at `sendAt`. */
export async function scheduleGhlEmailCampaign(
  input: ScheduleGhlEmailCampaignInput,
): Promise<void> {
  const { meta } = input
  const body = {
    scheduleType: 'scheduled',
    timeZone: input.timeZone,
    userId: input.userId,
    emailMeta: {
      subject: meta.subject,
      fromName: meta.fromName,
      fromEmail: meta.fromEmail,
      previewText: meta.previewText,
    },
    recipients: {
      type: 'tag',
      tagIds: input.tagIds,
    },
    scheduleConfig: {
      sendAt: input.sendAt,
    },
  }

  await ghlRequest<unknown>(
    input.apiKey,
    `/emails/public/v2/locations/${input.locationId}/campaigns/${input.campaignId}/schedule`,
    { method: 'POST', body, version: EMAIL_API_VERSION },
  )
}

/**
 * Delete a campaign. Used to roll back a just-created draft when scheduling
 * fails, so failed publishes don't accumulate orphaned drafts in GHL.
 */
export async function deleteGhlEmailCampaign(
  apiKey: string,
  locationId: string,
  campaignId: string,
): Promise<void> {
  await ghlRequest<unknown>(
    apiKey,
    `/emails/public/v2/locations/${locationId}/campaigns/${campaignId}`,
    { method: 'DELETE', version: EMAIL_API_VERSION },
  )
}

/**
 * Format a UTC instant as GHL's local wall-clock send string
 * ("YYYY-MM-DDTHH:mm:ss", no suffix) in `timeZone`. GHL pairs this with the
 * `timeZone` field, so it must be the local representation, not UTC.
 */
export function formatLocalSendAt(utcDate: Date, timeZone: string): string {
  // 'sv-SE' natively formats as "YYYY-MM-DD HH:mm:ss"; swap the space for 'T'.
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(utcDate)
  return local.replace(' ', 'T')
}

// ── Contacts (lead-gen capture — leadgen plan Phase 3) ───────────────────────

export interface UpsertContactResult {
  contactId: string | null
}

/**
 * Upsert a contact and apply tags (GHL creates unknown tag names on the fly).
 * POST /contacts/upsert is the documented v2 path — dedupes by email when
 * present, otherwise by phone (chat-agent callbacks are often phone-first).
 * At least one of email/phone must be provided.
 */
export async function upsertGhlContact(
  apiKey: string,
  locationId: string,
  input: {
    email?: string
    tags: string[]
    source?: string
    firstName?: string
    phone?: string
    customFields?: { id: string; value: string }[]
  },
): Promise<UpsertContactResult> {
  if (!input.email && !input.phone) throw new Error('upsertGhlContact needs email or phone')
  const data = await ghlRequest<{ contact?: { id?: string } }>(apiKey, '/contacts/upsert', {
    method: 'POST',
    body: {
      locationId,
      ...(input.email ? { email: input.email } : {}),
      tags: input.tags,
      ...(input.source ? { source: input.source } : {}),
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.customFields?.length ? { customFields: input.customFields } : {}),
    },
  })
  return { contactId: data.contact?.id ?? null }
}

/** Patch fields onto an existing contact (chat-agent convergence flow). */
export async function updateGhlContact(
  apiKey: string,
  contactId: string,
  fields: { email?: string; firstName?: string; phone?: string; customFields?: { id: string; value: string }[] },
): Promise<void> {
  await ghlRequest<unknown>(apiKey, `/contacts/${contactId}`, {
    method: 'PUT',
    body: {
      ...(fields.email ? { email: fields.email } : {}),
      ...(fields.firstName ? { firstName: fields.firstName } : {}),
      ...(fields.phone ? { phone: fields.phone } : {}),
      ...(fields.customFields?.length ? { customFields: fields.customFields } : {}),
    },
  })
}

/** Add tags to an existing contact (convergence path — never re-upserts). */
export async function addGhlContactTags(apiKey: string, contactId: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  await ghlRequest<unknown>(apiKey, `/contacts/${contactId}/tags`, {
    method: 'POST',
    body: { tags },
  })
}

/**
 * Attach a note to a contact — the chat-agent callback summary lands here so
 * the front desk opens the contact and sees the conversation context
 * (decision C).
 */
export async function createGhlContactNote(apiKey: string, contactId: string, body: string): Promise<void> {
  await ghlRequest<unknown>(apiKey, `/contacts/${contactId}/notes`, {
    method: 'POST',
    body: { body: body.slice(0, 5000) },
  })
}

/**
 * Resolve the "Guide Link" contact custom field id for a location (snapshot
 * asset, 2026-07-28: the single per-contact field the nurture email merges —
 * matched case-insensitively on key/name containing "guide_link"/"guide link").
 * Cached per location; null when the field doesn't exist (older snapshots).
 */
const guideLinkFieldCache = new Map<string, { id: string | null; at: number }>()
const GUIDE_LINK_CACHE_MS = 15 * 60 * 1000

export async function getGuideLinkFieldId(apiKey: string, locationId: string): Promise<string | null> {
  const hit = guideLinkFieldCache.get(locationId)
  if (hit && Date.now() - hit.at < GUIDE_LINK_CACHE_MS) return hit.id
  try {
    const data = await ghlRequest<{ customFields?: { id: string; name?: string; fieldKey?: string }[] }>(
      apiKey,
      `/locations/${locationId}/customFields`,
      { method: 'GET' },
    )
    const match = (data.customFields ?? []).find((f) => {
      const key = (f.fieldKey ?? '').toLowerCase()
      const name = (f.name ?? '').toLowerCase()
      return key.includes('guide_link') || name.replace(/\s+/g, '_') === 'guide_link' || name === 'guide link'
    })
    const id = match?.id ?? null
    guideLinkFieldCache.set(locationId, { id, at: Date.now() })
    return id
  } catch {
    return hit?.id ?? null
  }
}

/**
 * Resolve (or CREATE) the "Chat Summary" contact custom field for a location —
 * the chat-agent callback writes its summary here so snapshot workflows can
 * merge it into the front-desk notification ({{contact.chat_summary}}).
 * Find-or-create means no snapshot dependency; cached per location.
 */
const chatSummaryFieldCache = new Map<string, { id: string | null; at: number }>()

export async function getChatSummaryFieldId(apiKey: string, locationId: string): Promise<string | null> {
  const hit = chatSummaryFieldCache.get(locationId)
  if (hit && Date.now() - hit.at < GUIDE_LINK_CACHE_MS) return hit.id
  try {
    const data = await ghlRequest<{ customFields?: { id: string; name?: string; fieldKey?: string }[] }>(
      apiKey,
      `/locations/${locationId}/customFields`,
      { method: 'GET' },
    )
    let match = (data.customFields ?? []).find((f) => {
      const key = (f.fieldKey ?? '').toLowerCase()
      const name = (f.name ?? '').toLowerCase()
      return key.includes('chat_summary') || name.replace(/\s+/g, '_') === 'chat_summary'
    })
    if (!match) {
      const created = await ghlRequest<{ customField?: { id: string } }>(
        apiKey,
        `/locations/${locationId}/customFields`,
        { method: 'POST', body: { name: 'Chat Summary', dataType: 'LARGE_TEXT' } },
      )
      match = created.customField ? { id: created.customField.id } : undefined
    }
    const id = match?.id ?? null
    chatSummaryFieldCache.set(locationId, { id, at: Date.now() })
    return id
  } catch {
    return hit?.id ?? null
  }
}

const callbackTimeFieldCache = new Map<string, { id: string | null; at: number }>()

/** Find-or-create the "Callback Preferred Time" custom field (voice-sms plan
 *  §5) — the snapshot notification workflow merges
 *  {{contact.callback_preferred_time}} into the front-desk SMS. */
export async function getCallbackTimeFieldId(apiKey: string, locationId: string): Promise<string | null> {
  const hit = callbackTimeFieldCache.get(locationId)
  if (hit && Date.now() - hit.at < GUIDE_LINK_CACHE_MS) return hit.id
  try {
    const data = await ghlRequest<{ customFields?: { id: string; name?: string; fieldKey?: string }[] }>(
      apiKey,
      `/locations/${locationId}/customFields`,
      { method: 'GET' },
    )
    let match = (data.customFields ?? []).find((f) => {
      const key = (f.fieldKey ?? '').toLowerCase()
      const name = (f.name ?? '').toLowerCase()
      return key.includes('callback_preferred_time') || name.replace(/\s+/g, '_') === 'callback_preferred_time'
    })
    if (!match) {
      const created = await ghlRequest<{ customField?: { id: string } }>(
        apiKey,
        `/locations/${locationId}/customFields`,
        { method: 'POST', body: { name: 'Callback Preferred Time', dataType: 'TEXT' } },
      )
      match = created.customField ? { id: created.customField.id } : undefined
    }
    const id = match?.id ?? null
    callbackTimeFieldCache.set(locationId, { id, at: Date.now() })
    return id
  } catch {
    return hit?.id ?? null
  }
}

/**
 * Upsert a LOCATION custom value by name (list → update-or-create) — unlike a
 * blind POST this never duplicates on re-runs. Write requires the
 * customValues.write scope (user bumping the app scope, 2026-07-28); until the
 * grant carries it, the write 4xxs and the caller's warn-log is the signal.
 */
export async function upsertGhlCustomValue(
  apiKey: string,
  locationId: string,
  name: string,
  value: string,
): Promise<boolean> {
  const list = await ghlRequest<{ customValues?: { id: string; name?: string }[] }>(
    apiKey,
    `/locations/${locationId}/customValues`,
    { method: 'GET' },
  )
  const existing = (list.customValues ?? []).find((v) => (v.name ?? '').toLowerCase() === name.toLowerCase())
  const path = existing
    ? `/locations/${locationId}/customValues/${existing.id}`
    : `/locations/${locationId}/customValues`
  await ghlRequest(apiKey, path, { method: existing ? 'PUT' : 'POST', body: { name, value } })
  return true
}

// ── Trigger links (QR review card, leadgen plan Phase F option C) ────────────

export interface GhlTriggerLink {
  id: string
  name: string
  redirectTo?: string
  fieldKey?: string
}

/** List the location's trigger links; returns [] on any failure (defensive). */
export async function listTriggerLinks(apiKey: string, locationId: string): Promise<GhlTriggerLink[]> {
  try {
    const data = await ghlRequest<{ links?: GhlTriggerLink[] }>(apiKey, `/links/?locationId=${locationId}`)
    return data.links ?? []
  } catch {
    return []
  }
}

/** Point a trigger link at a new destination (the clinic's Google review deep link). */
export async function updateTriggerLink(
  apiKey: string,
  linkId: string,
  name: string,
  redirectTo: string,
): Promise<boolean> {
  try {
    await ghlRequest(apiKey, `/links/${linkId}`, { method: 'PUT', body: { name, redirectTo } })
    return true
  } catch {
    return false
  }
}

/* ── Conversations (marketing contact form → GHL inbox) ───────────────────── */

/** Find the contact's conversation or create one. Returns null on failure. */
export async function findOrCreateGhlConversation(
  apiKey: string,
  locationId: string,
  contactId: string,
): Promise<string | null> {
  try {
    const found = await ghlRequest<{ conversations?: { id: string }[] }>(
      apiKey,
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}`,
    )
    if (found.conversations?.length) return found.conversations[0].id
  } catch {
    // fall through to create
  }
  try {
    const created = await ghlRequest<{ conversation?: { id: string }; id?: string }>(apiKey, '/conversations/', {
      method: 'POST',
      body: { locationId, contactId },
    })
    return created.conversation?.id ?? created.id ?? null
  } catch {
    return null
  }
}

/**
 * Log an INBOUND message on a conversation so it lands in the GHL inbox like
 * a visitor-sent message. Returns false when the API refuses (some message
 * types need a registered conversation provider) — callers fall back to a
 * contact note.
 */
export async function addGhlInboundMessage(
  apiKey: string,
  conversationId: string,
  message: string,
): Promise<boolean> {
  try {
    await ghlRequest(apiKey, '/conversations/messages/inbound', {
      method: 'POST',
      body: { type: 'SMS', conversationId, message, direction: 'inbound' },
    })
    return true
  } catch {
    return false
  }
}

/** Contact tags (DM agent: ai-off human-takeover check). Empty array on failure. */
export async function getGhlContactTags(apiKey: string, contactId: string): Promise<string[]> {
  try {
    const data = await ghlRequest<{ contact?: { tags?: string[] } }>(apiKey, `/contacts/${contactId}`)
    return data.contact?.tags ?? []
  } catch {
    return []
  }
}

/**
 * Resolve a contact's most recent conversation channel (FB/IG/SMS type
 * string) — used by the DM agent when the workflow payload carries no
 * message_type (the Customer Replied builder exposes no such field,
 * 2026-09-09). Returns the raw type/lastMessageType string or null.
 */
export async function findGhlConversationChannel(
  apiKey: string,
  locationId: string,
  contactId: string,
): Promise<string | null> {
  try {
    const data = await ghlRequest<{ conversations?: { type?: string; lastMessageType?: string }[] }>(
      apiKey,
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}`,
    )
    const conv = (data.conversations ?? [])[0]
    return conv?.lastMessageType ?? conv?.type ?? null
  } catch {
    return null
  }
}

/** Send an outbound conversation message on a native channel (IG/FB/SMS…). */
export async function sendGhlConversationMessage(
  apiKey: string,
  opts: { type: string; contactId: string; message: string },
): Promise<boolean> {
  try {
    await ghlRequest(apiKey, '/conversations/messages', {
      method: 'POST',
      body: { type: opts.type, contactId: opts.contactId, message: opts.message },
    })
    return true
  } catch {
    return false
  }
}
