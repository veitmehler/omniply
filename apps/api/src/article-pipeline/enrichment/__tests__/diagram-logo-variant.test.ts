import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import sharp from 'sharp'
import { pickLogoVariant, overlayBrandLogo, watermarkRegionLuminance } from '../diagram-logo'
import { contentOccupancy, OCCUPANCY_MIN, RENDITION_RULES } from '../diagram-restyle'

function solid(w: number, h: number, rgb: { r: number; g: number; b: number }) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer()
}
async function withBox(w: number, h: number, canvas: { r: number; g: number; b: number }, box: { left: number; top: number; width: number; height: number }) {
  const inner = await solid(box.width, box.height, { r: 20, g: 20, b: 20 })
  return sharp({ create: { width: w, height: h, channels: 4, background: { ...canvas, alpha: 1 } } })
    .composite([{ input: inner, left: box.left, top: box.top }])
    .png()
    .toBuffer()
}

describe('logo variant follows the canvas (Whealth cream-canvas bug)', () => {
  it('cream canvas → dark logo, navy canvas → light logo, explicit choice wins', async () => {
    const cream = await solid(400, 400, { r: 240, g: 240, b: 216 })
    const navy = await solid(400, 400, { r: 20, g: 28, b: 40 })
    expect(await pickLogoVariant(cream, null)).toBe('dark')
    expect(await pickLogoVariant(navy, null)).toBe('light')
    expect(await pickLogoVariant(cream, 'light')).toBe('light')
    expect(await pickLogoVariant(navy, 'dark')).toBe('dark')
    expect((await watermarkRegionLuminance(cream))!).toBeGreaterThan(0.85)
  })

  it('only the watermark corner counts: a dark corner on a light page takes the light logo', async () => {
    // Dark block covering the bottom-right corner where the logo lands.
    const img = await withBox(400, 400, { r: 240, g: 240, b: 216 }, { left: 280, top: 320, width: 120, height: 80 })
    expect(await pickLogoVariant(img, null)).toBe('light')
  })

  it('overlayBrandLogo falls back to the variant that exists and reports which one it used', async () => {
    const cream = await solid(200, 200, { r: 240, g: 240, b: 216 })
    const logo = await solid(40, 40, { r: 51, g: 46, b: 40 })
    const r = await overlayBrandLogo(cream, { light: null, dark: logo }, null)
    expect(r.variant).toBe('dark')
    const r2 = await overlayBrandLogo(cream, { light: logo, dark: null }, null)
    expect(r2.variant).toBe('light')
    const r3 = await overlayBrandLogo(cream, { light: null, dark: null }, null)
    expect(r3.variant).toBe(null)
    expect(r3.png).toBe(cream)
  })
})

describe('composition fill (restyle floats in empty canvas)', () => {
  it('measures the content bounding box against the canvas colour', async () => {
    const small = await withBox(400, 400, { r: 240, g: 240, b: 216 }, { left: 120, top: 140, width: 160, height: 120 })
    const big = await withBox(400, 400, { r: 240, g: 240, b: 216 }, { left: 16, top: 20, width: 368, height: 360 })
    const s = (await contentOccupancy(small))!
    const b = (await contentOccupancy(big))!
    expect(s.width).toBeCloseTo(0.4, 1)
    expect(s.height).toBeCloseTo(0.3, 1)
    expect(s.width).toBeLessThan(OCCUPANCY_MIN)
    expect(b.width).toBeGreaterThan(OCCUPANCY_MIN)
    expect(b.height).toBeGreaterThan(OCCUPANCY_MIN)
  })

  it('the rendition rules now state the fill requirement', () => {
    expect(RENDITION_RULES).toMatch(/COMPOSITION FILL/)
    expect(RENDITION_RULES).toMatch(/85%/)
  })
})
