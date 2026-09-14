/**
 * Deterministic brand-palette composition (palette-extraction v2, Phase C).
 *
 * The vision LLM supplies a brand color INVENTORY (which hues exist, where they
 * were observed, how prominent they are — perception). This module assigns
 * inventory colors to newsletter roles with hard readability rules (arithmetic):
 * same inventory in → same palette out, and a color that fails contrast can
 * never ship. Preference order lives here, not in the prompt.
 */
import type { SemanticPalette } from './site-analysis'

export type Prominence = 'main' | 'supporting' | 'ground'

export interface BrandColor {
  hex: string
  name?: string
  prominence: Prominence
  observedRoles: string[]
  /** Real pixel share 0-1 measured from the screenshot clusters (not LLM-estimated). */
  coverage?: number
  confidence?: number
}

export interface BrandInventory {
  colors: BrandColor[]
}

export interface ComposedPalette extends SemanticPalette {
  /** Button label color (white or the dark header color), computed by contrast. */
  buttonText?: string
  /** Per-role pre-validated alternates the user can tap in the reveal. */
  alternates?: Record<string, string[]>
  /** Per-role human-readable origin: "extracted" | "derived from #x" | "fallback". */
  provenance?: Record<string, string>
}

// ── color math ────────────────────────────────────────────────────────────────

export function normalizeHex(raw: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(raw.trim())
  if (m) return `#${m[1].toLowerCase()}`
  const s = /^#?([0-9a-f]{3})$/i.exec(raw.trim())
  if (s) return `#${s[1].toLowerCase().split('').map((c) => c + c).join('')}`
  return null
}

function channel(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function relLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/**
 * NEWSLETTER button/header label rule (design decision 2026-09-14): prefer a
 * WHITE label on mid-to-dark brand fills even when raw WCAG math would pick
 * dark ink (black-on-teal read as a broken button). Simple perceptual
 * luminance (0–255 weighted, no gamma), mirrored verbatim in
 * newsletter/render.ts which stays import-free. Does NOT replace
 * labelColorFor — the palette-v2 extraction pipeline keeps its locked rules.
 */
export function nlLabelColorFor(fill: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return lum < 150 ? '#ffffff' : '#1c2b33'
}

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  const r = s === 0 ? l : f(hue + 1 / 3)
  const g = s === 0 ? l : f(hue)
  const b = s === 0 ? l : f(hue - 1 / 3)
  return `#${((to255(r) << 16) | (to255(g) << 8) | to255(b)).toString(16).padStart(6, '0')}`
}

/**
 * Walk HSL lightness (keeping hue/saturation) toward readability against `bg`
 * until `target` contrast is met. Returns the adjusted hex and how far the
 * lightness moved (0 = usable as-is), or null if the hue cannot reach target.
 */
export function adjustForContrast(
  hex: string,
  bg: string,
  target = 4.5,
): { hex: string; deltaL: number } | null {
  if (contrastRatio(hex, bg) >= target) return { hex, deltaL: 0 }
  const { h, s, l } = hexToHsl(hex)
  const darkenDirection = relLuminance(bg) >= 0.5 ? -1 : 1
  for (let step = 0.01; step <= 0.6; step += 0.01) {
    const nl = l + darkenDirection * step
    if (nl < 0.02 || nl > 0.98) break
    const candidate = hslToHex(h, s, nl)
    if (contrastRatio(candidate, bg) >= target) return { hex: candidate, deltaL: step }
  }
  return null
}

const dist = (a: string, b: string): number => {
  const na = parseInt(a.slice(1), 16)
  const nb = parseInt(b.slice(1), 16)
  const dr = ((na >> 16) & 255) - ((nb >> 16) & 255)
  const dg = ((na >> 8) & 255) - ((nb >> 8) & 255)
  const db = (na & 255) - (nb & 255)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h) % 360
  return d > 180 ? 360 - d : d
}

// ── composition ───────────────────────────────────────────────────────────────

const CONTRAST_TEXT = 4.5
/** Links must never come from the yellow/orange family (user rule 2026-07-24). */
const BANNED_LINK_HUE: [number, number] = [25, 95]
/** "Bright and alive" gate: a link hue must already be vivid on the homepage. */
const LINK_MIN_SATURATION = 0.35
/** Header band must be dark enough to carry the light logo. */
const HEADER_MAX_LUMINANCE = 0.5
/** Button "pop" gate: vividness + distance off both body and header (chroma, not luminance). */
const BUTTON_MIN_SATURATION = 0.5
const BUTTON_LIGHTNESS_RANGE: [number, number] = [0.3, 0.85]
const POP_MIN_DISTANCE = 60

interface Candidate extends BrandColor {
  hex: string
}

function saturationOf(hex: string): number {
  return hexToHsl(hex).s
}

/**
 * Button label color: white or the (dark) header color — whichever reads best
 * on the fill; plain dark ink when the header itself is light.
 */
export function labelColorFor(fill: string, headerBackground: string): string {
  const candidates =
    relLuminance(headerBackground) < 0.4 ? ['#ffffff', headerBackground, '#1c2b33'] : ['#ffffff', '#1c2b33']
  const passing = candidates.find((c) => contrastRatio(c, fill) >= 4.5)
  if (passing) return passing
  return candidates.sort((a, b) => contrastRatio(b, fill) - contrastRatio(a, fill))[0]
}

/** A button label (white or near-black) reads on this fill. */
function fillLabelReads(fill: string): boolean {
  return contrastRatio('#ffffff', fill) >= CONTRAST_TEXT || contrastRatio('#1c2b33', fill) >= CONTRAST_TEXT
}

/**
 * Mid-lightness brand buttons (Parker's orange: white 3.4:1, ink 4.34:1) get a
 * hue-preserving lightness nudge until a label reads — adjust the fill, not
 * the verdict. Small cap: past it, the color isn't "their orange" anymore.
 */
function adjustFillForLabel(hex: string, maxDeltaL = 0.12): { hex: string; deltaL: number } | null {
  if (fillLabelReads(hex)) return { hex, deltaL: 0 }
  const { h, s, l } = hexToHsl(hex)
  for (let step = 0.01; step <= maxDeltaL; step += 0.01) {
    for (const dir of [1, -1]) {
      const nl = l + dir * step
      if (nl < 0.05 || nl > 0.95) continue
      const cand = hslToHex(h, s, nl)
      if (fillLabelReads(cand)) return { hex: cand, deltaL: step }
    }
  }
  return null
}

/** Lighten a hue into band-tint territory (lum >= 0.85) while keeping its identity. */
function toTint(hex: string): string {
  const { h, s } = hexToHsl(hex)
  for (let l = 0.9; l <= 0.97; l += 0.01) {
    const c = hslToHex(h, Math.min(s, 0.55), l)
    if (relLuminance(c) >= 0.85) return c
  }
  return hslToHex(h, Math.min(s, 0.55), 0.95)
}

export function composePalette(inventory: BrandInventory): ComposedPalette {
  const colors: Candidate[] = inventory.colors
    .map((c) => ({ ...c, hex: normalizeHex(c.hex) ?? '' }))
    .filter((c) => c.hex)
  const provenance: Record<string, string> = {}
  const alternates: Record<string, string[]> = {}

  const byRole = (role: string) => colors.filter((c) => c.observedRoles?.includes(role))
  const mains = colors.filter((c) => c.prominence === 'main')
  const nonGround = colors.filter((c) => c.prominence !== 'ground')

  // Ground / body background: the dominant light color.
  const lightGrounds = colors
    .filter((c) => relLuminance(c.hex) > 0.8)
    .sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0))
  const ground = lightGrounds[0]?.hex ?? '#ffffff'
  provenance.bodyBackground = lightGrounds[0] ? 'extracted' : 'fallback'

  // Header background: a newsletter header is a BRANDING BAND, not page
  // chrome — take the strongest dark structural brand color (hero/nav/footer/
  // band; main before supporting, then coverage). A cream nav must not produce
  // a cream newsletter header; the ground is a last resort. PROFESSIONAL-HEADER
  // rule (user, 2026-07-24, ACA/Sherman bench findings): vivid WARM colors
  // (red/orange/magenta) are aggressive as large header bands — prefer any calm
  // structural dark, then any dark neutral in the inventory; a brand with
  // nothing calmer keeps its warm color (brand-true beats taste).
  const warmVivid = (hex: string) => {
    const { h, s } = hexToHsl(hex)
    return s > 0.5 && (h < 40 || h > 330)
  }
  const structural = colors
    .filter((c) =>
      c.observedRoles?.some((r) =>
        ['hero_background', 'nav_background', 'footer_background', 'band'].includes(r),
      ),
    )
    .filter((c) => c.hex !== ground && relLuminance(c.hex) < HEADER_MAX_LUMINANCE)
    .sort((a, b) => {
      const promo = (x: Candidate) => (x.prominence === 'main' ? 1 : 0)
      return promo(b) - promo(a) || (b.coverage ?? 0) - (a.coverage ?? 0)
    })
  const darkestMainAny = [...mains].sort((a, b) => relLuminance(a.hex) - relLuminance(b.hex))[0]
  // Candidate pool: calm structural darks PLUS dark neutrals from any role
  // (button-only greys count — ACA finding). Rank prominence FIRST so a fringe
  // supporting band can never outrank a main brand dark, then structural role,
  // then coverage. All-warm brands with no neutral keep their warm color.
  const calmStructural = structural.filter((c) => !warmVivid(c.hex))
  const darkNeutrals = colors.filter(
    (c) => c.hex !== ground && relLuminance(c.hex) < 0.4 && saturationOf(c.hex) < 0.3,
  )
  // Role weight (CMCC finding): a hero background is the brand's own statement
  // of "this is our color"; a band is decoration. hero > nav > footer > band.
  const HEADER_ROLE_WEIGHT: Record<string, number> = {
    hero_background: 4,
    nav_background: 3,
    footer_background: 2,
    band: 1,
  }
  const roleWeight = (c: Candidate) =>
    Math.max(0, ...(c.observedRoles ?? []).map((r) => HEADER_ROLE_WEIGHT[r] ?? 0))
  const headerPool = [...calmStructural, ...darkNeutrals]
    .filter((c, i, arr) => arr.findIndex((x) => x.hex === c.hex) === i)
    .sort((a, b) => {
      const promo = (x: Candidate) => (x.prominence === 'main' ? 1 : 0)
      return promo(b) - promo(a) || roleWeight(b) - roleWeight(a) || (b.coverage ?? 0) - (a.coverage ?? 0)
    })
  const headerPick =
    headerPool[0] ??
    structural[0] ??
    (darkestMainAny && relLuminance(darkestMainAny.hex) < HEADER_MAX_LUMINANCE ? darkestMainAny : null)
  const headerBackground = headerPick?.hex ?? ground
  provenance.headerBackground = headerPick ? 'extracted' : `derived from ${ground}`

  // Header text: best-contrast brand color on the header, else plain ink.
  const headerTextCandidate = [...mains, ...colors]
    .filter((c) => c.hex !== headerBackground)
    .sort((a, b) => contrastRatio(b.hex, headerBackground) - contrastRatio(a.hex, headerBackground))[0]
  let headerText: string
  if (headerTextCandidate && contrastRatio(headerTextCandidate.hex, headerBackground) >= CONTRAST_TEXT) {
    headerText = headerTextCandidate.hex
    provenance.headerText = 'extracted'
  } else {
    headerText = relLuminance(headerBackground) >= 0.5 ? '#1c2b33' : '#ffffff'
    provenance.headerText = 'fallback'
  }

  // Link/accent: the brand's LIFE color (user rules 2026-07-24). Eligible =
  // vivid on the homepage (saturation gate), hue outside the yellow/orange
  // band (links are NEVER yellow/orange; buttons may be — dark label text),
  // and darkenable to 4.5:1 within its own hue. Rank: role tier (observed
  // link color > structural band/button/hero > icon-only), then smallest
  // darkening ("slightly darkened" beats transformed), then saturation.
  const isBannedLinkHue = (hex: string) => {
    const h = hexToHsl(hex).h
    return h >= BANNED_LINK_HUE[0] && h <= BANNED_LINK_HUE[1]
  }
  const roleTier = (c: Candidate): number =>
    c.observedRoles?.includes('link_text')
      ? 3
      : c.observedRoles?.some((r) => ['band', 'button_fill', 'hero_background'].includes(r))
        ? 2
        : 1
  type Adjusted = { c: Candidate; adj: { hex: string; deltaL: number } }
  const withAdjustment = (cands: Candidate[]): Adjusted[] =>
    cands
      .filter((c, i, arr) => arr.findIndex((x) => x.hex === c.hex) === i)
      .map((c) => ({ c, adj: adjustForContrast(c.hex, ground, CONTRAST_TEXT) }))
      .filter((x): x is Adjusted => x.adj !== null)
  const eligible = withAdjustment(
    nonGround.filter(
      (c) => c.hex !== ground && !isBannedLinkHue(c.hex) && saturationOf(c.hex) >= LINK_MIN_SATURATION,
    ),
  ).sort(
    (a, b) =>
      roleTier(b.c) - roleTier(a.c) ||
      a.adj.deltaL - b.adj.deltaL ||
      saturationOf(b.c.hex) - saturationOf(a.c.hex),
  )
  // Duller non-banned mains: the selection fallback when nothing vivid exists,
  // and always an alternates source (a navy chip next to a vivid winner).
  const relaxed = withAdjustment(mains.filter((c) => c.hex !== ground && !isBannedLinkHue(c.hex))).sort(
    (a, b) => saturationOf(b.c.hex) - saturationOf(a.c.hex),
  )
  const provisionalAccent = eligible[0] ?? relaxed[0] ?? null

  // Button: the CTA must POP off both the body and the header (user rule
  // 2026-07-24) — attention is CHROMA, not luminance (gold on cream fails WCAG
  // luminance contrast yet visibly pops), so the pop gate is saturation +
  // color distance. Yellow/orange is allowed here (dark label text carries
  // it). Label readability stays a hard gate. Link hue is IRRELEVANT to
  // buttons (user rule 2026-07-24): pop is judged against body + header only.
  // BRAND CONSISTENCY (Foot Levelers finding): when the site's own observed
  // button color passes the gates, it wins outright; vividness ranking only
  // substitutes when the brand's button can't do the email job.
  const labelReads = fillLabelReads
  // HARD gates apply to every candidate: vivid, pops off body AND header.
  // The LIGHTNESS band and the strict label check apply only to FREE-CHOICE
  // candidates (colors we elect on the brand's behalf) — an observed brand
  // button skips the band (CMCC: deep-but-vivid green) and gets a
  // hue-preserving fill nudge when only its label fails (Parker: mid-
  // lightness orange).
  const popGatesNoLabel = (c: Candidate) =>
    c.hex !== ground &&
    c.hex !== headerBackground &&
    saturationOf(c.hex) >= BUTTON_MIN_SATURATION &&
    dist(c.hex, ground) >= POP_MIN_DISTANCE &&
    dist(c.hex, headerBackground) >= POP_MIN_DISTANCE
  const popEligible = colors
    .filter(popGatesNoLabel)
    .filter((c) => labelReads(c.hex))
    .filter((c) => {
      const l = hexToHsl(c.hex).l
      return l >= BUTTON_LIGHTNESS_RANGE[0] && l <= BUTTON_LIGHTNESS_RANGE[1]
    })
    .sort((a, b) => saturationOf(b.hex) - saturationOf(a.hex) || (b.coverage ?? 0) - (a.coverage ?? 0))
  // Dedicated-CTA preference (ICPA + Dynamic Chiropractic findings): a color
  // that ALSO serves links or structural bands is the site's all-purpose
  // accent; a buttons-only color is their true CTA color and ranks first.
  // Ranking, never exclusion — a sole all-purpose button still wins.
  type ObservedPick = { c: Candidate; fill: string; adjusted: boolean }
  const observedPop: ObservedPick[] = colors
    .filter((c) => c.observedRoles?.includes('button_fill'))
    .filter(popGatesNoLabel)
    .map((c) => {
      const adj = adjustFillForLabel(c.hex)
      return adj ? { c, fill: adj.hex, adjusted: adj.deltaL > 0 } : null
    })
    .filter((x): x is ObservedPick => x !== null)
    .sort((a, b) => {
      const dedicated = (x: ObservedPick) =>
        x.c.observedRoles?.some((r) => r === 'link_text' || r === 'band') ? 0 : 1
      const promo = (x: ObservedPick) => (x.c.prominence === 'main' ? 1 : 0)
      return (
        dedicated(b) - dedicated(a) || promo(b) - promo(a) || (b.c.coverage ?? 0) - (a.c.coverage ?? 0)
      )
    })
  const popPick = observedPop[0] ?? (popEligible[0] ? { c: popEligible[0], fill: popEligible[0].hex, adjusted: false } : undefined)
  // A site's own button may be ground-colored (white button on colored bands)
  // — on OUR body it would be invisible, so the observed fallback must also
  // stand off the ground (bench finding: life.edu white-on-white).
  const observedButton = byRole('button_fill').find((c) => dist(c.hex, ground) >= POP_MIN_DISTANCE)
  const darkestMain = [...mains].sort((a, b) => relLuminance(a.hex) - relLuminance(b.hex))[0]
  let button: string
  if (popPick) {
    button = popPick.fill
    provenance.button = observedPop[0]
      ? popPick.adjusted
        ? `derived from ${popPick.c.hex} (brand button, adjusted for label contrast)`
        : 'extracted (brand button)'
      : 'extracted (pop)'
  } else if (observedButton && labelReads(observedButton.hex)) {
    button = observedButton.hex
    provenance.button = 'extracted'
  } else if (darkestMain && labelReads(darkestMain.hex)) {
    button = darkestMain.hex
    provenance.button = observedButton ? `derived from ${observedButton.hex}` : 'extracted'
  } else {
    button = '#0b2545'
    provenance.button = 'fallback'
  }

  // Button label: white or the dark header color — whichever actually reads.
  const buttonText = labelColorFor(button, headerBackground)
  provenance.buttonText = `computed for ${button}`

  let accent: string
  if (provisionalAccent) {
    accent = provisionalAccent.adj.hex
    provenance.accent =
      provisionalAccent.adj.deltaL === 0
        ? 'extracted'
        : `derived from ${provisionalAccent.c.hex} (darkened for contrast)`
  } else if (!isBannedLinkHue(button) && adjustForContrast(button, ground, CONTRAST_TEXT)) {
    accent = adjustForContrast(button, ground, CONTRAST_TEXT)!.hex
    provenance.accent = `derived from ${button} (button fallback)`
  } else {
    accent = relLuminance(ground) >= 0.5 ? '#2a6f97' : '#9fd3ee'
    provenance.accent = 'fallback'
  }
  alternates.accent = [...eligible, ...relaxed]
    .map((x) => x.adj.hex)
    .filter((h) => h !== accent)
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 3)
  alternates.button = [...popEligible, ...(observedButton ? [observedButton] : []), ...mains]
    .map((c) => c.hex)
    .filter((h) => h !== button && labelReads(h))
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 3)

  // Section tints: band/supporting hues lightened into tint territory, hue-diverse.
  const tintSources = [...byRole('band'), ...colors.filter((c) => c.prominence === 'supporting'), ...mains]
  const tints: string[] = []
  for (const src of tintSources) {
    if (dist(src.hex, ground) < 24) continue
    const tint = toTint(src.hex)
    if (tints.some((t) => hueDistance(t, tint) < 30)) continue
    tints.push(tint)
    if (tints.length === 2) break
  }
  while (tints.length < 2) {
    tints.push(tints.length === 0 ? toTint(accent) : toTint(headerBackground === ground ? button : headerBackground))
  }
  // Monochrome brands can produce twin tints (bench finding: thejoint.com) —
  // keep the hue but deepen the second band so they alternate visibly.
  if (dist(tints[0], tints[1]) < 16) {
    const { h, s } = hexToHsl(tints[1])
    tints[1] = hslToHex(h, Math.min(s, 0.5), 0.86)
  }
  provenance.sectionTints = 'derived (lightened brand hues)'

  return {
    headerBackground,
    headerText,
    accent,
    button,
    buttonText,
    bodyBackground: ground,
    sectionTints: tints,
    confidence: Object.fromEntries(
      colors.length ? [['inventory', Math.min(1, colors.length / 5)]] : [['inventory', 0]],
    ),
    alternates,
    provenance,
  }
}
