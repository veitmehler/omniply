/**
 * Bot-loop guard (2026-10-27, after the Silpo Pack incident: a courier bot
 * and the agent exchanged 3×60 messages of mutual introductions).
 *
 * Layers, all cheaper than one LLM call:
 *  1. mute check — DB row per account+visitor; while muted, nothing runs.
 *     The GHL contact's WhatsApp DND is the clinic-visible marker AND the
 *     override surface: a human lifting the DND un-mutes on the next inbound.
 *  2. self-identification — automated counterparts announce themselves
 *     ("I'm your virtual assistant from …"); regex, pre-LLM, zero tokens.
 *  3. repetition — ≥3 near-identical inbound messages from one sender
 *     (loops degrade into verbatim repeats) → mute.
 *  4. daily reply budget per sender — bound for undetected loops; skips the
 *     turn without muting.
 *
 * Safety valve: a sender with a real booking history is never auto-muted.
 * The existing 30-turn conversation cap remains the final bound.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { sendFailureAlert } from '../lib/alerts'
import {
  createGhlContactNote,
  getGhlContactPhone,
  getGhlContactWhatsAppDnd,
  setGhlContactWhatsAppDnd,
} from '../lib/ghl/client'

const MUTE_DAYS = 7
const DAILY_REPLY_BUDGET = 20
const REPEAT_THRESHOLD = 3
const REPEAT_LOOKBACK = 10

/** Self-identification patterns of automated senders. Conservative by design:
 *  matched only on inbound text, and only for senders with no booking
 *  history. EN/ES/DE/FR/PT cover the clinics' markets. */
const BOT_PATTERNS: RegExp[] = [
  /\b(?:i\s*am|i'm)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:virtual\s+assistant|ai\s+assistant\s+(?:for|from|of)\s|chat\s*bot|chatbot|bot\b|automated\s+assistant)/i,
  /\bsoy\s+(?:tu\s+|un\s+|el\s+)?(?:asistente\s+virtual|chatbot|bot\b|asistente\s+automatizado)/i,
  /\b(?:this\s+is\s+an?\s+)?automated\s+(?:message|response|reply|notification)\b/i,
  /\b(?:mensaje|respuesta|notificaci[oó]n)\s+automatizad[oa]\b|\bmensaje\s+autom[aá]tico\b/i,
  /\bdo\s+not\s+reply\s+to\s+this\s+(?:message|email|number)\b|\bno\s+respondas?\s+a\s+este\s+mensaje\b/i,
  /\bich\s+bin\s+(?:ein\s+|dein\s+|ihr\s+)?(?:virtueller\s+assistent|chatbot|bot\b)|\bautomatische\s+(?:nachricht|antwort)\b/i,
  /\bje\s+suis\s+(?:un\s+|votre\s+)?(?:assistant\s+virtuel|chatbot|bot\b)|\bmessage\s+automatique\b/i,
  /\bsou\s+(?:o\s+|um\s+|seu\s+)?(?:assistente\s+virtual|chatbot|bot\b)|\bresposta\s+autom[aá]tica\b/i,
]

export function detectSelfIdentifiedBot(message: string): boolean {
  return BOT_PATTERNS.some((re) => re.test(message))
}

/** Normalize for repetition comparison: case/space/punctuation-insensitive,
 *  first 160 chars (loop messages repeat verbatim or near-verbatim). */
export function normalizeForRepeat(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 160)
}

export interface BotGuardInput {
  accountId: string
  visitorKey: string
  ghlContactId: string
  message: string
  /** Resolved messenger channel (WhatsApp | FB | IG). */
  channel: string
  /** Location-scoped GHL token for DND/note writes. */
  apiKey: string
}

export interface BotGuardResult {
  skip: boolean
  reason?: string
}

// ── Owner-number mute (2026-10-29: the owner's own setup/test messages hit
// the DM responder — e.g. Instagram wiring — and the agent chatted back).
// A sender whose contact phone IS one of the clinic's own numbers is the
// clinic, not a visitor: skip silently, no mute row, no DND, no note.
// Fails open everywhere (no phone / unreadable contact → normal handling).

/** Last-10-digit comparison — tolerant of +1/formatting differences. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '')
  const db = (b ?? '').replace(/\D/g, '')
  if (da.length < 7 || db.length < 7) return false
  return da.slice(-10) === db.slice(-10)
}

const OWNER_NUMBERS_TTL_MS = 15 * 60 * 1000
const ownerNumbersCache = new Map<string, { numbers: string[]; expires: number }>()

async function ownerNumbersForAccount(accountId: string): Promise<string[]> {
  const hit = ownerNumbersCache.get(accountId)
  if (hit && hit.expires > Date.now()) return hit.numbers
  const numbers: string[] = []
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { ownerUserId: true },
  })
  if (account?.ownerUserId) {
    const brand = await prisma.brandSettings.findUnique({
      where: { userId: account.ownerUserId },
      select: { organizationPhone: true },
    })
    if (brand?.organizationPhone) numbers.push(brand.organizationPhone)
  }
  const voice = await prisma.voiceAgentConfig.findUnique({
    where: { accountId },
    select: { phoneNumber: true, rescueNumber: true },
  })
  if (voice?.phoneNumber) numbers.push(voice.phoneNumber)
  if (voice?.rescueNumber) numbers.push(voice.rescueNumber)
  ownerNumbersCache.set(accountId, { numbers, expires: Date.now() + OWNER_NUMBERS_TTL_MS })
  return numbers
}

async function isOwnerSender(input: BotGuardInput): Promise<boolean> {
  const numbers = await ownerNumbersForAccount(input.accountId)
  if (!numbers.length) return false
  const phone = await getGhlContactPhone(input.apiKey, input.ghlContactId)
  if (!phone) return false
  return numbers.some((n) => phonesMatch(n, phone))
}

async function hasBookingHistory(accountId: string, ghlContactId: string): Promise<boolean> {
  const appt = await prisma.agentAppointment.findFirst({
    where: { accountId, ghlContactId },
    select: { id: true },
  })
  return !!appt
}

async function muteSender(input: BotGuardInput, reason: string): Promise<void> {
  const expiresAt = new Date(Date.now() + MUTE_DAYS * 24 * 60 * 60 * 1000)
  await prisma.agentMutedSender.upsert({
    where: { accountId_visitorKey: { accountId: input.accountId, visitorKey: input.visitorKey } },
    create: {
      accountId: input.accountId,
      visitorKey: input.visitorKey,
      ghlContactId: input.ghlContactId,
      channel: input.channel,
      reason,
      expiresAt,
    },
    update: { reason, expiresAt },
  })
  // Clinic-visible marker + override surface (WhatsApp-scoped by decision
  // 2026-10-27; other channels get the DB mute only for now).
  if (input.channel === 'WhatsApp') {
    await setGhlContactWhatsAppDnd(
      input.apiKey,
      input.ghlContactId,
      'Automated sender detected — Omniply AI replies paused',
    )
  }
  await createGhlContactNote(
    input.apiKey,
    input.ghlContactId,
    `Omniply: this sender was detected as automated (${reason}). The AI assistant has stopped replying to it${input.channel === 'WhatsApp' ? ' and WhatsApp DND was set — remove the DND to let the AI engage again' : ''}.`,
  ).catch(() => {})
  await sendFailureAlert({
    errorType: 'agent_bot_sender_muted',
    message: `AI agent muted an automated sender (${reason}) on account ${input.accountId} — contact ${input.ghlContactId}, channel ${input.channel}.`,
    context: { accountId: input.accountId, ghlContactId: input.ghlContactId, channel: input.channel, reason },
  }).catch(() => {})
  logger.warn(
    { accountId: input.accountId, contactId: input.ghlContactId, channel: input.channel, reason },
    '[bot-guard] sender muted',
  )
}

/**
 * Run all guard layers for one inbound DM. skip=true means: do not run the
 * agent turn (everything needed — mute rows, DND, notes, alerts — is done).
 */
export async function applyBotGuard(input: BotGuardInput): Promise<BotGuardResult> {
  // 1. Existing mute (with the human-override check on WhatsApp DND).
  const mute = await prisma.agentMutedSender.findUnique({
    where: { accountId_visitorKey: { accountId: input.accountId, visitorKey: input.visitorKey } },
  })
  if (mute) {
    if (mute.expiresAt && mute.expiresAt.getTime() < Date.now()) {
      await prisma.agentMutedSender.delete({ where: { id: mute.id } }).catch(() => {})
    } else if (mute.channel === 'WhatsApp') {
      const dnd = await getGhlContactWhatsAppDnd(input.apiKey, input.ghlContactId)
      if (dnd === false) {
        // A human lifted the DND — honor it.
        await prisma.agentMutedSender.delete({ where: { id: mute.id } }).catch(() => {})
        logger.info(
          { accountId: input.accountId, contactId: input.ghlContactId },
          '[bot-guard] DND lifted by human — sender un-muted',
        )
      } else {
        return { skip: true, reason: 'muted' }
      }
    } else {
      return { skip: true, reason: 'muted' }
    }
  }

  // 1b. The clinic's own number messaging itself (owner setup/test traffic):
  // quiet skip — the owner is never a lead, and replying is pure noise.
  if (await isOwnerSender(input)) {
    logger.info(
      { accountId: input.accountId, contactId: input.ghlContactId },
      '[bot-guard] sender phone matches a clinic-own number — owner skip',
    )
    return { skip: true, reason: 'owner-number' }
  }

  // 2. Self-identified bot (pre-LLM, zero tokens).
  if (detectSelfIdentifiedBot(input.message)) {
    if (await hasBookingHistory(input.accountId, input.ghlContactId)) {
      logger.info(
        { accountId: input.accountId, contactId: input.ghlContactId },
        '[bot-guard] self-ID pattern on sender with booking history — NOT muting',
      )
    } else {
      await muteSender(input, 'self-identified-bot')
      return { skip: true, reason: 'self-identified-bot' }
    }
  }

  // 3. Repetition: this message near-identical to ≥(threshold-1) recent ones.
  const recent = await prisma.agentMessage.findMany({
    where: {
      role: 'visitor',
      conversation: { accountId: input.accountId, visitorKey: input.visitorKey },
    },
    orderBy: { createdAt: 'desc' },
    take: REPEAT_LOOKBACK,
    select: { content: true },
  })
  const norm = normalizeForRepeat(input.message)
  if (norm.length >= 20) {
    const repeats = recent.filter((m) => normalizeForRepeat(m.content) === norm).length
    if (repeats + 1 >= REPEAT_THRESHOLD) {
      if (!(await hasBookingHistory(input.accountId, input.ghlContactId))) {
        await muteSender(input, 'repeated-messages')
        return { skip: true, reason: 'repeated-messages' }
      }
    }
  }

  // 4. Daily reply budget (skip the turn, no mute — legit chatty humans
  //    resume tomorrow; loops stay bounded even when undetected).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const repliesToday = await prisma.agentMessage.count({
    where: {
      role: 'assistant',
      createdAt: { gte: since },
      conversation: { accountId: input.accountId, visitorKey: input.visitorKey },
    },
  })
  if (repliesToday >= DAILY_REPLY_BUDGET) {
    logger.warn(
      { accountId: input.accountId, contactId: input.ghlContactId, repliesToday },
      '[bot-guard] daily reply budget reached — turn skipped',
    )
    return { skip: true, reason: 'daily-budget' }
  }

  return { skip: false }
}
