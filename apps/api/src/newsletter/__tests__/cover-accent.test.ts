import { describe, it, expect, vi } from 'vitest'

vi.mock('@omniply/shared', () => ({
  prisma: {},
  uploadBufferWithKey: vi.fn(),
  generateWithGeminiImage: vi.fn(),
  deleteObjectsByPrefix: vi.fn(),
  listObjectsByPrefix: vi.fn(),
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { pickCoverAccent, applyBrandToCoverGuide, type CoverColors } from '../cover'

const colors = (sections: string[]): CoverColors => ({ headerBg: '#011328', sections })

describe('pickCoverAccent — max contrast vs the navy ground', () => {
  it('picks the section color with the highest contrast against navy', () => {
    // Light teal wins over dark teals against #011328.
    expect(pickCoverAccent(colors(['#2d808e', '#5baebc', '#0e616f', '#3aa6b9']))).toBe('#5BAEBC')
  })

  it('lightens a too-dark brand pool until the accent clears 3:1', () => {
    const accent = pickCoverAccent(colors(['#0e2231', '#12303f']))
    expect(accent).not.toBeNull()
    // Whatever it returns must be a lightened variant, not the raw dark hex.
    expect(accent).not.toBe('#0E2231')
    expect(accent).not.toBe('#12303F')
  })

  it('returns null for an empty/invalid pool (copper default stays)', () => {
    expect(pickCoverAccent(colors([]))).toBeNull()
    expect(pickCoverAccent(colors(['nope', '']))).toBeNull()
  })
})

describe('applyBrandToCoverGuide', () => {
  const GUIDE = `- Accent Line Color: Warm, burnished copper / brown-gold (used sparingly). This is the ONLY non-white color in the artwork.
Use small strokes in the copper/brown-gold color to indicate motion.`

  it('swaps every copper mention for the brand accent', () => {
    const out = applyBrandToCoverGuide(GUIDE, '#5BAEBC')
    expect(out).not.toMatch(/copper|brown-gold/i)
    expect(out).toContain("The brand's accent — a rich #5BAEBC")
    expect(out).toContain('brand accent #5BAEBC to indicate motion')
    expect(out).toContain('This brand accent #5BAEBC is the ONLY non-white color')
  })

  it('appends the brand-character mood line when provided', () => {
    const out = applyBrandToCoverGuide(GUIDE, '#5BAEBC', 'A "Modern Clinical Wellness" look—clean, bright.')
    expect(out).toContain('Brand Character: the clinic\'s visual identity is: A "Modern Clinical Wellness" look')
  })

  it('leaves the guide untouched when accent is null (copper fallback)', () => {
    expect(applyBrandToCoverGuide(GUIDE, null)).toBe(GUIDE)
  })
})
