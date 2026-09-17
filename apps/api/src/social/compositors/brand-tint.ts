/**
 * Brand-tint scheme for the Wed/Sat tinted carousels
 * (.plans/social-brand-tint-carousel.implementation-plan.md).
 *
 * The slide is washed in the brand color at `alpha` opacity, so text sits on a
 * BLEND of brand color and the unknown image beneath: the effective backdrop
 * luminance is bounded to [alpha·L(brand), alpha·L(brand) + (1−alpha)] (image
 * pixel fully black → fully white). Each candidate text color is scored by its
 * WCAG contrast ratio against its own worst-case end of that range; the higher
 * minimum wins. If the winner still misses AA (4.5:1), the overlay opacity is
 * bumped once (0.85 → 0.92) to shrink the image's influence.
 */
import { relativeLuminance } from '../../article-pipeline/enrichment/diagram-theme'

export interface TintScheme {
  /** Normalized #RRGGBB brand color used for the full-frame overlay. */
  overlayColor: string
  /** 0.85 normally; 0.92 when neither text color clears AA at 0.85. */
  overlayOpacity: number
  textColor: '#FFFFFF' | '#111111'
  /** Logo variant paired with the text: light = white logo (dark backdrop). */
  logoVariant: 'light' | 'dark'
}

const DEFAULT_ALPHA = 0.85
const BUMPED_ALPHA = 0.92
const AA_CONTRAST = 4.5
const WHITE_L = 1
const NEAR_BLACK_L = relativeLuminance('#111111')

const HEX_RE = /^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i
/** Fallback when the brand color is unset/invalid — the platform's default navy. */
const FALLBACK_BRAND = '#1E3A5F'

function normalizeHex(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!HEX_RE.test(t)) return FALLBACK_BRAND
  const hex = (t.startsWith('#') ? t : `#${t}`).toUpperCase()
  if (hex.length === 4) {
    const [, r, g, b] = hex
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return hex
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Minimum contrast a text color achieves over the blend range. The worst case
 * is the range end closest to the text's own luminance: for white text that's
 * the lightest possible blend; for dark text the darkest.
 */
function minContrast(textL: number, brandL: number, alpha: number): number {
  const blendLo = alpha * brandL // image pixel black
  const blendHi = alpha * brandL + (1 - alpha) // image pixel white
  return Math.min(contrastRatio(textL, blendLo), contrastRatio(textL, blendHi))
}

export function tintScheme(brandHex: string | null | undefined, alpha = DEFAULT_ALPHA): TintScheme {
  const overlayColor = normalizeHex(brandHex)
  const brandL = relativeLuminance(overlayColor)

  const pick = (a: number) => {
    const white = minContrast(WHITE_L, brandL, a)
    const dark = minContrast(NEAR_BLACK_L, brandL, a)
    // WHITE BIAS (Veit 2026-09-17): white reads better on brand tints — keep
    // it whenever its worst case clears AA, even if near-black scores higher
    // (black-on-teal looked wrong despite winning the worst-case comparison).
    if (white >= AA_CONTRAST) {
      return { textColor: '#FFFFFF' as const, logoVariant: 'light' as const, contrast: white }
    }
    return white >= dark
      ? { textColor: '#FFFFFF' as const, logoVariant: 'light' as const, contrast: white }
      : { textColor: '#111111' as const, logoVariant: 'dark' as const, contrast: dark }
  }

  let overlayOpacity = alpha
  let choice = pick(alpha)
  if (choice.contrast < AA_CONTRAST && alpha < BUMPED_ALPHA) {
    overlayOpacity = BUMPED_ALPHA
    choice = pick(BUMPED_ALPHA)
  }

  return { overlayColor, overlayOpacity, textColor: choice.textColor, logoVariant: choice.logoVariant }
}

/** Client override: force light/dark text (per-post toggle, Veit 2026-09-17). */
export function forcedTintScheme(brandHex: string | null | undefined, mode: 'light' | 'dark'): TintScheme {
  const auto = tintScheme(brandHex)
  return {
    ...auto,
    textColor: mode === 'light' ? '#FFFFFF' : '#111111',
    logoVariant: mode === 'light' ? 'light' : 'dark',
  }
}

/**
 * Second story tint (Veit 2026-09-17): pick the brand color most visually
 * distant from the primary among the extracted palette (secondary + the
 * newsletter section ramp). Returns null when nothing differs enough —
 * callers then keep the primary, i.e. behavior identical to a one-color brand.
 */
export function pickAlternateTintColor(
  primary: string | null | undefined,
  candidates: (string | null | undefined)[],
): string | null {
  const base = normalizeHex(primary)
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const [br, bg, bb] = rgb(base)
  let best: string | null = null
  let bestDist = 0
  for (const raw of candidates) {
    const t = (raw ?? '').trim()
    if (!HEX_RE.test(t)) continue
    const hex = normalizeHex(t)
    if (hex === base) continue
    const [r, g, b] = rgb(hex)
    const dist = Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2)
    if (dist > bestDist) {
      bestDist = dist
      best = hex
    }
  }
  // Below this the two tints read as the same color in a feed — not variety.
  const MIN_DISTANCE = 40
  return bestDist >= MIN_DISTANCE ? best : null
}
