/**
 * What Google charges for web searches made by Gemini ("Grounding with Google
 * Search"), for Gemini 3 and newer.
 *
 * Google's pricing page, read 2026-11-25: "5,000 free search requests per month
 * (shared across all Gemini 3 and newer models), then $14 per 1,000 requests",
 * and "You will be charged for each individual search query performed."
 *
 * Until that day every grounded request was priced at a flat $0.035, the rule
 * of the retired Gemini 2.5 models. On the bench of 2026-11-24 that added $0.53
 * Google never billed (its own report for the day: $4.02 against our $4.66).
 *
 * The month's query count is kept in memory and primed from the spend ledger,
 * where each query is recorded as a call under the model name below. Staging
 * and production share the Google account but count separately, so the free
 * allowance is slightly overstated when both search heavily in one month.
 */
import { prisma } from '@omniply/shared'
import { recordProviderSpend } from '../../lib/net/call-stats'
import { logger } from '../../lib/logger'

export const SEARCH_QUERY_MODEL = 'google-search-query'
export const FREE_SEARCH_QUERIES_PER_MONTH = 5000
export const SEARCH_QUERY_FEE_USD = 0.014

let monthKey = ''
let counted = 0
let priming: Promise<void> | null = null

const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

/** Fee for `queries` more searches when `already` were made this month. Pure. */
export function feeForQueries(already: number, queries: number): number {
  const billable = Math.max(0, already + queries - FREE_SEARCH_QUERIES_PER_MONTH) - Math.max(0, already - FREE_SEARCH_QUERIES_PER_MONTH)
  return Number((billable * SEARCH_QUERY_FEE_USD).toFixed(6))
}

function prime(now: Date): void {
  if (priming || process.env.VITEST) return
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const key = keyOf(now)
  priming = prisma.providerSpend
    .aggregate({ where: { provider: 'gemini', model: SEARCH_QUERY_MODEL, at: { gte: start } }, _sum: { calls: true } })
    .then((r) => {
      // Queries counted in this process since the read began are already in `counted`; the ledger holds the rest.
      if (monthKey === key) counted = Math.max(counted, (r._sum.calls ?? 0) + countedSincePrime)
    })
    .catch((err) => logger.warn({ err }, '[search-fee] could not read the month\'s search count; assuming the free allowance still holds'))
}
let countedSincePrime = 0

/**
 * Count the searches one Gemini response made and return what they cost.
 * Each query is one call in the spend ledger, so the dashboard shows both the
 * count and, past the allowance, the money.
 */
export function searchQueryFee(queries: number, now: Date = new Date()): number {
  if (!Number.isFinite(queries) || queries <= 0) return 0
  const key = keyOf(now)
  if (key !== monthKey) {
    monthKey = key
    counted = 0
    countedSincePrime = 0
    priming = null
  }
  prime(now)
  const fee = feeForQueries(counted, queries)
  counted += queries
  countedSincePrime += queries
  for (let i = 0; i < queries; i++) recordProviderSpend('gemini', SEARCH_QUERY_MODEL, fee / queries)
  return fee
}

/** Test hook: forget the month's count. */
export function resetSearchQueryCount(): void {
  monthKey = ''
  counted = 0
  countedSincePrime = 0
  priming = null
}
