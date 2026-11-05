/**
 * Voice-agent direct booking (missed-call sweep Part 4a).
 *
 * Per-turn slot offering: the SERVER fetches real free slots from the
 * account's GHL booking calendar and injects them as plain facts — the model
 * never invents times, and the validator rejects any book_appointment whose
 * slotStart wasn't in the list offered that turn. Accounts without
 * agentBookingCalendarId keep the callback-only behavior unchanged.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { providerFor, isDirectMode, normalizeBookingMode, type BookingMode } from '../lib/booking'
import { parseBookingServices, servicesForMode, serviceProviderTarget, type BookingService } from '../lib/booking/services'
import { getGhlCalendarConfig, type GhlCalendarConfig } from '../lib/ghl/client'

export interface OfferedSlot {
  /** Exact ISO string from the free-slots endpoint — the book_appointment token. */
  startIso: string
  /** Clinic-local phrasing, e.g. "Tuesday, October 6 at 10:00 AM". */
  label: string
  /** Day heading for grouped prompt rendering, e.g. "Monday, October 5". */
  dayLabel: string
  /** Clinic-local relative marker for the group header (date-mapping done
   *  server-side so the model never derives which day "today" is). */
  relative: 'TODAY' | 'TOMORROW' | null
  /** Time-of-day within the group, e.g. "1:30 PM". */
  timeLabel: string
  /** True when this slot's day was THINNED (sample, not the full inventory).
   *  The prompt marks such day groups PARTIAL so the model never presents a
   *  sample's last time as "the latest availability" (Whealth 2026-11-05). */
  sampled: boolean
}

export interface ServiceSlots {
  key: string
  label: string
  slots: OfferedSlot[]
  /** Authoritative "how late does this run" lines computed from the
   *  calendar's configured open hours (never from the slot sample):
   *  "…open until 3:00 PM; the last appointment starts at 2:00 PM". */
  windowLines?: string[]
}

/** Visitor asked about a specific service on a specific day: that day's full
 *  inventory is fetched for that calendar and replaces the thinned sample. */
export interface BookingFocus {
  serviceKeys: string[]
  /** Clinic-local calendar date, YYYY-MM-DD. */
  dayIso: string
}

export interface BookingInfo {
  /** Tier semantics (PMS framework v2): direct-* may book; advisory-gcal
   *  speaks slots with the canonical disclaimer + link; patterns speaks
   *  general patterns only. 'off' = the link/callback behavior. */
  mode: BookingMode
  /** True when the agent may attach book_appointment (direct + slots). */
  bookable: boolean
  /** Flattened inventory (single calendar, or the union across services). */
  slots: OfferedSlot[]
  /** Multi-service accounts (direct-ghl + agentBookingConfig.services):
   *  per-service inventory — a slot books ONLY on its own service's
   *  calendar. null = classic single-calendar account. Services whose
   *  calendar returned no offerable slots are omitted (absence-is-
   *  unavailable, same rule the day groups follow). */
  services: ServiceSlots[] | null
}

const DISABLED: BookingInfo = { mode: 'off', bookable: false, slots: [], services: null }

// Short cache: a live call makes a turn every few seconds — don't hit the
// free-slots endpoint on each one, but stay fresh enough that a slot taken
// mid-call usually disappears before it's offered again. rawByService keeps
// each calendar's FULL slot list (pickSlots discards most of it) so a
// focused day can be expanded from cache with zero extra API calls.
const cache = new Map<string, { info: BookingInfo; rawByService: Map<string, string[]> | null; timezone: string | null; expires: number }>()
const CACHE_MS = 60 * 1000

/** Earliest offerable slot: not within the next 2 hours (no ambush bookings). */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000
const WINDOW_DAYS = 7
/**
 * Inventory sizing (reworked 2026-10-05 after the first real caller
 * negotiated: v1's 2-per-day teaser hid genuinely free afternoon slots and
 * the agent could only repeat itself or take a callback). The model now sees
 * the REAL near-term inventory: every slot on the first two bookable days,
 * every second slot further out, capped overall. The exact-ISO validator
 * still makes invented times impossible.
 */
const MAX_SLOTS = 48
const FULL_DETAIL_DAYS = 2
const LATER_DAY_STRIDE = 2
const MAX_PER_LATER_DAY = 8

export interface SlotCaps {
  maxSlots: number
  fullDetailDays: number
  laterDayStride: number
  maxPerLaterDay: number
}

/** Multi-service accounts split the prompt budget across calendars: tighter
 *  per-service caps keep 6 services' inventory near one calendar's size. */
const SERVICE_CAPS: SlotCaps = { maxSlots: 14, fullDetailDays: 1, laterDayStride: 2, maxPerLaterDay: 4 }

function fmtParts(startIso: string, timezone: string | null): { day: string; time: string } | null {
  const d = new Date(startIso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...(timezone ? { timeZone: timezone } : {}), ...opts }).format(d)
    return {
      day: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
      time: fmt({ hour: 'numeric', minute: '2-digit' }),
    }
  } catch {
    return null
  }
}

export function labelForSlot(startIso: string, timezone: string | null): string {
  const p = fmtParts(startIso, timezone)
  return p ? `${p.day} at ${p.time}` : startIso
}

/** Pure slot selection: sorted ISO list → the inventory the model may offer. */
export function pickSlots(all: string[], now: Date, timezone: string | null, caps?: SlotCaps): OfferedSlot[] {
  const maxSlots = caps?.maxSlots ?? MAX_SLOTS
  const fullDetailDays = caps?.fullDetailDays ?? FULL_DETAIL_DAYS
  const laterDayStride = caps?.laterDayStride ?? LATER_DAY_STRIDE
  const maxPerLaterDay = caps?.maxPerLaterDay ?? MAX_PER_LATER_DAY
  const perDay = new Map<string, number>()
  const dayOrder: string[] = []
  const out: OfferedSlot[] = []
  const todayLabel = fmtParts(now.toISOString(), timezone)?.day ?? null
  const tomorrowLabel = fmtParts(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), timezone)?.day ?? null
  for (const iso of all) {
    const t = Date.parse(iso)
    if (Number.isNaN(t) || t - now.getTime() < MIN_LEAD_MS) continue
    const day = iso.slice(0, 10)
    if (!dayOrder.includes(day)) dayOrder.push(day)
    const dayIndex = dayOrder.indexOf(day)
    const seen = perDay.get(day) ?? 0
    perDay.set(day, seen + 1)
    if (dayIndex >= fullDetailDays) {
      // Later days: thinned (every Nth slot, capped) — enough to negotiate a
      // day change without ballooning the prompt.
      if (seen % laterDayStride !== 0) continue
      if (out.filter((s) => s.startIso.slice(0, 10) === day).length >= maxPerLaterDay) continue
    }
    const p = fmtParts(iso, timezone)
    if (!p) continue
    out.push({
      startIso: iso,
      label: `${p.day} at ${p.time}`,
      dayLabel: p.day,
      timeLabel: p.time,
      relative: p.day === todayLabel ? 'TODAY' : p.day === tomorrowLabel ? 'TOMORROW' : null,
      sampled: dayIndex >= fullDetailDays,
    })
    if (out.length >= maxSlots) break
  }
  return out
}

/** Clinic-local YYYY-MM-DD of an instant. */
export function localDayIso(iso: string | number | Date, timezone: string | null): string | null {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat('en-CA', { ...(timezone ? { timeZone: timezone } : {}), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return null
  }
}

// ── Focus parsing (service + day in the visitor's own words) ───────────────
const DAY_WORDS: Array<{ rx: RegExp; kind: 'today' | 'tomorrow' | number }> = [
  { rx: /\b(today|tonight|this (morning|afternoon|evening)|hoy|esta (tarde|noche|mañana))\b/i, kind: 'today' },
  { rx: /\b(tomorrow|tmrw|tmr|mañana|manana)\b/i, kind: 'tomorrow' },
  { rx: /\b(sunday|domingo)\b/i, kind: 0 },
  { rx: /\b(monday|lunes)\b/i, kind: 1 },
  { rx: /\b(tuesday|martes)\b/i, kind: 2 },
  { rx: /\b(wednesday|mi[eé]rcoles)\b/i, kind: 3 },
  { rx: /\b(thursday|jueves)\b/i, kind: 4 },
  { rx: /\b(friday|viernes)\b/i, kind: 5 },
  { rx: /\b(saturday|s[aá]bado)\b/i, kind: 6 },
]

/** The visitor named a service AND a day in one message → fetch that day in
 *  full for that calendar. Pure; exported for tests. "mañana" alone is
 *  ambiguous in Spanish (tomorrow/morning) — the today-pattern claims
 *  "esta mañana", the bare word means tomorrow, matching booking usage. */
export function parseBookingFocus(
  message: string,
  services: Pick<BookingService, 'key' | 'label' | 'synonyms'>[],
  timezone: string | null,
  now: Date = new Date(),
): BookingFocus | null {
  const text = message.toLowerCase()
  const matched: string[] = []
  for (const svc of services) {
    const needles = [svc.key.replace(/[_-]/g, ' '), svc.label, ...(svc.synonyms ?? [])]
      .map((n) => (n ?? '').toLowerCase().trim())
      .filter((n) => n.length >= 3)
    if (needles.some((n) => text.includes(n))) {
      matched.push(svc.key)
      if (matched.length >= 2) break
    }
  }
  if (!matched.length) return null
  let offsetDays: number | null = null
  for (const w of DAY_WORDS) {
    if (!w.rx.test(message)) continue
    if (w.kind === 'today') { offsetDays = 0; break }
    if (w.kind === 'tomorrow') { offsetDays = 1; break }
    const todayShort = new Intl.DateTimeFormat('en-US', { ...(timezone ? { timeZone: timezone } : {}), weekday: 'short' }).format(now)
    const todayDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(todayShort)
    if (todayDow < 0) break
    offsetDays = ((w.kind as number) - todayDow + 7) % 7
    break
  }
  if (offsetDays === null) return null
  const dayIso = localDayIso(now.getTime() + offsetDays * 24 * 60 * 60 * 1000, timezone)
  return dayIso ? { serviceKeys: matched, dayIso } : null
}

// ── Service-hours lines (authoritative "how late" answers) ─────────────────
const calendarCfgCache = new Map<string, { cfg: GhlCalendarConfig | null; expires: number }>()
const CAL_CFG_MS = 10 * 60 * 1000

async function calendarConfigFor(apiKey: string, calendarId: string): Promise<GhlCalendarConfig | null> {
  const hit = calendarCfgCache.get(calendarId)
  if (hit && hit.expires > Date.now()) return hit.cfg
  const cfg = await getGhlCalendarConfig(apiKey, calendarId)
  calendarCfgCache.set(calendarId, { cfg, expires: Date.now() + CAL_CFG_MS })
  return cfg
}

function fmtWall(h: number, m: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

/** "…open until C; the last appointment starts at C − duration" for one
 *  clinic-local date. Pure; exported for tests. Null when the calendar has
 *  no hours that weekday. */
export function windowLineFor(
  label: string,
  cfg: GhlCalendarConfig,
  durationMinutes: number,
  dayIso: string,
  dayName: string,
): string | null {
  const dow = new Date(`${dayIso}T12:00:00Z`).getUTCDay()
  const blocks = cfg.openHours.filter((b) => (b.daysOfTheWeek ?? []).includes(dow)).flatMap((b) => b.hours ?? [])
  if (!blocks.length) return null
  const open = blocks.reduce((a, b) => (b.openHour * 60 + b.openMinute < a.openHour * 60 + a.openMinute ? b : a))
  const close = blocks.reduce((a, b) => (b.closeHour * 60 + b.closeMinute > a.closeHour * 60 + a.closeMinute ? b : a))
  const closeMin = close.closeHour * 60 + close.closeMinute
  const lastStart = closeMin - durationMinutes
  if (lastStart < open.openHour * 60 + open.openMinute) return null
  return `${label} — ${dayName}: ${fmtWall(open.openHour, open.openMinute)} to ${fmtWall(close.closeHour, close.closeMinute)}; the last appointment starts at ${fmtWall(Math.floor(lastStart / 60), lastStart % 60)}.`
}

/** Busy-interval filter for exclusiveWith services: a slot survives only if
 *  [start, start+duration) overlaps no booked (non-cancelled) event on the
 *  excluded services' calendars. Event-fetch failures fail OPEN (slots kept)
 *  — GHL's own same-staff blocking remains the first line of defense. */
async function applyExclusiveWithFilter(
  ownerUserId: string,
  services: BookingService[],
  fetched: ServiceSlots[],
  startMs: number,
  endMs: number,
): Promise<void> {
  const { getGhlCredentials } = await import('../lib/ghl/settings')
  const { listGhlCalendarEvents } = await import('../lib/ghl/client')
  const creds = await getGhlCredentials(ownerUserId)
  if (!creds) return
  const byKey = new Map(services.map((s) => [s.key, s]))
  const busyByCalendar = new Map<string, { start: number; end: number }[]>()
  for (const svc of services) {
    if (!svc.exclusiveWith?.length) continue
    const mine = fetched.find((f) => f.key === svc.key)
    if (!mine || !mine.slots.length) continue
    const busy: { start: number; end: number }[] = []
    for (const exKey of svc.exclusiveWith) {
      const exCal = byKey.get(exKey)?.calendarId
      if (!exCal) continue
      if (!busyByCalendar.has(exCal)) {
        try {
          const events = await listGhlCalendarEvents(creds.apiKey, creds.locationId, exCal, startMs, endMs)
          busyByCalendar.set(
            exCal,
            events
              .filter((e) => e.appointmentStatus !== 'cancelled')
              .map((e) => ({ start: Date.parse(e.startTime), end: Date.parse(e.endTime) }))
              .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end)),
          )
        } catch (err) {
          logger.warn({ err, calendarId: exCal }, '[agent] exclusiveWith event fetch failed — filter skipped for this calendar')
          busyByCalendar.set(exCal, [])
        }
      }
      busy.push(...(busyByCalendar.get(exCal) ?? []))
    }
    if (!busy.length) continue
    const durMs = (svc.durationMinutes ?? 60) * 60 * 1000
    mine.slots = mine.slots.filter((slot) => {
      const s = Date.parse(slot.startIso)
      if (!Number.isFinite(s)) return true
      const e = s + durMs
      return !busy.some((iv) => s < iv.end && e > iv.start)
    })
  }
}

/** Full-detail expansion of one clinic-local day from a raw slot list. */
function expandDay(all: string[], dayIso: string, now: Date, timezone: string | null): OfferedSlot[] {
  const todayLabel = fmtParts(now.toISOString(), timezone)?.day ?? null
  const tomorrowLabel = fmtParts(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), timezone)?.day ?? null
  const out: OfferedSlot[] = []
  for (const iso of all) {
    const t = Date.parse(iso)
    if (Number.isNaN(t) || t - now.getTime() < MIN_LEAD_MS) continue
    if (localDayIso(iso, timezone) !== dayIso) continue
    const p = fmtParts(iso, timezone)
    if (!p) continue
    out.push({
      startIso: iso,
      label: `${p.day} at ${p.time}`,
      dayLabel: p.day,
      timeLabel: p.time,
      relative: p.day === todayLabel ? 'TODAY' : p.day === tomorrowLabel ? 'TOMORROW' : null,
      sampled: false,
    })
    if (out.length >= 16) break
  }
  return out
}

/** Merge a focused day's full inventory into (a clone of) the cached info and
 *  attach authoritative service-hours lines. Never mutates the cached base. */
async function applyFocus(
  base: BookingInfo,
  rawByService: Map<string, string[]>,
  focus: BookingFocus,
  ownerUserId: string,
  timezone: string | null,
  servicesCfg: BookingService[],
): Promise<BookingInfo> {
  if (!base.services) return base
  const now = new Date()
  const services = base.services.map((s) => ({ ...s, slots: [...s.slots] }))
  for (const key of focus.serviceKeys) {
    const raw = rawByService.get(key)
    if (!raw) continue
    // exclusiveWith services (e.g. consultations) have their raw lists
    // busy-filtered AFTER fetch — expanding from raw would re-offer blocked
    // times, so those keep the sampled view (hours lines still attach).
    if (servicesCfg.find((s) => s.key === key)?.exclusiveWith?.length) continue
    const full = expandDay(raw, focus.dayIso, now, timezone)
    const idx = services.findIndex((s) => s.key === key)
    if (idx >= 0) {
      const dayLabel = full[0]?.dayLabel ?? null
      const kept = dayLabel === null
        ? services[idx].slots.filter((sl) => localDayIso(sl.startIso, timezone) !== focus.dayIso)
        : services[idx].slots.filter((sl) => sl.dayLabel !== dayLabel)
      services[idx] = { ...services[idx], slots: [...kept, ...full].sort((a, b) => a.startIso.localeCompare(b.startIso)) }
    } else if (full.length) {
      const cfg = servicesCfg.find((s) => s.key === key)
      services.push({ key, label: cfg?.label ?? key, slots: full })
    }
  }
  // Service-hours lines (today + the focused day) for the focused services.
  try {
    const { getGhlCredentials } = await import('../lib/ghl/settings')
    const creds = await getGhlCredentials(ownerUserId)
    if (creds) {
      const todayIso = localDayIso(now, timezone)
      const days = [...new Set([todayIso, focus.dayIso].filter(Boolean))] as string[]
      for (const key of focus.serviceKeys) {
        const svcCfg = servicesCfg.find((s) => s.key === key)
        const svc = services.find((s) => s.key === key)
        if (!svcCfg?.calendarId || !svc) continue
        const cal = await calendarConfigFor(creds.apiKey, svcCfg.calendarId)
        if (!cal) continue
        const dur = svcCfg.durationMinutes ?? cal.slotDurationMinutes ?? 60
        const lines = days
          .map((d) => {
            const dayName = fmtParts(`${d}T12:00:00Z`, timezone)?.day ?? d
            return windowLineFor(svc.label, cal, dur, d, dayName)
          })
          .filter((l): l is string => Boolean(l))
        if (lines.length) svc.windowLines = lines
      }
    }
  } catch (err) {
    logger.warn({ err }, '[agent] service-hours lines skipped')
  }
  const withSlots = services.filter((s) => s.slots.length > 0 || (s.windowLines?.length ?? 0) > 0)
  return { ...base, services: withSlots, slots: withSlots.flatMap((s) => s.slots) }
}

export async function bookingInfoFor(accountId: string, ownerUserId: string, visitorMessage?: string): Promise<BookingInfo> {
  const hit = cache.get(accountId)
  if (hit && hit.expires > Date.now()) {
    if (visitorMessage && hit.rawByService && hit.info.services) {
      try {
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { agentBookingMode: true, agentBookingConfig: true } })
        const servicesCfg = servicesForMode(parseBookingServices(account?.agentBookingConfig), normalizeBookingMode(account?.agentBookingMode)) ?? []
        const focus = parseBookingFocus(visitorMessage, servicesCfg, hit.timezone)
        if (focus) return await applyFocus(hit.info, hit.rawByService, focus, ownerUserId, hit.timezone, servicesCfg)
      } catch (err) {
        logger.warn({ err, accountId }, '[agent] focus expansion failed — base inventory holds')
      }
    }
    return hit.info
  }

  let info: BookingInfo = DISABLED
  let rawByService: Map<string, string[]> | null = null
  let cachedTimezone: string | null = null
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { agentBookingMode: true, agentBookingCalendarId: true, agentBookingConfig: true },
    })
    const mode = normalizeBookingMode(account?.agentBookingMode)
    if (mode === 'patterns') {
      // Tier 3: no slots ever — the engine speaks brand.availabilityPatterns.
      info = { mode, bookable: false, slots: [], services: null }
    } else if (mode !== 'off') {
      // Tier 1 (direct-*) and Tier 2 (advisory-gcal: READ side of the ghl
      // provider against the Google-mirroring calendar; never books).
      const provider = providerFor(isDirectMode(mode) ? mode : 'direct-ghl')
      const settings = await prisma.settings.findUnique({ where: { userId: ownerUserId }, select: { socialTimezone: true } })
      const timezone = settings?.socialTimezone ?? null
      const now = Date.now()
      const windowEnd = now + WINDOW_DAYS * 24 * 60 * 60 * 1000
      const services = isDirectMode(mode)
        ? servicesForMode(parseBookingServices(account?.agentBookingConfig), mode)
        : null
      if (services) {
        // Multi-service: one inventory per service target (GHL calendar or
        // Cliniko appointment type). A single target failing must not blank
        // the other services' times.
        cachedTimezone = timezone
        rawByService = new Map<string, string[]>()
        const fetched = await Promise.all(
          services.map(async (svc: BookingService): Promise<ServiceSlots> => {
            try {
              const target = serviceProviderTarget(mode, account?.agentBookingConfig ?? null, svc, null)
              const all = await provider.freeSlots(
                { accountId, ownerUserId, config: target.config, calendarId: target.calendarId },
                now,
                windowEnd,
              )
              rawByService!.set(svc.key, all)
              return { key: svc.key, label: svc.label, slots: pickSlots(all, new Date(now), timezone, SERVICE_CAPS) }
            } catch (err) {
              logger.warn({ err, accountId, service: svc.key }, '[agent] service slot fetch failed — service omitted this turn')
              return { key: svc.key, label: svc.label, slots: [] }
            }
          }),
        )
        // exclusiveWith (GHL only): subtract BOOKED events of the listed
        // services' calendars from this service's offered slots (e.g. a
        // consultation that needs the owner free while anything else runs).
        if (mode === 'direct-ghl' && services.some((s) => s.exclusiveWith?.length)) {
          await applyExclusiveWithFilter(ownerUserId, services, fetched, now, windowEnd)
        }
        const withSlots = fetched.filter((s) => s.slots.length > 0)
        info = withSlots.length
          ? { mode, bookable: true, slots: withSlots.flatMap((s) => s.slots), services: withSlots }
          : DISABLED
      } else {
        const all = await provider.freeSlots(
          { accountId, ownerUserId, config: account?.agentBookingConfig ?? null, calendarId: account?.agentBookingCalendarId ?? null },
          now,
          windowEnd,
        )
        const slots = pickSlots(all, new Date(now), timezone)
        // No slots → the agent must not announce visible times at all:
        // direct degrades to the callback flow, advisory to nothing.
        info = slots.length ? { mode, bookable: isDirectMode(mode), slots, services: null } : DISABLED
      }
    }
  } catch (err) {
    logger.warn({ err, accountId }, '[agent] booking slot fetch failed — callback flow holds')
    info = DISABLED
  }

  cache.set(accountId, { info, rawByService, timezone: cachedTimezone, expires: Date.now() + CACHE_MS })
  if (cache.size > 500) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  if (visitorMessage && rawByService && info.services) {
    try {
      const account = await prisma.account.findUnique({ where: { id: accountId }, select: { agentBookingMode: true, agentBookingConfig: true } })
      const servicesCfg = servicesForMode(parseBookingServices(account?.agentBookingConfig), normalizeBookingMode(account?.agentBookingMode)) ?? []
      const focus = parseBookingFocus(visitorMessage, servicesCfg, cachedTimezone)
      if (focus) return await applyFocus(info, rawByService, focus, ownerUserId, cachedTimezone, servicesCfg)
    } catch (err) {
      logger.warn({ err, accountId }, '[agent] focus expansion failed — base inventory holds')
    }
  }
  return info
}

/** Test/ops hook (and post-booking bust so the taken slot vanishes immediately). */
export function clearBookingCacheFor(accountId: string): void {
  cache.delete(accountId)
}
