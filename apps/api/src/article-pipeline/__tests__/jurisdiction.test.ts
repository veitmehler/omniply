import { describe, it, expect } from 'vitest'
import { jurisdictionFor } from '../jurisdiction'

describe('jurisdictionFor', () => {
  it('uses a region as it is', () => {
    expect(jurisdictionFor('Australia, Queensland')).toBe('Australia, Queensland')
    expect(jurisdictionFor('Texas, USA')).toBe('Texas, USA')
    expect(jurisdictionFor('New Zealand')).toBe('New Zealand')
  })
  it('takes the country from a street address', () => {
    expect(jurisdictionFor('Plaza Mariposa, Boulevard Mariposa, Kite Beach, Cabarete, Dominican Republic')).toBe('Dominican Republic')
    expect(jurisdictionFor('12 High St, Leeds, United Kingdom, LS1 4AP')).toBe('United Kingdom')
  })
  it('never leaves the sentence with a hole in it', () => {
    expect(jurisdictionFor('')).toBe('the country the practice is in')
    expect(jurisdictionFor(null)).toBe('the country the practice is in')
  })
})
