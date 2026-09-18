import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateWithGeminiImage = vi.fn()
const llmUsageCreate = vi.fn()
vi.mock('@omniply/shared', () => ({
  generateWithGeminiImage: (...a: unknown[]) => generateWithGeminiImage(...a),
  prisma: { lLMUsage: { create: (...a: unknown[]) => llmUsageCreate(...a) } },
  buildDiagramStyleGuide: (primary?: string | null, secondary?: string | null) =>
    primary ? `BRANDED-GUIDE(${primary},${secondary ?? ''})` : 'DEFAULT-GUIDE-BODY',
}))
vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import sharp from 'sharp'
import { buildRestylePrompt, restyleDiagram, RESTYLE_MODEL, RESTYLE_COST_USD, PRO_RESTYLE_MODEL, LADDER_MODELS, RENDITION_RULES } from '../diagram-restyle'

// A tiny valid PNG so sharp can decode the "result".
async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()
}

beforeEach(() => vi.clearAllMocks())

describe('buildRestylePrompt', () => {
  it('interpolates industry + specialization and appends the style guide', () => {
    const p = buildRestylePrompt({ industry: 'Chiropractic', specialization: 'Family Care', styleGuide: 'MY-GUIDE' })
    expect(p).toContain('Chiropractic business specializing in: Family Care')
    expect(p).toContain('MY-GUIDE')
    expect(p).toMatch(/1:1 square/i)
    expect(p).toMatch(/verbatim/i)
    expect(p).toMatch(/rearrange the spatial layout/i) // re-layout permission
    expect(p).toMatch(/preserve the exact informational flow/i) // fidelity guard
  })

  it('drops the specialization clause when missing', () => {
    const p = buildRestylePrompt({ industry: 'Accounting', specialization: null, styleGuide: 'G' })
    expect(p).toContain('for a Accounting business.')
    expect(p).not.toContain('specializing in:')
  })

  it('falls back to a generic business when industry is missing', () => {
    const p = buildRestylePrompt({ industry: null, specialization: null })
    expect(p).toContain('for a business.')
  })

  it('uses the default style guide when none provided and no brand colors', () => {
    const p = buildRestylePrompt({ industry: 'X' })
    expect(p).toContain('DEFAULT-GUIDE-BODY')
  })

  it('treats blank/whitespace style guide as default', () => {
    const p = buildRestylePrompt({ industry: 'X', styleGuide: '   ' })
    expect(p).toContain('DEFAULT-GUIDE-BODY')
  })

  it('bakes the brand palette INTO the guide when brand colors exist (no override paragraph)', () => {
    const p = buildRestylePrompt({ industry: 'X', primaryColor: '#3aa6b9', secondaryColor: '#2d808e' })
    expect(p).toContain('BRANDED-GUIDE(#3aa6b9,#2d808e)')
    expect(p).not.toContain('BRAND COLOR OVERRIDE')
  })

  it('a custom style guide wins over brand colors entirely', () => {
    const p = buildRestylePrompt({ industry: 'X', styleGuide: 'MY-GUIDE', primaryColor: '#3aa6b9' })
    expect(p).toContain('MY-GUIDE')
    expect(p).not.toContain('BRANDED-GUIDE')
  })
})

describe('restyleDiagram', () => {
  const base = { squarePng: Buffer.from('src-png'), prompt: 'P', geminiKey: 'k', userId: 'user_A', jobId: 'job_1' }

  it('returns the stylized png and logs cost on success', async () => {
    const out = await tinyPng()
    generateWithGeminiImage.mockResolvedValue(out)

    const res = await restyleDiagram(base)
    expect(res?.png).toBe(out)
    // Called as (key, prompt, model, '1:1', { mimeType, data })
    const call = generateWithGeminiImage.mock.calls[0]
    expect(call[0]).toBe('k')
    expect(call[2]).toBe(RESTYLE_MODEL)
    expect(call[3]).toBe('1:1')
    expect((call[4] as { mimeType: string }).mimeType).toBe('image/png')
    expect(llmUsageCreate).toHaveBeenCalledOnce()
    expect((llmUsageCreate.mock.calls[0][0] as { data: { cost: number } }).data.cost).toBe(RESTYLE_COST_USD)
  })

  it('returns null (no cost logged) when the model throws', async () => {
    generateWithGeminiImage.mockRejectedValue(new Error('safety block'))
    const res = await restyleDiagram(base)
    expect(res).toBeNull()
    expect(llmUsageCreate).not.toHaveBeenCalled()
  })

  it('returns null when the result is empty', async () => {
    generateWithGeminiImage.mockResolvedValue(Buffer.alloc(0))
    const res = await restyleDiagram(base)
    expect(res).toBeNull()
    expect(llmUsageCreate).not.toHaveBeenCalled()
  })

  it('returns null when the result is undecodable', async () => {
    generateWithGeminiImage.mockResolvedValue(Buffer.from('not-an-image'))
    const res = await restyleDiagram(base)
    expect(res).toBeNull()
  })

  it('still returns the png when the usage write fails', async () => {
    generateWithGeminiImage.mockResolvedValue(await tinyPng())
    llmUsageCreate.mockRejectedValue(new Error('db down'))
    const res = await restyleDiagram(base)
    expect(res).not.toBeNull()
  })
})


describe('rendition rules + ladder', () => {
  it('every restyle prompt carries the rendition house rules (override clause included)', () => {
    const p = buildRestylePrompt({ industry: 'X', styleGuide: 'MY-GUIDE' })
    expect(p).toContain('## RENDITION RULES (house')
    expect(p).toContain('PALETTE FIDELITY')
    expect(p).toContain('ONE consistent medium')
    expect(p).toContain('override')
    expect(RENDITION_RULES).toContain('override anything above')
  })

  it('ladder = flash, flash, pro', () => {
    expect(LADDER_MODELS).toEqual([RESTYLE_MODEL, RESTYLE_MODEL, PRO_RESTYLE_MODEL])
  })
})
