import { describe, it, expect } from 'vitest'
import { parseWeekdayText, offsetForZone } from '../hours-parse'

describe('parseWeekdayText', () => {
  it('parses Google weekday_text (narrow spaces + en dash)', () => {
    const text =
      'Monday: 8:00 AM – 6:00 PM\nTuesday: 8:00 AM – 6:00 PM\nWednesday: 8:00 AM – 6:00 PM\nThursday: 8:00 AM – 6:00 PM\nFriday: 8:00 AM – 6:00 PM\nSaturday: 9:00 AM – 1:00 PM\nSunday: Closed'
    const parsed = parseWeekdayText(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.periods).toHaveLength(6)
    expect(parsed!.days[1]).toEqual([{ open: 480, close: 1080 }])
    expect(parsed!.days[6]).toEqual([{ open: 540, close: 780 }])
    expect(parsed!.days[0]).toEqual([])
    expect(parsed!.canonicalWeekdayText.split('\n')[0]).toBe('Monday: 8:00 AM – 6:00 PM')
    expect(parsed!.canonicalWeekdayText.split('\n')[6]).toBe('Sunday: Closed')
  })

  it('parses day ranges and bare meridiem-less times', () => {
    const parsed = parseWeekdayText('Mon–Fri 8am–6pm\nSat 9-1')
    expect(parsed).not.toBeNull()
    for (const d of [1, 2, 3, 4, 5]) expect(parsed!.days[d]).toEqual([{ open: 480, close: 1080 }])
    expect(parsed!.days[6]).toEqual([{ open: 540, close: 780 }])
  })

  it('parses "Monday to Friday" wording and 24h times', () => {
    const parsed = parseWeekdayText('Monday to Friday: 08:00 - 18:00')
    expect(parsed).not.toBeNull()
    expect(parsed!.days[5]).toEqual([{ open: 480, close: 1080 }])
  })

  it('parses split shifts', () => {
    const parsed = parseWeekdayText('Tuesday: 9:00 AM - 12:00 PM, 2:00 PM - 6:00 PM')
    expect(parsed).not.toBeNull()
    expect(parsed!.days[2]).toEqual([
      { open: 540, close: 720 },
      { open: 840, close: 1080 },
    ])
  })

  it('reads "5-9pm" as an evening range', () => {
    const parsed = parseWeekdayText('Friday: 5 - 9pm')
    expect(parsed).not.toBeNull()
    expect(parsed!.days[5]).toEqual([{ open: 1020, close: 1260 }])
  })

  it('handles Open 24 hours', () => {
    const parsed = parseWeekdayText('Monday: Open 24 hours')
    expect(parsed).not.toBeNull()
    expect(parsed!.days[1]).toEqual([{ open: 0, close: 1440 }])
    expect(parsed!.periods[0]).toEqual({ open: { day: 1, time: '0000' }, close: { day: 2, time: '0000' } })
  })

  it('fails the WHOLE text on any unparseable line (strict)', () => {
    expect(parseWeekdayText('Monday: 8:00 AM - 6:00 PM\nwhenever we feel like it')).toBeNull()
    expect(parseWeekdayText('Mon: 8:00 AM - 6:00 PM\nTue: garbage - words')).toBeNull()
  })

  it('rejects overnight/invalid ranges and dayless lines', () => {
    expect(parseWeekdayText('Friday: 10:00 PM - 2:00 AM')).toBeNull()
    expect(parseWeekdayText('8:00 - 18:00')).toBeNull()
    expect(parseWeekdayText('')).toBeNull()
    expect(parseWeekdayText(null)).toBeNull()
  })

  it('returns null when every mentioned day is closed', () => {
    expect(parseWeekdayText('Monday: Closed\nTuesday: Closed')).toBeNull()
  })
})

describe('offsetForZone', () => {
  it('is DST-correct for US zones', () => {
    expect(offsetForZone('America/Phoenix', new Date('2026-01-15T12:00:00Z'))).toBe(-420)
    expect(offsetForZone('America/Phoenix', new Date('2026-07-15T12:00:00Z'))).toBe(-420) // no DST
    expect(offsetForZone('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300)
    expect(offsetForZone('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240)
  })

  it('handles half-hour zones and UTC', () => {
    expect(offsetForZone('Australia/Adelaide', new Date('2026-01-15T12:00:00Z'))).toBe(630)
    expect(offsetForZone('UTC', new Date())).toBe(0)
  })

  it('returns null for garbage (free-text settings field)', () => {
    expect(offsetForZone('Mars/OlympusMons')).toBeNull()
    expect(offsetForZone('')).toBeNull()
    expect(offsetForZone(null)).toBeNull()
  })
})
