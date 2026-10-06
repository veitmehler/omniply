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

export interface OfferedSlot {
  /** Exact ISO string from the free-slots endpoint — the book_appointment token. */
  startIso: string
  /** Clinic-local phrasing, e.g. "Tuesday, October 6 at 10:00 AM". */
  label: string
  /** Day heading for grouped prompt rendering, e.g. "Monday, October 5". */
  dayLabel: string
  /** Time-of-day within the group, e.g. "1:30 PM". */
  timeLabel: string
}

export interface BookingInfo {
  /** Tier semantics (PMS framework v2): direct-* may book; advisory-gcal
   *  speaks slots with the canonical disclaimer + link; patterns speaks
   *  general patterns only. 'off' = the link/callback behavior. */
  mode: BookingMode
  /** True when the agent may attach book_appointment (direct + slots). */
  bookable: boolean
  slots: OfferedSlot[]
}

const DISABLED: BookingInfo = { mode: 'off', bookable: false, slots: [] }

// Short cache: a live call makes a turn every few seconds — don't hit the
// free-slots endpoint on each one, but stay fresh enough that a slot taken
// mid-call usually disappears before it's offered again.
const cache = new Map<string, { info: BookingInfo; expires: number }>()
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
export function pickSlots(all: string[], now: Date, timezone: string | null): OfferedSlot[] {
  const perDay = new Map<string, number>()
  const dayOrder: string[] = []
  const out: OfferedSlot[] = []
  for (const iso of all) {
    const t = Date.parse(iso)
    if (Number.isNaN(t) || t - now.getTime() < MIN_LEAD_MS) continue
    const day = iso.slice(0, 10)
    if (!dayOrder.includes(day)) dayOrder.push(day)
    const dayIndex = dayOrder.indexOf(day)
    const seen = perDay.get(day) ?? 0
    perDay.set(day, seen + 1)
    if (dayIndex >= FULL_DETAIL_DAYS) {
      // Later days: thinned (every Nth slot, capped) — enough to negotiate a
      // day change without ballooning the prompt.
      if (seen % LATER_DAY_STRIDE !== 0) continue
      if (out.filter((s) => s.startIso.slice(0, 10) === day).length >= MAX_PER_LATER_DAY) continue
    }
    const p = fmtParts(iso, timezone)
    if (!p) continue
    out.push({ startIso: iso, label: `${p.day} at ${p.time}`, dayLabel: p.day, timeLabel: p.time })
    if (out.length >= MAX_SLOTS) break
  }
  return out
}

export async function bookingInfoFor(accountId: string, ownerUserId: string): Promise<BookingInfo> {
  const hit = cache.get(accountId)
  if (hit && hit.expires > Date.now()) return hit.info

  let info: BookingInfo = DISABLED
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { agentBookingMode: true, agentBookingCalendarId: true, agentBookingConfig: true },
    })
    const mode = normalizeBookingMode(account?.agentBookingMode)
    if (mode === 'patterns') {
      // Tier 3: no slots ever — the engine speaks brand.availabilityPatterns.
      info = { mode, bookable: false, slots: [] }
    } else if (mode !== 'off') {
      // Tier 1 (direct-*) and Tier 2 (advisory-gcal: READ side of the ghl
      // provider against the Google-mirroring calendar; never books).
      const provider = providerFor(isDirectMode(mode) ? mode : 'direct-ghl')
      const settings = await prisma.settings.findUnique({ where: { userId: ownerUserId }, select: { socialTimezone: true } })
      const now = Date.now()
      const all = await provider.freeSlots(
        { accountId, ownerUserId, config: account?.agentBookingConfig ?? null, calendarId: account?.agentBookingCalendarId ?? null },
        now,
        now + WINDOW_DAYS * 24 * 60 * 60 * 1000,
      )
      const slots = pickSlots(all, new Date(now), settings?.socialTimezone ?? null)
      // No slots → the agent must not announce visible times at all:
      // direct degrades to the callback flow, advisory to nothing.
      info = slots.length ? { mode, bookable: isDirectMode(mode), slots } : DISABLED
    }
  } catch (err) {
    logger.warn({ err, accountId }, '[agent] booking slot fetch failed — callback flow holds')
    info = DISABLED
  }

  cache.set(accountId, { info, expires: Date.now() + CACHE_MS })
  if (cache.size > 500) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return info
}

/** Test/ops hook (and post-booking bust so the taken slot vanishes immediately). */
export function clearBookingCacheFor(accountId: string): void {
  cache.delete(accountId)
}
