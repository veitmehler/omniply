/**
 * Website-vs-Google cross-check (places-trust plan Item 2).
 *
 * Pure comparator: facts extracted from the clinic's own website vs the
 * trusted Places probe. Warn-only by design (user decision 2026-10-02) —
 * output feeds informational panels (kb_review card, Settings) and an admin
 * ErrorLog row, never a gate. Null/absent site facts never warn.
 */
import type { PlaceProbe } from './google/places'
import { parseWeekdayText } from './hours-parse'

export interface SiteFacts {
  /** Hours as printed on the site, normalized to one weekly block of text lines. */
  hoursText: string | null
  phones: string[]
  streetAddress: string | null
  confidence: 'high' | 'low'
}

export interface FactDiscrepancy {
  field: 'hours' | 'phone' | 'address'
  website: string
  google: string
  note: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Last 9–10 digits — country-prefix and formatting agnostic. */
function phoneTail(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-9) : null
}

function describeDay(spans: { open: number; close: number }[]): string {
  if (!spans.length) return 'closed'
  const fmt = (n: number) => {
    const h24 = Math.floor(n / 60) % 24
    const ampm = h24 >= 12 ? 'PM' : 'AM'
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    const m = n % 60
    return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  return spans.map((s) => `${fmt(s.open)} – ${fmt(s.close)}`).join(', ')
}

export function compareSiteToGoogle(site: SiteFacts | null, probe: PlaceProbe | null): FactDiscrepancy[] {
  if (!site || site.confidence !== 'high' || !probe) return []
  const out: FactDiscrepancy[] = []

  // Hours: both sides through the same strict parser; unparseable → silent.
  const siteHours = parseWeekdayText(site.hoursText)
  const googleHours = parseWeekdayText(probe.openingHours)
  if (siteHours && googleHours) {
    for (let d = 0; d < 7; d++) {
      // A day the site never mentions is unknown, not closed — only Google's
      // weekday_text always covers all seven.
      if (!siteHours.covered[d]) continue
      const s = siteHours.days[d]
      const g = googleHours.days[d]
      const closedDisagree = (s.length === 0) !== (g.length === 0)
      const boundaryDiff =
        s.length > 0 &&
        g.length > 0 &&
        (Math.abs(s[0].open - g[0].open) >= 30 || Math.abs(s[s.length - 1].close - g[g.length - 1].close) >= 30)
      if (closedDisagree || boundaryDiff) {
        out.push({
          field: 'hours',
          website: `${DAY_NAMES[d]}: ${describeDay(s)}`,
          google: `${DAY_NAMES[d]}: ${describeDay(g)}`,
          note: `Your website says ${DAY_NAMES[d]} ${describeDay(s)}, but your Google listing says ${describeDay(g)}. Patients see the Google version.`,
        })
      }
    }
  }

  // Phone: any site phone matching the listing = agreement (sites list several lines).
  const googleTail = probe.formattedPhone ? phoneTail(probe.formattedPhone) : null
  const siteTails = site.phones.map(phoneTail).filter((t): t is string => t !== null)
  if (googleTail && siteTails.length && !siteTails.includes(googleTail)) {
    out.push({
      field: 'phone',
      website: site.phones.join(' / '),
      google: probe.formattedPhone!,
      note: `Your website lists ${site.phones.join(' / ')}, but your Google listing shows ${probe.formattedPhone}.`,
    })
  }

  // Address: flag only a differing street number, or zero street-name token
  // overlap — suite/formatting noise must not warn.
  if (site.streetAddress && probe.formattedAddress) {
    const tokens = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !/^(suite|ste|unit|floor|level)$/.test(w))
    const num = (s: string) => s.match(/\d{1,6}/)?.[0] ?? null
    const siteNum = num(site.streetAddress)
    const googleNum = num(probe.formattedAddress)
    const numDiffers = Boolean(siteNum && googleNum && siteNum !== googleNum)
    const siteTokens = tokens(site.streetAddress)
    const googleTokens = new Set(tokens(probe.formattedAddress))
    const noOverlap = siteTokens.length > 0 && googleTokens.size > 0 && !siteTokens.some((t) => googleTokens.has(t))
    if (numDiffers || noOverlap) {
      out.push({
        field: 'address',
        website: site.streetAddress,
        google: probe.formattedAddress,
        note: `Your website shows "${site.streetAddress}", but your Google listing shows "${probe.formattedAddress}".`,
      })
    }
  }

  return out
}
