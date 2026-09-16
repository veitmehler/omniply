import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { colorCutout, avgOpaqueLuminance, pickBrandLogoForBackground, type Mask, type BBox } from '../logo-process'

async function solidPng(r: number, g: number, b: number, w = 8, h = 8): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer()
}

describe('colorCutout', () => {
  it('preserves the source colors (does NOT recolor to a silhouette)', async () => {
    const src = await solidPng(200, 40, 40) // strong red
    const mask: Mask = { alpha: Buffer.alloc(64, 255), width: 8, height: 8 }
    const bbox: BBox = { left: 0, top: 0, width: 8, height: 8 }
    const out = await colorCutout(src, mask, bbox)
    const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBe(200)
    expect(data[1]).toBe(40)
    expect(data[2]).toBe(40)
    expect(data[3]).toBe(255)
  })

  it('applies the mask alpha and crops to the bbox', async () => {
    const src = await solidPng(10, 120, 200)
    const alpha = Buffer.alloc(64, 0)
    // opaque 2x2 block at (3,3)
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) alpha[y * 8 + x] = 255
    const out = await colorCutout(src, { alpha, width: 8, height: 8 }, { left: 3, top: 3, width: 2, height: 2 })
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(2)
    expect(meta.height).toBe(2)
    const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(255) // opaque inside the bbox
    expect(data[2]).toBe(200) // blue channel intact
  })
})

describe('avgOpaqueLuminance', () => {
  it('is high for white content, low for near-black content', async () => {
    const whiteLum = await avgOpaqueLuminance(await solidPng(255, 255, 255))
    const darkLum = await avgOpaqueLuminance(await solidPng(10, 10, 20))
    expect(whiteLum).toBeGreaterThan(0.95)
    expect(darkLum).toBeLessThan(0.05)
  })
})

describe('pickBrandLogoForBackground', () => {
  const b = {
    nlLogoColorUrl: 'color.png',
    nlLogoColorLuminance: 0.08, // dark-ish colored logo (navy/teal mark)
    nlLogoLightUrl: 'light.png',
    nlLogoDarkUrl: 'dark.png',
    nlLogoUrl: 'legacy.png',
  }

  it('uses the real logo when it reads against the band', () => {
    expect(pickBrandLogoForBackground(b, '#ffffff')).toBe('color.png') // dark logo on white
    expect(pickBrandLogoForBackground(b, '#3aa6b9')).toBe('color.png') // dark logo on mid teal
  })

  it('falls back to the light silhouette on a dark band the color logo vanishes on', () => {
    expect(pickBrandLogoForBackground(b, '#0b2545')).toBe('light.png')
  })

  it('a light colored logo falls back to the dark silhouette on a white band', () => {
    expect(pickBrandLogoForBackground({ ...b, nlLogoColorLuminance: 0.92 }, '#ffffff')).toBe('dark.png')
  })

  it('without a color variant, silhouettes pick by band luminance', () => {
    const noColor = { ...b, nlLogoColorUrl: null, nlLogoColorLuminance: null }
    expect(pickBrandLogoForBackground(noColor, '#0b2545')).toBe('light.png')
    expect(pickBrandLogoForBackground(noColor, '#ffffff')).toBe('dark.png')
  })
})
