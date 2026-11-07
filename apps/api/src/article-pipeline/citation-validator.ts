/**
 * Citation URL validator.
 *
 * Validates each citation URL before it is inserted into the article body,
 * removing dead links (404 / 410) and flagging uncertain ones (403, timeout).
 *
 * When OXYLABS_USERNAME and OXYLABS_PASSWORD are configured, requests are
 * routed through OxyLabs residential proxies, which dramatically reduces
 * false-negative rejections from sites that block datacenter IPs (.gov,
 * .edu, medical journals, WHO, NIH, etc.).
 *
 * Without OxyLabs credentials the validator falls back to direct HEAD
 * requests — still useful for catching obvious 404s.
 */

import { logger } from '../lib/logger'
import { getOxylabsSerpAuth, basicAuthHeader } from '../lib/oxylabs-auth'

export interface ValidatedCitation {
  title: string
  url: string
  status: 'valid' | 'uncertain' | 'dead'
  httpStatus?: number
}

const REQUEST_TIMEOUT_MS = 8_000
const CONCURRENCY = 5

type CitationEntry = {
  authority?: number | string
  sourceTitle?: string
  link_title?: string
  title?: string
  sourceUrl?: string
  link_url?: string
  url?: string
}

/**
 * Extract flat {title, url} pairs from step 12 JSON output for URL validation.
 * Handles multiple JSON shapes the LLM might produce.
 */
export function extractCitationsForValidation(raw: string): Array<{ title: string; url: string; authority?: number }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const entries: CitationEntry[] = Array.isArray(parsed)
      ? (parsed as CitationEntry[])
      : Array.isArray((parsed as Record<string, unknown>).resource_links)
        ? ((parsed as Record<string, unknown>).resource_links as CitationEntry[])
        : Array.isArray((parsed as Record<string, unknown>).links)
          ? ((parsed as Record<string, unknown>).links as CitationEntry[])
          : []

    return entries
      .map((e) => {
        const a = e.authority == null ? NaN : Number(e.authority)
        return {
          title: String(e.sourceTitle ?? e.link_title ?? e.title ?? ''),
          url: String(e.sourceUrl ?? e.link_url ?? e.url ?? ''),
          ...(Number.isFinite(a) ? { authority: a } : {}),
        }
      })
      .filter((c) => c.url.startsWith('http'))
  } catch {
    return []
  }
}

function classifyStatus(httpStatus: number): ValidatedCitation['status'] {
  if ([200, 201, 301, 302, 303, 307, 308].includes(httpStatus)) return 'valid'
  if (httpStatus === 403 || httpStatus === 401 || httpStatus === 429) return 'uncertain'
  if (httpStatus === 404 || httpStatus === 410) return 'dead'
  // 5xx server errors — page may exist, treat as uncertain
  if (httpStatus >= 500) return 'uncertain'
  return 'uncertain'
}


async function checkUrl(
  citation: { title: string; url: string },
  authHeader: string | null,
): Promise<ValidatedCitation> {
  const { url, title } = citation
  try {
    if (authHeader) {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const res = await fetch('https://realtime.oxylabs.io/v1/queries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ source: 'universal', url }),
        signal: controller.signal,
      })

      if (!res.ok) {
        // OxyLabs API itself failed — treat the citation as uncertain (keep it)
        return { title, url, status: 'uncertain' }
      }

      const json = (await res.json()) as { results?: Array<{ status_code?: number }> }
      const httpStatus = json.results?.[0]?.status_code ?? 200
      return { title, url, status: classifyStatus(httpStatus), httpStatus }
    }

    // Direct HEAD request
    const controller = new AbortController()
    setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; OmniplyBot/1.0; +https://omniply.io)',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    return { title, url, status: classifyStatus(res.status), httpStatus: res.status }
  } catch {
    // Network error or timeout — treat as uncertain (keep the citation)
    return { title, url, status: 'uncertain' }
  }
}

/**
 * Validate citation URLs in parallel with a concurrency limit.
 *
 * @param citations  Array of {title, url} objects from the step 12 LLM output
 * @param jobId      Used for logging
 * @returns          Same citations with added `status` and optional `httpStatus`
 */
export async function validateCitationUrls(
  citations: Array<{ title: string; url: string }>,
  jobId: string,
): Promise<ValidatedCitation[]> {
  if (citations.length === 0) return []

  // Admin-managed Oxylabs SERP/Scraper creds (env fallback). When absent, fall
  // back to direct HEAD requests.
  const serpAuth = await getOxylabsSerpAuth()
  const authHeader = serpAuth ? basicAuthHeader(serpAuth) : null
  const useOxylabs = !!authHeader
  if (!useOxylabs) {
    logger.warn(
      { jobId },
      '[citations] Oxylabs creds not set — falling back to direct HEAD requests',
    )
  }

  const results: ValidatedCitation[] = []

  // Process in batches of CONCURRENCY to avoid hammering the proxy
  for (let i = 0; i < citations.length; i += CONCURRENCY) {
    const batch = citations.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((c) => checkUrl(c, authHeader)))
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j]
      if (s.status === 'fulfilled') {
        results.push(s.value)
      } else {
        // Should not happen (checkUrl catches all errors), but be safe
        results.push({ title: batch[j].title, url: batch[j].url, status: 'uncertain' })
      }
    }
  }

  const valid = results.filter((r) => r.status === 'valid').length
  const uncertain = results.filter((r) => r.status === 'uncertain').length
  const dead = results.filter((r) => r.status === 'dead').length

  logger.info(
    { jobId, total: results.length, valid, uncertain, dead, useOxylabs },
    '[citations] validation complete',
  )

  return results
}
