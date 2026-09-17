import { describe, it, expect } from 'vitest'
import { DEFAULT_DIAGRAM_STYLE_GUIDE, buildDiagramStyleGuide } from '../diagramStyle'

describe('buildDiagramStyleGuide', () => {
  it('bakes the brand hues into the palette and bans the default gold/violet vocabulary', () => {
    const g = buildDiagramStyleGuide('#3aa6b9', '#2d808e')
    expect(g).toContain('#3AA6B9')
    expect(g).toContain('#2D808E')
    // The 2026-09-17 finding: any gold/violet wording in the guide wins over an
    // override paragraph — the branded guide must not CALL FOR those colors.
    expect(g).not.toMatch(/warm gold|brushed bronze|soft violet|plasma teal/i)
    // The explicit ban survives.
    expect(g).toMatch(/NO gold.*NO bronze.*NO amber.*NO violet.*NO purple/s)
    // Signature aesthetic intact.
    expect(g).toContain('Jewel-Box Data Capsules')
    expect(g).toContain('Plasma-Current Power Flows')
    expect(g).toContain('NO GLOBAL BLACK BORDER')
  })

  it('derives a lighter gradient endpoint from the primary', () => {
    const g = buildDiagramStyleGuide('#3aa6b9', '#2d808e')
    expect(g).toMatch(/#3AA6B9 → #[0-9A-F]{6}/)
  })

  it('falls back to the primary when the secondary is missing/invalid', () => {
    const g = buildDiagramStyleGuide('#3aa6b9', 'nope')
    expect(g).toContain('Brand Accent #3AA6B9')
  })

  it('returns the default guide when no valid primary exists', () => {
    expect(buildDiagramStyleGuide(null, '#2d808e')).toBe(DEFAULT_DIAGRAM_STYLE_GUIDE)
    expect(buildDiagramStyleGuide('not-a-color')).toBe(DEFAULT_DIAGRAM_STYLE_GUIDE)
  })

  it('default guide keeps its signature gold/violet palette for unbranded accounts', () => {
    expect(DEFAULT_DIAGRAM_STYLE_GUIDE).toContain('Warm Gold / Brushed Bronze')
    expect(DEFAULT_DIAGRAM_STYLE_GUIDE).toContain('Plasma Teal & Soft Violet')
  })
})
