import { describe, expect, it } from 'vitest'
import { normalizePhoneE164 } from '../phone'

describe('normalizePhoneE164', () => {
  it('AU landline with trunk zero (the live-call bug case)', () => {
    expect(normalizePhoneE164('07 4489 2655', 'AU')).toBe('+61744892655')
  })

  it('AU mobile', () => {
    expect(normalizePhoneE164('0400 111 222', 'AU')).toBe('+61400111222')
  })

  it('AU number already carrying the dial code without +', () => {
    expect(normalizePhoneE164('61 400 111 222', 'AU')).toBe('+61400111222')
  })

  it('US 10-digit', () => {
    expect(normalizePhoneE164('(555) 123-4567', 'US')).toBe('+15551234567')
  })

  it('US 11-digit with leading 1', () => {
    expect(normalizePhoneE164('1 829 731 2601', 'US')).toBe('+18297312601')
  })

  it('already E.164 passes through cleaned regardless of country', () => {
    expect(normalizePhoneE164('+61 400 111 222', 'US')).toBe('+61400111222')
    expect(normalizePhoneE164('+1 (829) 731-2601', 'AU')).toBe('+18297312601')
  })

  it('00-prefixed international', () => {
    expect(normalizePhoneE164('0061 400 111 222', 'US')).toBe('+61400111222')
  })

  it('unknown country leaves the number untouched', () => {
    expect(normalizePhoneE164('07 4489 2655', 'XX')).toBe('0744892655')
    expect(normalizePhoneE164('0744892655', null)).toBe('0744892655')
  })

  it('NANP numbers with odd lengths pass through as digits', () => {
    expect(normalizePhoneE164('12345', 'US')).toBe('12345')
  })

  it('GB trunk zero', () => {
    expect(normalizePhoneE164('020 7946 0018', 'GB')).toBe('+442079460018')
  })
})
