/**
 * Strict weekly-hours text parser (places-trust plan Item 4; shared with the
 * Item 2 site-vs-Google comparator).
 *
 * Converts human/Google hours text ("Monday: 8:00 AM – 6:00 PM",
 * "Mon–Fri 8am–6pm", "Sat 9-1", "Sunday: Closed") into the legacy Places
 * `periods` shape so `computeOpenStatus` consumes it unchanged.
 *
 * HIGH-CONFIDENCE ONLY: any line that doesn't parse fails the whole text
 * (returns null) — a partial guess about opening hours is worse than the
 * agent saying "the front desk can confirm". Pure module, unit-tested.
 */
import type { PlacePeriod } from './google/places'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_LOOKUP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

export interface ParsedHours {
  periods: PlacePeriod[]
  /** Monday-first 7 lines ("Monday: 8:00 AM – 6:00 PM" / "Sunday: Closed") for computeOpenStatus's today-line lookup. */
  canonicalWeekdayText: string
  /** Per-day minute ranges (day 0=Sunday), for the site-vs-Google comparator. */
  days: { open: number; close: number }[][]
  /** Days the text explicitly mentioned (day 0=Sunday) — an unmentioned day is unknown, not closed. */
  covered: boolean[]
}

function normalize(text: string): string {
  return text
    .replace(/[   ]/g, ' ') // narrow/no-break spaces (Google weekday_text)
    .replace(/[–—]/g, '-') // en/em dash → hyphen
    .replace(/\bto\b/gi, '-')
}

/** "8", "8:30", "17:00" (+ optional am/pm) → minutes since midnight, or null. */
function parseTime(raw: string, meridiem: string | null): number | null {
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (min > 59) return null
  if (meridiem) {
    if (h < 1 || h > 12) return null
    if (meridiem === 'pm' && h !== 12) h += 12
    if (meridiem === 'am' && h === 12) h = 0
  } else if (h > 24) {
    return null
  }
  return h * 60 + min
}

/** One "8am - 6pm" range → [openMin, closeMin], or null when unparseable. */
function parseRange(raw: string): [number, number] | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?$/i)
  if (!m) return null
  const mer = (s?: string) => (s ? (s.toLowerCase().startsWith('p') ? 'pm' : 'am') : null)
  const closeMer = mer(m[4])
  let openMer = mer(m[2])
  // Unmarked open with a marked close: prefer the same-half-day reading
  // ("5-9pm" → 5 PM), fall back across noon ("9-1pm" → 9 AM).
  if (!openMer && closeMer) {
    const close = parseTime(m[3], closeMer)
    const asSame = parseTime(m[1], closeMer)
    const asOther = parseTime(m[1], closeMer === 'pm' ? 'am' : 'pm')
    if (close == null) return null
    openMer = asSame != null && asSame < close ? closeMer : asOther != null && asOther < close ? (closeMer === 'pm' ? 'am' : 'pm') : null
    if (!openMer) return null
  }
  let open = parseTime(m[1], openMer)
  let close = parseTime(m[3], closeMer)
  if (open == null || close == null) return null
  // No meridiems at all ("9-1", "8-6"): business-day reading — a close at or
  // before the open means afternoon. 24h-format inputs ("08:00-18:00") are
  // already forward and untouched.
  if (!openMer && !closeMer && close <= open && close + 12 * 60 <= 24 * 60) {
    close += 12 * 60
  }
  if (close <= open || close > 24 * 60) return null // overnight/invalid → strict fail
  return [open, close]
}

/** "Mon-Fri", "Monday", "Tuesday:" → list of day indices, or null. */
function parseDaySpec(raw: string): number[] | null {
  const cleaned = raw.trim().toLowerCase().replace(/[.:]+$/, '')
  const range = cleaned.match(/^([a-z]+)\s*-\s*([a-z]+)$/)
  if (range) {
    const from = DAY_LOOKUP[range[1]]
    const to = DAY_LOOKUP[range[2]]
    if (from === undefined || to === undefined) return null
    const days: number[] = []
    for (let d = from; ; d = (d + 1) % 7) {
      days.push(d)
      if (d === to || days.length > 7) break
    }
    return days.length <= 7 ? days : null
  }
  const single = DAY_LOOKUP[cleaned]
  return single === undefined ? null : [single]
}

function fmtMinutes(total: number): string {
  const h24 = Math.floor(total / 60) % 24
  const m = total % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function parseWeekdayText(text: string | null | undefined): ParsedHours | null {
  if (!text?.trim()) return null
  const days: { open: number; close: number }[][] = Array.from({ length: 7 }, () => [])
  const covered = new Set<number>()

  for (const rawLine of normalize(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // Split day-spec from hours: explicit "Day: hours", else first token(s).
    const colonSplit = line.match(/^([^0-9]+?):\s*(.+)$/)
    const spaceSplit = line.match(/^([A-Za-z]+(?:\s*-\s*[A-Za-z]+)?)[\s,]+(.+)$/)
    const [daysRaw, hoursRaw] = colonSplit ? [colonSplit[1], colonSplit[2]] : spaceSplit ? [spaceSplit[1], spaceSplit[2]] : [null, null]
    if (!daysRaw || !hoursRaw) return null
    const dayList = parseDaySpec(daysRaw)
    if (!dayList) return null

    const hoursText = hoursRaw.trim()
    if (/^closed$/i.test(hoursText)) {
      dayList.forEach((d) => covered.add(d))
      continue
    }
    if (/^(open\s*)?24\s*(hours|hrs|\/\s*7)$/i.test(hoursText)) {
      for (const d of dayList) {
        days[d].push({ open: 0, close: 24 * 60 })
        covered.add(d)
      }
      continue
    }
    // Comma/" and "-separated ranges (split shifts).
    const ranges = hoursText.split(/,|\band\b|&/i).map((r) => parseRange(r))
    if (ranges.some((r) => r === null) || ranges.length === 0) return null
    for (const d of dayList) {
      for (const r of ranges) days[d].push({ open: r![0], close: r![1] })
      covered.add(d)
    }
  }

  if (covered.size === 0) return null
  const periods: PlacePeriod[] = []
  for (let d = 0; d < 7; d++) {
    for (const r of days[d]) {
      const pad = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}${String(n % 60).padStart(2, '0')}`
      periods.push({
        open: { day: d, time: pad(r.open) },
        close: { day: r.close === 24 * 60 ? (d + 1) % 7 : d, time: pad(r.close === 24 * 60 ? 0 : r.close) },
      })
    }
  }
  if (!periods.length) return null // every mentioned day closed — can't drive open-now

  const canonicalWeekdayText = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const spans = days[d]
      if (!spans.length) return `${DAY_NAMES[d]}: Closed`
      if (spans.length === 1 && spans[0].open === 0 && spans[0].close === 24 * 60) return `${DAY_NAMES[d]}: Open 24 hours`
      return `${DAY_NAMES[d]}: ${spans.map((s) => `${fmtMinutes(s.open)} – ${fmtMinutes(s.close)}`).join(', ')}`
    })
    .join('\n')

  return { periods, canonicalWeekdayText, days, covered: Array.from({ length: 7 }, (_, d) => covered.has(d)) }
}

/**
 * DST-correct UTC offset (minutes) for an IANA zone at a moment, or null for
 * an unknown zone — settings.socialTimezone is free text, a typo must fall
 * through the chain, not throw.
 */
export function offsetForZone(zone: string | null | undefined, at: Date = new Date()): number | null {
  if (!zone?.trim()) return null
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone.trim(), timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!part) return null
    if (part === 'GMT' || part === 'UTC') return 0
    const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!m) return null
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
  } catch {
    return null
  }
}
