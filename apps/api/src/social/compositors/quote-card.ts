import sharp from 'sharp'
import type { SocialBrandTheme } from '../brand-theme'
import { escapeXml, leftAlignedTextLines, wrapText } from '../svg-utils'

export type QuoteCardVariant = 'feed' | 'story'

export interface QuoteCardInput {
  quoteText: string
  attribution?: string
  variant: QuoteCardVariant
  brand: SocialBrandTheme
  logoBuffer?: Buffer | null
}

const DIMENSIONS: Record<QuoteCardVariant, { width: number; height: number }> = {
  feed: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
}

// ── Layout constants ──────────────────────────────────────────────────────────
// White background, large circular profile photo, account name in black,
// large left-aligned quote text. The header row (logo + name) floats directly
// above the body text with a fixed gap; the combined block is vertically centred.

const PADDING      = 80   // left/right margin
const LOGO_SIZE    = 150  // diameter of the circular profile photo
const HEADER_GAP   = 24   // gap between logo right edge and name text
const HEADER_TEXT_GAP = 50 // vertical gap between bottom of header row and top of body text

const NAME_FONT_SIZE   = 68  // account name
const QUOTE_FONT_FEED  = 64  // body quote text
const QUOTE_FONT_STORY = 60

// Instagram verified badge: blue circle with white tick.
// Scaled to sit neatly after the account name (≈0.85 × NAME_FONT_SIZE).
const BADGE_SIZE = 58 // px

// Each Helvetica Neue weight is registered under a unique family name in the
// bundled TTF name tables (see apps/api/fonts/patch-font-names.py). librsvg
// resolves fonts via fontconfig only — @font-face embedding is unsupported —
// so we select the exact face by family name instead of font-weight matching.
const FONT_NAME_LIGHT = 'HelveticaNeue Light'
const FONT_NAME_BOLD = 'HelveticaNeue Bold'

function buildVerifiedBadgeSvg(size: number): string {
  const r = size / 2
  // The tick path is hand-tuned to look like Instagram's verified badge.
  const tick = `M${size * 0.28},${size * 0.52} L${size * 0.44},${size * 0.68} L${size * 0.72},${size * 0.36}`
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${r}" cy="${r}" r="${r}" fill="#3897F0"/>
  <path d="${tick}" stroke="#FFFFFF" stroke-width="${size * 0.1}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`
}

/**
 * Returns { svg, logoTop } so the compositor can position the logo circle
 * at the same vertical offset that was used when building the SVG.
 */
function buildQuoteCardSvg(
  input: QuoteCardInput,
  namePxWidth: number,
): { svg: string; logoTop: number } {
  const { width, height } = DIMENSIONS[input.variant]
  const isStory = input.variant === 'story'

  const fontSize   = isStory ? QUOTE_FONT_STORY : QUOTE_FONT_FEED
  const lineHeight = Math.round(fontSize * 1.22)
  // Story wrap widened 22 → 27 (Veit 2026-09-19): long quotes rendered as a
  // skinny ribbon. 27 chars ≈ 890px at the 60px story font — clears the
  // 80px margins on the 1080 canvas.
  const maxChars   = isStory ? 27 : 26
  const maxLines   = isStory ? 16 : 10

  const lines = wrapText(input.quoteText, maxChars, maxLines)
  const textBlockHeight = lines.length * lineHeight

  // Combined block: header row (LOGO_SIZE tall) + gap + body text.
  // Centre the whole block vertically on the canvas with PADDING top/bottom guard.
  const combinedHeight = LOGO_SIZE + HEADER_TEXT_GAP + textBlockHeight
  const blockTop = Math.max(
    PADDING,
    Math.round((height - combinedHeight) / 2),
  )
  const logoTop    = blockTop
  const textStartY = blockTop + LOGO_SIZE + HEADER_TEXT_GAP + fontSize

  const nameFont = escapeXml(FONT_NAME_LIGHT)
  const bodyFont = escapeXml(FONT_NAME_LIGHT)
  const nameText = escapeXml(input.brand.socialAccountName)

  // Name baseline: optically centred on the logo circle's midline.
  const logoCentreY   = logoTop + LOGO_SIZE / 2
  const capHalfHeight = Math.round(NAME_FONT_SIZE * 0.72 / 2)
  const nameY = logoCentreY + capHalfHeight
  const nameX = PADDING + LOGO_SIZE + HEADER_GAP

  const badgeX   = nameX + namePxWidth + 12
  const badgeTop = Math.round(logoCentreY - BADGE_SIZE / 2)

  const verifiedBadge = input.brand.instagramVerified
    ? `<image href="data:image/svg+xml;base64,${Buffer.from(buildVerifiedBadgeSvg(BADGE_SIZE)).toString('base64')}" x="${badgeX}" y="${badgeTop}" width="${BADGE_SIZE}" height="${BADGE_SIZE}"/>`
    : ''

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- White background -->
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <!-- Account name: HelveticaNeue Light (same weight as quote body) -->
  <text x="${nameX}" y="${nameY}" font-family="${nameFont}" font-size="${NAME_FONT_SIZE}" fill="#1A1A1A">${nameText}</text>
  ${verifiedBadge}
  <!-- Quote body: HelveticaNeue Light (unique family name) -->
  <text font-family="${bodyFont}" font-size="${fontSize}" fill="#1A1A1A">
    ${leftAlignedTextLines(lines, PADDING, textStartY, lineHeight)}
  </text>
</svg>`

  return { svg, logoTop }
}

/** Estimate the rendered pixel advance width of a string at the given font size.
 *  This is an approximation (no actual font shaping), but good enough for badge placement. */
function estimateTextWidth(text: string, fontSize: number): number {
  // Average character advance ≈ 0.58 × font-size for a bold geometric sans.
  return Math.round(text.length * fontSize * 0.58)
}

/** Composite the logo circle at the computed logoTop position. */
async function compositeLogo(
  pngBuffer: Buffer,
  logoBuffer: Buffer | null | undefined,
  logoTop: number,
  brand: SocialBrandTheme,
): Promise<Buffer> {
  const logoLeft = PADDING

  if (!logoBuffer) {
    // Fallback: coloured circle with the first letter of the account name
    const letter = (brand.socialAccountName[0] ?? 'B').toUpperCase()
    const fallbackSvg = Buffer.from(`<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2}" fill="${escapeXml(brand.primaryColor)}"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(FONT_NAME_BOLD)}" font-size="${Math.round(LOGO_SIZE * 0.45)}" fill="#FFFFFF">${escapeXml(letter)}</text>
    </svg>`)
    const fallbackPng = await sharp(fallbackSvg).png().toBuffer()
    return sharp(pngBuffer)
      .composite([{ input: fallbackPng, left: logoLeft, top: logoTop }])
      .png()
      .toBuffer()
  }

  // Resize logo and clip to circle
  const resized = await sharp(logoBuffer)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' })
    .png()
    .toBuffer()

  const circleMask = Buffer.from(
    `<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}"><circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2}" fill="white"/></svg>`,
  )
  const circularLogo = await sharp(resized)
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toBuffer()

  return sharp(pngBuffer)
    .composite([{ input: circularLogo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer()
}

/** Render a branded quote card PNG (1:1 feed or 9:16 story). */
export async function renderQuoteCard(input: QuoteCardInput): Promise<Buffer> {
  const namePxWidth = estimateTextWidth(input.brand.socialAccountName, NAME_FONT_SIZE)
  const { svg, logoTop } = buildQuoteCardSvg(input, namePxWidth)
  const base = await sharp(Buffer.from(svg)).png().toBuffer()
  return compositeLogo(base, input.logoBuffer, logoTop, input.brand)
}

export function quoteCardDimensions(variant: QuoteCardVariant): { width: number; height: number } {
  return DIMENSIONS[variant]
}
