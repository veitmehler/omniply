/** Mermaid `themeVariables` + init for diagrams (brand colors). */

/** Solid background for dark `mmdc -b` / Puppeteer raster (match init `theme: dark`). */
export const DIAGRAM_DARK_BACKGROUND = '#1E1E2E'

export interface DiagramBrandThemeInput {
  diagramPrimaryColor?: string | null
  diagramSecondaryColor?: string | null
  diagramLineColor?: string | null
  diagramFontFamily?: string | null
}

export interface DiagramTheme {
  primaryColor: string
  secondaryColor: string
  lineColor: string
  fontFamily: string
}

const DEFAULTS: DiagramTheme = {
  primaryColor: '#3B82F6',
  secondaryColor: '#8B5CF6',
  lineColor: '#6B7280',
  fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
}

const DARK_LINE = '#6C7086'
/** Ambient text for a white canvas (labels outside fills: axis ticks, edge labels, notes). */
const LIGHT_AMBIENT_TEXT = '#1F2937'
/** Ambient text for the dark canvas. */
const DARK_AMBIENT_TEXT = '#E5E7EB'

export function themeFromBrand(brand: DiagramBrandThemeInput | null | undefined): DiagramTheme {
  const b = brand ?? {}
  return {
    primaryColor: pickHex(b.diagramPrimaryColor, DEFAULTS.primaryColor),
    secondaryColor: pickHex(b.diagramSecondaryColor, DEFAULTS.secondaryColor),
    lineColor: pickHex(b.diagramLineColor, DEFAULTS.lineColor),
    fontFamily:
      typeof b.diagramFontFamily === 'string' && b.diagramFontFamily.trim().length > 0
        ? b.diagramFontFamily.trim()
        : DEFAULTS.fontFamily,
  }
}

/**
 * Light article SVG: `theme: base`, fills + luminance-paired text colors.
 * `textColor` covers ambient labels (axis, edge, note text) on the white canvas.
 * `primaryTextColor` / `secondaryTextColor` / `tertiaryTextColor` cover text
 * rendered *inside* filled shapes — auto-chosen as black or white based on WCAG contrast.
 */
export function buildDiagramInitDirective(theme: DiagramTheme): string {
  const primaryBorderColor = darkenHex(theme.primaryColor, 15)
  const secondaryBorderColor = darkenHex(theme.secondaryColor, 15)
  const primaryTextColor = pickContrastingText(theme.primaryColor)
  const secondaryTextColor = pickContrastingText(theme.secondaryColor)

  const initObj = {
    theme: 'base',
    themeVariables: {
      primaryColor: theme.primaryColor,
      primaryBorderColor,
      primaryTextColor,
      secondaryColor: theme.secondaryColor,
      secondaryBorderColor,
      secondaryTextColor,
      tertiaryColor: theme.secondaryColor,
      tertiaryBorderColor: secondaryBorderColor,
      tertiaryTextColor: secondaryTextColor,
      lineColor: theme.lineColor,
      textColor: LIGHT_AMBIENT_TEXT,
      classText: primaryTextColor,
      fontFamily: theme.fontFamily,
    },
    flowchart: { htmlLabels: false },
    sequence: { htmlLabels: false },
    class: { htmlLabels: false },
    state: { htmlLabels: false },
  }

  return `%%{init: ${JSON.stringify(initObj)}}%%`
}

/** Social / dark PNG variant: `theme: dark`, lightened fills + luminance-paired text. */
export function buildDarkDiagramInitDirective(theme: DiagramTheme): string {
  const lightPrimary = lightenHex(theme.primaryColor, 15)
  const lightSecondary = lightenHex(theme.secondaryColor, 15)
  const primaryBorderColor = lightenHex(theme.primaryColor, 25)
  const secondaryBorderColor = lightenHex(theme.secondaryColor, 25)
  const primaryTextColor = pickContrastingText(lightPrimary)
  const secondaryTextColor = pickContrastingText(lightSecondary)

  const initObj = {
    theme: 'dark',
    themeVariables: {
      primaryColor: lightPrimary,
      primaryBorderColor,
      primaryTextColor,
      secondaryColor: lightSecondary,
      secondaryBorderColor,
      secondaryTextColor,
      tertiaryColor: lightSecondary,
      tertiaryBorderColor: secondaryBorderColor,
      tertiaryTextColor: secondaryTextColor,
      lineColor: DARK_LINE,
      textColor: DARK_AMBIENT_TEXT,
      classText: primaryTextColor,
      background: DIAGRAM_DARK_BACKGROUND,
      fontFamily: theme.fontFamily,
    },
    flowchart: { htmlLabels: false },
    sequence: { htmlLabels: false },
    class: { htmlLabels: false },
    state: { htmlLabels: false },
  }

  return `%%{init: ${JSON.stringify(initObj)}}%%`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * WCAG 2.x relative luminance of a hex color (0 = black, 1 = white). Shared with
 * the social brand-tint compositor (compositors/brand-tint.ts).
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const linear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * Return `'#FFFFFF'` or `'#000000'` — whichever yields higher contrast against `hexBg`.
 * Uses WCAG 2.x relative luminance so mid-tone fills (blues, purples) always get
 * a readable label color instead of the near-identical RGB-invert Mermaid defaults to.
 */
function pickContrastingText(hexBg: string): string {
  return relativeLuminance(hexBg) > 0.5 ? '#000000' : '#FFFFFF'
}

function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex).replace('#', '')
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ]
}

function pickHex(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== 'string' || !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw.trim())) {
    return fallback
  }
  const hex = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`
  return normalizeHex(hex)
}

function normalizeHex(hex: string): string {
  if (hex.length === 4 && hex.startsWith('#')) {
    const [, r, g, b] = hex
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return hex.length === 7 ? hex.toUpperCase() : hex
}

export function darkenHex(hex: string, percentTowardBlack: number): string {
  const n = normalizeHex(hex)
  const v = /^#([0-9A-F]{6})$/i.exec(n)
  if (!v) return hex
  const num = Number.parseInt(v[1], 16)
  const step = Math.round((255 * percentTowardBlack) / 100)
  const r = Math.max(0, (num >> 16) - step)
  const g = Math.max(0, ((num >> 8) & 0xff) - step)
  const b = Math.max(0, (num & 0xff) - step)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}

function lightenHex(hex: string, percentTowardWhite: number): string {
  const n = normalizeHex(hex)
  const v = /^#([0-9A-F]{6})$/i.exec(n)
  if (!v) return hex
  const num = Number.parseInt(v[1], 16)
  const step = Math.round((255 * percentTowardWhite) / 100)
  const r = Math.min(255, (num >> 16) + step)
  const g = Math.min(255, ((num >> 8) & 0xff) + step)
  const b = Math.min(255, (num & 0xff) + step)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}
