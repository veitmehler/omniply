import { describe, expect, it } from 'vitest'
import { buildRescueGreeting, samePhone, spokenDigits, RESCUE_FIRST_MESSAGE } from '../voice-rescue'

describe('buildRescueGreeting', () => {
  it('name + phone: apologizes by name and offers the FULL number digit by digit', () => {
    const g = buildRescueGreeting('Thomas', '0870087991')
    expect(g).toContain('Thomas')
    expect(g).toContain('0 8 7 0 0 8 7 9 9 1')
    expect(g).not.toContain("What's your name")
  })

  it('name only: asks just for the number', () => {
    const g = buildRescueGreeting('Thomas', null)
    expect(g).toContain('Thomas')
    expect(g).toContain('best number')
  })

  it('phone only: offers the number without a name', () => {
    const g = buildRescueGreeting(null, '+61400111222')
    expect(g).toContain('6 1 4 0 0 1 1 1 2 2 2')
  })

  it('nothing known: falls back to the generic ask', () => {
    expect(buildRescueGreeting(null, null)).toBe(RESCUE_FIRST_MESSAGE)
  })

  it('spokenDigits strips formatting', () => {
    expect(spokenDigits('+61 (0)400 111-222')).toBe('6 1 0 4 0 0 1 1 1 2 2 2')
  })
})

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
