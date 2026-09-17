import { describe, it, expect } from 'vitest'
import { tintScheme, pickAlternateTintColor } from '../brand-tint'

describe('tintScheme', () => {
  it('brand navy → white text + light logo at the default opacity', () => {
    const s = tintScheme('#011328')
    expect(s.textColor).toBe('#FFFFFF')
    expect(s.logoVariant).toBe('light')
    expect(s.overlayOpacity).toBe(0.85)
    expect(s.overlayColor).toBe('#011328')
  })

  it('near-white brand → dark text + dark logo', () => {
    const s = tintScheme('#F5F5F0')
    expect(s.textColor).toBe('#111111')
    expect(s.logoVariant).toBe('dark')
  })

  it('pure black brand → white text, no opacity bump needed', () => {
    const s = tintScheme('#000000')
    expect(s.textColor).toBe('#FFFFFF')
    expect(s.overlayOpacity).toBe(0.85)
  })

  it('mid-tone teal picks dark text (4.96:1 vs white 2.47:1) with no bump', () => {
    // #2A9D8F: L ≈ 0.266 — dark text wins against the darkest blend end and
    // clears AA at the default opacity.
    const s = tintScheme('#2A9D8F')
    expect(s.textColor).toBe('#111111')
    expect(s.logoVariant).toBe('dark')
    expect(s.overlayOpacity).toBe(0.85)
  })

  it('marginal-AA brand (#1E3A5F: white = 4.47:1 at 0.85) bumps opacity to 0.92', () => {
    const s = tintScheme('#1E3A5F')
    expect(s.textColor).toBe('#FFFFFF')
    expect(s.overlayOpacity).toBe(0.92)
  })

  it('mid-tone orange picks the max-contrast side deterministically', () => {
    const a = tintScheme('#E76F51')
    const b = tintScheme('#E76F51')
    expect(a).toEqual(b)
  })

  it('logo variant always pairs with the text color', () => {
    for (const hex of ['#011328', '#FFFFFF', '#2A9D8F', '#E76F51', '#808080']) {
      const s = tintScheme(hex)
      expect(s.logoVariant).toBe(s.textColor === '#FFFFFF' ? 'light' : 'dark')
    }
  })

  it('expands 3-digit hex and normalizes case', () => {
    const s = tintScheme('#abc')
    expect(s.overlayColor).toBe('#AABBCC')
  })

  it('accepts hex without the leading #', () => {
    expect(tintScheme('011328').overlayColor).toBe('#011328')
  })

  it('invalid or missing brand color falls back to the default navy', () => {
    for (const bad of [null, undefined, '', 'not-a-color', '#12345']) {
      const s = tintScheme(bad as string | null | undefined)
      expect(s.overlayColor).toBe('#1E3A5F')
      expect(s.textColor).toBe('#FFFFFF')
    }
  })

  it('truly dark brands never trigger the opacity bump (already ≥ AA for white)', () => {
    for (const hex of ['#011328', '#222222', '#000000']) {
      expect(tintScheme(hex).overlayOpacity).toBe(0.85)
    }
  })
})

describe('pickAlternateTintColor — second story tint (beat 1)', () => {
  it('picks the most distant brand color from the primary (Simon Chiro ramp → deep teal)', () => {
    expect(
      pickAlternateTintColor('#3aa6b9', ['#2d808e', '#2d808e', '#2d808e', '#5baebc', '#3aa6b9', '#0e616f']),
    ).toBe('#0E616F')
  })

  it('returns null when every candidate is too close to read as a different color', () => {
    expect(pickAlternateTintColor('#3aa6b9', ['#3aa6b9', '#3ba7ba', '#39a5b8'])).toBeNull()
  })

  it('ignores invalid and empty candidates', () => {
    expect(pickAlternateTintColor('#3aa6b9', [null, undefined, '', 'not-a-color', '#0e616f'])).toBe('#0E616F')
  })

  it('returns null for an empty candidate pool (one-color brand)', () => {
    expect(pickAlternateTintColor('#3aa6b9', [])).toBeNull()
  })
})
