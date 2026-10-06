/**
 * Open-now computation from Google Places opening_hours (chat-agent plan §1).
 *
 * "Are you open?" is never model-guessed: the server computes the verdict
 * from the place's structured `periods` + `utc_offset` and injects it as a
 * plain fact the model merely phrases. Pure module — no I/O, unit-tested.
 *
 * Legacy Place Details shapes: periods = [{ open: {day, time:'HHMM'},
 * close?: {...} }] with day 0=Sunday; a single period of {day:0, time:'0000'}
 * and no close means open 24/7. weekday_text is Monday-first.
 */
import type { PlacePeriod } from '../lib/google/places'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK_MIN = 7 * 24 * 60

export interface OpenStatus {
  known: boolean
  openNow?: boolean
  /** "Open now — closes at 6:00 PM." / "Closed now — opens Tuesday at 8:00 AM." */
  verdict?: string
  /** The weekday_text line for the clinic-local today, e.g. "Tuesday: 8:00 AM – 6:00 PM". */
  todayLine?: string
  /** Clinic-local time, e.g. "Tuesday 2:15 PM" (grounds the model's phrasing). */
  localTime?: string
}

function toMinutes(day: number, time: string): number {
  return day * 24 * 60 + Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4))
}

function fmtTime(totalMin: number): string {
  const h24 = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function computeOpenStatus(
  periods: PlacePeriod[] | undefined,
  utcOffsetMinutes: number | undefined,
  weekdayText: string | null | undefined,
  nowUtc: Date = new Date(),
): OpenStatus {
  if (!periods?.length || utcOffsetMinutes == null) return { known: false }

  // Clinic-local clock via the UTC accessors on a shifted date.
  const local = new Date(nowUtc.getTime() + utcOffsetMinutes * 60_000)
  const day = local.getUTCDay()
  const nowMin = toMinutes(day, `${String(local.getUTCHours()).padStart(2, '0')}${String(local.getUTCMinutes()).padStart(2, '0')}`)
  // Full date included so "today"/"Thursday" questions never require the
  // model to guess the calendar (negative-availability bug, 2026-10-06).
  const localTime = `${DAY_NAMES[day]}, ${MONTH_NAMES[local.getUTCMonth()]} ${local.getUTCDate()}, ${fmtTime(nowMin % (24 * 60))}`
  // weekday_text is Monday-first; day 0=Sunday sits at index 6.
  const todayLine = weekdayText?.split('\n')[(day + 6) % 7]

  // 24/7: one open with no close.
  if (periods.length === 1 && !periods[0].close && periods[0].open.time === '0000') {
    return { known: true, openNow: true, verdict: 'Open 24 hours.', todayLine, localTime }
  }

  // Normalize to [openMin, closeMin) intervals on the week circle.
  const intervals = periods
    .filter((p) => p.close)
    .map((p) => {
      const openMin = toMinutes(p.open.day, p.open.time)
      let closeMin = toMinutes(p.close!.day, p.close!.time)
      if (closeMin <= openMin) closeMin += WEEK_MIN // overnight / week wrap
      return { openMin, closeMin }
    })
  if (!intervals.length) return { known: false }

  for (const iv of intervals) {
    // Test now and now+1week to cover intervals that wrap past Saturday night.
    for (const t of [nowMin, nowMin + WEEK_MIN]) {
      if (t >= iv.openMin && t < iv.closeMin) {
        return {
          known: true,
          openNow: true,
          verdict: `Open now — closes at ${fmtTime(iv.closeMin % (24 * 60))}.`,
          todayLine,
          localTime,
        }
      }
    }
  }

  // Closed: find the next opening on the week circle.
  let best: { openMin: number; delta: number } | null = null
  for (const iv of intervals) {
    const delta = (iv.openMin - nowMin + WEEK_MIN) % WEEK_MIN
    if (!best || delta < best.delta) best = { openMin: iv.openMin, delta }
  }
  const openDay = Math.floor((best!.openMin % WEEK_MIN) / (24 * 60))
  const dayWord = best!.delta < 24 * 60 && openDay === day ? 'today' : openDay === (day + 1) % 7 ? 'tomorrow' : DAY_NAMES[openDay]
  return {
    known: true,
    openNow: false,
    verdict: `Closed now — opens ${dayWord} at ${fmtTime(best!.openMin % (24 * 60))}.`,
    todayLine,
    localTime,
  }
}
