import { describe, expect, it } from 'vitest'
import { samePhone } from '../voice-rescue'

// resolveRescueContext's DB paths are exercised in the live V3.2 battery;
// the pure matching rule is the unit-testable privacy surface.
describe('samePhone', () => {
  it('matches identical E.164', () => {
    expect(samePhone('+61400111222', '+61400111222')).toBe(true)
  })

  it('matches across formatting and country-prefix drift', () => {
    expect(samePhone('+61400111222', '0400 111 222')).toBe(true)
    expect(samePhone('(829) 731-2601', '+18297312601')).toBe(true)
  })

  it('rejects different numbers', () => {
    expect(samePhone('+61400111222', '+61400111333')).toBe(false)
  })

  it('rejects null/short values (never matches on weak data)', () => {
    expect(samePhone(null, '+61400111222')).toBe(false)
    expect(samePhone('+61400111222', undefined)).toBe(false)
    expect(samePhone('12345', '12345')).toBe(false)
  })
})
