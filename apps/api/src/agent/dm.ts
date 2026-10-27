import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getGhlCredentials } from '../lib/ghl/settings'
import { getGhlContactTags, sendGhlConversationMessage } from '../lib/ghl/client'
import { runAgentTurn } from './engine'
import { applyBotGuard } from './bot-guard'

/**
 * Social DM transport (transport 2 of the transport-agnostic agent core).
 *
 * The snapshot workflow "AI DM Responder" (trigger: Customer Replied — the
 * builder offers no per-channel filter, so it fires on EVERY inbound reply)
 * posts to /api/agent/ghl-dm/:token. This module filters to the supported
 * messenger channels server-side (FB, IG, WhatsApp), maps the payload onto an
 * agent conversation and replies on the same channel. Time-insensitive by
 * design: the webhook enqueues and returns immediately; the turn runs in the
 * worker.
 */

/** GHL message-type → outbound send type. Extend to enable more channels.
 *  WhatsApp (wellness plan Phase 2): inbound arrives as TYPE_WHATSAPP, the
 *  send type is 'WhatsApp' (Conversations send-message enum). Agent replies
 *  are always answers to an inbound message, so they fall inside Meta's
 *  24-hour service window — business-INITIATED sends (reminders, review
 *  asks) need approved templates and stay in GHL workflows, not here. */
export const CHANNEL_TYPES: Record<string, string> = {
  TYPE_FACEBOOK: 'FB',
  TYPE_FB: 'FB',
  FB: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_IG: 'IG',
  IG: 'IG',
  TYPE_WHATSAPP: 'WhatsApp',
  WHATSAPP: 'WhatsApp',
}

export interface DmJobData {
  accountId: string
  ownerUserId: string
  contactId: string
  message: string
  /** Absent when the workflow payload had no message_type — the worker
   *  resolves the channel via the Conversations API (2026-09-09). */
  sendType?: string
}

export interface ParsedDmPayload {
  contactId: string | null
  message: string | null
  messageType: string | null
  direction: string | null
}

/**
 * Tolerant payload parser: GHL workflow webhook payload shapes vary by
 * trigger configuration (standard fields vs customData mappings). We accept
 * both and log unparseable payloads for calibration during E2E.
 */
export function parseDmPayload(body: Record<string, unknown>): ParsedDmPayload {
  const custom = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>
  const messageObj = (body.message ?? {}) as Record<string, unknown>
  const contactObj = (body.contact ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    contactId: str(custom.contact_id) ?? str(body.contact_id) ?? str(contactObj.id) ?? str(body.contactId),
    message: str(custom.message_body) ?? str(messageObj.body) ?? str(body.message_body) ?? str(body.body),
    messageType: str(custom.message_type) ?? str(messageObj.type) ?? str(body.message_type) ?? str(body.type),
    direction: str(custom.direction) ?? str(messageObj.direction) ?? str(body.direction),
  }
}

/**
 * Webhook entry: validate + filter + enqueue. Returns a short status string
 * for logging/response; never throws.
 */
export async function acceptDmWebhook(
  token: string,
  body: Record<string, unknown>,
  enqueue: (data: DmJobData) => Promise<void>,
): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { ghlDmToken: token },
    select: { id: true, ownerUserId: true, status: true },
  })
  if (!account || !account.ownerUserId) return 'unknown-token'
  if (account.status !== 'active') return 'account-inactive'

  const parsed = parseDmPayload(body)
  if (!parsed.contactId || !parsed.message) {
    logger.warn({ accountId: account.id, keys: Object.keys(body) }, '[agent-dm] unparseable webhook payload')
    return 'unparseable'
  }
  // Outbound echoes must never trigger a turn (loop safety layer 2).
  if (parsed.direction && parsed.direction.toLowerCase() !== 'inbound') return 'not-inbound'

  // Explicit non-messenger types are rejected here; a MISSING type is fine —
  // the Customer Replied builder exposes no message_type field (2026-09-09),
  // so the worker resolves the channel via the Conversations API instead.
  const sendType = parsed.messageType ? CHANNEL_TYPES[parsed.messageType.toUpperCase()] : undefined
  if (parsed.messageType && !sendType) return `channel-unsupported:${parsed.messageType}`

  await enqueue({
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    contactId: parsed.contactId,
    message: parsed.message,
    sendType,
  })
  return sendType ? 'enqueued' : 'enqueued-channel-lookup'
}

/** Worker: run the agent turn and reply on the same channel. */
export async function processDmTurn(data: DmJobData): Promise<void> {
  const creds = await getGhlCredentials(data.ownerUserId)
  if (!creds) {
    logger.error({ accountId: data.accountId }, '[agent-dm] no GHL credentials — turn dropped')
    return
  }

  // Channel resolution when the webhook payload had no message_type: look at
  // the contact's latest conversation. Non-messenger channels (SMS, email,
  // webchat) are skipped silently — this transport serves FB/IG/WhatsApp DMs.
  let sendType = data.sendType
  if (!sendType) {
    const { findGhlConversationChannel } = await import('../lib/ghl/client')
    const channel = await findGhlConversationChannel(creds.apiKey, creds.locationId, data.contactId)
    sendType = channel ? CHANNEL_TYPES[channel.toUpperCase()] : undefined
    if (!sendType) {
      logger.info({ accountId: data.accountId, contactId: data.contactId, channel }, '[agent-dm] non-messenger channel — skipping')
      return
    }
  }

  // Suppression check (layer 2 — the workflow also filters on these tags):
  // 'ai-off' = human takeover; 'in comment reply workflow' = the contact is
  // inside a scripted comment-reply funnel, which owns the thread until it
  // removes the tag (then the agent inherits open-ended Q&A).
  const SUPPRESS_TAGS = ['ai-off', 'in comment reply workflow']
  const tags = await getGhlContactTags(creds.apiKey, data.contactId)
  const hit = tags.find((t) => SUPPRESS_TAGS.includes(t.toLowerCase().trim()))
  if (hit) {
    logger.info({ accountId: data.accountId, contactId: data.contactId, tag: hit }, '[agent-dm] suppressed — skipping')
    return
  }

  // Bot-loop guard (layer 3): automated counterparts are muted BEFORE any
  // LLM spend — see agent/bot-guard.ts (Silpo Pack incident, 2026-10-27).
  const guard = await applyBotGuard({
    accountId: data.accountId,
    visitorKey: `ghl:${data.contactId}`,
    ghlContactId: data.contactId,
    message: data.message,
    channel: sendType,
    apiKey: creds.apiKey,
  })
  if (guard.skip) {
    logger.info(
      { accountId: data.accountId, contactId: data.contactId, reason: guard.reason },
      '[agent-dm] bot-guard skip',
    )
    return
  }

  const result = await runAgentTurn({
    accountId: data.accountId,
    visitorKey: `ghl:${data.contactId}`,
    message: data.message,
    channel: 'ghl-dm',
    ghlContactId: data.contactId,
  })

  // AI Activity rollup fact: persist the resolved platform (FB/IG/WhatsApp)
  // — resolution is per-turn and would otherwise be lost to the dashboard.
  void prisma.agentConversation
    .update({ where: { id: result.conversationId }, data: { dmPlatform: sendType } })
    .catch(() => {})

  // DM rendering: cards become plain links appended to the reply text.
  const parts = [result.reply]
  if (result.action?.type === 'send_booking_link' && result.bookingUrl) parts.push(result.bookingUrl)
  if (result.action?.type === 'send_guide_link' && result.guideLink) parts.push(result.guideLink)
  const text = parts.join('\n\n').slice(0, 1900)

  const sent = await sendGhlConversationMessage(creds.apiKey, {
    type: sendType,
    contactId: data.contactId,
    message: text,
  })
  if (!sent) {
    logger.error(
      { accountId: data.accountId, contactId: data.contactId, sendType: sendType },
      '[agent-dm] reply send FAILED — visitor saw nothing',
    )
    await prisma.agentConversation
      .updateMany({
        where: { id: result.conversationId },
        data: { flagged: true, flagReason: 'dm-send-failed' },
      })
      .catch(() => {})
  }
}
