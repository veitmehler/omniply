import { describe, it, expect } from 'vitest'
import { isSaasDefaultLocationName, pickPrefillBusinessName } from '../bootstrap'

describe('SaaS default-name detection (live finding 2026-10-09)', () => {
  it('flags the SaaS auto-name pattern, any casing', () => {
    expect(isSaasDefaultLocationName("Elena Vargas's Account")).toBe(true)
    expect(isSaasDefaultLocationName("jane smith's account ")).toBe(true)
  })
  it('passes real practice names, including ones containing "account"', () => {
    expect(isSaasDefaultLocationName('Simon Chiropractic Center')).toBe(false)
    expect(isSaasDefaultLocationName('Accountable Spine Care')).toBe(false)
    expect(isSaasDefaultLocationName('')).toBe(false)
    expect(isSaasDefaultLocationName(null)).toBe(false)
  })
})

describe('business-name prefill (friendly first, junk blanks)', () => {
  it('prefers the FRIENDLY name so unchanged-confirm is a no-op', () => {
    expect(pickPrefillBusinessName('Simon Chiro Center', 'Simon Chiro Center LLC')).toBe('Simon Chiro Center')
  })
  it('falls back to business.name only when friendly is empty', () => {
    expect(pickPrefillBusinessName('', 'Simon Chiro Center LLC')).toBe('Simon Chiro Center LLC')
  })
  it('blanks SaaS junk instead of prefilling it (forces the edit)', () => {
    expect(pickPrefillBusinessName("Elena Vargas's Account", '')).toBe('')
    expect(pickPrefillBusinessName("Elena Vargas's Account", null)).toBe('')
  })
  it('skips junk friendly but keeps a real business.name fallback', () => {
    expect(pickPrefillBusinessName("Elena Vargas's Account", 'The Chiropractic Clinic')).toBe('The Chiropractic Clinic')
  })
})
