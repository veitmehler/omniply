import { describe, it, expect } from 'vitest'
import { parseBookingServices } from '../services'

describe('parseBookingServices', () => {
  it('parses a valid services config', () => {
    const out = parseBookingServices({
      services: [
        { key: 'hbot', label: 'HBOT Session', calendarId: 'cal1', synonyms: ['hyperbaric', 'oxygen chamber'] },
        { key: 'sports-massage', label: 'Sports Massage', calendarId: 'cal2' },
      ],
    })
    expect(out).toEqual([
      { key: 'hbot', label: 'HBOT Session', calendarId: 'cal1', synonyms: ['hyperbaric', 'oxygen chamber'] },
      { key: 'sports-massage', label: 'Sports Massage', calendarId: 'cal2', synonyms: [] },
    ])
  })

  it('returns null for absent/invalid/legacy configs (single-calendar path)', () => {
    expect(parseBookingServices(null)).toBeNull()
    expect(parseBookingServices({})).toBeNull()
    expect(parseBookingServices({ businessId: 'cliniko-stuff' })).toBeNull()
    expect(parseBookingServices({ services: [] })).toBeNull()
    expect(parseBookingServices({ services: 'hbot' } as never)).toBeNull()
    expect(parseBookingServices([{ key: 'hbot' }] as never)).toBeNull()
  })

  it('drops malformed entries, normalizes keys, dedupes', () => {
    const out = parseBookingServices({
      services: [
        { key: 'HBOT ', label: 'HBOT', calendarId: 'cal1' }, // key lowercased+trimmed
        { key: 'hbot', label: 'Duplicate', calendarId: 'cal9' }, // dup key dropped
        { key: 'bad key!', label: 'X', calendarId: 'cal2' }, // invalid slug
        { key: 'nolabel', label: '', calendarId: 'cal3' }, // empty label
        { key: 'nocal', label: 'No Cal', calendarId: '' }, // empty calendar
        { key: 'ok', label: 'OK', calendarId: 'cal4', synonyms: ['fine', 42, ''] }, // bad synonyms filtered
      ],
    })
    expect(out).toEqual([
      { key: 'hbot', label: 'HBOT', calendarId: 'cal1', synonyms: [] },
      { key: 'ok', label: 'OK', calendarId: 'cal4', synonyms: ['fine'] },
    ])
  })

  it('caps at 12 services', () => {
    const services = Array.from({ length: 20 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, calendarId: `c${i}` }))
    expect(parseBookingServices({ services })).toHaveLength(12)
  })
})
