import { describe, it, expect, vi } from 'vitest'

vi.mock('@omniply/shared', () => ({ prisma: {} }))
vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../../lib/llm-usage', () => ({ recordLLMUsage: vi.fn() }))
vi.mock('../../../article-pipeline/llm/factory', () => ({ getLLMAdapter: vi.fn() }))

import { parseKtBullets, gateShortTakeaway } from '../short-takeaways'

const FULL = {
  label: 'Revenue Leak Quantified',
  text: 'Revenue Leak Quantified: Generic lead magnets converting at 0.1% leave $151,200 annually on the table for practices with 1,200 monthly visitors.',
}

describe('gateShortTakeaway', () => {
  it('accepts a faithful compression', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: 'Generic lead magnets leave $151,200 annually on the table.' }),
    ).toBe('Generic lead magnets leave $151,200 annually on the table.')
  })

  it('rejects a number not present in the full bullet', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: 'Generic lead magnets leave $151,300 annually on the table.' }),
    ).toBeNull()
  })

  it('rejects an altered label', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak', short: 'Generic lead magnets leave $151,200 annually.' }),
    ).toBeNull()
  })

  it('rejects over-long output', () => {
    const long = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ')
    expect(gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: long })).toBeNull()
  })

  it('accepts percent and comma-formatted tokens present in source', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: 'Magnets converting at 0.1% waste money.' }),
    ).toBe('Magnets converting at 0.1% waste money.')
  })
})

describe('parseKtBullets', () => {
  it('extracts labels and text', () => {
    const html = '<ul><li><b>Alpha Label</b>: First claim with $5,000.</li><li><b>Beta</b>: Second claim.</li></ul>'
    const bullets = parseKtBullets(html)
    expect(bullets).toHaveLength(2)
    expect(bullets[0].label).toBe('Alpha Label')
    expect(bullets[0].text).toContain('$5,000')
    expect(bullets[1].label).toBe('Beta')
  })
})
