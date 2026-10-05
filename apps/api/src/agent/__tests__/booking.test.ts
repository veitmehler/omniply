import { describe, it, expect } from 'vitest'
import { pickSlots, labelForSlot } from '../booking'

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

  it('carries day/time labels for grouped prompt rendering', () => {
    const out = pickSlots(['2026-10-06T10:00:00-07:00'], NOW, TZ)
    expect(out[0].dayLabel).toContain('Tuesday')
    expect(out[0].timeLabel).toBe('10:00 AM')
    expect(out[0].label).toBe(`${out[0].dayLabel} at ${out[0].timeLabel}`)
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
