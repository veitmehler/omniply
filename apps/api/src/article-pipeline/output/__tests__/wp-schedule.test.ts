import { describe, it, expect } from 'vitest'
import { parsePublishTime, zonedDateTimeToUtc } from '../wordpress-target'

describe('parsePublishTime', () => {
  it('parses valid HH:mm', () => {
    expect(parsePublishTime('09:00')).toEqual([9, 0])
    expect(parsePublishTime('7:30')).toEqual([7, 30])
    expect(parsePublishTime('23:59')).toEqual([23, 59])
  })

  it('falls back to 9:00 on malformed input', () => {
    expect(parsePublishTime(null)).toEqual([9, 0])
    expect(parsePublishTime('')).toEqual([9, 0])
    expect(parsePublishTime('24:00')).toEqual([9, 0])
    expect(parsePublishTime('9am')).toEqual([9, 0])
    expect(parsePublishTime('09:60')).toEqual([9, 0])
  })
})

describe('zonedDateTimeToUtc', () => {
  it('converts New York EDT (summer) correctly', () => {
    // 2026-09-22 09:00 America/New_York = 13:00 UTC (EDT, UTC-4)
    const d = zonedDateTimeToUtc(2026, 9, 22, 9, 0, 'America/New_York')
    expect(d.toISOString()).toBe('2026-09-22T13:00:00.000Z')
  })

  it('converts New York EST (winter) correctly', () => {
    // 2026-01-15 09:00 America/New_York = 14:00 UTC (EST, UTC-5)
    const d = zonedDateTimeToUtc(2026, 1, 15, 9, 0, 'America/New_York')
    expect(d.toISOString()).toBe('2026-01-15T14:00:00.000Z')
  })

  it('converts a UTC-ahead zone (Sydney) correctly across its DST', () => {
    // 2026-01-15 09:00 Australia/Sydney (AEDT, UTC+11) = 2026-01-14 22:00 UTC
    const summer = zonedDateTimeToUtc(2026, 1, 15, 9, 0, 'Australia/Sydney')
    expect(summer.toISOString()).toBe('2026-01-14T22:00:00.000Z')
    // 2026-06-15 09:00 Australia/Sydney (AEST, UTC+10) = 2026-06-14 23:00 UTC
    const winter = zonedDateTimeToUtc(2026, 6, 15, 9, 0, 'Australia/Sydney')
    expect(winter.toISOString()).toBe('2026-06-14T23:00:00.000Z')
  })

  it('handles UTC itself', () => {
    const d = zonedDateTimeToUtc(2026, 9, 22, 9, 0, 'UTC')
    expect(d.toISOString()).toBe('2026-09-22T09:00:00.000Z')
  })
})
