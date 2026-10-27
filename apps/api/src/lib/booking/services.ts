/**
 * Multi-service booking config (wellness-vertical plan Phase 1; provider-
 * agnostic since the calendar-discovery card, 2026-10-27).
 *
 * `account.agentBookingConfig.services` maps bookable services to their
 * provider-side target: a GHL calendar (`calendarId`, direct-ghl) or a
 * Cliniko appointment type (`cliniko.appointmentTypeId`, direct-cliniko —
 * businessId/practitioner defaults stay at the config root). Absent/invalid
 * config keeps the single-calendar behavior (agentBookingCalendarId)
 * byte-for-byte unchanged.
 *
 * `exclusiveWith` (service keys): this service's slots are additionally
 * filtered against those services' BOOKED events (e.g. a consultation that
 * requires the owner free while any other service runs). GHL-only for now —
 * Cliniko practitioner availability already carries its own conflicts.
 */
import type { Prisma } from '@prisma/client'

export interface BookingService {
  /** Stable slug the model attaches ("hbot"); also the MCP enum value. */
  key: string
  /** Spoken/displayed name ("HBOT Session"). */
  label: string
  /** GHL calendar this service books into (direct-ghl target). */
  calendarId: string
  /** Alternate caller phrasings ("hyperbaric", "oxygen chamber"). */
  synonyms: string[]
  /** Cliniko target (direct-cliniko): appointment type + optional
   *  per-service practitioner override (root practitionerIds otherwise). */
  cliniko?: { appointmentTypeId: string; practitionerIds?: string[] }
  /** Keys of services whose BOOKED times block this service's slots. */
  exclusiveWith?: string[]
  /** Slot length for overlap math (from calendar/appointment-type config). */
  durationMinutes?: number
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
    const clinikoRaw = e.cliniko as Record<string, unknown> | undefined
    const clinikoTypeId =
      clinikoRaw && typeof clinikoRaw.appointmentTypeId === 'string' ? clinikoRaw.appointmentTypeId.trim() : ''
    if (!KEY_RX.test(key) || seen.has(key)) continue
    if (!label || label.length > 60) continue
    // A service needs at least one provider target.
    if ((!calendarId || calendarId.length > 80) && !clinikoTypeId) continue
    const synonyms = Array.isArray(e.synonyms)
      ? e.synonyms
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 40)
          .map((s) => s.trim())
          .slice(0, 10)
      : []
    seen.add(key)
    const svc: BookingService = { key, label, calendarId: calendarId.length <= 80 ? calendarId : '', synonyms }
    if (clinikoTypeId && clinikoTypeId.length <= 40) {
      const pracs = Array.isArray(clinikoRaw?.practitionerIds)
        ? (clinikoRaw!.practitionerIds as unknown[])
            .filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
            .map(String)
            .slice(0, 20)
        : undefined
      svc.cliniko = { appointmentTypeId: clinikoTypeId, ...(pracs?.length ? { practitionerIds: pracs } : {}) }
    }
    if (Array.isArray(e.exclusiveWith)) {
      const ex = e.exclusiveWith
        .filter((k): k is string => typeof k === 'string' && KEY_RX.test(k.trim().toLowerCase()))
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k !== key)
        .slice(0, MAX_SERVICES)
      if (ex.length) svc.exclusiveWith = ex
    }
    const dur = typeof e.durationMinutes === 'number' && e.durationMinutes >= 5 && e.durationMinutes <= 480 ? Math.round(e.durationMinutes) : null
    if (dur) svc.durationMinutes = dur
    out.push(svc)
    if (out.length >= MAX_SERVICES) break
  }
  // exclusiveWith may only reference existing keys.
  const keys = new Set(out.map((s) => s.key))
  for (const s of out) {
    if (s.exclusiveWith) {
      s.exclusiveWith = s.exclusiveWith.filter((k) => keys.has(k))
      if (!s.exclusiveWith.length) delete s.exclusiveWith
    }
  }
  return out.length ? out : null
}

/** Services usable under a given direct mode (right provider target). */
export function servicesForMode(services: BookingService[] | null, mode: string): BookingService[] | null {
  if (!services) return null
  const usable =
    mode === 'direct-ghl'
      ? services.filter((s) => s.calendarId)
      : mode === 'direct-cliniko'
        ? services.filter((s) => s.cliniko?.appointmentTypeId)
        : []
  return usable.length ? usable : null
}

/**
 * Provider context pieces for one service: direct-ghl rides the calendarId;
 * direct-cliniko overlays the service's appointment type (and optional
 * practitioners) onto the root config (businessId etc. stay there).
 */
export function serviceProviderTarget(
  mode: string,
  rootConfig: Prisma.JsonValue | null,
  service: BookingService | null,
  fallbackCalendarId: string | null,
): { config: Prisma.JsonValue | null; calendarId: string | null } {
  if (service && mode === 'direct-cliniko' && service.cliniko) {
    const root = (rootConfig && typeof rootConfig === 'object' && !Array.isArray(rootConfig) ? rootConfig : {}) as Record<string, unknown>
    return {
      config: {
        ...root,
        appointmentTypeId: service.cliniko.appointmentTypeId,
        ...(service.cliniko.practitionerIds?.length ? { practitionerIds: service.cliniko.practitionerIds } : {}),
      } as Prisma.JsonValue,
      calendarId: null,
    }
  }
  return { config: rootConfig, calendarId: service?.calendarId || fallbackCalendarId }
}
