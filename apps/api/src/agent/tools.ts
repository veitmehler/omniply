/**
 * Agent action validation (.plans/chat-agent-v1.implementation-plan.md §2/§4).
 *
 * The model proposes at most one action per turn inside its JSON reply; the
 * SERVER decides whether it runs. Everything here is a whitelist: unknown
 * types, malformed fields, guide slugs that aren't live, or booking links
 * without a booking URL all collapse to null (reply still ships, action
 * doesn't). Pure module — unit-tested.
 */

export type AgentAction =
  | { type: 'send_booking_link'; phone: string | null }
  | { type: 'offer_guide'; slug: string }
  | { type: 'capture_contact'; name: string | null; email: string; phone: string | null; guideSlug: string | null }
  | { type: 'request_callback'; name: string; phone: string; reason: string; preferredTime: string | null }
  | { type: 'add_contact_email'; email: string }
  | { type: 'send_guide_link'; slug: string; phone: string | null }
  | { type: 'request_human' }
  // Voice intake (start-of-call): name + disconnect callback number. INSERT
  // into GHL only (converge/create by phone) — never used to read data back.
  | { type: 'intake_details'; name: string | null; phone: string | null }
  // Direct booking (missed-call sweep Part 4a): slotStart must be one of the
  // EXACT ISO strings the server offered THIS turn — anything else drops.
  | { type: 'book_appointment'; name: string; phone: string; slotStart: string }

export interface ActionContext {
  /** Slugs of guides that are live AND deliverable for this account. */
  guideSlugs: string[]
  bookingAvailable: boolean
  /** True once this conversation created a GHL contact (callback/capture) —
   * gates the email-afterward patch so it can't fire before a contact exists. */
  hasContact: boolean
  /** ISO starts of the booking slots offered this turn ([] → booking off). */
  offeredSlots?: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Spoken-email normalization (voice ASR cleanup, 2026-10-06): lowercase,
 * strip spaces/trailing punctuation, spoken "at"/"dot" fallbacks, and snap
 * near-miss domains onto the closed set of common providers ("gmall.com",
 * "gmai.com" → gmail.com). The local part can't be guessed — that's what
 * the spell-back confirmation in the voice prompt is for.
 */
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'icloud.com', 'protonmail.com', 'proton.me', 'aol.com', 'live.com',
  'me.com', 'msn.com',
]

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

export function normalizeSpokenEmail(raw: string): string {
  let e = raw.trim().toLowerCase().replace(/[.,;:!?]+$/, '')
  if (!e.includes('@')) e = e.replace(/\s+at\s+/g, '@')
  e = e.replace(/\s+dot\s+/g, '.').replace(/\s+/g, '')
  const at = e.lastIndexOf('@')
  if (at > 0) {
    const local = e.slice(0, at)
    const domain = e.slice(at + 1)
    if (!COMMON_DOMAINS.includes(domain)) {
      const near = COMMON_DOMAINS.find((d) => {
        const dist = editDistance(domain, d)
        return dist >= 1 && dist <= 2
      })
      if (near) return `${local}@${near}`
    }
  }
  return e
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function validPhone(v: string): boolean {
  return v.replace(/\D/g, '').length >= 7 && v.length <= 30
}

/** Whitelist-validate a model-proposed action; null on anything off. */
export function validateAction(raw: unknown, ctx: ActionContext): AgentAction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>

  switch (a.type) {
    case 'send_booking_link': {
      if (!ctx.bookingAvailable) return null
      // phone (voice SMS delivery): optional, whitelist-validated like all
      // phone fields; web/DM never set it and nothing downstream requires it.
      const phone = str(a.phone, 30)
      return { type: 'send_booking_link', phone: phone && validPhone(phone) ? phone : null }
    }

    case 'offer_guide': {
      const slug = str(a.slug, 80)
      return ctx.guideSlugs.includes(slug) ? { type: 'offer_guide', slug } : null
    }

    case 'capture_contact': {
      const name = str(a.name, 60)
      const email = normalizeSpokenEmail(str(a.email, 254))
      const phone = str(a.phone, 30)
      const guideSlug = str(a.guideSlug, 80)
      // Email is the only hard requirement: an email-only capture still
      // delivers the guide + drip. Requiring a name silently killed captures
      // where the model never asked for one (name backfills via known-details
      // reconciliation if it appears later in the conversation).
      if (!EMAIL_RE.test(email)) return null
      return {
        type: 'capture_contact',
        name: name || null,
        email,
        phone: phone && validPhone(phone) ? phone : null,
        guideSlug: guideSlug && ctx.guideSlugs.includes(guideSlug) ? guideSlug : null,
      }
    }

    case 'request_callback': {
      const name = str(a.name, 60)
      const phone = str(a.phone, 30)
      const reason = str(a.reason, 200)
      // Caller's words verbatim ("around 10:30 AM") — no date parsing (voice-
      // sms plan §5): it feeds humans and merge fields, not schedulers.
      const preferredTime = str(a.preferredTime, 80)
      if (!name || !validPhone(phone)) return null
      return { type: 'request_callback', name, phone, reason, preferredTime: preferredTime || null }
    }

    case 'book_appointment': {
      const name = str(a.name, 60)
      const phone = str(a.phone, 30)
      const slotStart = str(a.slotStart, 40)
      // Deterministic guard (plan Part 4a): only a slot the server offered
      // THIS turn is bookable — a hallucinated or stale time drops the action
      // (reply ships, booking doesn't, action-dropped flag surfaces it).
      if (!(ctx.offeredSlots ?? []).includes(slotStart)) return null
      if (!name || !validPhone(phone)) return null
      return { type: 'book_appointment', name, phone, slotStart }
    }

    case 'request_human':
      return { type: 'request_human' }

    case 'send_guide_link': {
      const slug = str(a.slug, 80)
      if (!ctx.guideSlugs.includes(slug)) return null
      const phone = str(a.phone, 30)
      return { type: 'send_guide_link', slug, phone: phone && validPhone(phone) ? phone : null }
    }

    case 'add_contact_email': {
      const email = normalizeSpokenEmail(str(a.email, 254))
      if (!ctx.hasContact || !EMAIL_RE.test(email)) return null
      return { type: 'add_contact_email', email }
    }

    case 'intake_details': {
      const name = str(a.name, 60)
      const phone = str(a.phone, 30)
      const validP = phone && validPhone(phone) ? phone : null
      // At least one real detail — an empty intake is noise.
      if (!name && !validP) return null
      return { type: 'intake_details', name: name || null, phone: validP }
    }

    default:
      return null
  }
}
