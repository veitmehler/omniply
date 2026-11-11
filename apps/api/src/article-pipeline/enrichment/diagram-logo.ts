/**
 * AI diagram restyle ("Nano Banana") — Phase 2: logo watermark.
 *
 * Composites a semi-transparent brand logo onto the bottom-right of a stylized
 * diagram. Best-effort: if there's no logo or anything goes wrong, the base
 * image is returned unchanged (branding never fails a diagram).
 */

import sharp from 'sharp'
import { logger } from '../../lib/logger'

export interface LogoOverlayOptions {
  /** Logo width budget as a fraction of the canvas width. */
  widthRatio?: number
  /** Logo height budget as a fraction of the canvas height — slim/tall logos
   * bind on THIS, not the width (Veit 2026-09-15: a tall logo scaled to the
   * width budget alone dwarfed the diagram). The logo scales proportionally
   * to fit INSIDE both budgets. */
  heightRatio?: number
  /** Uniform alpha multiplier applied to the logo (0..1). */
  opacity?: number
  /** Inset from the bottom/right edges as a fraction of the canvas width. */
  marginRatio?: number
}

const DEFAULTS: Required<LogoOverlayOptions> = {
  widthRatio: 0.22,
  heightRatio: 0.12,
  opacity: 0.3,
  marginRatio: 0.03,
}

export async function overlayLogo(
  basePng: Buffer,
  logoBuffer: Buffer | null | undefined,
  options: LogoOverlayOptions = {},
): Promise<Buffer> {
  if (!logoBuffer || logoBuffer.length === 0) return basePng
  const { widthRatio, heightRatio, opacity, marginRatio } = { ...DEFAULTS, ...options }

  try {
    const baseMeta = await sharp(basePng).metadata()
    const baseW = baseMeta.width ?? 0
    const baseH = baseMeta.height ?? 0
    if (!baseW || !baseH) return basePng

    const targetW = Math.max(1, Math.round(baseW * widthRatio))
    const targetH = Math.max(1, Math.round(baseH * heightRatio))

    // Contain-fit into BOTH budgets (fit:'inside' scales proportionally until
    // the binding dimension — width for wide logos, height for slim/tall
    // ones), then fade the alpha uniformly by multiplying the raw channel
    // (matches logo-process.ts's raw-buffer style).
    const { data, info } = await sharp(logoBuffer)
      .resize({ width: targetW, height: targetH, fit: 'inside', withoutEnlargement: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const faded = Buffer.from(data)
    for (let i = 3; i < faded.length; i += 4) {
      faded[i] = Math.round(faded[i] * opacity)
    }
    const fadedLogo = await sharp(faded, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer()

    const margin = Math.round(baseW * marginRatio)
    const left = Math.max(0, baseW - info.width - margin)
    const top = Math.max(0, baseH - info.height - margin)

    return await sharp(basePng).composite([{ input: fadedLogo, left, top }]).png().toBuffer()
  } catch (err) {
    logger.warn({ err }, '[diagram-logo] overlay failed — returning base image')
    return basePng
  }
}

export type LogoVariant = 'light' | 'dark'

/**
 * Mean luminance (0..1) of the watermark box — the bottom-right region where
 * overlayLogo places the logo, using the same budgets and margin.
 */
export async function watermarkRegionLuminance(basePng: Buffer, options: LogoOverlayOptions = {}): Promise<number | null> {
  const { widthRatio, heightRatio, marginRatio } = { ...DEFAULTS, ...options }
  try {
    const meta = await sharp(basePng).metadata()
    const W = meta.width ?? 0
    const H = meta.height ?? 0
    if (!W || !H) return null
    const w = Math.max(1, Math.round(W * widthRatio))
    const h = Math.max(1, Math.round(H * heightRatio))
    const margin = Math.round(W * marginRatio)
    const left = Math.max(0, W - w - margin)
    const top = Math.max(0, H - h - margin)
    const { data } = await sharp(basePng).extract({ left, top, width: Math.min(w, W - left), height: Math.min(h, H - top) }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let sum = 0
    for (let i = 0; i < data.length; i += 3) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    return sum / (data.length / 3) / 255
  } catch {
    return null
  }
}

/**
 * Which logo goes on this canvas (Whealth finding, 2026-11-11: a white logo
 * landed on a cream canvas because the variant was a static per-account
 * setting). An explicit account choice wins; otherwise the canvas decides:
 * a light watermark corner takes the dark logo, a dark corner the light one.
 */
export async function pickLogoVariant(basePng: Buffer, explicit: LogoVariant | null | undefined): Promise<LogoVariant> {
  if (explicit === 'light' || explicit === 'dark') return explicit
  const lum = await watermarkRegionLuminance(basePng)
  if (lum === null) return 'light'
  return lum >= 0.5 ? 'dark' : 'light'
}

/** Overlay the right variant for the canvas. Falls back to whichever variant exists. */
export async function overlayBrandLogo(
  basePng: Buffer,
  logos: { light: Buffer | null; dark: Buffer | null },
  explicit: LogoVariant | null | undefined,
  options: LogoOverlayOptions = {},
): Promise<{ png: Buffer; variant: LogoVariant | null }> {
  if (!logos.light && !logos.dark) return { png: basePng, variant: null }
  let variant = await pickLogoVariant(basePng, explicit)
  if (!logos[variant]) variant = variant === 'dark' ? 'light' : 'dark'
  const png = await overlayLogo(basePng, logos[variant], options)
  return { png, variant }
}
