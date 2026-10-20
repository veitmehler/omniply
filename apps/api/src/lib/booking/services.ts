/**
 * Multi-service booking config (wellness-vertical plan Phase 1).
 *
 * `account.agentBookingConfig.services` maps bookable services to their own
 * GHL calendars — a recovery center books HBOT on one calendar and massage
 * on another. Absent/invalid config keeps the single-calendar behavior
 * (agentBookingCalendarId) byte-for-byte unchanged.
 *
 * direct-ghl only: the calendarId means nothing to the Cliniko/Nookal
 * providers, whose own config shapes live in the same Json column.
 */
import type { Prisma } from '@prisma/client'

export interface BookingService {
  /** Stable slug the model attaches ("hbot"); also the MCP enum value. */
  key: string
  /** Spoken/displayed name ("HBOT Session"). */
  label: string
  /** GHL calendar this service books into. */
  calendarId: string
  /** Alternate caller phrasings ("hyperbaric", "oxygen chamber"). */
  synonyms: string[]
}

const KEY_RX = /^[a-z0-9][a-z0-9_-]{0,39}$/
const MAX_SERVICES = 12

export function parseBookingServices(config: Prisma.JsonValue | null | undefined): BookingService[] | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const raw = (config as Record<string, unknown>).services
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const out: BookingService[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const key = typeof e.key === 'string' ? e.key.trim().toLowerCase() : ''
    const label = typeof e.label === 'string' ? e.label.trim() : ''
    const calendarId = typeof e.calendarId === 'string' ? e.calendarId.trim() : ''
    if (!KEY_RX.test(key) || seen.has(key)) continue
    if (!label || label.length > 60 || !calendarId || calendarId.length > 80) continue
    const synonyms = Array.isArray(e.synonyms)
      ? e.synonyms
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 40)
          .map((s) => s.trim())
          .slice(0, 10)
      : []
    seen.add(key)
    out.push({ key, label, calendarId, synonyms })
    if (out.length >= MAX_SERVICES) break
  }
  return out.length ? out : null
}
