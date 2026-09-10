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

export interface ActionContext {
  /** Slugs of guides that are live AND deliverable for this account. */
  guideSlugs: string[]
  bookingAvailable: boolean
  /** True once this conversation created a GHL contact (callback/capture) —
   * gates the email-afterward patch so it can't fire before a contact exists. */
  hasContact: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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
      const email = str(a.email, 254).toLowerCase()
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

    case 'request_human':
      return { type: 'request_human' }

    case 'send_guide_link': {
      const slug = str(a.slug, 80)
      if (!ctx.guideSlugs.includes(slug)) return null
      const phone = str(a.phone, 30)
      return { type: 'send_guide_link', slug, phone: phone && validPhone(phone) ? phone : null }
    }

    case 'add_contact_email': {
      const email = str(a.email, 254).toLowerCase()
      if (!ctx.hasContact || !EMAIL_RE.test(email)) return null
      return { type: 'add_contact_email', email }
    }

    default:
      return null
  }
}
