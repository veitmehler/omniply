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
 * Fail-soft: any unit or page that fails is skipped. A thin feed stays thin: the
 * grounded fallback is gone (2026-11-24, it invented a third of its identifiers).
 *
 * Source fitness (2026-11-24): a source is vetted before its facts count. Clinic
 * articles read authority pages first and papers second; every source gets its
 * publication type checked and a source card; see source-fitness.ts.
 */
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { meteredCost } from './llm/metered-cost'
import { isCitable, sourceTier } from './citation-policy'
import { contentTerms, termOverlap, liveResolvers, ncbiQueue, NCBI_BASE, ncbiKey, type GroundingSupportPages } from './source-verify'
import { googleSerpOrganic, type SerpOrganic } from '../newsletter/oxylabs'
import { assessSource, classifyPaper, sourceFamily, liveFitnessDeps, type FitnessDeps } from './source-fitness'
import { withLocalUnits, type MeasurementSystem } from './units'

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
  /** Source vetting lookups; the live ones when omitted. */
  fitness?: FitnessDeps
}

export interface RetrievalResult {
  text: string
  supports: GroundingSupportPages[]
  chunkUris: string[]
  facts: RetrievedFact[]
  stats: { units: number; queries: number; candidates: number; pagesRead: number; facts: number; unitsEmpty: number; sourcesRejected: number; factsDropped: number }
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
/** Candidates looked at per unit before giving up on filling its pages (each costs at most one free PubMed lookup). */
const MAX_SCREENED_PER_UNIT = 8
const UNIT_CONCURRENCY = 3
/** Question words that survive the stopword list but carry no search meaning. */
const GENERIC = new Set(['take', 'heal', 'help', 'actually', 'really', 'make', 'long', 'much', 'many', 'does', 'should', 'could', 'would', 'thing', 'need', 'want', 'know', 'work', 'good', 'best', 'safe', 'mean', 'happen', 'like', 'feel', 'better', 'worse', 'guide', 'beginner', 'matter'])
export function searchTerms(s: string): string[] {
  return [...contentTerms(s)].filter((t) => !GENERIC.has(t))
}

/** Hosts the SERP may return, in three searches. The domain policy is applied again on every result.
 *  Google reads about 32 words of a query, so each list stays under ten sites. */
const PAPER_SITES = ['site:pubmed.ncbi.nlm.nih.gov', 'site:pmc.ncbi.nlm.nih.gov', 'site:ncbi.nlm.nih.gov/books', 'site:cochranelibrary.com']
/** Public health bodies. */
const BODY_SITES = ['site:nih.gov', 'site:medlineplus.gov', 'site:cdc.gov', 'site:fda.gov', 'site:who.int', 'site:nhs.uk', 'site:nice.org.uk', 'site:gov.au', 'site:racgp.org.au']
/** Hospital systems and patient education from professional bodies (Veit, 2026-11-24: "Mayo is viewed as an authority in the health space"). */
const CLINIC_SITES = ['site:mayoclinic.org', 'site:clevelandclinic.org', 'site:hopkinsmedicine.org', 'site:health.harvard.edu', 'site:hss.edu', 'site:orthoinfo.aaos.org', 'site:familydoctor.org', 'site:merckmanuals.com', 'site:arthritis.org']

/** Azavea (business topics for practice owners): regulators, government statistics, business schools, platform docs. */
const BUSINESS_SITES_A = ['site:ftc.gov', 'site:sba.gov', 'site:bls.gov', 'site:census.gov', 'site:cms.gov', 'site:hhs.gov', 'site:pewresearch.org']
const BUSINESS_SITES_B = ['site:hbr.org', 'site:sloanreview.mit.edu', 'site:thinkwithgoogle.com', 'site:support.google.com', 'site:acatoday.org', 'site:fclb.org', 'site:ama-assn.org', 'site:nber.org', 'site:brookings.edu']

/** Clinics: three queries per unit, hospital systems and patient education first, then public health bodies, then papers.
 *  Azavea: regulators/statistics, then business schools and platform docs. */
export function buildQueries(unit: string, topic: string, vertical?: string | null): string[] {
  const unitTerms = searchTerms(unit).slice(0, 5)
  const topicTerms = searchTerms(topic).filter((t) => !unitTerms.includes(t)).slice(0, 2)
  const core = [...unitTerms, ...topicTerms].join(' ')
  if (!core) return []
  if (vertical === 'azavea') {
    return [`${core} (${BUSINESS_SITES_A.join(' OR ')})`, `${core} (${BUSINESS_SITES_B.join(' OR ')})`]
  }
  return [CLINIC_SITES, BODY_SITES, PAPER_SITES].map((sites) => `${core} (${sites.join(' OR ')})`)
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

/** Rank candidates: policy-filtered, deduped, at least one unit term in title+snippet, more overlap first,
 * one page per host. Clinic articles read authority pages (hospital systems, health bodies, reference texts)
 * before papers: a search by section words lands on any paper that contains them, and the odd citations of
 * 2026-11-24 all came in that way. Azavea keeps its primary tier (regulators, statistics) first. */
export function rankCandidates(results: SerpOrganic[], unit: string, topic: string, seen: Set<string>, vertical?: string | null, perHost = MAX_PAGES_PER_HOST): SerpOrganic[] {
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
      const ta = readFirst(a.r.url, vertical) ? 0 : 1
      const tb = readFirst(b.r.url, vertical) ? 0 : 1
      return ta - tb || b.all - a.all || a.i - b.i
    })
  const hostCount = new Map<string, number>()
  const out: SerpOrganic[] = []
  for (const x of scored) {
    const h = hostOf(x.r.url)
    const n = hostCount.get(h) ?? 0
    if (n >= perHost) continue
    hostCount.set(h, n + 1)
    out.push(x.r)
  }
  return out
}

/** Clinics: authority pages and reference texts before journal papers. Azavea: its primary tier first. */
function readFirst(url: string, vertical?: string | null): boolean {
  if (vertical === 'azavea') return sourceTier(url, vertical) === 'primary'
  return sourceFamily(url) !== 'paper'
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
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number; cachedContentTokenCount?: number }
  }
  const c = j.candidates?.[0]
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  const um = j.usageMetadata ?? {}
  const input = (um.promptTokenCount ?? 0) + (um.toolUsePromptTokenCount ?? 0)
  const output = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0)
  const status = c?.urlContextMetadata?.urlMetadata?.[0]?.urlRetrievalStatus ?? ''
  return { text, cost: meteredCost('gemini', EXTRACT_MODEL, input, output, 0, um.cachedContentTokenCount ?? 0), tokens: { input, output }, retrieved: tools ? /SUCCESS/i.test(status) : true }
}

/** Azavea (practice-owner business articles): facts arrive in the practice's own
 *  measures, never in software-subscription metrics (NRR entered a retainer
 *  article this way, 2026-11-12). Clinic verticals get no extra line. */
const AZAVEA_EXTRACTION_RULE =
  'The reader runs a healthcare practice as a business. State a figure in the measures a practice uses (patients, visits, new-patient calls, show rate, dollars, hours, weeks). Skip any fact expressed as a software-subscription metric (net revenue retention, MRR, ARR, churn cohorts, CAC payback, LTV) and any fact about an industry that is not a local service business, even when the words overlap. '

/** Argon round on Dasha's articles (2026-11-12): a bench-press row scraped
 *  from a review's summary table, a nurses' occupational study, hospital HBOT
 *  indications, an ophthalmology exam list and US insurance percentages all
 *  reached a wellness-clinic article because extraction matched terms, not
 *  the reader's situation. Every fact now carries its setting and a verdict
 *  on whether it applies to the reader; non-applying facts are dropped here. */
const SETTING_RULE =
  'READER CHECK: the article is read by the practice\'s own clients or patients in everyday life (for a business article, by the practice owner). ' +
  'Return a fact ONLY when its population and setting match that reader. Skip hospital, inpatient, surgical and critical-care protocols; animal, cell and tissue studies; occupational studies of other professions (nurses, soldiers, students); and another country\'s insurance, reimbursement or regulation unless the article is explicitly about that country. ' +
  'Never extract a row from a table, a figure legend or a list of study conditions: a fact rests on one sentence of prose that a reader could have read. ' +
  'RELEVANCE CHECK (2026-11-13): a fact is about the section\'s own subject at the reader\'s level, something the reader could repeat to a friend without a biochemistry lesson. A laboratory finding (a plasma compound, a cellular marker, DNA strand breaks) that only connects to the section through a chain of inference does not apply; mark it "applies": false. '

export function extractionPrompt(unit: string, industry: string, sourceLabel: string, topic = '', vertical?: string | null): string {
  return (
    `You extract facts for an article written by a ${industry} practice.${topic ? ` The article is about: "${topic}".` : ''} The article section is: "${unit}".\n` +
    SETTING_RULE +
    (vertical === 'azavea' ? AZAVEA_EXTRACTION_RULE : '') +
    `From the source below, return up to ${MAX_FACTS_PER_SOURCE} facts that are directly relevant to that section AND to the article's subject. ` +
    `If the source is about a different condition, population or treatment than the article (for example a page on Parkinson's disease for an article on back stiffness), return [] even if a sentence mentions a shared word. ` +
    `A fact is one plain sentence stating what was found, with its figure, rate or duration when the source gives one. ` +
    `Each fact must rest on one sentence of the source, copied exactly as "quote". Never use general knowledge; if the source has nothing relevant, return [].\n` +
    `Take what the source itself establishes: its own findings, measurements and recommendations. Skip a sentence in which the source reports what other work found (it carries a reference marker such as [3], or says "previous studies", "it is believed", "has been reported").\n` +
    `Output ONLY a JSON array: [{"fact": "...", "quote": "...", "setting": "<population and setting, under 8 words>", "applies": true|false}] where "applies" is false when the setting does not match the reader.\n\n${sourceLabel}`
  )
}

/** A quote that is a table row rather than prose: mostly numbers, symbols and
 *  abbreviations with hardly any running words ("High VOL BP (8x10x70%1RM) 6- & 30-h post"). */
export function looksLikeTableRow(quote: string): boolean {
  const tokens = quote.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const wordy = tokens.filter((t) => /^[A-Za-z][a-z]{2,}[,.;:]?$/.test(t)).length
  const numeric = tokens.filter((t) => /\d/.test(t)).length
  if (wordy < 5) return true
  return numeric / tokens.length > 0.4 || /\d\s*[x×]\s*\d/.test(quote)
}

export function parseFacts(raw: string): Array<{ fact: string; quote: string; setting?: string }> {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as Array<{ fact?: string; quote?: string; setting?: string; applies?: unknown }>
    return arr
      .filter((x) => x && typeof x.fact === 'string' && x.fact.trim().length > 20 && typeof x.quote === 'string' && x.quote.trim().length > 15)
      .filter((x) => x.applies !== false && String(x.applies).toLowerCase() !== 'false')
      .filter((x) => !looksLikeTableRow(x.quote!))
      .slice(0, MAX_FACTS_PER_SOURCE)
      .map((x) => ({ fact: x.fact!.trim(), quote: x.quote!.trim().slice(0, 400), ...(typeof x.setting === 'string' ? { setting: x.setting.trim().slice(0, 80) } : {}) }))
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
  /** The measurement system the clinic's readers use. When given, a measurement in the other system gets the local figure in brackets. */
  measures?: MeasurementSystem
  deps?: RetrievalDeps
}): Promise<RetrievalResult> {
  const deps = opts.deps ?? liveRetrievalDeps
  const stats = { units: opts.units.length, queries: 0, candidates: 0, pagesRead: 0, facts: 0, unitsEmpty: 0, sourcesRejected: 0, factsDropped: 0 }
  const facts: RetrievedFact[] = []
  const seen = new Set<string>()
  let cost = 0
  const tokens = { input: 0, output: 0 }
  const ctx = { jobId: opts.jobId, stepNumber: opts.stepNumber }
  const industry = opts.industry || 'health'

  // Source fitness applies to clinic articles. Azavea's business sources (regulators, statistics) are not papers
  // about care, and its extraction rule already ties each fact to a practice's own measures.
  const vetting = opts.vertical !== 'azavea'
  const fitness = deps.fitness ?? liveFitnessDeps

  /** A paper whose PubMed record already rules it out is never read. Costs one free lookup. */
  const ruledOutByType = async (url: string, title: string): Promise<string | null> => {
    if (!vetting || sourceFamily(url) !== 'paper') return null
    const rec = await fitness.paperRecord(url).catch(() => null)
    return classifyPaper(rec?.pubTypes ?? [], rec?.title || title).reject
  }

  /** Keep the facts a vetted source may be cited for. */
  const vet = async (unit: string, url: string, title: string, extracted: Array<{ fact: string; quote: string }>, text: string | null): Promise<Array<{ fact: string; quote: string }>> => {
    if (!vetting || extracted.length === 0) return extracted
    const a = await assessSource({ url, title, practice: industry, topic: opts.topic, sections: [unit], facts: extracted, text }, fitness)
    cost += a.cost
    tokens.input += a.tokens.input
    tokens.output += a.tokens.output
    if (a.rejected) {
      stats.sourcesRejected++
      stats.factsDropped += extracted.length
      logger.info({ ...ctx, unit, url, title: a.meta.title.slice(0, 120), why: a.rejected }, '[research-retrieval] source rejected')
      return []
    }
    const kept: Array<{ fact: string; quote: string }> = []
    extracted.forEach((f, i) => {
      const v = a.facts[i]
      if (v.use === 'drop') {
        stats.factsDropped++
        logger.info({ ...ctx, unit, url, fact: f.fact.slice(0, 120), why: v.reason }, '[research-retrieval] fact dropped')
        return
      }
      // A single study speaks for the group it studied: the writer gets that group with the fact.
      const scope = v.use === 'cite-as-finding' && a.card?.population ? ` (One study, in ${a.card.population.replace(/[.\s]+$/, '').toLowerCase()}.)` : ''
      kept.push({ fact: f.fact.replace(/\s+$/, '') + scope, quote: f.quote })
    })
    return kept
  }

  const runUnit = async (unit: string) => {
    const before = facts.length
    // 1. PubMed papers (free, identifiers real by construction): reviews, meta-analyses and guidelines only.
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
          const typeReject = await ruledOutByType(url, h.title)
          if (typeReject) {
            stats.sourcesRejected++
            logger.info({ ...ctx, unit, url, title: h.title.slice(0, 120), why: typeReject }, '[research-retrieval] source rejected')
            continue
          }
          const abs = await deps.pubmedAbstract(h.id)
          if (!abs) continue
          stats.pagesRead++
          const ex = await deps.extractFromText(unit, h.title, abs, industry, opts.topic, opts.vertical)
          cost += ex.cost
          tokens.input += ex.tokens.input
          tokens.output += ex.tokens.output
          for (const f of await vet(unit, url, h.title, ex.facts, abs)) facts.push({ ...f, url, title: h.title, unit })
        }
      } catch (err) {
        logger.warn({ ...ctx, unit, err }, '[research-retrieval] pubmed path failed for unit')
      }
    }
    // 2. Authority pages via our own search, then papers the search found.
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
    // Rank the whole list, then read down it until the unit has its pages: a paper ruled out by its type
    // gives its place to the next candidate instead of leaving the unit a page short.
    // The one-page-per-host cap counts pages read, so a ruled-out paper does not use up its host's place.
    const ranked = rankCandidates(candidates, unit, opts.topic, seen, opts.vertical, Infinity)
    const readPerHost = new Map<string, number>()
    let read = 0
    let screened = 0
    for (const c of ranked) {
      if (read >= MAX_PAGES_PER_UNIT || screened >= MAX_SCREENED_PER_UNIT) break
      const host = hostOf(c.url)
      if ((readPerHost.get(host) ?? 0) >= MAX_PAGES_PER_HOST) continue
      screened++
      seen.add(norm(c.url))
      stats.candidates++
      try {
        const typeReject = await ruledOutByType(c.url, c.title)
        if (typeReject) {
          stats.sourcesRejected++
          logger.info({ ...ctx, unit, url: c.url, title: (c.title || '').slice(0, 120), why: typeReject }, '[research-retrieval] source rejected')
          continue
        }
        read++
        readPerHost.set(host, (readPerHost.get(host) ?? 0) + 1)
        const ex = await deps.extractFromUrl(unit, c.url, industry, opts.topic, opts.vertical)
        cost += ex.cost
        tokens.input += ex.tokens.input
        tokens.output += ex.tokens.output
        if (ex.retrieved) stats.pagesRead++
        const title = c.title || hostOf(c.url)
        for (const f of await vet(unit, c.url, title, ex.facts, c.snippet || null)) facts.push({ ...f, url: c.url, title, unit })
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
  // Measurements in the reader's units, added once, here, so the feed, the supports and the stored records carry the same text.
  if (opts.measures) for (const f of facts) f.fact = withLocalUnits(f.fact, opts.measures)
  // Keep feed order by unit, then by discovery.
  stats.facts = facts.length

  // Grounding-support shape: each fact's own text maps to its page, so the verifier pairs them deterministically.
  const chunkUris = [...new Set(facts.map((f) => f.url))]
  const supports: GroundingSupportPages[] = facts.map((f) => ({ text: f.fact, urls: [f.url] }))
  logger.info({ ...ctx, ...stats, cost: Number(cost.toFixed(4)) }, '[research-retrieval] done')
  return { text: assembleFeed(facts, opts.units), supports, chunkUris, facts, stats, cost, tokens }
}
