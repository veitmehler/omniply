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
    ).toEqual({ short: 'Generic lead magnets leave $151,200 annually on the table.' })
  })

  it('rejects a number not present in the full bullet', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: 'Generic lead magnets leave $151,300 annually on the table.' }),
    ).toHaveProperty('reason')
  })

  it('rejects an altered label', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak', short: 'Generic lead magnets leave $151,200 annually.' }),
    ).toHaveProperty('reason')
  })

  it('rejects output over the line-char cap', () => {
    const long = 'x'.repeat(130)
    expect(gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: long })).toHaveProperty('reason')
  })

  it('accepts percent and comma-formatted tokens present in source', () => {
    expect(
      gateShortTakeaway(FULL, { label: 'Revenue Leak Quantified', short: 'Magnets converting at 0.1% waste money.' }),
    ).toEqual({ short: 'Magnets converting at 0.1% waste money.' })
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

import { gateHeadline } from '../short-takeaways'

describe('gateHeadline', () => {
  it('accepts a clean 5-7 word headline', () => {
    expect(gateHeadline('What your free guide quietly costs')).toBe('What Your Free Guide Quietly Costs')
  })
  it('rejects digits', () => {
    expect(gateHeadline('5 numbers your practice ignores daily')).toBeNull()
  })
  it('rejects clickbait cliches', () => {
    expect(gateHeadline("You won't believe these takeaway facts")).toBeNull()
  })
  it('rejects too short and too long', () => {
    expect(gateHeadline('Too short here')).toBeNull()
    expect(gateHeadline('This headline is far too long to pass the gate check')).toBeNull()
  })
  it('strips em-dashes', () => {
    expect(gateHeadline('Your content — quietly failing you')).toBe('Your Content, Quietly Failing You')
  })
})

import { estimateFits } from '../short-takeaways'

describe('estimateFits', () => {
  it('accepts five short lines with a headline', () => {
    const lines = Array.from({ length: 5 }, () => 'Label Words: a compact statement with one number in it.')
    expect(estimateFits('What your free guide quietly costs', lines)).toBe(true)
  })
  it('rejects five full-length bullets', () => {
    const lines = Array.from({ length: 5 }, () => 'L'.repeat(250))
    expect(estimateFits('What your free guide quietly costs', lines)).toBe(false)
  })
})
