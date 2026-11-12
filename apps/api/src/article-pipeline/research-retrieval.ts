/**
 * Retrieval-first research (bench B21, 2026-11-10). Behind RESEARCH_MODE=retrieval.
 *
 * The grounded path lets Gemini decide whether to search; on topics it "knows"
 * it answers from memory and the per-unit split then costs 14 grounded calls.
 * Here nothing a model writes ever chooses a source:
 *   1. queries are ours, built from each unit's terms with site restrictions to
 *      the authority hosts (and PubMed's own API for papers);
 *   2. pages are ranked by us on title + snippet overlap and capped per unit;
 *   3. facts are extracted from each page (or abstract) by a small model that
 *      must return the verbatim sentence each fact rests on; the URL is attached
 *      by us;
 *   4. the output has exactly the shape of a step-7/8 feed plus grounding
 *      supports, so the verifier, pool, anchoring, writer and fact checker run
 *      unchanged.
 * Fail-soft: any unit or page that fails is skipped; the executor falls back to
 * the grounded step when the feed ends under the floor.
 */
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { calculateCost } from './llm/cost-table'
import { isCitable, sourceTier } from './citation-policy'
import { contentTerms, termOverlap, liveResolvers, ncbiQueue, NCBI_BASE, ncbiKey, type GroundingSupportPages } from './source-verify'
import { googleSerpOrganic, type SerpOrganic } from '../newsletter/oxylabs'

export interface RetrievedFact {
  fact: string
  quote: string
  url: string
  title: string
  unit: string
}

export interface RetrievalDeps {
  serp: (query: string) => Promise<SerpOrganic[]>
  pubmedSearch: (query: string) => Promise<Array<{ id: string; title: string }>>
  pubmedAbstract: (id: string) => Promise<string | null>
  /** Extract facts for `unit` from a source text (abstract). */
  extractFromText: (unit: string, title: string, text: string, industry: string, topic: string, vertical?: string | null) => Promise<{ facts: Array<{ fact: string; quote: string }>; cost: number; tokens: { input: number; output: number } }>
  /** Extract facts for `unit` from a page Google reads (URL context). */
  extractFromUrl: (unit: string, url: string, industry: string, topic: string, vertical?: string | null) => Promise<{ facts: Array<{ fact: string; quote: string }>; cost: number; tokens: { input: number; output: number }; retrieved: boolean }>
}

export interface RetrievalResult {
  text: string
  supports: GroundingSupportPages[]
  chunkUris: string[]
  facts: RetrievedFact[]
  stats: { units: number; queries: number; candidates: number; pagesRead: number; facts: number; unitsEmpty: number }
  cost: number
  tokens: { input: number; output: number }
}

const EXTRACT_MODEL = 'gemini-3.1-flash-lite'
const UA = 'OmniplyCitations/1.0 (+https://omniply.io; mailto:ops@omniply.io)'
const TIMEOUT_MS = 45_000
const MAX_PAGES_PER_UNIT = 3
const MAX_PUBMED_PER_UNIT = 2
const MAX_FACTS_PER_SOURCE = 3
const MAX_PAGES_PER_HOST = 1
const UNIT_CONCURRENCY = 3
/** Question words that survive the stopword list but carry no search meaning. */
const GENERIC = new Set(['take', 'heal', 'help', 'actually', 'really', 'make', 'long', 'much', 'many', 'does', 'should', 'could', 'would', 'thing', 'need', 'want', 'know', 'work', 'good', 'best', 'safe', 'mean', 'happen', 'like', 'feel', 'better', 'worse', 'guide', 'beginner', 'matter'])
export function searchTerms(s: string): string[] {
  return [...contentTerms(s)].filter((t) => !GENERIC.has(t))
}

/** Hosts the SERP may return. The domain policy is applied again on every result. */
const AUTHORITY_SITES = [
  'site:pubmed.ncbi.nlm.nih.gov',
  'site:pmc.ncbi.nlm.nih.gov',
  'site:ncbi.nlm.nih.gov/books',
  'site:cochranelibrary.com',
  'site:nih.gov',
  'site:cdc.gov',
  'site:who.int',
  'site:nhs.uk',
  'site:nice.org.uk',
  'site:gov.au',
  'site:racgp.org.au',
  'site:mayoclinic.org',
  'site:clevelandclinic.org',
  'site:hopkinsmedicine.org',
  'site:health.harvard.edu',
]

/** Azavea (business topics for practice owners): regulators, government statistics, business schools, platform docs. */
const BUSINESS_SITES_A = ['site:ftc.gov', 'site:sba.gov', 'site:bls.gov', 'site:census.gov', 'site:cms.gov', 'site:hhs.gov', 'site:pewresearch.org']
const BUSINESS_SITES_B = ['site:hbr.org', 'site:sloanreview.mit.edu', 'site:thinkwithgoogle.com', 'site:support.google.com', 'site:acatoday.org', 'site:fclb.org', 'site:ama-assn.org', 'site:nber.org', 'site:brookings.edu']

/** Two queries per unit: papers, then official bodies and hospital systems (clinics); regulators/statistics, then business schools and platform docs (Azavea). */
export function buildQueries(unit: string, topic: string, vertical?: string | null): string[] {
  const unitTerms = searchTerms(unit).slice(0, 5)
  const topicTerms = searchTerms(topic).filter((t) => !unitTerms.includes(t)).slice(0, 2)
  const core = [...unitTerms, ...topicTerms].join(' ')
  if (!core) return []
  if (vertical === 'azavea') {
    return [`${core} (${BUSINESS_SITES_A.join(' OR ')})`, `${core} (${BUSINESS_SITES_B.join(' OR ')})`]
  }
  const papers = `${core} (${AUTHORITY_SITES.slice(0, 4).join(' OR ')})`
  const bodies = `${core} (${AUTHORITY_SITES.slice(4).join(' OR ')})`
  return [papers, bodies]
}

/** PubMed queries for a unit, widest first: reviews, meta-analyses, guidelines, last 10 years.
 * Generic verbs are dropped; the caller tries each until one returns hits. */
export function buildPubmedQueries(unit: string, topic: string): string[] {
  const unitTerms = searchTerms(unit).slice(0, 4)
  const topicTerms = searchTerms(topic).filter((t) => !unitTerms.includes(t)).slice(0, 2)
  const terms = [...unitTerms, ...topicTerms]
  const filter = '(review[pt] OR meta-analysis[pt] OR guideline[pt] OR systematic review[pt]) AND ("last 10 years"[dp])'
  const out: string[] = []
  for (const n of [4, 3, 2]) {
    if (terms.length < n) continue
    out.push(`${terms.slice(0, n).join(' ')} AND ${filter}`)
  }
  if (out.length === 0 && terms.length === 1) out.push(`${terms[0]} AND ${filter}`)
  return [...new Set(out)]
}

/** Rank candidates: policy-filtered, deduped, at least one unit term in title+snippet, primary tier
 * (journals, NCBI, Cochrane) before official bodies, more overlap first, one page per host. */
export function rankCandidates(results: SerpOrganic[], unit: string, topic: string, seen: Set<string>, vertical?: string | null): SerpOrganic[] {
  const local = new Set<string>()
  const unitKey = searchTerms(unit).join(' ')
  const topicKey = searchTerms(topic).join(' ')
  const scored = results
    .filter((r) => {
      const k = norm(r.url)
      if (!isCitable(r.url, vertical) || seen.has(k) || local.has(k)) return false
      local.add(k)
      return true
    })
    .map((r, i) => ({ r, i, unit: termOverlap(`${r.title} ${r.snippet}`, unitKey).shared, topic: topicKey ? termOverlap(`${r.title} ${r.snippet}`, topicKey).shared : 1, all: termOverlap(`${r.title} ${r.snippet}`, `${unit} ${topic}`).shared }))
    .filter((x) => x.unit >= 1 && x.topic >= 1)
    .sort((a, b) => {
      const ta = sourceTier(a.r.url, vertical) === 'primary' ? 0 : 1
      const tb = sourceTier(b.r.url, vertical) === 'primary' ? 0 : 1
      return ta - tb || b.all - a.all || a.i - b.i
    })
  const perHost = new Map<string, number>()
  const out: SerpOrganic[] = []
  for (const x of scored) {
    const h = hostOf(x.r.url)
    const n = perHost.get(h) ?? 0
    if (n >= MAX_PAGES_PER_HOST) continue
    perHost.set(h, n + 1)
    out.push(x.r)
  }
  return out
}

function norm(u: string): string {
  return u.trim().replace(/\/$/, '')
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function geminiJson(prompt: string, tools?: unknown[]): Promise<{ text: string; cost: number; tokens: { input: number; output: number }; retrieved: boolean }> {
  const key = await getSystemApiKey('gemini')
  if (!key) throw new Error('No Gemini key')
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], ...(tools ? { tools } : {}), generationConfig: { maxOutputTokens: 900 } }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; urlContextMetadata?: { urlMetadata?: Array<{ urlRetrievalStatus?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number }
  }
  const c = j.candidates?.[0]
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  const um = j.usageMetadata ?? {}
  const input = (um.promptTokenCount ?? 0) + (um.toolUsePromptTokenCount ?? 0)
  const output = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0)
  const status = c?.urlContextMetadata?.urlMetadata?.[0]?.urlRetrievalStatus ?? ''
  return { text, cost: calculateCost(EXTRACT_MODEL, input, output), tokens: { input, output }, retrieved: tools ? /SUCCESS/i.test(status) : true }
}

/** Azavea (practice-owner business articles): facts arrive in the practice's own
 *  measures, never in software-subscription metrics (NRR entered a retainer
 *  article this way, 2026-11-12). Clinic verticals get no extra line. */
const AZAVEA_EXTRACTION_RULE =
  'The reader runs a healthcare practice as a business. State a figure in the measures a practice uses (patients, visits, new-patient calls, show rate, dollars, hours, weeks). Skip any fact expressed as a software-subscription metric (net revenue retention, MRR, ARR, churn cohorts, CAC payback, LTV) and any fact about an industry that is not a local service business, even when the words overlap. '

export function extractionPrompt(unit: string, industry: string, sourceLabel: string, topic = '', vertical?: string | null): string {
  return (
    `You extract facts for an article written by a ${industry} practice.${topic ? ` The article is about: "${topic}".` : ''} The article section is: "${unit}".\n` +
    (vertical === 'azavea' ? AZAVEA_EXTRACTION_RULE : '') +
    `From the source below, return up to ${MAX_FACTS_PER_SOURCE} facts that are directly relevant to that section AND to the article's subject. ` +
    `If the source is about a different condition, population or treatment than the article (for example a page on Parkinson's disease for an article on back stiffness), return [] even if a sentence mentions a shared word. ` +
    `A fact is one plain sentence stating what was found, with its figure, rate or duration when the source gives one. ` +
    `Each fact must rest on one sentence of the source, copied exactly as "quote". Never use general knowledge; if the source has nothing relevant, return [].\n` +
    `Output ONLY a JSON array: [{"fact": "...", "quote": "..."}]\n\n${sourceLabel}`
  )
}

export function parseFacts(raw: string): Array<{ fact: string; quote: string }> {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as Array<{ fact?: string; quote?: string }>
    return arr
      .filter((x) => x && typeof x.fact === 'string' && x.fact.trim().length > 20 && typeof x.quote === 'string' && x.quote.trim().length > 15)
      .slice(0, MAX_FACTS_PER_SOURCE)
      .map((x) => ({ fact: x.fact!.trim(), quote: x.quote!.trim().slice(0, 400) }))
  } catch {
    return []
  }
}

/** The quote must largely occur in the source text (when we hold the text). */
function quoteInText(quote: string, text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const q = quote.toLowerCase().replace(/\s+/g, ' ')
  if (t.includes(q)) return true
  const words = q.split(/\W+/).filter((w) => w.length > 3)
  if (words.length < 4) return false
  return words.filter((w) => t.includes(w)).length / words.length >= 0.75
}

export const liveRetrievalDeps: RetrievalDeps = {
  serp: (q) => googleSerpOrganic(q, 'United States', 'com'),
  pubmedSearch: liveResolvers.pubmedSearch,
  async pubmedAbstract(pmid) {
    try {
      const res = await ncbiQueue(() => fetch(`${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text${ncbiKey()}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }))
      if (!res.ok) return null
      const t = (await res.text()).replace(/\s+/g, ' ').trim()
      return t.length > 80 ? t : null
    } catch {
      return null
    }
  },
  async extractFromText(unit, title, text, industry, topic, vertical) {
    const r = await geminiJson(extractionPrompt(unit, industry, `SOURCE TITLE: ${title}\nSOURCE TEXT:\n${text.slice(0, 6000)}`, topic, vertical))
    const facts = parseFacts(r.text).filter((f) => quoteInText(f.quote, text))
    return { facts, cost: r.cost, tokens: r.tokens }
  },
  async extractFromUrl(unit, url, industry, topic, vertical) {
    const r = await geminiJson(extractionPrompt(unit, industry, `SOURCE PAGE (read it): ${url}`, topic, vertical), [{ url_context: {} }])
    return { facts: r.retrieved ? parseFacts(r.text) : [], cost: r.cost, tokens: r.tokens, retrieved: r.retrieved }
  },
}

/** Assemble a step-7/8-shaped feed: numbered facts with [Source: …] tags, grouped by unit. */
export function assembleFeed(facts: RetrievedFact[], units: string[]): string {
  const lines: string[] = []
  let n = 0
  for (const unit of units) {
    const fs = facts.filter((f) => f.unit === unit)
    if (fs.length === 0) continue
    lines.push(`**${unit}**`)
    for (const f of fs) {
      n++
      lines.push(`${n}. ${f.fact} [Source: ${f.title.replace(/[\[\]]/g, '').slice(0, 120)}, ${hostOf(f.url)}, ${f.url}]`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

export async function runRetrievalResearch(opts: {
  jobId: string
  stepNumber: number
  units: string[]
  topic: string
  industry: string
  /** 'azavea' switches to business/regulatory sources and skips the PubMed path. */
  vertical?: string | null
  deps?: RetrievalDeps
}): Promise<RetrievalResult> {
  const deps = opts.deps ?? liveRetrievalDeps
  const stats = { units: opts.units.length, queries: 0, candidates: 0, pagesRead: 0, facts: 0, unitsEmpty: 0 }
  const facts: RetrievedFact[] = []
  const seen = new Set<string>()
  let cost = 0
  const tokens = { input: 0, output: 0 }
  const ctx = { jobId: opts.jobId, stepNumber: opts.stepNumber }
  const industry = opts.industry || 'health'

  const runUnit = async (unit: string) => {
    const before = facts.length
    // 1. PubMed papers (free, identifiers real by construction).
    let hits: Array<{ id: string; title: string }> = []
    for (const pq of opts.vertical === 'azavea' ? [] : buildPubmedQueries(unit, opts.topic)) {
      try {
        stats.queries++
        hits = (await deps.pubmedSearch(pq)).slice(0, MAX_PUBMED_PER_UNIT)
      } catch (err) {
        logger.warn({ ...ctx, unit, err }, '[research-retrieval] pubmed search failed')
      }
      if (hits.length > 0) break
    }
    {
      try {
        for (const h of hits) {
          const url = `https://pubmed.ncbi.nlm.nih.gov/${h.id}/`
          if (seen.has(norm(url))) continue
          seen.add(norm(url))
          stats.candidates++
          const abs = await deps.pubmedAbstract(h.id)
          if (!abs) continue
          stats.pagesRead++
          const ex = await deps.extractFromText(unit, h.title, abs, industry, opts.topic, opts.vertical)
          cost += ex.cost
          tokens.input += ex.tokens.input
          tokens.output += ex.tokens.output
          for (const f of ex.facts) facts.push({ ...f, url, title: h.title, unit })
        }
      } catch (err) {
        logger.warn({ ...ctx, unit, err }, '[research-retrieval] pubmed path failed for unit')
      }
    }
    // 2. Authority pages via our own search.
    let candidates: SerpOrganic[] = []
    for (const q of buildQueries(unit, opts.topic, opts.vertical)) {
      try {
        stats.queries++
        const res = await deps.serp(q)
        candidates.push(...res)
      } catch (err) {
        logger.warn({ ...ctx, unit, err }, '[research-retrieval] serp failed')
      }
    }
    candidates = rankCandidates(candidates, unit, opts.topic, seen, opts.vertical).slice(0, MAX_PAGES_PER_UNIT)
    stats.candidates += candidates.length
    for (const c of candidates) {
      seen.add(norm(c.url))
      try {
        const ex = await deps.extractFromUrl(unit, c.url, industry, opts.topic, opts.vertical)
        cost += ex.cost
        tokens.input += ex.tokens.input
        tokens.output += ex.tokens.output
        if (ex.retrieved) stats.pagesRead++
        for (const f of ex.facts) facts.push({ ...f, url: c.url, title: c.title || hostOf(c.url), unit })
      } catch (err) {
        logger.warn({ ...ctx, unit, url: c.url, err }, '[research-retrieval] page extraction failed')
      }
    }
    if (facts.length === before) stats.unitsEmpty++
  }
  const queue = [...opts.units]
  await Promise.all(Array.from({ length: Math.min(UNIT_CONCURRENCY, queue.length) }, async () => {
    for (let u = queue.shift(); u !== undefined; u = queue.shift()) await runUnit(u)
  }))
  // Keep feed order by unit, then by discovery.
  stats.facts = facts.length

  // Grounding-support shape: each fact's own text maps to its page, so the verifier pairs them deterministically.
  const chunkUris = [...new Set(facts.map((f) => f.url))]
  const supports: GroundingSupportPages[] = facts.map((f) => ({ text: f.fact, urls: [f.url] }))
  logger.info({ ...ctx, ...stats, cost: Number(cost.toFixed(4)) }, '[research-retrieval] done')
  return { text: assembleFeed(facts, opts.units), supports, chunkUris, facts, stats, cost, tokens }
}
