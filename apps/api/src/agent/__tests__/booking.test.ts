import { describe, it, expect } from 'vitest'
import { pickSlots, labelForSlot } from '../booking'

const TZ = 'America/Phoenix'
const NOW = new Date('2026-10-05T16:00:00Z') // Monday 9:00 AM Phoenix

describe('pickSlots', () => {
  const all = [
    '2026-10-05T09:30:00-07:00', // too soon (<2h lead)
    '2026-10-05T13:00:00-07:00',
    '2026-10-05T14:00:00-07:00',
    '2026-10-05T15:00:00-07:00', // 3rd same-day — skipped (max 2/day)
    '2026-10-06T10:00:00-07:00',
    '2026-10-06T11:00:00-07:00',
  ]

  it('applies lead time, per-day cap, and overall cap', () => {
    const out = pickSlots(all, NOW, TZ)
    expect(out.map((s) => s.startIso)).toEqual([
      '2026-10-05T13:00:00-07:00',
      '2026-10-05T14:00:00-07:00',
      '2026-10-06T10:00:00-07:00',
    ])
  })

  it('labels in clinic-local words', () => {
    const out = pickSlots(all, NOW, TZ)
    expect(out[0].label).toContain('Monday')
    expect(out[0].label).toContain('1:00 PM')
    expect(out[2].label).toContain('Tuesday')
    expect(out[2].label).toContain('10:00 AM')
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
  it('survives a bad timezone by falling back to the raw string or default formatting', () => {
    expect(labelForSlot('2026-10-06T10:00:00-07:00', 'Mars/OlympusMons')).toBeTruthy()
    expect(labelForSlot('garbage', TZ)).toBe('garbage')
  })
})
