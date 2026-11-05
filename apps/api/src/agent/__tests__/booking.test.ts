import { describe, it, expect } from 'vitest'
import { pickSlots, labelForSlot, parseBookingFocus, windowLineFor, localDayIso } from '../booking'

describe('parseBookingFocus', () => {
  const services = [
    { key: 'hbot', label: 'HBOT Session', synonyms: ['hyperbaric', 'oxygen chamber'] },
    { key: 'acupuncture', label: 'Acupuncture', synonyms: ['acupuntura'] },
  ]
  const now = new Date('2026-11-05T15:00:00Z') // Thursday

  it('matches service + weekday to the next occurrence in clinic tz', () => {
    const f = parseBookingFocus('do you have HBOT on friday?', services, 'America/Santo_Domingo', now)
    expect(f).toEqual({ serviceKeys: ['hbot'], dayIso: '2026-11-06' })
  })

  it('matches synonyms, Spanish days, today and tomorrow', () => {
    expect(parseBookingFocus('oxygen chamber tomorrow pls', services, 'America/Santo_Domingo', now)?.dayIso).toBe('2026-11-06')
    expect(parseBookingFocus('acupuntura el sábado', services, 'America/Santo_Domingo', now)?.dayIso).toBe('2026-11-07')
    expect(parseBookingFocus('hbot today', services, 'America/Santo_Domingo', now)?.dayIso).toBe('2026-11-05')
  })

  it('needs BOTH a service and a day', () => {
    expect(parseBookingFocus('do you have anything on friday?', services, null, now)).toBeNull()
    expect(parseBookingFocus('tell me about HBOT', services, null, now)).toBeNull()
  })

  it('same weekday as today means today, and two services both match', () => {
    expect(parseBookingFocus('hbot thursday', services, 'America/Santo_Domingo', now)?.dayIso).toBe('2026-11-05')
    const f = parseBookingFocus('hbot or acupuncture on saturday?', services, 'America/Santo_Domingo', now)
    expect(f?.serviceKeys.sort()).toEqual(['acupuncture', 'hbot'])
  })
})

describe('windowLineFor', () => {
  const cfg = {
    openHours: [
      { daysOfTheWeek: [1, 2, 3, 4, 5], hours: [{ openHour: 10, openMinute: 0, closeHour: 18, closeMinute: 0 }] },
      { daysOfTheWeek: [6], hours: [{ openHour: 10, openMinute: 0, closeHour: 15, closeMinute: 0 }] },
    ],
    slotDurationMinutes: 60,
  }

  it('states close AND last start (Saturday acupuncture: until 3, last start 2)', () => {
    const line = windowLineFor('Acupuncture', cfg, 60, '2026-11-07', 'Saturday, November 7')
    expect(line).toBe('Acupuncture — Saturday, November 7: 10:00 AM to 3:00 PM; the last appointment starts at 2:00 PM.')
  })

  it('weekday window with a non-hour duration', () => {
    const line = windowLineFor('PEMF', cfg, 30, '2026-11-06', 'Friday, November 6')
    expect(line).toContain('to 6:00 PM; the last appointment starts at 5:30 PM.')
  })

  it('null on a closed day', () => {
    expect(windowLineFor('Acupuncture', cfg, 60, '2026-11-08', 'Sunday, November 8')).toBeNull()
  })
})

describe('localDayIso', () => {
  it('maps a UTC instant to the clinic-local date', () => {
    expect(localDayIso('2026-11-06T03:30:00Z', 'America/Santo_Domingo')).toBe('2026-11-05')
  })
})

const TZ = 'America/Phoenix'
const NOW = new Date('2026-10-05T16:00:00Z') // Monday 9:00 AM Phoenix

function halfHourDay(date: string, fromHour: number, toHour: number): string[] {
  const out: string[] = []
  for (let h = fromHour; h < toHour; h++) {
    out.push(`${date}T${String(h).padStart(2, '0')}:00:00-07:00`)
    out.push(`${date}T${String(h).padStart(2, '0')}:30:00-07:00`)
  }
  return out
}

describe('pickSlots', () => {
  it('applies the 2h lead time and keeps FULL detail on the first two days', () => {
    const all = [...halfHourDay('2026-10-05', 8, 18), ...halfHourDay('2026-10-06', 8, 18)]
    const out = pickSlots(all, NOW, TZ)
    const monday = out.filter((s) => s.startIso.startsWith('2026-10-05'))
    const tuesday = out.filter((s) => s.startIso.startsWith('2026-10-06'))
    // Monday: nothing before 11:00 (9:00 + 2h lead) — 11:00..17:30 = 14 slots.
    expect(monday[0].startIso).toBe('2026-10-05T11:00:00-07:00')
    expect(monday).toHaveLength(14)
    // Tuesday (second bookable day): every slot survives.
    expect(tuesday).toHaveLength(20)
    // The negotiation case that burned us: a free 4:30 PM today IS offered.
    expect(monday.some((s) => s.timeLabel === '4:30 PM')).toBe(true)
  })

  it('thins later days and respects the overall cap', () => {
    const all = [
      ...halfHourDay('2026-10-05', 8, 18),
      ...halfHourDay('2026-10-06', 8, 18),
      ...halfHourDay('2026-10-07', 8, 18),
      ...halfHourDay('2026-10-08', 8, 18),
    ]
    const out = pickSlots(all, NOW, TZ)
    expect(out.length).toBeLessThanOrEqual(48)
    const wednesday = out.filter((s) => s.startIso.startsWith('2026-10-07'))
    // Day 3+: every 2nd slot, capped at 8.
    expect(wednesday.length).toBeLessThanOrEqual(8)
    expect(wednesday.length).toBeGreaterThan(0)
  })

  it('carries day/time labels + server-computed TODAY/TOMORROW markers', () => {
    const out = pickSlots(['2026-10-05T13:00:00-07:00', '2026-10-06T10:00:00-07:00', '2026-10-08T10:00:00-07:00'], NOW, TZ)
    expect(out[0].relative).toBe('TODAY') // Monday, NOW's clinic-local day
    expect(out[1].dayLabel).toContain('Tuesday')
    expect(out[1].relative).toBe('TOMORROW')
    expect(out[2].relative).toBeNull()
    expect(out[1].timeLabel).toBe('10:00 AM')
    expect(out[1].label).toBe(`${out[1].dayLabel} at ${out[1].timeLabel}`)
  })

  it('per-service caps shrink the inventory (multi-service prompt budget)', () => {
    const all = [
      ...halfHourDay('2026-10-05', 8, 18),
      ...halfHourDay('2026-10-06', 8, 18),
      ...halfHourDay('2026-10-07', 8, 18),
    ]
    const caps = { maxSlots: 14, fullDetailDays: 1, laterDayStride: 2, maxPerLaterDay: 4 }
    const out = pickSlots(all, NOW, TZ, caps)
    expect(out.length).toBeLessThanOrEqual(14)
    // First bookable day keeps full detail, later days are thinned to ≤4.
    const tuesday = out.filter((s) => s.startIso.startsWith('2026-10-06'))
    expect(tuesday.length).toBeLessThanOrEqual(4)
    // Default caps unchanged when the param is omitted.
    expect(pickSlots(all, NOW, TZ).length).toBeGreaterThan(out.length)
  })

  it('empty input and all-too-soon input produce no slots', () => {
    expect(pickSlots([], NOW, TZ)).toEqual([])
    expect(pickSlots(['2026-10-05T09:10:00-07:00'], NOW, TZ)).toEqual([])
  })

  it('garbage slot strings are skipped, not thrown', () => {
    expect(pickSlots(['not-a-date', '2026-10-06T10:00:00-07:00'], NOW, TZ)).toHaveLength(1)
  })
})

describe('labelForSlot', () => {
  it('survives a bad timezone and garbage input', () => {
    expect(labelForSlot('2026-10-06T10:00:00-07:00', 'Mars/OlympusMons')).toBeTruthy()
    expect(labelForSlot('garbage', TZ)).toBe('garbage')
  })
})
