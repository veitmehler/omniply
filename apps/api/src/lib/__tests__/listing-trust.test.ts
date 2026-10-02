import { describe, it, expect } from 'vitest'
import { listingMatchesBrand, listingTrusted } from '../google/listing-trust'

describe('listingMatchesBrand', () => {
  it('matches identical and containing names', () => {
    expect(listingMatchesBrand('Simon Chiropractic Center', 'Simon Chiropractic Center')).toBe(true)
    expect(listingMatchesBrand('Simon Chiropractic Center - Mesa', 'Simon Chiropractic Center')).toBe(true)
    expect(listingMatchesBrand('Simon Chiropractic', 'Dr. Simon Chiropractic Center')).toBe(true)
  })

  it('matches on shared distinctive tokens despite generic noise', () => {
    expect(listingMatchesBrand('Desert Valley Chiropractic Clinic', 'Desert Valley Family Care')).toBe(true)
  })

  it('rejects a different business (the demo mis-matches)', () => {
    expect(listingMatchesBrand('Advantage ADHD & Psychiatry Services', 'Demo Practice')).toBe(false)
    expect(listingMatchesBrand("Rosa's Mexican Grill", 'Simon Chiropractic Center')).toBe(false)
  })

  it('keeps the probe when it cannot judge', () => {
    expect(listingMatchesBrand(null, 'Demo Practice')).toBe(true)
    expect(listingMatchesBrand('Something', null)).toBe(true)
    expect(listingMatchesBrand('The Family Care Clinic', 'Family Wellness Center')).toBe(true) // all-generic both sides
  })
})

describe('listingTrusted', () => {
  it('explicit confirmation overrides a name mismatch', () => {
    expect(listingTrusted({ listingName: 'Totally Different Name Co', brandName: 'Demo Practice', confirmedAt: new Date() })).toBe(true)
    expect(listingTrusted({ listingName: 'Totally Different Name Co', brandName: 'Demo Practice', confirmedAt: null })).toBe(false)
  })
})
