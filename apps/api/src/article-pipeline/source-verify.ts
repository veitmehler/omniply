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
import { fetchPageTitle, isCitable } from './citation-policy'

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
}

export type SourceStatus = 'verified' | 'repaired' | 'unchecked' | 'dropped'

export interface FactSource {
  fact: string
  url: string
  title: string
  status: Exclude<SourceStatus, 'dropped'>
}

export interface VerifyResult {
  text: string
  sources: FactSource[]
  stats: { tags: number; verified: number; repaired: number; unchecked: number; dropped: number; root: number; obs: number }
}

const TAG_RE = /\[Source:\s*([^\]]*)\]/g
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
    const blocks = before.split(/\n\s*\n/)
    before = blocks[blocks.length - 1] ?? before
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
    })
    prevEnd = end
  }
  return tags
}

// ── Identifier resolvers ──────────────────────────────────────────────────────

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const CROSSREF_BASE = 'https://api.crossref.org'
const TIMEOUT_MS = 8_000
const UA = 'OmniplyCitations/1.0 (+https://omniply.io; mailto:ops@omniply.io)'

// NCBI allows 3 requests/s without a key (10 with NCBI_API_KEY). Serialize.
let ncbiChain: Promise<unknown> = Promise.resolve()
const NCBI_GAP_MS = process.env.NCBI_API_KEY ? 120 : 400
function ncbiQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = ncbiChain.then(() => new Promise((r) => setTimeout(r, NCBI_GAP_MS))).then(fn)
  ncbiChain = run.catch(() => undefined)
  return run
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

function ncbiKey(): string {
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

/**
 * Verify every source tag in a research output. Returns the rewritten text
 * (verified or repaired URLs kept, unverifiable URLs removed) and the list of
 * fact→source pairs the inserter may link.
 */
export async function verifyFactSources(
  text: string,
  ctx: Record<string, unknown> = {},
  r: Resolvers = liveResolvers,
): Promise<VerifyResult> {
  const stats = { tags: 0, verified: 0, repaired: 0, unchecked: 0, dropped: 0, root: 0, obs: 0 }
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
    let url = tag.url
    let title = ''
    let status: SourceStatus = 'dropped'

    if (url && isRootUrl(url)) {
      stats.root++
      url = null
    }
    if (url && !isCitable(url)) {
      // Off-policy host: the fact may still be used, the link may not.
      url = null
    }

    if (url) {
      const ident = identifyUrl(url)
      try {
        if (ident) {
          const resolved =
            ident.kind === 'pubmed' ? await r.pubmedTitle(ident.id) : ident.kind === 'pmc' ? await r.pmcTitle(ident.id) : await r.doiTitle(ident.id)
          if (resolved && titleCoversFact(resolved, tag.fact)) {
            title = resolved
            status = 'verified'
          } else {
            logger.info({ ...ctx, url, resolved: resolved?.slice(0, 90) ?? null, fact: tag.fact.slice(0, 90) }, '[source-verify] identifier does not match its fact')
            url = null
          }
        } else {
          const fetched = await r.pageTitle(url)
          // A bot wall is not a title: NCBI Bookshelf (StatPearls) answers with a
          // reCAPTCHA page, Cloudflare with "Just a moment". Treat as unchecked.
          const pageTitle = fetched !== null && BOT_WALL_RE.test(fetched) ? null : fetched
          if (pageTitle === null) {
            status = 'unchecked'
            title = `${tag.institution}${tag.publisher ? `, ${tag.publisher}` : ''}`
          } else if (titleCoversFact(pageTitle, tag.fact) || titleCoversFact(pageTitle, `${tag.institution} ${tag.publisher}`)) {
            title = pageTitle
            status = 'verified'
          } else {
            logger.info({ ...ctx, url, pageTitle: pageTitle.slice(0, 90), fact: tag.fact.slice(0, 90) }, '[source-verify] page title does not match its fact')
            url = null
          }
        }
      } catch (err) {
        logger.warn({ ...ctx, url, err }, '[source-verify] resolver failed, treating as unchecked')
        status = 'unchecked'
        title = tag.institution
      }
    }

    if (!url && looksLikePaper(tag)) {
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

    if (url && status !== 'dropped') {
      sources.push({ fact: tag.fact, url, title, status })
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
  return { text: out, sources, stats }
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
