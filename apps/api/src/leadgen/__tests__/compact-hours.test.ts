import { describe, it, expect } from 'vitest'
import { compactOpeningHours } from '../compile'

describe('compactOpeningHours', () => {
  it('groups consecutive identical days and shortens times', () => {
    const raw = [
      'Monday: 9:00 AM – 5:00 PM',
      'Tuesday: 9:00 AM – 5:00 PM',
      'Wednesday: 9:00 AM – 5:00 PM',
      'Thursday: 9:00 AM – 5:00 PM',
      'Friday: 9:00 AM – 5:00 PM',
      'Saturday: 9:00 AM – 12:30 PM',
      'Sunday: Closed',
    ].join('\n')
    expect(compactOpeningHours(raw)).toBe('Mon-Fri 9 AM-5 PM · Sat 9 AM-12:30 PM · Sun Closed')
  })

  it('handles narrow spaces and single-day groups', () => {
    const raw = 'Monday: 8:00 AM – 6:00 PM\nTuesday: Closed'
    expect(compactOpeningHours(raw)).toBe('Mon 8 AM-6 PM · Tue Closed')
  })

  it('returns unparseable input unchanged', () => {
    expect(compactOpeningHours('By appointment only')).toBe('By appointment only')
    expect(compactOpeningHours('')).toBe('')
  })
})
