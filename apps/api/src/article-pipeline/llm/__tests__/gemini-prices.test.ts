import { describe, it, expect, beforeEach } from 'vitest'
import { calculateCost, getCostPerToken } from '../cost-table'
import { feeForQueries, searchQueryFee, resetSearchQueryCount, FREE_SEARCH_QUERIES_PER_MONTH } from '../search-fee'
import { MEDIA_COST_USD } from '../../../lib/media-costs'

/**
 * Google's own report for 2026-11-24 (Cloud console, by SKU), the day of the
 * GEMINI2 bench: Pro output $2.34, Flash Image $0.40, Pro input $0.33,
 * "gemini 3.6 flash" output $0.16. We had tracked $4.66 against its $4.02.
 */
describe('Gemini prices against Google\'s report of 2026-11-24', () => {
  const NOV_2026 = Date.UTC(2026, 10, 24)
  it('Pro output: 195,336 tokens come to $2.34', () => {
    expect(calculateCost('gemini-3.1-pro-preview', 0, 195_336)).toBeCloseTo(2.34, 2)
  })
  it('the id gemini-3.5-flash is billed as Gemini 3.6 Flash: 43,427 output tokens come to $0.16, not $0.39', () => {
    expect(getCostPerToken('gemini-3.5-flash', 'output', NOV_2026)).toBe(3.75)
    expect((43_427 / 1e6) * getCostPerToken('gemini-3.5-flash', 'output', NOV_2026)).toBeCloseTo(0.16, 2)
  })
  it('Gemini 3.6 Flash doubles on 2027-01-01, as the pricing page states', () => {
    expect(getCostPerToken('gemini-3.5-flash', 'input', Date.UTC(2026, 11, 31, 23))).toBe(0.75)
    expect(getCostPerToken('gemini-3.5-flash', 'input', Date.UTC(2027, 0, 1))).toBe(1.5)
    expect(getCostPerToken('gemini-3.6-flash', 'output', Date.UTC(2027, 0, 1))).toBe(7.5)
  })
  it('six 1K images come to $0.40', () => {
    expect(MEDIA_COST_USD['gemini-image'] * 6).toBeCloseTo(0.4, 2)
  })
  it('cached input tokens cost a tenth, for Gemini only', () => {
    expect(calculateCost('gemini-3.1-pro-preview', 1_000_000, 0)).toBeCloseTo(2.0)
    expect(calculateCost('gemini-3.1-pro-preview', 1_000_000, 0, 500_000)).toBeCloseTo(1.1)
    expect(calculateCost('gemini-3.1-pro-preview', 1_000_000, 0, 5_000_000)).toBeCloseTo(0.2) // never more cached than sent
    expect(calculateCost('claude-sonnet-5-5', 1_000_000, 0, 500_000)).toBeCloseTo(2.0)
  })
})

describe('search queries: free up to 5,000 a month, then $14 per 1,000', () => {
  beforeEach(() => resetSearchQueryCount())
  it('the 15 grounded requests of the bench cost nothing (we had counted $0.53)', () => {
    expect(feeForQueries(0, 15)).toBe(0)
    expect(searchQueryFee(15, new Date(Date.UTC(2026, 10, 24)))).toBe(0)
  })
  it('charges only the queries past the allowance', () => {
    expect(feeForQueries(FREE_SEARCH_QUERIES_PER_MONTH - 2, 5)).toBeCloseTo(3 * 0.014)
    expect(feeForQueries(FREE_SEARCH_QUERIES_PER_MONTH, 10)).toBeCloseTo(0.14)
    expect(feeForQueries(6000, 1000)).toBeCloseTo(14)
  })
  it('counts across calls within a month and starts again the next month', () => {
    const nov = new Date(Date.UTC(2026, 10, 24))
    expect(searchQueryFee(FREE_SEARCH_QUERIES_PER_MONTH, nov)).toBe(0)
    expect(searchQueryFee(2, nov)).toBeCloseTo(0.028)
    expect(searchQueryFee(2, new Date(Date.UTC(2026, 11, 1)))).toBe(0)
  })
  it('a response that searched nothing costs nothing', () => {
    expect(searchQueryFee(0)).toBe(0)
  })
})
