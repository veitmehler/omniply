import path from 'path'
import { readFile } from 'fs/promises'
import sharp, { type OverlayOptions } from 'sharp'
import { fal } from '@fal-ai/client'
import { getSystemApiKey } from '../../lib/system-keys'
import { logger } from '../../lib/logger'
import { generateFeaturedImage } from '../../article-pipeline/image-generation'
import type { SocialBrandTheme } from '../brand-theme'
import type { TintScheme } from './brand-tint'
import { centeredTextLines, escapeXml, leftAlignedTextLines, wrapText } from '../svg-utils'
import { withTimeout } from '../../lib/net/with-timeout'
import { withRetry } from '../../lib/net/retry'
import { generateWithGeminiImage, prisma } from '@omniply/shared'

/** Per-image cost for Gemini image models (~1290 output tokens), mirrored from diagram-restyle. */
const GEMINI_IMAGE_COST_USD = 0.039
import { instrumentCall } from '../../lib/net/instrument'

/** Bound Fal image calls so a hang can't wedge a run (see with-timeout.ts). */
const FAL_IMAGE_TIMEOUT_MS = 3 * 60 * 1000

export type CarouselSlideType = 'hook' | 'content' | 'cta'

export interface CarouselSlidePlan {
  type: CarouselSlideType
  headlineText: string | null
  bodyText: string | null
  imagePrompt: string
}

export interface CarouselSlideInput {
  slide: CarouselSlidePlan
  slideIndex: number
  totalSlides: number
  brand: SocialBrandTheme
  logoBuffer?: Buffer | null
  /** F4 diagram-background mode: more opaque title box + a carousel arrow on the hook. */
  diagramMode?: boolean
  /** Pre-loaded continuation-arrow glyph (color already chosen) for the hook slide. */
  arrowBuffer?: Buffer | null
  /** Story slides (engagement v2): short texts render LARGER (52px base, 36px floor). */
  storyMode?: boolean
  /** F4 panel scheme: 'light' (dark diagram) → white panel/navy text; 'dark' → navy panel/white text. */
  diagramVariant?: 'light' | 'dark'
  /**
   * Wed/Sat brand-tint design (mutually exclusive with diagramMode): full-frame
   * brand-color wash, centered text, logo bottom-right. See brand-tint.ts.
   */
  tint?: TintScheme
  /** Pre-loaded light/dark logo variant for tinted slides (composited bottom-right). */
  tintLogoBuffer?: Buffer | null
}

const SLIDE_SIZE = 1080

/**
 * Load the bundled continuation-arrow glyph in the color that contrasts the
 * diagram background. `light` (light watermark = dark bg) → white arrows;
 * `dark` → black arrows. Best-effort: returns null if the asset is missing.
 */
export async function loadContinuationArrow(variant: 'light' | 'dark'): Promise<Buffer | null> {
  const file = variant === 'dark' ? 'continue-arrows-black.png' : 'continue-arrows-white.png'
  try {
    return await readFile(path.join(process.cwd(), 'assets', file))
  } catch (err) {
    logger.warn({ err, file }, '[carousel] continuation-arrow asset missing')
    return null
  }
}

// Patched per-weight Helvetica Neue family names (registered with fontconfig).
const FONT_MEDIUM = 'HelveticaNeue Medium'
const FONT_LIGHT  = 'HelveticaNeue Light'

// F4 (diagram-background) panel scheme: white translucent panel + brand-navy
// text/arrows, with one shared opacity across the title, content, and explainer
// slides so they read consistently over the diagram.
const F4_PANEL_BG = '#FFFFFF'
const F4_TEXT = '#011328' // brand navy
const F4_TEXT_RGB = { r: 1, g: 19, b: 40 } // #011328
const F4_PANEL_OPACITY = 0.85   // title + explainer white banners
const F4_CONTENT_OPACITY = 0.9  // content half-panel (slightly more opaque)
const F4_CTA_OPACITY = 0.85     // CTA stays dark full-frame, just more opaque

/**
 * F4 panel color scheme by logo variant — the panel always contrasts the diagram:
 *  - 'light' (light logo → dark diagram): white panel + navy text.
 *  - 'dark'  (dark logo → light diagram): navy panel + white text.
 * It's the two brand colors (#FFFFFF / #011328) swapping roles.
 */
function f4Scheme(variant: 'light' | 'dark' | undefined): {
  panelBg: string
  text: string
  textRgb: { r: number; g: number; b: number }
} {
  if (variant === 'dark') {
    return { panelBg: F4_TEXT, text: F4_PANEL_BG, textRgb: { r: 255, g: 255, b: 255 } }
  }
  return { panelBg: F4_PANEL_BG, text: F4_TEXT, textRgb: F4_TEXT_RGB }
}

/** Recolor a transparent glyph PNG to a solid RGB, preserving its alpha. */
async function tintGlyph(buf: Buffer, rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i += 4) { out[i] = rgb.r; out[i + 1] = rgb.g; out[i + 2] = rgb.b }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

// ── Hook slide ───────────────────────────────────────────────────────────────
// Full background visible. Dark semi-transparent rounded box sits only behind
// the headline. Headline centered, HelveticaNeue Medium 52px, 22 chars/line.
function buildHookSlideOverlaySvg(input: CarouselSlideInput): string {
  const { slide, brand } = input
  // F4 (diagram mode) bakes the logo into the diagram, so skip the name watermark.
  const watermark = input.diagramMode ? '' : escapeXml(brand.organizationName)

  const fontSize   = 52
  const lineHeight = 68
  const maxChars   = 22
  const maxLines   = 5

  // If headlineText is absent, fall back to the first line of bodyText so the
  // hook slide always has visible text even when the LLM omitted the headline.
  const displayText = slide.headlineText?.trim() || slide.bodyText?.split('\n')[0]?.trim() || ''

  const lines = wrapText(displayText, maxChars, maxLines)
  const textBlockHeight = lines.length * lineHeight

  const boxPadV = 40
  const boxPadH = 60
  const boxW    = SLIDE_SIZE - 2 * boxPadH
  const boxH    = Math.max(textBlockHeight + 2 * boxPadV, 2 * boxPadV + fontSize)
  const boxX    = boxPadH
  const boxY    = Math.round((SLIDE_SIZE - boxH) / 2) - 40
  const textStartY = boxY + boxPadV + fontSize

  const textSvg = centeredTextLines(lines, SLIDE_SIZE / 2, textStartY, lineHeight)

  // F4 (diagram mode): a full-width translucent banner whose colors contrast the
  // diagram (light variant → white/navy, dark variant → navy/white). Other
  // carousels keep the padded dark box + white text.
  const isF4 = !!input.diagramMode
  const scheme = f4Scheme(input.diagramVariant)
  const boxFill    = isF4 ? scheme.panelBg : '#000000'
  const boxOpacity = isF4 ? F4_PANEL_OPACITY : 0.65
  const textFill   = isF4 ? scheme.text : '#FFFFFF'
  const rectX  = isF4 ? 0 : boxX
  const rectW  = isF4 ? SLIDE_SIZE : boxW
  const rectRx = isF4 ? 0 : 6
  const boxSvg = displayText
    ? `<rect x="${rectX}" y="${boxY}" width="${rectW}" height="${boxH}" rx="${rectRx}" fill="${boxFill}" fill-opacity="${boxOpacity}"/>`
    : ''
  const textElement = displayText
    ? `<text text-anchor="middle" font-family="${FONT_MEDIUM}" font-size="${fontSize}" fill="${textFill}">\n    ${textSvg}\n  </text>`
    : ''

  return `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  ${boxSvg}
  ${textElement}
  <text x="${SLIDE_SIZE - 32}" y="${SLIDE_SIZE - 28}" text-anchor="end" font-family="${FONT_LIGHT}" font-size="20" fill="#FFFFFF" opacity="0.6">${watermark}</text>
</svg>`
}

// ── Content slides ───────────────────────────────────────────────────────────
// Dark half-panel alternates left/right based on slideIndex (1st content = left,
// 2nd = right, etc.). Hook is index 0 so content slides start at index 1 — odd
// content indices are left panels, even content indices are right panels.
// Optional headline: HelveticaNeue Medium 42px, 22 chars/line.
// Body text: HelveticaNeue Light 28px, 29 chars/line; paragraphs split on \n.
function buildContentSlideOverlaySvg(input: CarouselSlideInput): string {
  const { slide, slideIndex, brand } = input
  // F4 (diagram mode) bakes the logo into the diagram, so skip the name watermark.
  const watermark = input.diagramMode ? '' : escapeXml(brand.organizationName)

  // F4: translucent panel whose colors contrast the diagram (same scheme as the title).
  const isF4 = !!input.diagramMode
  const scheme = f4Scheme(input.diagramVariant)
  const panelFill = isF4 ? scheme.panelBg : '#000000'
  const panelOpacity = isF4 ? F4_CONTENT_OPACITY : 0.65
  const textFill = isF4 ? scheme.text : '#FFFFFF'

  // Alternate: odd slideIndex = left panel, even = right panel.
  // (slideIndex 0 is the hook, so first content slide is index 1 → left.)
  const isRightPanel = slideIndex % 2 === 0

  const panelX = isRightPanel ? SLIDE_SIZE / 2 : 0
  const textX  = isRightPanel ? SLIDE_SIZE / 2 + 52 : 52

  const startY         = 68
  const headlineFontSz = 44
  const headlineLineH  = 56
  const headlineMaxC   = 20
  const headlineMaxL   = 3
  // 2026-09-03 bump (parity with the tinted-slide sizes): the half-panel
  // body ran 28px with a fixed 29-char wrap, producing small ragged text.
  const bodyFontSz     = 34
  const bodyLineH      = 48
  const bodyMaxChars   = Math.max(20, Math.floor((SLIDE_SIZE / 2 - 2 * 52) / (34 * 0.52)))
  // Allow the body to fill the available vertical space rather than truncating
  // at 7 lines — narration reads the full text, so the slide must show it too.
  // The currentY overflow guard below still prevents drawing past the frame.
  const bodyMaxLines   = 18
  const paragraphGap   = 18
  const headBodyGap    = 26

  let currentY = startY
  const tspans: string[] = []

  // Optional headline
  if (slide.headlineText) {
    const headLines = wrapText(slide.headlineText, headlineMaxC, headlineMaxL)
    tspans.push(
      `<text font-family="${FONT_MEDIUM}" font-size="${headlineFontSz}" fill="${textFill}">` +
      leftAlignedTextLines(headLines, textX, currentY + headlineFontSz, headlineLineH) +
      `</text>`,
    )
    currentY += headLines.length * headlineLineH + headBodyGap
  }

  // Body paragraphs (split on \n)
  const paragraphs = (slide.bodyText ?? '').split('\n').filter((p) => p.trim().length > 0)
  const bodyTspans: string[] = []
  for (const para of paragraphs) {
    const lines = wrapText(para.trim(), bodyMaxChars, bodyMaxLines)
    for (const line of lines) {
      bodyTspans.push(`<tspan x="${textX}" y="${currentY + bodyFontSz}">${escapeXml(line)}</tspan>`)
      currentY += bodyLineH
    }
    currentY += paragraphGap
    if (currentY > SLIDE_SIZE - 60) break
  }

  const bodyBlock = bodyTspans.length > 0
    ? `<text font-family="${FONT_LIGHT}" font-size="${bodyFontSz}" fill="${textFill}">${bodyTspans.join('')}</text>`
    : ''

  return `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${panelX}" y="0" width="${SLIDE_SIZE / 2}" height="${SLIDE_SIZE}" fill="${panelFill}" fill-opacity="${panelOpacity}"/>
  ${tspans.join('\n  ')}
  ${bodyBlock}
  <text x="${SLIDE_SIZE - 32}" y="${SLIDE_SIZE - 28}" text-anchor="end" font-family="${FONT_LIGHT}" font-size="20" fill="#FFFFFF" opacity="0.6">${watermark}</text>
</svg>`
}

// ── CTA slide ────────────────────────────────────────────────────────────────
// Full-frame dark overlay. Headline centered, HelveticaNeue Medium 48px,
// 22 chars/line. Body text HelveticaNeue Light 28px, 35 chars/line.
function buildCtaSlideOverlaySvg(input: CarouselSlideInput): string {
  const { slide, brand } = input
  // F4 (diagram mode) bakes the logo into the diagram, so skip the name watermark.
  const watermark = input.diagramMode ? '' : escapeXml(brand.organizationName)

  const textX          = 80
  const headlineFontSz = 48
  const headlineLineH  = 62
  const headlineMaxC   = 22
  const headlineMaxL   = 3
  const bodyFontSz     = 28
  const bodyLineH      = 40
  const bodyMaxChars   = 35
  const bodyMaxLines   = 6
  const paragraphGap   = 14
  const headBodyGap    = 32

  // Build headline lines first to compute total block height for centering
  const headLines = slide.headlineText
    ? wrapText(slide.headlineText, headlineMaxC, headlineMaxL)
    : []
  const paragraphs = (slide.bodyText ?? '').split('\n').filter((p) => p.trim().length > 0)
  const bodyLineGroups = paragraphs.map((p) => wrapText(p.trim(), bodyMaxChars, bodyMaxLines))
  const totalBodyLines = bodyLineGroups.reduce((n, g) => n + g.length, 0)
  const totalBodyGaps  = bodyLineGroups.length > 0 ? bodyLineGroups.length - 1 : 0

  const headlineBlockH = headLines.length * headlineLineH
  const bodyBlockH     = totalBodyLines * bodyLineH + totalBodyGaps * paragraphGap
  const gapH           = headLines.length > 0 && totalBodyLines > 0 ? headBodyGap : 0
  const totalH         = headlineBlockH + gapH + bodyBlockH

  let currentY = Math.round((SLIDE_SIZE - totalH) / 2)

  const elements: string[] = []

  if (headLines.length > 0) {
    elements.push(
      `<text text-anchor="left" font-family="${FONT_MEDIUM}" font-size="${headlineFontSz}" fill="#FFFFFF">` +
      leftAlignedTextLines(headLines, textX, currentY + headlineFontSz, headlineLineH) +
      `</text>`,
    )
    currentY += headlineBlockH + headBodyGap
  }

  const bodyTspans: string[] = []
  for (const lines of bodyLineGroups) {
    for (const line of lines) {
      bodyTspans.push(`<tspan x="${textX}" y="${currentY + bodyFontSz}">${escapeXml(line)}</tspan>`)
      currentY += bodyLineH
    }
    currentY += paragraphGap
  }

  if (bodyTspans.length > 0) {
    elements.push(
      `<text font-family="${FONT_LIGHT}" font-size="${bodyFontSz}" fill="#FFFFFF">${bodyTspans.join('')}</text>`,
    )
  }

  // CTA stays a dark full-frame overlay (intentionally different from the white
  // F4 panels); F4 just uses a slightly more opaque scrim.
  const ctaOpacity = input.diagramMode ? F4_CTA_OPACITY : 0.70

  return `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" fill="#000000" fill-opacity="${ctaOpacity}"/>
  ${elements.join('\n  ')}
  <text x="${SLIDE_SIZE - 32}" y="${SLIDE_SIZE - 28}" text-anchor="end" font-family="${FONT_LIGHT}" font-size="20" fill="#FFFFFF" opacity="0.6">${watermark}</text>
</svg>`
}

// ── Brand-tinted slides (Wed/Sat) ────────────────────────────────────────────
// One uniform treatment for hook, content, and CTA slides: full-frame brand
// wash at the scheme's opacity, headline + body JUSTIFIED as a single centered
// block — lines flush both edges. librsvg ignores SVG's textLength AND
// word-spacing, so justification is done by measuring each line's natural
// width (render + trim) and distributing the deficit as letter-spacing.
// A paragraph's last line and short lines stay natural (standard justify).
// Logo composited bottom-right in renderCarouselSlide (PNG buffer, not SVG).
// No org-name text watermark — the logo replaces it.

// Text must stay clear of the bottom-right logo zone (logo ~140px wide + 48px
// margins), so the centering region ends above it.
const TINT_TEXT_TOP = 140
const TINT_TEXT_BOTTOM = 880
// Only stretch a line to the block width when its natural width fills ≥72% of
// it — stretching shorter lines reads gappy.
const JUSTIFY_MIN_FILL = 0.72

/** Measure a text line's natural rendered width for a font family/size (render + trim). */
async function measureLineWidth(text: string, fontFamily: string, fontSize: number): Promise<number> {
  const svg = `<svg width="${SLIDE_SIZE * 2}" height="${Math.ceil(fontSize * 2)}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="${Math.round(fontSize * 1.3)}" font-family="${fontFamily}" font-size="${fontSize}" fill="#000">${escapeXml(text)}</text></svg>`
  try {
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true })
    return info.width
  } catch {
    return Math.round(text.length * fontSize * 0.5) // char-count estimate fallback
  }
}

/**
 * One justified line as its own <text> element: flush-left at x0; when it is
 * not a paragraph's last line and fills enough of the block, the width deficit
 * is spread across the glyph gaps via letter-spacing (librsvg applies it to
 * the n−1 gaps between characters).
 */
async function justifiedLineSvg(
  line: string,
  x0: number,
  y: number,
  blockW: number,
  fontFamily: string,
  fontSize: number,
  fill: string,
  isLast: boolean,
): Promise<string> {
  let spacing = 0
  if (!isLast && line.length > 1) {
    const natural = await measureLineWidth(line, fontFamily, fontSize)
    if (natural < blockW && natural / blockW >= JUSTIFY_MIN_FILL) {
      spacing = (blockW - natural) / (line.length - 1)
    }
  }
  const spacingAttr = spacing > 0 ? ` letter-spacing="${spacing.toFixed(2)}"` : ''
  return `<text x="${x0}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" fill="${fill}"${spacingAttr}>${escapeXml(line)}</text>`
}

/**
 * Hook (title) slide: full-width banner behind a CENTER-ALIGNED title spanning
 * ~80% of the slide width. Banner/text colors are scheme-inverted relative to
 * the body scheme so the title always pops against the tint:
 *  - white-text scheme (dark brand): white banner @0.92, title in the brand color
 *  - dark-text scheme (light brand): dark banner, white title
 * Returns the banner's bottom Y so the compositor can center the swipe arrows
 * exactly between banner and logo.
 */
async function buildTintedHookOverlaySvg(
  input: CarouselSlideInput,
): Promise<{ svg: string; bannerBottom: number }> {
  const { slide } = input
  const tint = input.tint!

  const fontSize = 56
  const lineH = 72
  const padV = 40
  const regionH = TINT_TEXT_BOTTOM - TINT_TEXT_TOP

  // 84% width text zone at 56px HelveticaNeue Medium (~0.52em avg advance).
  // (Global bump 2026-08-24: tinted slides read too small in-feed.)
  const textZoneW = Math.round(SLIDE_SIZE * 0.84)
  const maxChars = Math.max(20, Math.floor(textZoneW / (fontSize * 0.52)))

  const displayText = slide.headlineText?.trim() || slide.bodyText?.split('\n')[0]?.trim() || ''
  const lines = wrapText(displayText, maxChars, 5)
  const blockH = lines.length * lineH

  const blockTop = TINT_TEXT_TOP + Math.max(0, Math.round((regionH - blockH) / 2))
  const bannerY = blockTop - padV
  const bannerH = blockH + 2 * padV
  const bannerBottom = bannerY + bannerH

  const lightScheme = tint.textColor === '#FFFFFF'
  const bannerFill = lightScheme ? '#FFFFFF' : '#000000'
  const bannerOpacity = lightScheme ? 0.92 : 0.55
  const titleFill = lightScheme ? tint.overlayColor : '#FFFFFF'

  const textSvg = centeredTextLines(lines, SLIDE_SIZE / 2, blockTop + fontSize, lineH)

  const svg = `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" fill="${tint.overlayColor}" fill-opacity="${tint.overlayOpacity}"/>
  <rect x="0" y="${bannerY}" width="${SLIDE_SIZE}" height="${bannerH}" fill="${bannerFill}" fill-opacity="${bannerOpacity}"/>
  <text text-anchor="middle" font-family="${FONT_MEDIUM}" font-size="${fontSize}" fill="${titleFill}">
    ${textSvg}
  </text>
</svg>`
  return { svg, bannerBottom }
}

async function buildTintedSlideOverlaySvg(
  input: CarouselSlideInput,
): Promise<{ svg: string; blockBottom: number }> {
  const { slide } = input
  const tint = input.tint!

  // Numbered list slides (story mode): a leading "N. " on the body text is
  // stripped and rendered as an oversized numeral above the text block
  // (user 2026-09-04: one enumerated item per slide, large number in design).
  const listNum = input.storyMode
    ? ((slide.bodyText ?? '').trim().match(/^(\d{1,2})\.\s+/)?.[1] ?? null)
    : null
  const numeralFs = 180
  const numeralGap = 36
  const numeralBlockH = listNum ? numeralFs + numeralGap : 0

  const headlineFontSz = 56
  const headlineLineH = 72
  const headlineMaxChars = 22
  const headBodyGap = 34
  const paragraphGap = 16
  // Story slides reserve the 780-880 band for the FIXED swipe arrow (arrow
  // jumped around when anchored to the text block — user 2026-09-03).
  const regionBottom = input.storyMode ? 780 : TINT_TEXT_BOTTOM
  const regionH = regionBottom - TINT_TEXT_TOP

  const headLines = slide.headlineText ? wrapText(slide.headlineText, headlineMaxChars, 4) : []
  const headlineBlockH = headLines.length * headlineLineH

  // Auto-fit the body: shrink until the whole block fits the centering region.
  // Global bump 2026-08-24 (user: tinted text too small/narrow in-feed):
  // base 38px wrapping ~30 chars, floor raised to 30px (was 30px base with a
  // 22px floor).
  const bodyTextClean = listNum
    ? (slide.bodyText ?? '').trim().replace(/^\d{1,2}\.\s+/, '')
    : (slide.bodyText ?? '')
  const paragraphs = bodyTextClean.split('\n').filter((p) => p.trim().length > 0)
  // Story slides: a line starting with "- " renders as a bullet point with a
  // hanging indent (user 2026-09-04: task lists read as prose otherwise).
  const bulletFlags = paragraphs.map((p) => input.storyMode === true && /^-\s+/.test(p.trim()))
  const paraTexts = paragraphs.map((p) => p.trim().replace(/^-\s+/, ''))
  // Story slides carry 20-35 words by design — start larger so short text
  // fills the frame instead of floating in it.
  const baseFs = input.storyMode ? 52 : 38
  const floorFs = input.storyMode ? 36 : 30
  let bodyFontSz = baseFs
  let bodyLineH = Math.round(baseFs * 1.4)
  let bodyGroups: string[][] = []
  let bodyBlockH = 0
  for (let fs = baseFs; fs >= floorFs; fs -= 2) {
    const lineH = Math.round(fs * 1.4)
    const maxChars = input.storyMode
      ? Math.max(18, Math.floor((SLIDE_SIZE - 2 * 100) / (fs * 0.52)))
      : Math.max(24, Math.round(30 * (fs / 38)))
    const groups = paraTexts.map((p, gi) => wrapText(p, bulletFlags[gi] ? Math.max(10, maxChars - 2) : maxChars, 99))
    const lines = groups.reduce((n, g) => n + g.length, 0)
    const gaps = groups.length > 0 ? (groups.length - 1) * paragraphGap : 0
    const h = lines * lineH + gaps
    const gap = headLines.length > 0 && lines > 0 ? headBodyGap : 0
    bodyFontSz = fs
    bodyLineH = lineH
    bodyGroups = groups
    bodyBlockH = h
    if (numeralBlockH + headlineBlockH + gap + h <= regionH) break
  }

  // With the raised shrink floor, an unusually long slide can still overflow
  // the region — trim trailing body lines to fit and mark the cut with an
  // ellipsis rather than drawing into the logo zone.
  {
    const gap = headLines.length > 0 && bodyBlockH > 0 ? headBodyGap : 0
    let available = regionH - numeralBlockH - headlineBlockH - gap
    const kept: string[][] = []
    let used = 0
    let truncated = false
    for (const group of bodyGroups) {
      const groupGap = kept.length > 0 ? paragraphGap : 0
      const keepLines: string[] = []
      for (const line of group) {
        if (used + groupGap + (keepLines.length + 1) * bodyLineH > available) {
          truncated = true
          break
        }
        keepLines.push(line)
      }
      if (keepLines.length > 0) {
        kept.push(keepLines)
        used += groupGap + keepLines.length * bodyLineH
      }
      if (truncated) break
    }
    if (truncated && kept.length > 0) {
      const last = kept[kept.length - 1]
      last[last.length - 1] = last[last.length - 1].replace(/[.,;:\s]*$/, '') + '…'
    }
    if (truncated) {
      bodyGroups = kept
      bodyBlockH = used
    }
    void available
  }

  const gapH = headLines.length > 0 && bodyBlockH > 0 ? headBodyGap : 0
  const totalH = numeralBlockH + headlineBlockH + gapH + bodyBlockH
  let currentY = TINT_TEXT_TOP + Math.max(0, Math.round((regionH - totalH) / 2))

  // One shared block width so headline and body justify to the same edges,
  // centered on the slide: the widest measured line, capped to safe margins.
  const headWidths = await Promise.all(headLines.map((l) => measureLineWidth(l, FONT_MEDIUM, headlineFontSz)))
  const bodyWidths = await Promise.all(
    bodyGroups.flat().map((l) => measureLineWidth(l, FONT_LIGHT, bodyFontSz)),
  )
  const widest = Math.max(0, ...headWidths, ...bodyWidths)
  const blockW = Math.min(Math.max(widest, 320), SLIDE_SIZE - 2 * 100)
  const x0 = Math.round((SLIDE_SIZE - blockW) / 2)

  const elements: string[] = []

  if (listNum) {
    elements.push(
      `<text x="${x0}" y="${currentY + Math.round(numeralFs * 0.78)}" font-family="${FONT_MEDIUM}" font-size="${numeralFs}" fill="${tint.textColor}">${listNum}</text>`,
    )
    currentY += numeralBlockH
  }

  for (let i = 0; i < headLines.length; i++) {
    if (input.storyMode) {
      // Story slides: LEFT-aligned natural lines inside the horizontally
      // centered block (centered body text read unprofessional; justification
      // read stretched — user 2026-09-03).
      elements.push(
        `<text x="${x0}" y="${currentY + headlineFontSz + i * headlineLineH}" font-family="${FONT_MEDIUM}" font-size="${headlineFontSz}" fill="${tint.textColor}">${escapeXml(headLines[i])}</text>`,
      )
    } else {
      elements.push(
        await justifiedLineSvg(
          headLines[i], x0, currentY + headlineFontSz + i * headlineLineH,
          blockW, FONT_MEDIUM, headlineFontSz, tint.textColor, i === headLines.length - 1,
        ),
      )
    }
  }
  if (headLines.length > 0) currentY += headlineBlockH + gapH

  for (let gi = 0; gi < bodyGroups.length; gi++) {
    const lines = bodyGroups[gi]
    const isBullet = bulletFlags[gi] === true
    const bulletIndent = isBullet ? Math.round(bodyFontSz * 1.1) : 0
    for (let i = 0; i < lines.length; i++) {
      if (input.storyMode) {
        const lineX = isBullet && i > 0 ? x0 + bulletIndent : x0
        const lineText = isBullet && i === 0 ? `• ${lines[i]}` : lines[i]
        elements.push(
          `<text x="${lineX}" y="${currentY + bodyFontSz}" font-family="${FONT_LIGHT}" font-size="${bodyFontSz}" fill="${tint.textColor}">${escapeXml(lineText)}</text>`,
        )
      } else {
        elements.push(
          await justifiedLineSvg(
            lines[i], x0, currentY + bodyFontSz,
            blockW, FONT_LIGHT, bodyFontSz, tint.textColor, i === lines.length - 1,
          ),
        )
      }
      currentY += bodyLineH
    }
    currentY += paragraphGap
  }

  const blockBottom = TINT_TEXT_TOP + Math.max(0, Math.round((regionH - totalH) / 2)) + totalH

  return {
    svg: `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" fill="${tint.overlayColor}" fill-opacity="${tint.overlayOpacity}"/>
  ${elements.join('\n  ')}
</svg>`,
    blockBottom,
  }
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download carousel background: ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/** Generate a fal.ai background image for one carousel slide. */
const FALLBACK_BG_PROMPT =
  'soft-focus abstract professional background, neutral muted tones, gentle gradient, no text, no people'

/**
 * fal returns an all-black frame when its safety checker flags a prompt or when
 * the prompt is empty. Detect that so we can fall back instead of shipping a
 * black slide.
 */
async function isNearlyBlack(buffer: Buffer): Promise<boolean> {
  try {
    const { channels } = await sharp(buffer).stats()
    return channels.slice(0, 3).every((c) => c.mean < 6)
  } catch {
    return false
  }
}

export async function generateCarouselBackground(
  imagePrompt: string,
  jobId: string,
  model: string = 'fal-ai/flux/schnell',
  userId?: string,
): Promise<Buffer> {
  // An empty prompt makes image models emit a black frame — always send something.
  const promptText = (imagePrompt || '').trim().slice(0, 2000) || FALLBACK_BG_PROMPT

  // Direct Google path for Gemini image models (nano-banana class) — no fal
  // middleman: better rate limits/concurrency, at-worst price parity. Falls
  // back to the fal default model on any failure or near-black result.
  // See .plans/production-throughput.implementation-plan.md Phase 1e.
  if (model.startsWith('gemini')) {
    const geminiKey = await getSystemApiKey('gemini')
    if (geminiKey) {
      try {
        const buf = await instrumentCall({ provider: 'gemini', op: `image:${model}` }, () =>
          withRetry(
            () =>
              withTimeout(
                () => generateWithGeminiImage(geminiKey, promptText, model, '1:1'),
                FAL_IMAGE_TIMEOUT_MS,
                `gemini-image:${model}`,
              ),
            { attempts: 2, onRetry: (err) => logger.warn({ jobId, model, err }, '[carousel] gemini image retrying') },
          ),
        )
        if (!(await isNearlyBlack(buf))) {
          if (userId) {
            await prisma.lLMUsage
              .create({
                data: { userId, source: 'social_carousel_bg', provider: 'gemini', model, inputTokens: 0, outputTokens: 0, cost: GEMINI_IMAGE_COST_USD },
              })
              .catch(() => {})
          }
          return buf
        }
        logger.warn({ jobId, model }, '[carousel] gemini returned a near-black image — falling back to fal')
      } catch (err) {
        logger.warn({ jobId, model, err }, '[carousel] gemini image failed — falling back to fal')
      }
    } else {
      logger.warn({ jobId }, '[carousel] no gemini system key — falling back to fal')
    }
    model = 'fal-ai/flux/schnell'
  }

  const apiKey = await getSystemApiKey('fal-ai')
  if (!apiKey) throw new Error('No Fal.ai system API key configured')

  fal.config({ credentials: apiKey })

  const prompt = promptText

  // Recraft's input schema differs from flux (no steps/safety params; a
  // style selector instead) — and its vector_illustration style is exactly
  // the motif-icon aesthetic (2026-09-03).
  const falInput = model.includes('recraft')
    ? { prompt, image_size: 'square_hd', style: 'vector_illustration' }
    : {
        prompt,
        image_size: 'square_hd',
        num_inference_steps: 4,
        // These are benign on-brand marketing backgrounds; the safety checker
        // false-positives on ordinary scene prompts and returns a black image.
        enable_safety_checker: false,
      }

  const result = await instrumentCall({ provider: 'fal-ai', op: `image:${model}` }, () =>
    withRetry(
      () =>
        withTimeout(
          (signal) =>
            fal.subscribe(model, {
              input: falInput,
              pollInterval: 2000,
              logs: false,
              abortSignal: signal,
            }),
          FAL_IMAGE_TIMEOUT_MS,
          `fal-image:${model}`,
        ),
      {
        attempts: 2,
        onRetry: (err) => logger.warn({ jobId, model, err }, '[carousel] fal image retrying after failure'),
      },
    ),
  )

  const data = result.data as { images?: Array<{ url: string }> }
  const url = data?.images?.[0]?.url
  if (!url) {
    logger.warn({ jobId }, '[carousel] fal returned no URL, falling back to flux-pro')
    const fallbackUrl = await generateFeaturedImage(prompt, jobId)
    return downloadImage(fallbackUrl)
  }

  const buffer = await downloadImage(url)

  // Defensive: if flux still returns a black frame, retry once via flux-pro.
  if (await isNearlyBlack(buffer)) {
    logger.warn({ jobId }, '[carousel] fal returned a black image, falling back to flux-pro')
    try {
      const fallbackUrl = await generateFeaturedImage(prompt, jobId)
      return await downloadImage(fallbackUrl)
    } catch (err) {
      logger.error({ jobId, err }, '[carousel] flux-pro fallback also failed; using black frame')
      return buffer
    }
  }

  return buffer
}

/**
 * Composite one carousel slide: fal background + text overlay.
 *
 * Routes to the correct overlay function based on slide.type:
 *   hook    → centered headline box (full image visible)
 *   content → left-half dark overlay with optional headline + body paragraphs
 *   cta     → full-frame dark overlay with headline + body
 */
export async function renderCarouselSlide(
  backgroundBuffer: Buffer,
  input: CarouselSlideInput,
): Promise<Buffer> {
  let overlaySvg: string
  let hookBannerBottom: number | null = null
  let contentBlockBottom: number | null = null
  if (input.tint) {
    // Brand-tint design: full-width-banner hook, justified block for the rest.
    if (input.slide.type === 'hook') {
      const hook = await buildTintedHookOverlaySvg(input)
      overlaySvg = hook.svg
      hookBannerBottom = hook.bannerBottom
    } else {
      const tinted = await buildTintedSlideOverlaySvg(input)
      overlaySvg = tinted.svg
      contentBlockBottom = tinted.blockBottom
    }
  } else {
    switch (input.slide.type) {
      case 'hook':
        overlaySvg = buildHookSlideOverlaySvg(input)
        break
      case 'cta':
        overlaySvg = buildCtaSlideOverlaySvg(input)
        break
      case 'content':
      default:
        overlaySvg = buildContentSlideOverlaySvg(input)
        break
    }
  }

  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer()

  const resizedBg = await sharp(backgroundBuffer)
    .resize(SLIDE_SIZE, SLIDE_SIZE, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const composites: OverlayOptions[] = [{ input: overlayPng, top: 0, left: 0 }]

  // Tinted slides: logo bottom-right on every slide (48px margins); on the
  // hook slide the swipe arrows sit with their RIGHT edge on the logo's LEFT
  // edge, centered exactly halfway between the title banner and the logo.
  if (input.tint) {
    const LOGO_W = 140
    const MARGIN = 48
    let logoLeft = SLIDE_SIZE - LOGO_W - MARGIN
    let logoTop = SLIDE_SIZE - Math.round(LOGO_W * 0.32) - MARGIN // aspect fallback when no logo loads
    if (input.tintLogoBuffer) {
      try {
        const meta = await sharp(input.tintLogoBuffer).metadata()
        const logoH = Math.round((LOGO_W * (meta.height ?? LOGO_W)) / (meta.width ?? LOGO_W))
        const logoPng = await sharp(input.tintLogoBuffer).resize({ width: LOGO_W }).png().toBuffer()
        logoTop = SLIDE_SIZE - logoH - MARGIN
        composites.push({ input: logoPng, left: logoLeft, top: logoTop })
      } catch (err) {
        logger.warn({ err }, '[carousel] tint logo compositing failed (non-fatal)')
      }
    }

    // Swipe cue: hook slides center the arrows between banner and logo;
    // story content slides (arrowBuffer passed on every non-final slide,
    // 2026-09-03) sit them left of the logo on its baseline.
    if (input.arrowBuffer && (input.slide.type === 'hook' ? hookBannerBottom != null : true)) {
      const ARROW_W = 100
      try {
        const meta = await sharp(input.arrowBuffer).metadata()
        const arrowH = Math.round((ARROW_W * (meta.height ?? 55)) / (meta.width ?? 87))
        const arrowPng = await sharp(input.arrowBuffer).resize({ width: ARROW_W }).png().toBuffer()
        // Content slides: ONE fixed position (center y=830) — the story text
        // region ends at 780, so overlap is impossible and the arrow never
        // jumps between slides.
        const centerY =
          input.slide.type === 'hook' && hookBannerBottom != null
            ? Math.round((hookBannerBottom + logoTop) / 2)
            : 830
        composites.push({
          input: arrowPng,
          left: logoLeft - ARROW_W - (input.slide.type === 'hook' ? 0 : 24),
          top: centerY - Math.round(arrowH / 2),
        })
      } catch (err) {
        logger.warn({ err }, '[carousel] tint arrow compositing failed (non-fatal)')
      }
    }
  }

  // F4 hook slide: add the continuation-arrow swipe indicator, bottom-right,
  // sized small and lifted to clear the logo baked into the diagram's corner.
  if (input.slide.type === 'hook' && input.diagramMode && input.arrowBuffer) {
    const ARROW_W = 100
    const meta = await sharp(input.arrowBuffer).metadata()
    const arrowH = Math.round((ARROW_W * (meta.height ?? 55)) / (meta.width ?? 87))
    const arrowPng = await sharp(input.arrowBuffer).resize({ width: ARROW_W }).png().toBuffer()
    const margin = 48
    const arrowBottom = Math.round(SLIDE_SIZE * 0.74) // sit above the baked-in corner logo
    composites.push({
      input: arrowPng,
      left: SLIDE_SIZE - ARROW_W - margin,
      top: arrowBottom - arrowH,
    })
  }

  return sharp(resizedBg).composite(composites).png().toBuffer()
}

export function carouselSlideDimensions(): { width: number; height: number } {
  return { width: SLIDE_SIZE, height: SLIDE_SIZE }
}

// ── Diagram-explainer slide ────────────────────────────────────────────────────
// Used by F4 (diagram-background carousels): the stylized diagram fills the slide
// with a full-width white translucent banner (same scheme/opacity as the title)
// centered exactly 2/3 down, carrying the navy phrase plus the navy arrow glyph.
export const DIAGRAM_EXPLAINER_TEXT = "Let's explore the diagram"

/** Render text to a tight, transparent PNG (trimmed to the glyphs) so we can measure + center it. */
async function renderTextGlyphPng(text: string, fontSize: number, color = '#FFFFFF'): Promise<{ buf: Buffer; width: number; height: number }> {
  const canvasW = SLIDE_SIZE * 2
  const canvasH = Math.ceil(fontSize * 2)
  const svg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg"><text x="20" y="${Math.round(fontSize * 1.3)}" font-family="${FONT_MEDIUM}" font-size="${fontSize}" fill="${color}">${escapeXml(text)}</text></svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const { data, info } = await sharp(png).trim().png().toBuffer({ resolveWithObject: true })
  return { buf: data, width: info.width, height: info.height }
}

/**
 * Render the diagram background (cover-fit) with a full-width white translucent
 * banner whose content (navy phrase + navy continuation-arrow glyph, centered as
 * one group) sits exactly 2/3 down the slide, with symmetric top/bottom padding.
 */
export async function renderDiagramExplainerSlide(
  backgroundBuffer: Buffer,
  arrowBuffer?: Buffer | null,
  variant?: 'light' | 'dark',
  text: string = DIAGRAM_EXPLAINER_TEXT,
): Promise<Buffer> {
  const fontSize = 56
  const padV     = 48
  const gap      = 28
  const centerY  = Math.round((SLIDE_SIZE * 2) / 3) // exactly 2/3 down
  const scheme   = f4Scheme(variant)

  const { buf: textBuf, width: textW, height: textH } = await renderTextGlyphPng(text, fontSize, scheme.text)

  let arrowPng: Buffer | null = null
  let arrowW = 0
  let arrowH = 0
  if (arrowBuffer) {
    arrowH = Math.round(fontSize * 0.85)
    const meta = await sharp(arrowBuffer).metadata()
    arrowW = Math.round((arrowH * (meta.width ?? 87)) / (meta.height ?? 55))
    // Arrows sit on the panel → tint them to the panel's text color (navy or white).
    const tinted = await tintGlyph(arrowBuffer, scheme.textRgb)
    arrowPng = await sharp(tinted).resize({ height: arrowH }).png().toBuffer()
  }

  const contentH = Math.max(textH, arrowH)
  const bannerH  = contentH + 2 * padV
  const bannerY  = Math.round(centerY - bannerH / 2)
  const groupW   = textW + (arrowPng ? gap + arrowW : 0)
  const startX   = Math.round((SLIDE_SIZE - groupW) / 2)

  const bannerSvg = `<svg width="${SLIDE_SIZE}" height="${SLIDE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${bannerY}" width="${SLIDE_SIZE}" height="${bannerH}" fill="${scheme.panelBg}" fill-opacity="${F4_PANEL_OPACITY}"/>
</svg>`

  const resizedBg = await sharp(backgroundBuffer)
    .resize(SLIDE_SIZE, SLIDE_SIZE, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const composites: OverlayOptions[] = [
    { input: await sharp(Buffer.from(bannerSvg)).png().toBuffer(), top: 0, left: 0 },
    { input: textBuf, left: startX, top: Math.round(centerY - textH / 2) },
  ]
  if (arrowPng) {
    composites.push({ input: arrowPng, left: startX + textW + gap, top: Math.round(centerY - arrowH / 2) })
  }

  return sharp(resizedBg).composite(composites).png().toBuffer()
}

const STORY_W = 1080
const STORY_H = 1920

/**
 * Center-crop a source image buffer to 1080×1920 (9:16) using Sharp.
 * Used by S4/S6 to prepare a raw background before converting to video.
 */
export async function cropBufferToStoryAspect(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(STORY_W, STORY_H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
}

/** Word-wrap without a line cap — used for pitch auto-fit. */
function wrapTextUnlimited(text: string, maxCharsPerLine: number): string[] {
  return wrapText(text, maxCharsPerLine, 99)
}

/** Downward-pointing arrow (vector path, no glyph dependency). */
function buildDownArrowSvg(cx: number, cy: number): string {
  const shaftTop = cy - 28
  const shaftBot = cy + 8
  const headY    = cy + 28
  return `<path
    d="M ${cx} ${shaftTop} L ${cx} ${shaftBot} M ${cx - 18} ${headY - 18} L ${cx} ${headY} L ${cx + 18} ${headY - 18}"
    stroke="#FFFFFF"
    stroke-width="5"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
  />`
}

const PITCH_REGION_TOP    = 280
const PITCH_REGION_BOTTOM = 1380
const PITCH_MAX_HEIGHT    = PITCH_REGION_BOTTOM - PITCH_REGION_TOP
const CTA_FONT_SIZE       = 36
const CTA_LINE_H          = 48
const CTA_MAX_CHARS       = 28
const CTA_MAX_LINES       = 2
const CTA_FIRST_LINE_Y    = STORY_H - 340
const ARROW_CY            = STORY_H - 200

/**
 * Composite a 9:16 story pitch slide: center-crop the source background to
 * 1080×1920, apply a full-frame dark overlay, then render:
 *   - pitch body (upper-center, auto-fit font so nothing is truncated)
 *   - CTA line anchored near the bottom
 *   - drawn downward arrow below the CTA
 */
export async function buildPitchSlidePng(
  backgroundBuffer: Buffer,
  pitchText: string,
  ctaText: string,
): Promise<Buffer> {
  const bg = await sharp(backgroundBuffer)
    .resize(STORY_W, STORY_H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const centerX = STORY_W / 2

  // Auto-fit pitch: shrink font until the full text fits the upper region.
  let pitchFontSize = 48
  let pitchLineH    = 66
  let pitchLines: string[] = []
  let pitchStartY   = PITCH_REGION_TOP

  for (let fs = 48; fs >= 30; fs -= 2) {
    const lineH    = Math.round(fs * 1.375)
    const maxChars = Math.max(20, Math.round(32 * (fs / 48)))
    const lines    = wrapTextUnlimited(pitchText, maxChars)
    const height   = lines.length * lineH
    if (height <= PITCH_MAX_HEIGHT) {
      pitchFontSize = fs
      pitchLineH    = lineH
      pitchLines    = lines
      pitchStartY   = PITCH_REGION_TOP + Math.round((PITCH_MAX_HEIGHT - height) / 2)
      break
    }
    if (fs === 30) {
      pitchFontSize = fs
      pitchLineH    = lineH
      pitchLines    = lines
      pitchStartY   = PITCH_REGION_TOP
    }
  }

  const pitchTspans = pitchLines
    .map((line, i) =>
      `<tspan x="${centerX}" y="${pitchStartY + pitchFontSize + i * pitchLineH}">${escapeXml(line)}</tspan>`,
    )
    .join('')

  const ctaLines = wrapText(ctaText, CTA_MAX_CHARS, CTA_MAX_LINES)
  const ctaTspans = ctaLines
    .map((line, i) =>
      `<tspan x="${centerX}" y="${CTA_FIRST_LINE_Y + CTA_FONT_SIZE + i * CTA_LINE_H}">${escapeXml(line)}</tspan>`,
    )
    .join('')

  const overlaySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}">
  <rect width="${STORY_W}" height="${STORY_H}" fill="rgba(0,0,0,0.72)"/>
  <text
    font-family="${FONT_MEDIUM}"
    font-size="${pitchFontSize}"
    fill="#FFFFFF"
    text-anchor="middle"
    dominant-baseline="auto"
  >${pitchTspans}</text>
  <text
    font-family="${FONT_MEDIUM}"
    font-size="${CTA_FONT_SIZE}"
    fill="#FFFFFF"
    text-anchor="middle"
    dominant-baseline="auto"
    opacity="0.95"
  >${ctaTspans}</text>
  ${buildDownArrowSvg(centerX, ARROW_CY)}
</svg>`

  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer()

  return sharp(bg)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png()
    .toBuffer()
}

const BULLET_TITLE_Y      = 220
const BULLET_TITLE_FONT   = 66
const BULLET_LIST_TOP     = 440
const BULLET_LIST_BOTTOM  = STORY_H - 180
const BULLET_MARGIN_X     = 90

/**
 * Static 9:16 tips story: center-crop the background (the newsletter's overview
 * cover), apply a dark overlay, render a title near the top and a left-aligned
 * bulleted list below it. Font auto-fits so every bullet fits the safe region.
 */
export async function buildBulletStoryPng(
  backgroundBuffer: Buffer,
  title: string,
  bullets: string[],
): Promise<Buffer> {
  const bg = await sharp(backgroundBuffer)
    .resize(STORY_W, STORY_H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const items = bullets.map((b) => b.trim()).filter(Boolean)
  const listHeight = BULLET_LIST_BOTTOM - BULLET_LIST_TOP

  // Auto-fit: shrink font until every wrapped bullet fits the list region.
  let fontSize = 46
  let lineH = 62
  let bulletGap = 26
  let renderedBullets: string[][] = []
  for (let fs = 46; fs >= 28; fs -= 2) {
    const lh = Math.round(fs * 1.35)
    const gap = Math.round(fs * 0.55)
    const maxChars = Math.max(22, Math.round(34 * (fs / 46)))
    const wrapped = items.map((b) => wrapText(b, maxChars, 4))
    const total = wrapped.reduce((sum, lines) => sum + lines.length * lh + gap, 0)
    if (total <= listHeight || fs === 28) {
      fontSize = fs
      lineH = lh
      bulletGap = gap
      renderedBullets = wrapped
      break
    }
  }

  // Build bullet tspans, tracking the running Y so multi-line bullets stack.
  let y = BULLET_LIST_TOP + fontSize
  const bulletSvg = renderedBullets
    .map((lines) => {
      const parts = lines.map((line, i) => {
        const x = BULLET_MARGIN_X + (i === 0 ? 0 : 44)
        const prefix = i === 0 ? '•  ' : ''
        const tspan = `<tspan x="${x}" y="${y}">${escapeXml(`${prefix}${line}`)}</tspan>`
        y += lineH
        return tspan
      })
      y += bulletGap
      return parts.join('')
    })
    .join('')

  const titleLines = wrapText(title, 26, 2)
  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${BULLET_MARGIN_X}" y="${BULLET_TITLE_Y + i * (BULLET_TITLE_FONT + 8)}">${escapeXml(line)}</tspan>`)
    .join('')

  const overlaySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}">
  <rect width="${STORY_W}" height="${STORY_H}" fill="rgba(0,0,0,0.82)"/>
  <text
    font-family="${FONT_MEDIUM}"
    font-size="${BULLET_TITLE_FONT}"
    font-weight="bold"
    fill="#FFFFFF"
    text-anchor="start"
  >${titleTspans}</text>
  <text
    font-family="${FONT_LIGHT}"
    font-size="${fontSize}"
    fill="#FFFFFF"
    text-anchor="start"
  >${bulletSvg}</text>
</svg>`

  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer()

  return sharp(bg)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png()
    .toBuffer()
}
