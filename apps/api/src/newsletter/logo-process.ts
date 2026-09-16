/**
 * Turn one uploaded logo into clean light (white) + dark (navy) transparent PNGs.
 *
 * We derive an alpha MASK of the logo, then recolour it — no generative redraw,
 * so the exact wordmark, sub-text (e.g. "KAWANA"), and thin lines are preserved
 * (a spike showed Nano Banana intermittently dropped fine elements). The mask:
 *   1. if the upload already has transparency → use its own alpha,
 *   2. else if it sits on a near-uniform solid background → key that colour out,
 *   3. else (complex background) → fall back to fal background removal (birefnet).
 * Then recolour to white / navy via the alpha, crop to content, upload.
 */
import sharp from 'sharp'
import { downloadImageFromUrl, uploadBufferWithKey, deleteOldVersions } from '@omniply/shared'
import { getSystemApiKey } from '../lib/system-keys'
import { vtoken } from './image-overlay'
import { logger } from '../lib/logger'

export interface ProcessedLogo {
  lightUrl: string
  darkUrl: string
  /** Mask applied to the ORIGINAL pixels — the client's real logo colors. */
  colorUrl: string
  /** Avg WCAG luminance of the color cutout's opaque pixels (contrast input). */
  colorLuminance: number
  /** Cropped content dimensions — aspect drives the default render width
   *  (a slim-tall mark at full width renders enormous). */
  contentWidth: number
  contentHeight: number
}

export interface BBox { left: number; top: number; width: number; height: number }
export interface Mask { alpha: Buffer; width: number; height: number }

// Distance→alpha knee: < FLOOR transparent (the background), >= FULL fully opaque
// (logo content), smooth toe between for clean anti-aliased edges.
const FLOOR = 10
const FULL = 70
const keyCurve = (dist: number): number =>
  dist <= FLOOR ? 0 : dist >= FULL ? 255 : Math.round(((dist - FLOOR) * 255) / (FULL - FLOOR))

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 1, g: 19, b: 40 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Background removal via fal birefnet → transparent PNG buffer (complex-bg fallback). */
async function birefnetCutout(sourceUrl: string): Promise<Buffer> {
  const falKey = await getSystemApiKey('fal-ai')
  if (!falKey) throw new Error('fal-ai key not configured (needed for logo background removal)')
  const res = await fetch('https://fal.run/fal-ai/birefnet', {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: sourceUrl }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`birefnet ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { image?: { url?: string } }
  if (!data.image?.url) throw new Error('birefnet returned no image')
  return downloadImageFromUrl(data.image.url)
}

/** Build the logo alpha mask from a source buffer + URL (URL only used for the fal fallback). */
async function buildMask(srcBuf: Buffer, sourceUrl: string): Promise<Mask> {
  const { data, info } = await sharp(srcBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const n = width * height
  const a = Buffer.alloc(n)

  // 1. Already transparent → trust the designer's alpha.
  let transparent = 0
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 240) transparent++
  if (transparent > n * 0.02) {
    for (let p = 0; p < n; p++) a[p] = data[p * 4 + 3]
    return { alpha: a, width, height }
  }

  // 2. Near-uniform solid background → key it out.
  const corner = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return [data[i], data[i + 1], data[i + 2]] as const
  }
  const cs = [corner(1, 1), corner(width - 2, 1), corner(1, height - 2), corner(width - 2, height - 2)]
  const ch = (k: number) => Math.max(...cs.map((c) => c[k])) - Math.min(...cs.map((c) => c[k]))
  const uniform = ch(0) < 24 && ch(1) < 24 && ch(2) < 24
  if (uniform) {
    const bg = [
      Math.round(cs.reduce((s, c) => s + c[0], 0) / 4),
      Math.round(cs.reduce((s, c) => s + c[1], 0) / 4),
      Math.round(cs.reduce((s, c) => s + c[2], 0) / 4),
    ]
    for (let p = 0; p < n; p++) {
      const i = p * 4
      const dist = Math.max(
        Math.abs(data[i] - bg[0]),
        Math.abs(data[i + 1] - bg[1]),
        Math.abs(data[i + 2] - bg[2]),
      )
      a[p] = keyCurve(dist)
    }
    return { alpha: a, width, height }
  }

  // 3. Complex background → fal birefnet, then use its alpha.
  logger.info('[newsletter/logo-process] complex background → birefnet fallback')
  const cut = await birefnetCutout(sourceUrl)
  const { data: cd, info: ci } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cn = ci.width * ci.height
  const ca = Buffer.alloc(cn)
  for (let p = 0; p < cn; p++) ca[p] = cd[p * 4 + 3]
  return { alpha: ca, width: ci.width, height: ci.height }
}

function alphaBBox({ alpha, width, height }: Mask): BBox {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Solid-colour RGBA from the mask, cropped to content (two passes — sharp can't extract+joinChannel in one). */
async function recolor(mask: Mask, rgb: { r: number; g: number; b: number }, bbox: BBox): Promise<Buffer> {
  const { width, height, alpha } = mask
  const solid = await sharp({ create: { width, height, channels: 3, background: rgb } }).raw().toBuffer()
  const composed = await sharp(solid, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
  return sharp(composed).extract(bbox).png().toBuffer()
}

/** Original-colour RGBA: the source pixels under the mask's alpha, cropped. */
export async function colorCutout(srcBuf: Buffer, mask: Mask, bbox: BBox): Promise<Buffer> {
  const rgb = await sharp(srcBuf)
    .resize(mask.width, mask.height, { fit: 'fill' }) // no-op unless birefnet resized
    .removeAlpha()
    .raw()
    .toBuffer()
  const composed = await sharp(rgb, { raw: { width: mask.width, height: mask.height, channels: 3 } })
    .joinChannel(mask.alpha, { raw: { width: mask.width, height: mask.height, channels: 1 } })
    .png()
    .toBuffer()
  return sharp(composed).extract(bbox).png().toBuffer()
}

/** Avg WCAG relative luminance of a PNG's opaque (alpha>128) pixels. */
export async function avgOpaqueLuminance(pngBuf: Buffer): Promise<number> {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  let sum = 0
  let count = 0
  for (let p = 0; p < info.width * info.height; p++) {
    const i = p * 4
    if (data[i + 3] > 128) {
      sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2])
      count++
    }
  }
  return count ? sum / count : 0.5
}

/**
 * Pick the logo asset for an arbitrary background: the true-color logo when it
 * reads against the band (contrast >= 2.5), else the silhouette the band's
 * luminance calls for. Newsletter headers honor the client's explicit variant
 * choice instead (render.ts pickLogo); this is for the automatic surfaces
 * (quiz, linktree). Social slides + diagram watermarks stay silhouette-only by
 * design (user decision 2026-09-16: branding, not color).
 */
export function pickBrandLogoForBackground(
  b: {
    nlLogoColorUrl?: string | null
    nlLogoColorLuminance?: number | null
    nlLogoLightUrl?: string | null
    nlLogoDarkUrl?: string | null
    nlLogoUrl?: string | null
  },
  bgHex: string,
): string | null {
  const hexLum = (hex: string): number => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return 0.5
    const n = parseInt(m[1], 16)
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  }
  const bgLum = hexLum(bgHex)
  const color = b.nlLogoColorUrl?.trim() || null
  const light = b.nlLogoLightUrl?.trim() || null
  const dark = b.nlLogoDarkUrl?.trim() || null
  const legacy = b.nlLogoUrl?.trim() || null
  if (color && typeof b.nlLogoColorLuminance === 'number') {
    const [hi, lo] = b.nlLogoColorLuminance >= bgLum ? [b.nlLogoColorLuminance, bgLum] : [bgLum, b.nlLogoColorLuminance]
    if ((hi + 0.05) / (lo + 0.05) >= 2.5) return color
  }
  return bgLum < 0.5 ? light ?? dark ?? color ?? legacy : dark ?? light ?? color ?? legacy
}

/**
 * Generate + store light/dark/colour transparent variants from a source logo URL.
 * `darkHex` is the colour of the dark variant (for light backgrounds).
 */
export async function processLogo(
  userId: string,
  sourceUrl: string,
  darkHex = '#011328',
  // Storage key prefix. Defaults to the newsletter location; callers that store
  // variants elsewhere (e.g. diagram watermarks) pass a distinct base so
  // deleteOldVersions never prunes another feature's logo objects.
  keyBase = `newsletter/logos/${userId}`,
): Promise<ProcessedLogo> {
  const srcBuf = await downloadImageFromUrl(sourceUrl)
  const mask = await buildMask(srcBuf, sourceUrl)
  const bbox = alphaBBox(mask)

  const lightBuf = await recolor(mask, { r: 255, g: 255, b: 255 }, bbox)
  const darkBuf = await recolor(mask, hexToRgb(darkHex), bbox)
  const colorBuf = await colorCutout(srcBuf, mask, bbox)
  const colorLuminance = await avgOpaqueLuminance(colorBuf)

  const base = keyBase
  const lightKey = `${base}-light-${vtoken()}.png`
  const darkKey = `${base}-dark-${vtoken()}.png`
  const colorKey = `${base}-color-${vtoken()}.png`
  const [{ url: lightUrl }, { url: darkUrl }, { url: colorUrl }] = await Promise.all([
    uploadBufferWithKey(lightKey, lightBuf, 'image/png'),
    uploadBufferWithKey(darkKey, darkBuf, 'image/png'),
    uploadBufferWithKey(colorKey, colorBuf, 'image/png'),
  ])
  await deleteOldVersions(`${base}-light-`, lightKey)
  await deleteOldVersions(`${base}-dark-`, darkKey)
  await deleteOldVersions(`${base}-color-`, colorKey)

  logger.info({ userId, colorLuminance }, '[newsletter/logo-process] generated light + dark + colour variants')
  return { lightUrl, darkUrl, colorUrl, colorLuminance, contentWidth: bbox.width, contentHeight: bbox.height }
}
