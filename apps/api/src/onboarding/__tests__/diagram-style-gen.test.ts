import { describe, it, expect, vi } from 'vitest'

vi.mock('@omniply/shared', () => ({
  prisma: {},
  brandSettingsForUser: vi.fn(),
  buildDiagramStyleGuide: () => `# STYLE GUIDE\n\n## CORE AESTHETIC\nexample\n\n## STRUCTURAL ELEMENTS\ntail`,
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

import { validateGuideSections, buildStyleGuideVisionPrompt, connectionsBlock } from '../diagram-style-gen'

const PAL = { primary: '#3AA6B9', secondary: '#2D808E', light: '#89CAD5', deep: '#22636E' }

const GOOD = `## CORE AESTHETIC
Each node is a crisp borderless card with soft shadows; connections are thin solid teal lines. ${'x'.repeat(120)}

## PALETTE
Node borders and connector lines use #3AA6B9. Accents use #2D808E. Canvas is off-white.
These brand hues (plus neutrals) are the ENTIRE palette. Never render color names, hex codes, or role words as text in the image.

## ICONOGRAPHY & ILLUSTRATION
Monolinear clinical icons with uniform stroke weight.`

describe('validateGuideSections — the safety gate', () => {
  it('accepts a compliant guide', () => {
    expect(validateGuideSections(GOOD, PAL)).toBeNull()
  })

  it('rejects a missing section header', () => {
    expect(validateGuideSections(GOOD.replace('## PALETTE', '## COLORS'), PAL)).toMatch(/missing section/)
  })

  it('rejects when a brand hex is absent', () => {
    expect(validateGuideSections(GOOD.replaceAll('#2D808E', '#FF0000'), PAL)).toBe('secondary hex missing')
  })

  it('rejects without a border commitment', () => {
    const noBorder = GOOD.replace('borderless card', 'flat card')
    expect(validateGuideSections(noBorder, PAL)).toBe('no border commitment')
  })

  it('rejects without the palette closer sentence', () => {
    const noCloser = GOOD.replace('These brand hues (plus neutrals) are the ENTIRE palette', 'colors only')
    expect(validateGuideSections(noCloser, PAL)).toBe('missing palette closer')
  })

  it('rejects degenerate lengths and code fences', () => {
    expect(validateGuideSections('## CORE AESTHETIC hi', PAL)).toMatch(/bad length/)
    expect(validateGuideSections(GOOD + '\n```js\nx\n```', PAL)).toBe('contains code fences')
  })
})

describe('buildStyleGuideVisionPrompt', () => {
  it('carries the recipe: renderer profile, few-shot, border commitment, visual-part palette rule', () => {
    const p = buildStyleGuideVisionPrompt(PAL)
    expect(p).toContain('gemini-3.1-flash-image')
    expect(p).toContain('EXTREMELY literal')
    expect(p).toContain('=== EXAMPLE')
    expect(p).toContain('BORDER COMMITMENT (mandatory)')
    expect(p).toContain('VISUAL PART')
    expect(p).toContain('primary #3AA6B9')
    expect(p).toContain('Never prescribe "spaciousness"')
    // Connectors are the house signature — never the vision model's remit.
    expect(p).toContain('Do NOT define the connector/line treatment')
    // Guardrail tail is NEVER requested from the LLM.
    expect(p).not.toContain('## STRUCTURAL ELEMENTS')
  })
})


describe('connectionsBlock — house-signature plasma currents', () => {
  it('re-hues the jewel current language with the brand pair', () => {
    const b = connectionsBlock('#3AA6B9', '#89CAD5')
    expect(b).toContain('## CONNECTIONS (house signature')
    expect(b).toContain('#3AA6B9 → #89CAD5')
    expect(b).toContain('luminous gradient CURRENTS')
    expect(b).toContain('NEVER flat')
    expect(b).toContain('LIGHT canvas')
    expect(b).toContain('DARK canvas')
  })

  it('carries the icons-and-canvas house rule (Veit: clean canvas, node-support icons only)', () => {
    const b = connectionsBlock('#3AA6B9', '#89CAD5')
    expect(b).toContain('## ICONS & CANVAS (house rule)')
    expect(b).toContain('ONLY to support a specific node')
    expect(b.replace(/\s+/g, ' ')).toContain('at most ONE icon per node')
    expect(b).toContain('No icon-only cards or panels')
    expect(b).toContain('canvas stays CLEAN')
    expect(b.replace(/\s+/g, ' ')).toContain('never by adding elements')
  })
})
