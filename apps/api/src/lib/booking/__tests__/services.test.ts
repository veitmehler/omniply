import { describe, it, expect } from 'vitest'
import { parseBookingServices, servicesForMode, serviceProviderTarget } from '../services'

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

describe('parseBookingServices — provider-agnostic extensions (discovery card)', () => {
  it('accepts Cliniko-targeted services without a calendarId', () => {
    const out = parseBookingServices({
      businessId: 'b1',
      practitionerIds: ['p1', 'p2'],
      services: [
        { key: 'physio', label: 'Physiotherapy', cliniko: { appointmentTypeId: 'at1' } },
        { key: 'massage', label: 'Massage', cliniko: { appointmentTypeId: 'at2', practitionerIds: ['p2'] } },
      ],
    })
    expect(out).toEqual([
      { key: 'physio', label: 'Physiotherapy', calendarId: '', synonyms: [], cliniko: { appointmentTypeId: 'at1' } },
      { key: 'massage', label: 'Massage', calendarId: '', synonyms: [], cliniko: { appointmentTypeId: 'at2', practitionerIds: ['p2'] } },
    ])
  })

  it('keeps exclusiveWith only for existing keys and never self-references', () => {
    const out = parseBookingServices({
      services: [
        { key: 'consult', label: 'Consultation', calendarId: 'c1', exclusiveWith: ['consult', 'massage', 'ghost'] },
        { key: 'massage', label: 'Massage', calendarId: 'c2' },
      ],
    })
    expect(out?.[0].exclusiveWith).toEqual(['massage'])
    expect(out?.[1].exclusiveWith).toBeUndefined()
  })

  it('carries durationMinutes within bounds and drops nonsense', () => {
    const out = parseBookingServices({
      services: [
        { key: 'a', label: 'A', calendarId: 'c1', durationMinutes: 60 },
        { key: 'b', label: 'B', calendarId: 'c2', durationMinutes: 2 },
      ],
    })
    expect(out?.[0].durationMinutes).toBe(60)
    expect(out?.[1].durationMinutes).toBeUndefined()
  })

  it('drops entries with neither provider target', () => {
    const out = parseBookingServices({
      services: [
        { key: 'ok', label: 'OK', calendarId: 'c1' },
        { key: 'none', label: 'No target' },
      ],
    })
    expect(out?.map((s) => s.key)).toEqual(['ok'])
  })
})

describe('servicesForMode / serviceProviderTarget', () => {
  it('filters services to the mode-matching target', () => {
    const services = parseBookingServices({
      services: [
        { key: 'ghl1', label: 'G', calendarId: 'c1' },
        { key: 'cl1', label: 'C', cliniko: { appointmentTypeId: 'at1' } },
      ],
    })
    expect(servicesForMode(services, 'direct-ghl')?.map((s) => s.key)).toEqual(['ghl1'])
    expect(servicesForMode(services, 'direct-cliniko')?.map((s) => s.key)).toEqual(['cl1'])
    expect(servicesForMode(services, 'off')).toBeNull()
  })

  it('builds the Cliniko per-service provider config over the root', () => {
    const services = parseBookingServices({
      services: [{ key: 'cl1', label: 'C', cliniko: { appointmentTypeId: 'at9', practitionerIds: ['p7'] } }],
    })
    const t = serviceProviderTarget('direct-cliniko', { businessId: 'b1', practitionerIds: ['p1'] }, services![0], null)
    expect(t.calendarId).toBeNull()
    expect(t.config).toEqual({ businessId: 'b1', practitionerIds: ['p7'], appointmentTypeId: 'at9' })
  })

  it('ghl mode rides the service calendar with fallback', () => {
    const t = serviceProviderTarget('direct-ghl', { x: 1 }, { key: 'k', label: 'L', calendarId: 'c5', synonyms: [] }, 'fallback')
    expect(t).toEqual({ config: { x: 1 }, calendarId: 'c5' })
    const t2 = serviceProviderTarget('direct-ghl', null, null, 'fallback')
    expect(t2).toEqual({ config: null, calendarId: 'fallback' })
  })
})

