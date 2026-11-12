/**
 * DM responder channel gate (2026-11-12, Dasha's Instagram inbox).
 *
 * The "AI DM Responder" workflow fires on EVERY inbound reply and the
 * builder cannot filter by channel, so the account decides per channel how
 * the agent behaves:
 *
 *   off        — the agent never replies on this channel.
 *   inquiries  — reply only to genuine prospect inquiries (three layers, in
 *                order, cheapest first):
 *                  1. nothing-to-answer: reactions, emoji, "thanks" → silent.
 *                  2. owner-active thread: the owner wrote in this thread by
 *                     hand within OWNER_ACTIVE_WINDOW_DAYS → the human owns
 *                     it, the agent stays out.
 *                  3. intent classifier (Haiku, agent_dm_intent): creator
 *                     pitches, promo codes, collab asks, friend chatter and
 *                     spam → silent. Fails OPEN (a classifier outage must not
 *                     silence real prospects).
 *   all        — every text message gets a turn (the pre-2026-11-12 behaviour).
 *
 * Defaults when the account has no setting: WhatsApp 'all' (that inbox is
 * business traffic by nature), Instagram and Facebook 'inquiries'.
 */

export type DmChannelMode = 'off' | 'inquiries' | 'all'
export type DmChannelKey = 'whatsapp' | 'instagram' | 'facebook'
export type DmChannelModes = Record<DmChannelKey, DmChannelMode>

export const DM_CHANNEL_KEYS: DmChannelKey[] = ['whatsapp', 'instagram', 'facebook']
export const DM_CHANNEL_MODES: DmChannelMode[] = ['off', 'inquiries', 'all']
export const DM_CHANNEL_DEFAULTS: DmChannelModes = { whatsapp: 'all', instagram: 'inquiries', facebook: 'inquiries' }
export const OWNER_ACTIVE_WINDOW_DAYS = 7

/** Send type (FB | IG | WhatsApp) → settings key. */
export function channelKeyForSendType(sendType: string): DmChannelKey | null {
  const t = sendType.toUpperCase()
  if (t === 'FB') return 'facebook'
  if (t === 'IG') return 'instagram'
  if (t === 'WHATSAPP') return 'whatsapp'
  return null
}

/** Stored JSON (or anything) → complete modes with defaults filled in. */
export function resolveDmChannelModes(stored: unknown): DmChannelModes {
  const out: DmChannelModes = { ...DM_CHANNEL_DEFAULTS }
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const rec = stored as Record<string, unknown>
    for (const key of DM_CHANNEL_KEYS) {
      const v = rec[key]
      if (typeof v === 'string' && (DM_CHANNEL_MODES as string[]).includes(v)) out[key] = v as DmChannelMode
    }
  }
  return out
}

/** Settings PUT body → modes, or null when any provided value is invalid. */
export function parseDmChannelModes(body: unknown): DmChannelModes | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  const out: DmChannelModes = { ...DM_CHANNEL_DEFAULTS }
  for (const key of DM_CHANNEL_KEYS) {
    const v = rec[key]
    if (v === undefined) continue
    if (typeof v !== 'string' || !(DM_CHANNEL_MODES as string[]).includes(v)) return null
    out[key] = v as DmChannelMode
  }
  return out
}

// ---------------------------------------------------------------------------
// Layer 1 — nothing to answer
// ---------------------------------------------------------------------------

const REACTION_WORDS = new Set([
  'thanks', 'thank', 'thankyou', 'thx', 'ty', 'you', 'so', 'much', 'wow', 'wowww', 'yes', 'yess', 'yesss', 'yeah', 'yep', 'no',
  'nope', 'ok', 'okay', 'k', 'kk', 'lol', 'lmao', 'haha', 'hahaha', 'hehe', 'cool', 'nice', 'great', 'awesome', 'amazing',
  'love', 'loved', 'it', 'this', 'that', 'omg', 'yay', 'woohoo', 'sure', 'fine', 'good', 'perfect', 'true', 'same', 'cute',
  'beautiful', 'gorgeous', 'congrats', 'congratulations', 'welcome', 'bye', 'ciao', 'hi', 'hey', 'hello', 'hola', 'gracias',
  'si', 'sí', 'vale', 'genial', 'jaja', 'jajaja', 'ja', 'muy', 'bien', 'bueno', 'claro', 'ya', 'obrigado', 'obrigada', 'merci',
  'danke', 'спасибо', 'да', 'класс', 'ура',
])

/** Strip emoji, symbols, punctuation and repeated letters so "Wowwwwww yesss!!! 🙌" becomes "wow yes". */
function reactionTokens(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}️‍]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1{2,}/g, '$1$1').replace(/(.)\1+$/g, '$1'))
}

/**
 * True when the message carries nothing a front desk would answer: empty
 * after stripping emoji/punctuation, or at most four tokens that are all
 * reaction words ("Thank you!!", "Wowwwwww yesss", "haha ok"). Anything with
 * a digit, a question mark or a non-reaction word is NOT a reaction.
 */
export function isReactionOnly(message: string): boolean {
  if (/[?¿]/.test(message)) return false
  const tokens = reactionTokens(message)
  if (tokens.length === 0) return true
  if (tokens.length > 4) return false
  return tokens.every((t) => REACTION_WORDS.has(t) || REACTION_WORDS.has(t.replace(/(.)\1+$/g, '$1')))
}

// ---------------------------------------------------------------------------
// Layer 2 — owner-active thread
// ---------------------------------------------------------------------------

export interface ThreadMessage {
  direction: string | null
  body: string | null
  dateAdded: string | Date | null
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * True when an outbound message in the thread within the window was NOT
 * written by the agent. The agent's replies are known verbatim (stored
 * assistant turns; the sent text may carry an appended link, so a prefix
 * match counts). Empty outbound bodies (shared reels, stickers, voice notes)
 * are human too — the agent never sends an empty message.
 */
export function ownerActiveInThread(opts: {
  thread: ThreadMessage[]
  agentReplies: string[]
  now?: Date
  windowDays?: number
}): { active: boolean; lastOwnerMessageAt: Date | null } {
  const now = opts.now ?? new Date()
  const windowMs = (opts.windowDays ?? OWNER_ACTIVE_WINDOW_DAYS) * 86_400_000
  const ours = opts.agentReplies.map(normalizeText).filter(Boolean)
  let last: Date | null = null
  for (const m of opts.thread) {
    if ((m.direction ?? '').toLowerCase() !== 'outbound') continue
    const at = m.dateAdded ? new Date(m.dateAdded) : null
    if (!at || Number.isNaN(at.getTime())) continue
    if (now.getTime() - at.getTime() > windowMs) continue
    const body = normalizeText(m.body ?? '')
    const isOurs = body.length > 0 && ours.some((r) => body === r || body.startsWith(r))
    if (isOurs) continue
    if (!last || at > last) last = at
  }
  return { active: last !== null, lastOwnerMessageAt: last }
}

// ---------------------------------------------------------------------------
// Layer 3 — intent classification (prompt agent_dm_intent)
// ---------------------------------------------------------------------------

export type DmIntent = 'inquiry' | 'not_inquiry'

/** Parse the classifier's JSON ({"intent":"inquiry"|"not_inquiry", "reason":...}). Unknown → null. */
export function parseDmIntent(raw: unknown): { intent: DmIntent; reason: string | null } | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const intent = typeof rec.intent === 'string' ? rec.intent.trim().toLowerCase() : ''
  if (intent !== 'inquiry' && intent !== 'not_inquiry') return null
  return { intent, reason: typeof rec.reason === 'string' ? rec.reason.slice(0, 200) : null }
}

export type DmGateVerdict =
  | { reply: true }
  | { reply: false; reason: 'channel-off' | 'reaction-only' | 'owner-active' | 'not-inquiry'; detail?: string | null }

/**
 * Orchestrates the three layers for one inbound message. The expensive
 * lookups (thread fetch, classifier) are injected so the decision logic is
 * unit-testable and only runs the layers the mode calls for.
 */
export async function gateDmTurn(opts: {
  mode: DmChannelMode
  message: string
  loadThread: () => Promise<{ thread: ThreadMessage[]; agentReplies: string[] }>
  classify: (message: string) => Promise<{ intent: DmIntent; reason: string | null } | null>
  now?: Date
}): Promise<DmGateVerdict> {
  if (opts.mode === 'off') return { reply: false, reason: 'channel-off' }
  if (opts.mode === 'all') return { reply: true }

  if (isReactionOnly(opts.message)) return { reply: false, reason: 'reaction-only' }

  const { thread, agentReplies } = await opts.loadThread()
  const owner = ownerActiveInThread({ thread, agentReplies, now: opts.now })
  if (owner.active) return { reply: false, reason: 'owner-active', detail: owner.lastOwnerMessageAt?.toISOString() ?? null }

  const verdict = await opts.classify(opts.message)
  // Fail open: no verdict (outage, unparseable) → the prospect is served.
  if (!verdict) return { reply: true }
  if (verdict.intent === 'not_inquiry') return { reply: false, reason: 'not-inquiry', detail: verdict.reason }
  return { reply: true }
}
