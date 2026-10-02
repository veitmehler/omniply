import { describe, it, expect } from 'vitest'
import { compareSiteToGoogle, type SiteFacts } from '../hours-compare'
import type { PlaceProbe } from '../google/places'

const probe = (over: Partial<PlaceProbe> = {}): PlaceProbe => ({
  placeId: 'ChIJtest',
  name: 'Simon Chiropractic Center',
  openingHours:
    'Monday: 8:00 AM – 6:00 PM\nTuesday: 8:00 AM – 6:00 PM\nWednesday: 8:00 AM – 6:00 PM\nThursday: 8:00 AM – 6:00 PM\nFriday: 8:00 AM – 6:00 PM\nSaturday: Closed\nSunday: Closed',
  formattedPhone: '(480) 962-6011',
  formattedAddress: '2500 S Power Rd Suite 106, Mesa, AZ 85209, USA',
  reviews: [],
  ...over,
})

const site = (over: Partial<SiteFacts> = {}): SiteFacts => ({
  hoursText: 'Mon-Fri: 8:00 AM - 6:00 PM\nSat: Closed\nSun: Closed',
  phones: ['480-962-6011'],
  streetAddress: '2500 South Power Road, Suite 106, Mesa AZ 85209',
  confidence: 'high',
  ...over,
})

describe('compareSiteToGoogle', () => {
  it('agrees when everything lines up (formatting noise ignored)', () => {
    expect(compareSiteToGoogle(site(), probe())).toEqual([])
  })

  it('flags a closed-vs-open day disagreement', () => {
    const out = compareSiteToGoogle(site({ hoursText: 'Mon-Fri: 8am-6pm\nSat: 9am-1pm' }), probe())
    expect(out).toHaveLength(1)
    expect(out[0].field).toBe('hours')
    expect(out[0].note).toContain('Saturday')
    expect(out[0].note).toContain('Google version')
  })

  it('flags a ≥30-minute boundary difference, ignores smaller ones', () => {
    const late = compareSiteToGoogle(site({ hoursText: 'Mon-Fri: 8am-5pm' }), probe())
    expect(late.filter((d) => d.field === 'hours')).toHaveLength(5)
    const tiny = compareSiteToGoogle(site({ hoursText: 'Mon-Fri: 8:15 AM - 6:00 PM' }), probe())
    expect(tiny).toEqual([])
  })

  it('phone: any matching site phone = agreement; none = flag', () => {
    expect(compareSiteToGoogle(site({ phones: ['(555) 123-9999', '+1 480 962 6011'] }), probe())).toEqual([])
    const out = compareSiteToGoogle(site({ phones: ['480-555-0100'] }), probe())
    expect(out).toHaveLength(1)
    expect(out[0].field).toBe('phone')
  })

  it('address: differing street number flags; suite noise does not', () => {
    expect(compareSiteToGoogle(site({ streetAddress: '2500 S Power Rd, Mesa' }), probe())).toEqual([])
    const out = compareSiteToGoogle(site({ streetAddress: '17 Main Street, Mesa' }), probe())
    expect(out).toHaveLength(1)
    expect(out[0].field).toBe('address')
  })

  it('never warns on null/low-confidence/missing data', () => {
    expect(compareSiteToGoogle(null, probe())).toEqual([])
    expect(compareSiteToGoogle(site({ confidence: 'low', hoursText: 'Mon-Fri: 9am-5pm' }), probe())).toEqual([])
    expect(compareSiteToGoogle(site({ hoursText: null, phones: [], streetAddress: null }), probe())).toEqual([])
    expect(compareSiteToGoogle(site(), null)).toEqual([])
    expect(compareSiteToGoogle(site({ hoursText: 'whenever we like' }), probe())).toEqual([]) // unparseable → silent
  })
})
