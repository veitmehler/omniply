/**
 * Citation source policy (bench B12, 2026-11-07).
 *
 * Two holes let clinic-blog "sources" into a published article: the inline
 * citation pool was Gemini's grounding results (everything the search
 * consulted, mercola.com included) preferred over the curated step-12 list
 * whose 1–10 authority rating was parsed and discarded; and the link
 * inserter could add any href it liked (11 of 15 links in B11 stiffness came
 * from the model's memory, not from either list). Prompt rules reduce;
 * deterministic gates catch.
 *
 * Policy: default DENY. A source is citable only when its host matches the
 * primary (journals, PubMed, DOI) or authority (government, universities,
 * professional colleges, major health organisations, a short list of serious
 * press) lists. Commercial clinics, product sites and study aggregators never
 * become citations, whatever the search surfaced.
 */

export type SourceTier = 'primary' | 'authority' | 'rejected'

const PRIMARY_HOSTS = [
  'pubmed.ncbi.nlm.nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'doi.org',
  'dx.doi.org',
  'europepmc.org',
  'cochranelibrary.com',
  'cochrane.org',
  'thelancet.com',
  'jamanetwork.com',
  'nejm.org',
  'bmj.com',
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'cell.com',
  'springer.com',
  'link.springer.com',
  'wiley.com',
  'onlinelibrary.wiley.com',
  'tandfonline.com',
  'sagepub.com',
  'journals.sagepub.com',
  'plos.org',
  'journals.plos.org',
  'frontiersin.org',
  'mdpi.com',
  'biomedcentral.com',
  'jospt.org',
  'academic.oup.com',
  'oup.com',
  'cambridge.org',
  'karger.com',
  'thieme-connect.com',
  'liebertpub.com',
  'physiotherapyjournal.com',
  'jmptonline.org',
  'spinejournal.com',
  'journals.lww.com',
  'lww.com',
  'ajronline.org',
  'pubs.rsna.org',
  'elsevier.com',
  'hindawi.com',
  'scielo.br',
  'scielo.org',
  'ijsr.net',
  'researchgate.net',
  'semanticscholar.org',
  'psycnet.apa.org',
]

const AUTHORITY_HOSTS = [
  'who.int',
  'nih.gov',
  'cdc.gov',
  'medlineplus.gov',
  'nhs.uk',
  'nice.org.uk',
  'aihw.gov.au',
  'healthdirect.gov.au',
  'safetyandquality.gov.au',
  'ahpra.gov.au',
  'racgp.org.au',
  'chiro.org.au',
  'chiropractic.org.au',
  'australian.physio',
  'arthritisaustralia.org.au',
  'arthritis.org',
  'painaustralia.org.au',
  'betterhealth.vic.gov.au',
  'health.govt.nz',
  'acc.co.nz',
  'mayoclinic.org',
  'clevelandclinic.org',
  'hopkinsmedicine.org',
  'hopkinsarthritis.org',
  'health.harvard.edu',
  'hss.edu',
  'acatoday.org',
  'apta.org',
  'wfc.org',
  'chiropractic.ca',
  'rcc-uk.org',
  'aafp.org',
  'aaos.org',
  'orthoinfo.aaos.org',
  'osteopathic.org',
  'physio-pedia.com',
  'theconversation.com',
  'abc.net.au',
  'bbc.com',
  'bbc.co.uk',
  'reuters.com',
  'theguardian.com',
  'nytimes.com',
  'washingtonpost.com',
  'smh.com.au',
  'theage.com.au',
]

/** Explicit denials beat everything (aggregators that read like sources). */
const DENY_HOSTS = ['mercola.com', 'studyfinds.com', 'studyfinds.org', 'sciencedaily.com', 'medicalxpress.com', 'news-medical.net', 'healthline.com', 'webmd.com', 'verywellhealth.com', 'medicalnewstoday.com', 'wikipedia.org', 'encyclopedia.pub', 'quora.com', 'reddit.com', 'pinterest.com', 'facebook.com', 'youtube.com', 'linkedin.com', 'medium.com']

const AUTHORITY_TLD_RE = /(?:^|\.)(?:gov|gov\.au|gov\.uk|gov\.nz|edu|edu\.au|ac\.uk|ac\.nz)$/i

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function matches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`))
}

export function sourceTier(url: string): SourceTier {
  const host = hostOf(url)
  if (!host) return 'rejected'
  if (matches(host, DENY_HOSTS)) return 'rejected'
  if (matches(host, PRIMARY_HOSTS)) return 'primary'
  if (matches(host, AUTHORITY_HOSTS) || AUTHORITY_TLD_RE.test(host)) return 'authority'
  return 'rejected'
}

export function isCitable(url: string): boolean {
  return sourceTier(url) !== 'rejected'
}

export interface PoolCandidate {
  title: string
  url: string
  /** Step-12 authority rating (1–10) when the candidate comes from the curated list. */
  authority?: number
}

export interface RankedCandidate extends PoolCandidate {
  tier: SourceTier
  origin: 'curated' | 'grounding'
}

export const DEFAULT_POOL_CAP = 14
export const MIN_CURATED_AUTHORITY = 7

/**
 * Build the inline-citation pool: curated step-12 sources (authority ≥ 7,
 * policy-passing) first, ordered by authority, then policy-passing grounding
 * sources (primary before authority). Deduped by URL, capped.
 */
export function rankCitationPool(
  curated: PoolCandidate[],
  grounding: PoolCandidate[],
  cap = DEFAULT_POOL_CAP,
): { pool: RankedCandidate[]; rejected: RankedCandidate[] } {
  const seen = new Set<string>()
  const pool: RankedCandidate[] = []
  const rejected: RankedCandidate[] = []
  const norm = (u: string) => u.trim().replace(/\/$/, '')

  // The live step-12 prompt returns resource_links without any rating, so a
  // missing authority is neutral (the domain policy is the gate); a rating
  // that IS present and low still rejects.
  const curatedSorted = [...curated].sort((a, b) => (b.authority ?? MIN_CURATED_AUTHORITY) - (a.authority ?? MIN_CURATED_AUTHORITY))
  for (const c of curatedSorted) {
    const tier = sourceTier(c.url)
    const key = norm(c.url)
    if (seen.has(key)) continue
    seen.add(key)
    if (tier === 'rejected' || (c.authority !== undefined && c.authority < MIN_CURATED_AUTHORITY)) {
      rejected.push({ ...c, tier, origin: 'curated' })
      continue
    }
    pool.push({ ...c, tier, origin: 'curated' })
  }
  const groundingSorted = [...grounding]
    .map((g) => ({ ...g, tier: sourceTier(g.url), origin: 'grounding' as const }))
    .sort((a, b) => (a.tier === 'primary' ? 0 : 1) - (b.tier === 'primary' ? 0 : 1))
  for (const g of groundingSorted) {
    const key = norm(g.url)
    if (seen.has(key)) continue
    seen.add(key)
    if (g.tier === 'rejected') {
      rejected.push(g)
      continue
    }
    pool.push(g)
  }
  return { pool: pool.slice(0, cap), rejected }
}

/** True when a stored title is just the host name (what the grounding resolver stores). */
export function titleLooksLikeDomain(title: string): boolean {
  const t = title.trim().toLowerCase()
  return !t || (!/\s/.test(t) && /\.[a-z]{2,}$/.test(t))
}

const TITLE_TIMEOUT_MS = 6_000
const TITLE_MAX_BYTES = 65_536

/** Fetch a page's <title> (first 64 KB only); null on any failure. */
export async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniplyCitations/1.0; +https://omniply.io)', Accept: 'text/html' },
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < TITLE_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
    }
    await reader.cancel().catch(() => undefined)
    const html = Buffer.concat(chunks).toString('utf8')
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!m) return null
    const title = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return title.length >= 8 ? title.slice(0, 160) : null
  } catch {
    return null
  }
}

/** Fill domain-only titles with real page titles (concurrency-limited). */
export async function enrichTitles<T extends { title: string; url: string }>(items: T[], concurrency = 5): Promise<T[]> {
  const out = [...items]
  const targets = out.map((it, i) => ({ it, i })).filter(({ it }) => titleLooksLikeDomain(it.title))
  for (let i = 0; i < targets.length; i += concurrency) {
    await Promise.all(
      targets.slice(i, i + concurrency).map(async ({ it, i: idx }) => {
        const t = await fetchPageTitle(it.url)
        if (t) out[idx] = { ...it, title: t }
      }),
    )
  }
  return out
}

/**
 * Enforce the pool on the inserter's output. An <a> whose href is in the pool
 * stays. An off-pool href whose host matches exactly ONE pool URL is
 * re-pointed at that pool URL (B13: the model "corrected" PubMed and Safe Work
 * Australia URLs to variants of its own, which cost an article every link).
 * Anything else is unwrapped, text kept. Internal anchors (#…) are left alone.
 */
export function stripUnpooledLinks(
  html: string,
  allowedUrls: Iterable<string>,
): { html: string; stripped: number; recovered: number; strippedHosts: string[] } {
  const norm = (u: string) => u.trim().replace(/\/$/, '')
  const pool = [...allowedUrls]
  const allowed = new Set(pool.map(norm))
  const byHost = new Map<string, string[]>()
  for (const u of pool) {
    const host = hostOf(u)
    if (!host) continue
    byHost.set(host, [...(byHost.get(host) ?? []), u])
  }
  let stripped = 0
  let recovered = 0
  const strippedHosts: string[] = []
  const out = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs: string, inner: string) => {
    const hrefMatch = /href\s*=\s*["']?([^"'\s>]*)["']?/i.exec(attrs)
    const href = hrefMatch?.[1] ?? ''
    if (!href || href.startsWith('#')) return match
    if (allowed.has(norm(href))) return match
    const host = hostOf(href)
    const candidates = host ? byHost.get(host) ?? [] : []
    if (candidates.length === 1) {
      recovered++
      const fixedAttrs = attrs.replace(hrefMatch![0], hrefMatch![0].replace(href, candidates[0]))
      return `<a${fixedAttrs}>${inner}</a>`
    }
    stripped++
    strippedHosts.push(host ?? href.slice(0, 40))
    return inner
  })
  return { html: out, stripped, recovered, strippedHosts }
}
