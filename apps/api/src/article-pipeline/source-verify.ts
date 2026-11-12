/**
 * Source verification (bench B15, 2026-11-09).
 *
 * B14 shipped a sciatica article whose "70% of herniations resorb" statistic
 * linked to a dermatology paper: the research step (Gemini) typed a PubMed id
 * from memory, step 12 typed a different wrong id for the same paper, and the
 * citation validator only checked that the URL was alive. A second claim was
 * attributed to the RACGP with the RACGP homepage as its "source", and the
 * inserter then attached the one RACGP page in the pool (a different
 * guideline) to it.
 *
 * This module makes the FACT the unit of citation and checks IDENTITY, not
 * liveness:
 *  - parseFactTags(): the step-7/8 feeds carry
 *      [Source: <institution or author>, <publisher>, <year>, <URL>]
 *    after each fact; the fact text and the tag are extracted together.
 *  - A root/homepage URL is not a source (dropped; the fact stays, unlinked).
 *  - PubMed / PMC / DOI URLs are resolved through the NCBI and Crossref APIs
 *    and the real title is compared with the fact by content-term overlap.
 *    Mismatch → repair by title search (PubMed first, Crossref second) → or
 *    the URL is dropped.
 *  - Other URLs: the page <title> is fetched and compared the same way;
 *    pages that block bots stay "unchecked" (liveness check still applies).
 *  - anchorFactSources(): deterministic linking of each verified source to
 *    the article sentence that states its fact, so the LLM inserter never
 *    guesses relevance for fact-backed links.
 *
 * Everything here is fail-soft: any network or parse failure leaves the fact
 * as it was (minus an unverifiable URL) and never throws.
 */
import { logger } from '../lib/logger'
import { fetchPageTitle, isCitable, sourceTier } from './citation-policy'

export interface FactTag {
  /** Plain text of the fact the tag belongs to (markdown stripped, ≤ 600 chars). */
  fact: string
  /** Raw inner text of the tag, without "[Source:" and "]". */
  inner: string
  institution: string
  publisher: string
  year: string
  url: string | null
  /** Offsets of the whole "[Source: …]" tag in the input text. */
  start: number
  end: number
  /** Offset where this fact's block begins (after the previous blank line or tag). */
  factStart: number
}

export type SourceStatus = 'verified' | 'repaired' | 'grounded' | 'retrieved' | 'unchecked' | 'dropped'

export interface FactSource {
  fact: string
  url: string
  title: string
  status: Exclude<SourceStatus, 'dropped'> | 'fill'
  /** B16 support check: the sentence of the source that states the fact (empty when unknown). */
  quote?: string
  verdict?: 'supported' | 'partial' | 'unsupported' | 'unknown'
}

/** B16: a grounding support = a span of the research text and the real pages Google retrieved for it. */
export interface GroundingSupportPages {
  text: string
  urls: string[]
}

export type SupportChecker = (fact: string, url: string) => Promise<{ verdict: 'supported' | 'partial' | 'unsupported' | 'unknown'; quote: string; cost: number }>

/** B21: a fact the retrieval researcher extracted from a page it chose, with the verbatim sentence. */
export interface RetrievedFactRecord {
  fact: string
  url: string
  title: string
  quote: string
}

export interface VerifyOptions {
  supports?: GroundingSupportPages[]
  /** When given, every surviving URL is checked for support and the rulings apply. */
  support?: SupportChecker
  /** B21: retrieval facts. Identity is by construction (the URL was attached by code to the page the
   * fact was read from), so the title gate and the LLM judge are skipped; the quote is checked
   * against the page text deterministically when the page is readable. */
  retrieved?: RetrievedFactRecord[]
  /** true = quote found in the page, false = not found, null = page unreadable. */
  quoteCheck?: (quote: string, url: string) => Promise<boolean | null>
  /** Account vertical: 'azavea' admits business/regulatory hosts (citation-policy BUSINESS_HOSTS). */
  vertical?: string | null
}

export interface VerifyResult {
  text: string
  sources: FactSource[]
  stats: {
    tags: number
    verified: number
    repaired: number
    grounded: number
    retrieved: number
    unchecked: number
    dropped: number
    root: number
    obs: number
    supportChecked: number
    unlinkedQualitative: number
    figureDropped: number
    supportCost: number
  }
}

const TAG_RE = /\[Source:\s*([^\]]*)\]/g
const IDENTIFIER_HOST_RE = /^https?:\/\/(www\.)?(pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc|doi\.org|dx\.doi\.org)/i
export const BOT_WALL_RE = /checking your browser|recaptcha|just a moment|access denied|attention required|are you a human|verify you are|403 forbidden|cloudflare/i

const STOP = new Set(
  'the a an and or of to in on for with by from at as is are was were be been being that this these those it its their there here than then into over under about after before between during without within while when where which who whom whose what why how all any each some most more less few many much very also only just not no yes can could may might will would shall should must do does did done have has had having per vs versus among around across along through toward towards upon via own same other another such both either neither one two three four five six seven eight nine ten first second third new old high low large small long short early late often usually rarely sometimes never always people person patient patients adults adult study studies trial trials review reviews analysis data results findings found reported showed shows show report year years'.split(/\s+/),
)

/** Content terms: lower-case, ≥ 4 letters, not stopwords, light plural strip. */
export function contentTerms(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
  }
  return out
}

/** Overlap of a candidate title with a fact: shared content terms and the share of the title covered. */
export function termOverlap(title: string, fact: string): { shared: number; ratio: number; terms: string[] } {
  const t = contentTerms(title)
  const f = contentTerms(fact)
  const terms = [...t].filter((x) => f.has(x))
  return { shared: terms.length, ratio: t.size ? terms.length / t.size : 0, terms }
}

/** A title "covers" a fact when they share at least two content terms, or one that is a third of a short title. */
export function titleCoversFact(title: string, fact: string): boolean {
  const o = termOverlap(title, fact)
  return o.shared >= 2 || (o.shared === 1 && o.ratio >= 0.34)
}

export function isRootUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.pathname === '/' || u.pathname === '') && !u.search
  } catch {
    return true
  }
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract the facts and their source tags from a research-step output. */
export function parseFactTags(text: string): FactTag[] {
  const tags: FactTag[] = []
  let prevEnd = 0
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    // The fact is the text since the previous tag, trimmed to the last block (after a blank line or heading).
    let before = text.slice(prevEnd, start)
    let factStart = prevEnd
    for (const bm of before.matchAll(/\n\s*\n/g)) factStart = prevEnd + (bm.index ?? 0) + bm[0].length
    before = text.slice(factStart, start)
    // Drop a leading bold heading line ("**1. Title**") when a body line follows it.
    const lines = before.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 1 && /^\*\*.*\*\*$/.test(lines[0])) lines.shift()
    const fact = stripMarkdown(lines.join(' ')).slice(-600)
    const inner = m[1].trim()
    const urlMatch = inner.match(/https?:\/\/\S+/i)
    const url = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : null
    const fields = inner
      .replace(/https?:\/\/\S+/i, '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    tags.push({
      fact,
      inner,
      institution: fields[0] ?? '',
      publisher: fields[1] ?? '',
      year: fields.find((f) => /^(19|20)\d\d$/.test(f)) ?? '',
      url,
      start,
      end,
      factStart,
    })
    prevEnd = end
  }
  return tags
}

// ── Identifier resolvers ──────────────────────────────────────────────────────

export const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const CROSSREF_BASE = 'https://api.crossref.org'
const TIMEOUT_MS = 8_000
const UA = 'OmniplyCitations/1.0 (+https://omniply.io; mailto:ops@omniply.io)'

// NCBI allows 3 requests/s without a key (10 with NCBI_API_KEY). Serialize.
let ncbiChain: Promise<unknown> = Promise.resolve()
const NCBI_GAP_MS = process.env.NCBI_API_KEY ? 120 : 400
export function ncbiQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = ncbiChain.then(() => new Promise((r) => setTimeout(r, NCBI_GAP_MS))).then(fn)
  ncbiChain = run.catch(() => undefined)
  return run
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export function ncbiKey(): string {
  return process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : ''
}

export function identifyUrl(url: string): { kind: 'pubmed' | 'pmc' | 'doi'; id: string } | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'pubmed.ncbi.nlm.nih.gov') {
      const m = u.pathname.match(/^\/(\d{5,9})\/?$/)
      return m ? { kind: 'pubmed', id: m[1] } : null
    }
    if (host === 'pmc.ncbi.nlm.nih.gov' || (host === 'ncbi.nlm.nih.gov' && /\/pmc\//.test(u.pathname))) {
      const m = u.pathname.match(/PMC(\d+)/i)
      return m ? { kind: 'pmc', id: m[1] } : null
    }
    if (host === 'doi.org' || host === 'dx.doi.org') {
      const doi = decodeURIComponent(u.pathname.replace(/^\//, ''))
      return /^10\.\d{4,9}\//.test(doi) ? { kind: 'doi', id: doi } : null
    }
    return null
  } catch {
    return null
  }
}

export interface Resolvers {
  pubmedTitle: (id: string) => Promise<string | null>
  pmcTitle: (id: string) => Promise<string | null>
  doiTitle: (doi: string) => Promise<string | null>
  pubmedSearch: (query: string) => Promise<Array<{ id: string; title: string }>>
  pageTitle: (url: string) => Promise<string | null>
}

export const liveResolvers: Resolvers = {
  async pubmedTitle(id) {
    try {
      const j = (await ncbiQueue(() => getJson(`${NCBI_BASE}/esummary.fcgi?db=pubmed&id=${id}&retmode=json${ncbiKey()}`))) as { result?: Record<string, { title?: string }> }
      return j.result?.[id]?.title ?? null
    } catch {
      return null
    }
  },
  async pmcTitle(id) {
    try {
      const j = (await ncbiQueue(() => getJson(`${NCBI_BASE}/esummary.fcgi?db=pmc&id=${id}&retmode=json${ncbiKey()}`))) as { result?: Record<string, { title?: string }> }
      return j.result?.[id]?.title ?? null
    } catch {
      return null
    }
  },
  async doiTitle(doi) {
    try {
      const j = (await getJson(`${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`)) as { message?: { title?: string[] } }
      return j.message?.title?.[0] ?? null
    } catch {
      return null
    }
  },
  async pubmedSearch(query) {
    try {
      const s = (await ncbiQueue(() => getJson(`${NCBI_BASE}/esearch.fcgi?db=pubmed&retmax=4&sort=relevance&retmode=json&term=${encodeURIComponent(query)}${ncbiKey()}`))) as { esearchresult?: { idlist?: string[] } }
      const ids = s.esearchresult?.idlist ?? []
      if (ids.length === 0) return []
      const j = (await ncbiQueue(() => getJson(`${NCBI_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${ncbiKey()}`))) as { result?: Record<string, { title?: string }> }
      return ids.map((id) => ({ id, title: j.result?.[id]?.title ?? '' })).filter((x) => x.title)
    } catch {
      return []
    }
  },
  pageTitle: fetchPageTitle,
}

/** Build a search query from the fact: its most specific content terms. */
export function factQuery(fact: string, max = 8): string {
  return [...contentTerms(fact)].slice(0, max).join(' ')
}

/** Does this tag look like a paper (journal / author) rather than an institution page? */
export function looksLikePaper(tag: FactTag): boolean {
  const blob = `${tag.institution} ${tag.publisher}`
  if (tag.url && identifyUrl(tag.url)) return true
  return /\b(journal|j\.|lancet|bmj|jama|spine|medicine|review|surgery|therapy|research|science|plos|cochrane|et al|physiotherapy|rheumatology|orthop|neurolog|pain)\b/i.test(blob) && !/\b(college|association|department|institute of health|ministry|government|foundation|clinic|hospital|health publishing|healthdirect|nhs|cdc|who)\b/i.test(blob)
}

/** A repair must be unambiguous: the found title shares most of its content
 *  terms with the fact (not just the topic words). Live check 2026-11-09: a
 *  looser rule accepted a 1970s surgical book chapter for a resorption
 *  statistic because "herniated lumbar disc" matched, which is exactly the
 *  failure this module exists to stop. */
function repairAcceptable(title: string, fact: string): boolean {
  const o = termOverlap(title, fact)
  return o.shared >= 4 || (o.shared >= 3 && o.ratio >= 0.5)
}

/** PubMed only (medical facts; Crossref returns books and chapters that match on topic words). Two
 *  query widths: NCBI ANDs every term, so a long query often returns nothing. */
async function repairByTitle(tag: FactTag, r: Resolvers): Promise<{ url: string; title: string } | null> {
  for (const width of [6, 4]) {
    const q = factQuery(tag.fact, width)
    if (!q) return null
    const pm = await r.pubmedSearch(q)
    const best = pm
      .map((c) => ({ ...c, o: termOverlap(c.title, tag.fact) }))
      .sort((a, b) => b.o.shared - a.o.shared || b.o.ratio - a.o.ratio)[0]
    if (best && repairAcceptable(best.title, tag.fact)) {
      return { url: `https://pubmed.ncbi.nlm.nih.gov/${best.id}/`, title: best.title }
    }
    if (pm.length > 0) return null // results came back and none fit: do not widen into noise
  }
  return null
}

function rebuildTag(tag: FactTag, url: string | null): string {
  const fields = [tag.institution, tag.publisher, tag.year].filter(Boolean)
  if (url) fields.push(url)
  return `[Source: ${fields.join(', ')}]`
}

/** Check one URL against a fact: identity for identifiers, page title otherwise. */
async function checkUrlForFact(
  url: string,
  tag: FactTag,
  r: Resolvers,
  ctx: Record<string, unknown>,
): Promise<{ ok: boolean; title: string; status: 'verified' | 'unchecked' }> {
  const ident = identifyUrl(url)
  if (ident) {
    const resolved = ident.kind === 'pubmed' ? await r.pubmedTitle(ident.id) : ident.kind === 'pmc' ? await r.pmcTitle(ident.id) : await r.doiTitle(ident.id)
    if (resolved && titleCoversFact(resolved, tag.fact)) return { ok: true, title: resolved, status: 'verified' }
    logger.info({ ...ctx, url, resolved: resolved?.slice(0, 90) ?? null, fact: tag.fact.slice(0, 90) }, '[source-verify] identifier does not match its fact')
    return { ok: false, title: '', status: 'unchecked' }
  }
  // A PubMed / PMC / DOI URL without an identifier (a search-results page, a
  // malformed id) is not a specific page and cannot be verified: reject.
  if (IDENTIFIER_HOST_RE.test(url)) {
    logger.info({ ...ctx, url }, '[source-verify] identifier host without an identifier (search page?)')
    return { ok: false, title: '', status: 'unchecked' }
  }
  const fetched = await r.pageTitle(url)
  // A bot wall is not a title: NCBI Bookshelf (StatPearls) answers with a
  // reCAPTCHA page, Cloudflare with "Just a moment". Treat as unchecked.
  const pageTitle = fetched !== null && BOT_WALL_RE.test(fetched) ? null : fetched
  if (pageTitle === null) return { ok: true, title: `${tag.institution}${tag.publisher ? `, ${tag.publisher}` : ''}`, status: 'unchecked' }
  if (titleCoversFact(pageTitle, tag.fact) || titleCoversFact(pageTitle, `${tag.institution} ${tag.publisher}`)) return { ok: true, title: pageTitle, status: 'verified' }
  logger.info({ ...ctx, url, pageTitle: pageTitle.slice(0, 90), fact: tag.fact.slice(0, 90) }, '[source-verify] page title does not match its fact')
  return { ok: false, title: '', status: 'unchecked' }
}

/** Pages Google retrieved for the span that carries this fact (B16). */
export function groundedCandidates(tag: FactTag, supports: GroundingSupportPages[]): string[] {
  const out: string[] = []
  for (const sp of supports) {
    const o = termOverlap(sp.text, tag.fact)
    if (o.shared >= 3 || (o.shared >= 2 && o.ratio >= 0.5)) for (const u of sp.urls) if (u && !out.includes(u)) out.push(u)
  }
  return out
}

/** B21: the retrieval record for a tag (same URL, same fact up to whitespace/case). */
function findRetrieved(tag: FactTag, recs?: RetrievedFactRecord[]): RetrievedFactRecord | undefined {
  if (!recs?.length || !tag.url) return undefined
  const u = tag.url.trim().replace(/\/$/, '')
  const f = tag.fact.toLowerCase().replace(/\s+/g, ' ').trim()
  return recs.find((r) => r.url.trim().replace(/\/$/, '') === u && r.fact.toLowerCase().replace(/\s+/g, ' ').trim() === f)
}

/**
 * Verify every source tag in a research output. Returns the rewritten text
 * (verified, grounded or repaired URLs kept, unverifiable URLs removed,
 * unsupported figure facts removed) and the fact→source pairs the inserter
 * may link.
 */
export async function verifyFactSources(
  text: string,
  ctx: Record<string, unknown> = {},
  r: Resolvers = liveResolvers,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const stats: VerifyResult['stats'] = { tags: 0, verified: 0, repaired: 0, grounded: 0, retrieved: 0, unchecked: 0, dropped: 0, root: 0, obs: 0, supportChecked: 0, unlinkedQualitative: 0, figureDropped: 0, supportCost: 0 }
  const sources: FactSource[] = []
  if (!text) return { text, sources, stats }
  let tags: FactTag[]
  try {
    tags = parseFactTags(text)
  } catch {
    return { text, sources, stats }
  }
  stats.tags = tags.length
  if (tags.length === 0) return { text, sources, stats }

  const edits: Array<{ start: number; end: number; replacement: string }> = []
  for (const tag of tags) {
    if (/^\s*OBS\b/i.test(tag.inner) || /\[OBS\]/.test(tag.inner)) {
      stats.obs++
      continue
    }
    let url: string | null = null
    let title = ''
    let status: SourceStatus = 'dropped'
    let retrievedQuote = ''

    // 0. B21: a retrieval fact — the page is the one it was read from. Keep it on its own
    //    provenance; only a quote demonstrably absent from a readable page fails it.
    const rec = tag.url ? findRetrieved(tag, opts.retrieved) : undefined
    if (rec && isCitable(rec.url, opts.vertical)) {
      url = rec.url
      title = rec.title
      status = 'retrieved'
      retrievedQuote = rec.quote
    }

    // 1. The model's own URL, if it survives identity.
    if (!url && tag.url && isRootUrl(tag.url)) stats.root++
    if (!url && tag.url && !isRootUrl(tag.url) && isCitable(tag.url, opts.vertical)) {
      try {
        const c = await checkUrlForFact(tag.url, tag, r, ctx)
        if (c.ok) {
          url = tag.url
          title = c.title
          status = c.status
        }
      } catch (err) {
        logger.warn({ ...ctx, url: tag.url, err }, '[source-verify] resolver failed, treating as unchecked')
        url = tag.url
        title = tag.institution
        status = 'unchecked'
      }
    }

    // 2. Pages Google actually retrieved for this span (grounding supports).
    if (!url && opts.supports?.length) {
      for (const cand of groundedCandidates(tag, opts.supports)) {
        if (isRootUrl(cand) || !isCitable(cand, opts.vertical)) continue
        try {
          const c = await checkUrlForFact(cand, tag, r, ctx)
          if (c.ok) {
            url = cand
            title = c.title
            status = 'grounded'
            break
          }
        } catch {
          /* next candidate */
        }
      }
    }

    // 3. Title search on PubMed for any fact still without a source (strict match; B18: no longer
    //    limited to paper-like tags — this is the fact-driven fill).
    if (!url) {
      try {
        const fixed = await repairByTitle(tag, r)
        if (fixed) {
          url = fixed.url
          title = fixed.title
          status = 'repaired'
          logger.info({ ...ctx, url, title: title.slice(0, 90), fact: tag.fact.slice(0, 90) }, '[source-verify] source repaired by title search')
        }
      } catch (err) {
        logger.warn({ ...ctx, err }, '[source-verify] repair search failed')
      }
    }

    // 4. Support check and the rulings: qualitative loses the link, figure is dropped.
    let removeFact = false
    let quote = ''
    let verdict: FactSource['verdict'] | undefined
    if (url && status === 'retrieved') {
      quote = retrievedQuote
      verdict = 'unknown'
      if (opts.quoteCheck && retrievedQuote) {
        const found = await opts.quoteCheck(retrievedQuote, url)
        if (found === true) verdict = 'supported'
        if (found === false) {
          const figure = isFigureFactLocal(tag.fact)
          logger.info({ ...ctx, url, figure, fact: tag.fact.slice(0, 90) }, '[source-verify] retrieval quote not found in its page')
          if (figure) {
            removeFact = true
            stats.figureDropped++
          } else {
            url = null
            stats.unlinkedQualitative++
          }
        }
      }
    } else if (url && opts.support) {
      const figure = isFigureFactLocal(tag.fact)
      const sup = await opts.support(tag.fact, url)
      stats.supportChecked++
      stats.supportCost += sup.cost
      verdict = sup.verdict
      quote = sup.quote
      // B18 rule for sources nobody could read: keep only an authority-tier page that
      // grounding supplied (Google retrieved it for this very fact); drop otherwise.
      const unreadable = sup.verdict === 'unknown' && !(status === 'grounded' && sourceTier(url, opts.vertical) !== 'rejected')
      const fails = sup.verdict === 'unsupported' || (figure && sup.verdict === 'partial') || unreadable
      if (fails) {
        logger.info({ ...ctx, url, verdict: sup.verdict, figure, fact: tag.fact.slice(0, 90) }, '[source-verify] source does not support its fact')
        if (figure) {
          removeFact = true
          stats.figureDropped++
        } else {
          url = null
          stats.unlinkedQualitative++
        }
      }
    }

    if (removeFact) {
      edits.push({ start: tag.factStart, end: tag.end, replacement: '' })
      continue
    }
    if (url && status !== 'dropped') {
      sources.push({ fact: tag.fact, url, title, status, quote, verdict })
      stats[status]++
    } else {
      status = 'dropped'
      stats.dropped++
    }
    const replacement = rebuildTag(tag, url && status !== 'dropped' ? url : null)
    if (replacement !== text.slice(tag.start, tag.end)) edits.push({ start: tag.start, end: tag.end, replacement })
  }

  let out = text
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }
  out = out.replace(/\n{3,}/g, '\n\n')
  return { text: out, sources, stats }
}

const NUMBER_WORDS_RE =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|third|quarter|double|twice|threefold|fourfold)\b/i

/** A fact that carries a quantity (digits other than a lone year, a percentage, a number word). */
export function isFigureFactLocal(fact: string): boolean {
  const digits = fact.match(/\d+(?:[.,]\d+)?/g) ?? []
  if (digits.some((d) => !/^(19|20)\d\d$/.test(d))) return true
  if (/%|percent|per cent/i.test(fact)) return true
  return NUMBER_WORDS_RE.test(fact)
}

/** Identity check for step-12 curated pairs (title claimed by the model vs the real page). */
export async function verifyCuratedIdentity<T extends { title: string; url: string }>(
  pairs: T[],
  ctx: Record<string, unknown> = {},
  r: Resolvers = liveResolvers,
): Promise<{ kept: T[]; rejected: Array<T & { reason: string }> }> {
  const kept: T[] = []
  const rejected: Array<T & { reason: string }> = []
  for (const p of pairs) {
    if (isRootUrl(p.url)) {
      rejected.push({ ...p, reason: 'root url' })
      continue
    }
    const ident = identifyUrl(p.url)
    if (!ident) {
      kept.push(p)
      continue
    }
    try {
      const resolved = ident.kind === 'pubmed' ? await r.pubmedTitle(ident.id) : ident.kind === 'pmc' ? await r.pmcTitle(ident.id) : await r.doiTitle(ident.id)
      if (!resolved) {
        kept.push(p)
        continue
      }
      const o = termOverlap(resolved, p.title)
      if (o.shared >= 3 || o.ratio >= 0.5) kept.push({ ...p, title: resolved })
      else {
        rejected.push({ ...p, reason: `resolves to "${resolved.slice(0, 80)}"` })
        logger.info({ ...ctx, url: p.url, claimed: p.title.slice(0, 80), resolved: resolved.slice(0, 80) }, '[source-verify] curated identifier does not match its title')
      }
    } catch {
      kept.push(p)
    }
  }
  return { kept, rejected }
}

// ── Deterministic fact anchoring ─────────────────────────────────────────────

const MIN_ANCHOR_SHARED = 3
const MIN_ANCHOR_RATIO = 0.35

/**
 * Link each fact source to the article sentence that states its fact. Only
 * plain sentences (no inline markup) inside <p> or <li> are candidates; one
 * link per sentence, one per URL. Returns the HTML and the URLs placed.
 */
export function anchorFactSources(html: string, sources: FactSource[]): { html: string; placed: string[]; unplaced: FactSource[] } {
  const placed: string[] = []
  const unplaced: FactSource[] = []
  const usedUrls = new Set<string>()
  const usedSpans: Array<[number, number]> = []
  const edits: Array<{ start: number; end: number; url: string }> = []

  // Candidate sentences with absolute offsets.
  const cands: Array<{ start: number; end: number; text: string; terms: Set<string> }> = []
  const blockRe = /<(p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi
  let bm: RegExpExecArray | null
  while ((bm = blockRe.exec(html)) !== null) {
    const inner = bm[2]
    if (/<[a-z/!]/i.test(inner)) continue // already marked up (links, bold, glosses)
    const innerStart = bm.index + bm[0].indexOf(inner)
    const sentRe = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g
    let sm: RegExpExecArray | null
    while ((sm = sentRe.exec(inner)) !== null) {
      const raw = sm[0]
      const lead = raw.length - raw.trimStart().length
      const trail = raw.length - raw.trimEnd().length
      const text = raw.trim()
      if (text.split(/\s+/).length < 6) continue
      cands.push({ start: innerStart + sm.index + lead, end: innerStart + sm.index + raw.length - trail, text, terms: contentTerms(text) })
    }
  }

  for (const s of sources) {
    if (usedUrls.has(s.url)) continue
    const factTerms = contentTerms(s.fact)
    if (factTerms.size === 0) {
      unplaced.push(s)
      continue
    }
    let best: { c: (typeof cands)[number]; shared: number; ratio: number } | null = null
    for (const c of cands) {
      if (usedSpans.some(([a, b]) => c.start < b && c.end > a)) continue
      const shared = [...c.terms].filter((t) => factTerms.has(t)).length
      const ratio = shared / Math.max(1, Math.min(c.terms.size, factTerms.size))
      if (shared >= MIN_ANCHOR_SHARED && ratio >= MIN_ANCHOR_RATIO && (!best || shared > best.shared || (shared === best.shared && ratio > best.ratio))) {
        best = { c, shared, ratio }
      }
    }
    if (!best) {
      unplaced.push(s)
      continue
    }
    usedSpans.push([best.c.start, best.c.end])
    usedUrls.add(s.url)
    placed.push(s.url)
    edits.push({ start: best.c.start, end: best.c.end, url: s.url })
  }

  edits.sort((a, b) => b.start - a.start)
  let out = html
  for (const e of edits) {
    const sentence = out.slice(e.start, e.end)
    // Leave the final punctuation outside the link.
    const m = sentence.match(/^([\s\S]*?)([.!?]+)$/)
    const body = m ? m[1] : sentence
    const punct = m ? m[2] : ''
    out = out.slice(0, e.start) + `<a href="${e.url}" target="_blank" rel="noopener noreferrer">${body}</a>${punct}` + out.slice(e.end)
  }
  return { html: out, placed, unplaced }
}

// ── B16: verified-source floor ────────────────────────────────────────────────

export const SOURCE_FLOOR = 6

/** Heading words that carry no retrieval value on PubMed. */
const CONVERSATIONAL = new Set(['hurting','hurt','fast','stop','actually','really','worth','getting','checked','mean','means','help','helps','feel','feeling','make','makes','worse','better','home','alone','managing','time','first','hours','days','days','week','weeks'])

/**
 * When fewer than SOURCE_FLOOR verified sources survive, look for reviews,
 * meta-analyses and guidelines per section heading on PubMed. Fill sources
 * carry the heading as their "fact": they may appear in the references list
 * and be linked where a sentence already states the matter; they never add
 * new claims to the prose (ruling 2026-11-09).
 */
export async function pubmedFill(
  headings: string[],
  topic: string,
  needed: number,
  r: Resolvers = liveResolvers,
  ctx: Record<string, unknown> = {},
): Promise<FactSource[]> {
  const out: FactSource[] = []
  const seen = new Set<string>()
  const topicTerms = [...contentTerms(topic)].filter((t) => !CONVERSATIONAL.has(t)).slice(0, 2)
  for (const h of headings) {
    if (out.length >= needed) break
    // Live check 2026-11-09: conversational heading words ("hurting", "fast",
    // "stop") AND-ed together return nothing on PubMed. Query = topic's two
    // key terms + the heading's specific terms, narrowing until there are hits.
    const headTerms = [...contentTerms(h)].filter((t) => !topicTerms.includes(t) && !CONVERSATIONAL.has(t))
    let hits: Array<{ id: string; title: string }> = []
    for (const width of [2, 1, 0]) {
      const terms = [...topicTerms, ...headTerms.slice(0, width)]
      if (terms.length < 2) continue
      const q = `${terms.join(' ')} AND (review[pt] OR meta-analysis[pt] OR guideline[pt] OR systematic review[pt]) AND ("last 10 years"[dp])`
      try {
        hits = await r.pubmedSearch(q)
      } catch (err) {
        logger.warn({ ...ctx, heading: h, err }, '[source-verify] fill search failed')
        break
      }
      if (hits.length > 0) break
    }
    for (const hit of hits) {
      const url = `https://pubmed.ncbi.nlm.nih.gov/${hit.id}/`
      if (seen.has(url)) continue
      const o = termOverlap(hit.title, `${h} ${topic}`)
      if (o.shared < 3) continue
      seen.add(url)
      out.push({ fact: `${h}. ${hit.title}`, url, title: hit.title, status: 'fill' })
      if (out.length >= needed) break
    }
  }
  if (out.length) logger.info({ ...ctx, added: out.length, headings: headings.length }, '[source-verify] pubmed fill added sources')
  return out
}

/** B16: fact sources on record (verified at steps 7/8 as step 121, PubMed fill as 122), falling back to tag parsing for older jobs. */
export function loadFactSources(completedSteps: Map<number, string>): FactSource[] {
  const out: FactSource[] = []
  for (const n of [121, 122]) {
    try {
      const list = JSON.parse(completedSteps.get(n) ?? '[]') as FactSource[]
      for (const f of list) if (f?.url && !out.some((o) => o.url === f.url && o.fact === f.fact)) out.push(f)
    } catch {
      /* ignore */
    }
  }
  if (out.length === 0) {
    for (const n of [8, 7]) {
      for (const t of parseFactTags(completedSteps.get(n) ?? '')) {
        if (t.url && !out.some((o) => o.url === t.url)) out.push({ fact: t.fact, url: t.url, title: `${t.institution}${t.publisher ? `, ${t.publisher}` : ''}`, status: 'unchecked' })
      }
    }
  }
  return out
}
