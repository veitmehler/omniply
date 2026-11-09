/**
 * Resolve Gemini grounding redirect URIs to direct webpage URLs.
 *
 * Gemini's generative search returns source URIs through
 * vertexaisearch.cloud.google.com/grounding-api-redirect/... which are 302
 * redirects to the actual source pages. This module resolves them.
 */

import { logger } from '../lib/logger'

const REDIRECT_HOST = 'vertexaisearch.cloud.google.com'
const CONCURRENCY = 5
const TIMEOUT_MS = 5_000

export interface GroundingSource {
  title: string
  uri: string
  domain?: string
}

export interface ResolvedSource {
  title: string
  url: string
  step: number
}

async function resolveRedirect(source: GroundingSource): Promise<string | null> {
  try {
    const res = await fetch(source.uri, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const location = res.headers.get('location')
    if (location) return location
    // If no redirect, the URI itself may be the final URL
    if (res.ok || res.status === 200) return source.uri
    return null
  } catch {
    return null
  }
}

/**
 * Resolve an array of Gemini grounding sources to direct URLs.
 * Deduplicates by resolved URL. Non-redirect URIs pass through as-is.
 */
export async function resolveGroundingUrls(
  sources: GroundingSource[],
  stepNumber: number,
  jobId: string,
): Promise<ResolvedSource[]> {
  if (sources.length === 0) return []

  const results: ResolvedSource[] = []
  const seenUrls = new Set<string>()

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (s) => {
        const isRedirect = s.uri.includes(REDIRECT_HOST)
        const url = isRedirect ? await resolveRedirect(s) : s.uri
        return url ? { title: s.title, url, step: stepNumber } : null
      }),
    )

    for (const result of settled) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const { url } = result.value
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      results.push(result.value)
    }
  }

  logger.info(
    { jobId, stepNumber, input: sources.length, resolved: results.length },
    '[grounding] resolved redirect URLs',
  )

  return results
}

/**
 * B16: resolve chunk URIs keeping their index (grounding supports refer to
 * chunks by index). Failed or missing entries stay null.
 */
export async function resolveChunkUrisIndexed(uris: Array<string | null>): Promise<Array<string | null>> {
  const out: Array<string | null> = new Array(uris.length).fill(null)
  for (let i = 0; i < uris.length; i += CONCURRENCY) {
    const batch = uris.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (uri) => {
        if (!uri) return null
        return uri.includes(REDIRECT_HOST) ? resolveRedirect({ title: '', uri }) : uri
      }),
    )
    settled.forEach((r, j) => {
      out[i + j] = r.status === 'fulfilled' ? r.value : null
    })
  }
  return out
}
