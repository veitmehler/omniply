/**
 * Source fitness (2026-11-24): judge the source before any fact is taken from it.
 *
 * Until now research verified one thing: the page contains the sentence. That
 * let a post-surgery case report define sciatica, a trial's plan report its
 * outcomes, an engineering review of sensor gloves explain morning stiffness,
 * and a review written to document the harms of spinal manipulation appear in
 * a chiropractor's article (Gemini read of the GEMINI2 bench). Every one of
 * those facts was "supported" by a verbatim quote.
 *
 * Three checks, cheapest first:
 *   1. the paper's publication type, from PubMed's own record (free): case
 *      reports, trial plans, letters and animal work never become sources;
 *   2. a source card, one small-model call on title + abstract: what the
 *      source is about, who it covers, its message, its stance toward the
 *      practice's own service, and whether it is about the same subject as the facts taken;
 *   3. per fact: is it the source's own finding, or a sentence in which the
 *      source reports what others found.
 *
 * Rulings (Veit, 2026-11-24): never cite a source critical of the practice's
 * own profession; a single study only for its own specific finding; common
 * knowledge links to an authority page or stays unlinked.
 */
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { meteredCost } from './llm/metered-cost'
import { sourceTier } from './citation-policy'
import { identifyUrl, ncbiQueue, NCBI_BASE, ncbiKey } from './source-verify'

const FIT_MODEL = process.env.SOURCE_FIT_MODEL || 'gemini-3.1-flash-lite'
const UA = 'OmniplyCitations/1.0 (+https://omniply.io; mailto:ops@omniply.io)'
const TIMEOUT_MS = 30_000

// ── 1. What kind of document is it ───────────────────────────────────────────

/** paper = journal article; reference = clinical reference text (NCBI Bookshelf); page = an authority site's own page. */
export type SourceFamily = 'paper' | 'reference' | 'page'
/** synthesis = review, meta-analysis, guideline; study = a single piece of research. */
export type PaperClass = 'synthesis' | 'study'

export interface SourceMeta {
  url: string
  family: SourceFamily
  title: string
  pubTypes: string[]
  journal: string | null
  year: number | null
  pmid: string | null
}

export function sourceFamily(url: string): SourceFamily {
  if (/ncbi\.nlm\.nih\.gov\/books\//i.test(url)) return 'reference'
  if (identifyUrl(url)) return 'paper'
  return sourceTier(url) === 'primary' ? 'paper' : 'page'
}

/** PubMed publication types that never make a citable source for a patient article. */
const REJECT_PUB_TYPES: Record<string, string> = {
  'case reports': 'a case report',
  'clinical trial protocol': 'a trial plan, written before results existed',
  letter: 'a letter',
  comment: 'a comment on another paper',
  editorial: 'an editorial',
  news: 'a news item',
  'newspaper article': 'a news item',
  'retracted publication': 'retracted',
  'retraction of publication': 'a retraction notice',
  'published erratum': 'an erratum',
  preprint: 'a preprint, not peer reviewed',
  'personal narrative': 'a personal narrative',
  biography: 'a biography',
  'historical article': 'a historical article',
  interview: 'an interview',
}

const SYNTHESIS_PUB_TYPES = new Set(['meta-analysis', 'systematic review', 'review', 'practice guideline', 'guideline', 'consensus development conference', 'network meta-analysis', 'scoping review'])

/** PubMed files many reviews as plain journal articles; the title says what they are. */
const SYNTHESIS_TITLE_RE = /\b(?:systematic|scoping|narrative|umbrella|literature|integrative)\s+review\b|\bmeta-?analys[ie]s\b|\b(?:clinical\s+practice\s+)?guidelines?\b|\b(?:consensus|position)\s+statement\b|:\s*an?\s+(?:\w+\s+)?(?:review|overview)\b|\breview\s+of\s+the\s+(?:literature|evidence)\b/i
const PROTOCOL_TITLE_RE = /\b(?:study|trial|research|review)\s+protocol\b|\bprotocol\s+(?:for|of)\s+(?:a|an|the)\b|:\s*(?:a\s+|the\s+)?(?:study\s+)?protocol\b|\bprotocol$/i
const CASE_TITLE_RE = /\bcase\s+(?:report|series|study|presentation)\b|\ba\s+(?:rare\s+)?case\s+of\b|\breport\s+of\s+(?:a|an|one|two|three|\d+)\s+cases?\b|:\s*a\s+case\b/i
const ANIMAL_TITLE_RE = /\b(?:in\s+(?:rats?|mice|rabbits?|pigs?|dogs?|sheep)|rat\s+model|mouse\s+model|murine|porcine|canine|zebrafish|in\s+vitro|cell\s+culture|cadaver(?:ic)?)\b/i

/**
 * Publication type and title decide, with no model involved. Returns the class
 * of an acceptable paper, or the reason it cannot be a source.
 */
export function classifyPaper(pubTypes: string[], title: string): { cls: PaperClass; reject: string | null } {
  const types = pubTypes.map((t) => t.toLowerCase().trim())
  const cls: PaperClass = types.some((t) => SYNTHESIS_PUB_TYPES.has(t)) || SYNTHESIS_TITLE_RE.test(title) ? 'synthesis' : 'study'
  for (const t of types) if (REJECT_PUB_TYPES[t]) return { cls, reject: REJECT_PUB_TYPES[t] }
  if (PROTOCOL_TITLE_RE.test(title)) return { cls, reject: 'a trial plan, written before results existed' }
  if (CASE_TITLE_RE.test(title)) return { cls, reject: 'a case report' }
  if (ANIMAL_TITLE_RE.test(title)) return { cls, reject: 'animal or laboratory work' }
  return { cls, reject: null }
}

// ── 2. Whose statement is it ─────────────────────────────────────────────────

/**
 * The sentence reports what other work found: it carries a reference marker
 * ("[2, 4]", "(Smith et al., 2019)") or says so ("previous studies", "it is
 * believed"). In a single study that is its background, not its finding
 * (the SCOPiC plan: "It is believed that many patients ... within 12 weeks [2, 4].").
 */
const CITES_OTHERS_RE =
  /\[\s*\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\s*\]|\(\s*[A-Z][A-Za-z'’-]+(?:\s+(?:et\s+al\.?|and|&)\s*[A-Z]?[A-Za-z'’-]*)?,?\s+(?:19|20)\d\d[a-z]?\s*\)|\bet\s+al\.?\b|\b(?:previous|prior|earlier|other|several|numerous|many)\s+(?:studies|reports|authors|investigators|trials|research)\b|\bit\s+(?:is|has\s+been)\s+(?:widely\s+|well\s+|generally\s+|commonly\s+)?(?:believed|accepted|reported|known|recognized|recognised|established|suggested|shown)\b|\b(?:has|have)\s+been\s+(?:reported|shown|described|suggested)\b/i

export function quoteCitesOthers(quote: string): boolean {
  return CITES_OTHERS_RE.test(quote)
}

// ── 3. The source card ───────────────────────────────────────────────────────

export type Stance = 'supportive' | 'neutral' | 'critical'

export interface SourceCard {
  about: string
  docType: string
  population: string
  conclusion: string
  stance: Stance
  /** What the facts taken are about, in the judge's words. */
  factsAbout: string
  /** The source is about the same condition, treatment or body system as the facts taken from it. */
  sameSubject: boolean
  /** The people and setting it covers are the practice's everyday clients. */
  readerMatch: boolean
  facts: Array<{ own: boolean; common: boolean }>
}

/** Document kinds a model may name that are never sources, whatever PubMed's record says. */
const REJECT_DOC_TYPES: Record<string, string> = {
  'case report': 'a case report',
  'study protocol': 'a trial plan, written before results existed',
  'laboratory or animal study': 'animal or laboratory work',
  'engineering or technology paper': 'an engineering paper, not a clinical source',
  'news, blog or opinion': 'opinion, not evidence',
}

export interface CardInput {
  /** The practice's profession as the account states it ("Chiropractor", "Wellness & Recovery"). */
  practice: string
  topic: string
  /** The article section(s) the source was found for, when known. */
  sections?: string[]
  meta: SourceMeta
  /** Abstract, or the opening of the page. */
  text: string | null
  facts: Array<{ fact: string; quote: string }>
}

export function cardPrompt(i: CardInput): string {
  const m = i.meta
  return (
    `You vet a source before a practice cites it in an article for its own clients.\n` +
    `Practice: ${i.practice || 'health practice'}.\n` +
    `Article: "${i.topic}".\n` +
    (i.sections?.length ? `Article section(s) this source was found for: ${i.sections.map((s) => `"${s}"`).join('; ')}.\n` : '') +
    `\nSOURCE\nTitle: ${m.title}\n` +
    (m.journal ? `Published in: ${m.journal}${m.year ? ` (${m.year})` : ''}\n` : '') +
    (m.pubTypes.length ? `Publication types: ${m.pubTypes.join(', ')}\n` : '') +
    `Address: ${m.url}\n` +
    (i.text ? `Abstract or opening:\n${i.text.slice(0, 3500)}\n` : '') +
    `\nFACTS TAKEN FROM IT (each with the sentence it rests on)\n` +
    i.facts.map((f, n) => `${n + 1}. ${f.fact}\n   sentence: "${f.quote}"`).join('\n') +
    `\n\nReturn ONLY this JSON object:\n` +
    `{"about": "<what the source is mainly about, at most 12 words>",\n` +
    ` "doc_type": "<one of: guideline | systematic review or meta-analysis | narrative review | clinical trial | observational study | case report | study protocol | laboratory or animal study | engineering or technology paper | patient information page | reference text | news, blog or opinion | other>",\n` +
    ` "population": "<who it studied or addresses, at most 8 words>",\n` +
    ` "facts_about": "<what the listed facts are about, at most 10 words>",\n` +
    ` "conclusion": "<its main message, at most 20 words>",\n` +
    ` "stance": "<supportive | neutral | critical>",\n` +
    ` "same_subject": <true|false>,\n` +
    ` "reader_match": <true|false>,\n` +
    ` "facts": [{"n": 1, "own": <true|false>, "common": <true|false>}, ...one entry per fact]}\n\n` +
    `How to decide:\n` +
    `- stance is toward the practice's own profession and the care it offers, and it describes the source as a whole. "critical" means the source argues against this care, or was written to catalogue its harms, injuries or failures. One experiment showing that the care does not do one particular thing, or works by a different mechanism than people assume, is "neutral". A balanced page that lists both benefits and risks is "neutral".\n` +
    `- same_subject compares the facts with the SOURCE, never with the article. It is true when the source is about the same condition, treatment or body system as "facts_about", whether the source is broader or narrower: a review of low back pain is the same subject as a fact about sitting and back pain; a review of one warning sign is the same subject as facts about that warning sign. It is false only when the source was written about something else, such as a device, an app, a product, another disease or another profession's workplace, and the facts are incidental to it.\n` +
    `- reader_match is false only when the source's findings do not carry over to an ordinary adult reading this article: they come from children, from patients after surgery or in hospital care, from people with a specific disease the article is not about, or from a treatment of a different class, dose or pressure than a practice like this offers. Healthy adults, working adults and recreational or competitive athletes match. General patient guidance, warning signs and when-to-seek-care advice match by definition.\n` +
    `- own is true when the fact is the source's own finding, measurement, recommendation or statement of record. False when the sentence reports what other work found or what "is believed" (reference markers, "previous studies", "it is well accepted").\n` +
    `- common is true when the fact is general knowledge a clinician states without a study: a definition, a typical symptom, ordinary advice.`
  )
}

const asBool = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true'

export function parseCard(raw: string, factCount: number): SourceCard | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const stanceRaw = String(j.stance ?? '').toLowerCase().trim()
    const stance: Stance = stanceRaw === 'critical' ? 'critical' : stanceRaw === 'supportive' ? 'supportive' : 'neutral'
    const rows = Array.isArray(j.facts) ? (j.facts as Array<Record<string, unknown>>) : []
    const facts = Array.from({ length: factCount }, (_, i) => {
      const row = rows.find((r) => Number(r.n) === i + 1) ?? rows[i]
      // A fact the model did not rate is treated as the source's own, specific statement: the source-level checks still apply.
      return row ? { own: asBool(row.own), common: asBool(row.common) } : { own: true, common: false }
    })
    return {
      about: String(j.about ?? '').slice(0, 160),
      docType: String(j.doc_type ?? 'other').toLowerCase().trim(),
      population: String(j.population ?? '').slice(0, 120),
      conclusion: String(j.conclusion ?? '').slice(0, 240),
      stance,
      factsAbout: String(j.facts_about ?? '').slice(0, 120),
      sameSubject: asBool(j.same_subject),
      readerMatch: asBool(j.reader_match),
      facts,
    }
  } catch {
    return null
  }
}

// ── 4. The verdicts ──────────────────────────────────────────────────────────

/** Whether the source may be cited at all. null = yes. */
export function sourceRejection(meta: SourceMeta, card: SourceCard | null): string | null {
  if (meta.family === 'paper') {
    const typed = classifyPaper(meta.pubTypes, meta.title)
    if (typed.reject) return typed.reject
  }
  if (!card) return null // the judge failed: the deterministic checks stand alone
  if (meta.family === 'paper' && REJECT_DOC_TYPES[card.docType]) return REJECT_DOC_TYPES[card.docType]
  if (card.stance === 'critical') return "critical of the practice's own profession"
  if (!card.sameSubject) return `about something else (${card.about || 'another subject'})`
  if (!card.readerMatch) return `covers a different group or treatment (${card.population || 'another population'})`
  return null
}

export type FactUse = 'cite' | 'cite-as-finding' | 'drop'

/**
 * What a fact from an accepted source may be used for.
 *  - a single study: only its own finding, written as that finding
 *  - a review, guideline, reference text or authority page: its statements,
 *    common knowledge included
 */
export function factUse(meta: SourceMeta, card: SourceCard | null, index: number, quote: string): { use: FactUse; reason: string | null } {
  const isStudy = meta.family === 'paper' && classifyPaper(meta.pubTypes, meta.title).cls === 'study'
  if (!isStudy) return { use: 'cite', reason: null }
  const row = card?.facts[index]
  if (quoteCitesOthers(quote) || (row && !row.own)) return { use: 'drop', reason: 'the study is reporting what others found' }
  if (row?.common) return { use: 'drop', reason: 'common knowledge, not this study’s finding' }
  return { use: 'cite-as-finding', reason: null }
}

// ── 5. Live lookups ──────────────────────────────────────────────────────────

export interface FitnessDeps {
  /** PubMed's record for a paper address: types, title, journal, year. null = not a PubMed paper or lookup failed. */
  paperRecord: (url: string) => Promise<{ pmid: string; title: string; pubTypes: string[]; journal: string | null; year: number | null } | null>
  abstract: (pmid: string) => Promise<string | null>
  judge: (prompt: string) => Promise<{ text: string; cost: number; tokens: { input: number; output: number } }>
}

/** NCBI answers 429 under load; a paper's record decides whether it is cited, so try three times. */
async function getJson(url: string): Promise<unknown> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ncbiQueue(() => fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }))
      if (res.ok) return await res.json()
      last = new Error(`${res.status} ${url}`)
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
  }
  throw last
}

interface Esummary {
  result?: Record<string, { title?: string; pubtype?: string[]; fulljournalname?: string; source?: string; pubdate?: string; articleids?: Array<{ idtype?: string; value?: string }> }>
}

async function lookupPaperRecord(url: string): ReturnType<FitnessDeps['paperRecord']> {
  const id = identifyUrl(url)
  if (!id || id.kind === 'doi') return null
  try {
    let pmid = id.kind === 'pubmed' ? id.id : null
    if (id.kind === 'pmc') {
      const j = (await getJson(`${NCBI_BASE}/esummary.fcgi?db=pmc&id=${id.id}&retmode=json${ncbiKey()}`)) as Esummary
      pmid = j.result?.[id.id]?.articleids?.find((a) => a.idtype === 'pmid')?.value ?? null
      if (!pmid || pmid === '0') {
        const title = j.result?.[id.id]?.title
        return title ? { pmid: '', title, pubTypes: [], journal: j.result?.[id.id]?.fulljournalname ?? j.result?.[id.id]?.source ?? null, year: null } : null
      }
    }
    if (!pmid) return null
    const j = (await getJson(`${NCBI_BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json${ncbiKey()}`)) as Esummary
    const r = j.result?.[pmid]
    if (!r?.title) return null
    const year = Number((r.pubdate ?? '').slice(0, 4))
    return { pmid, title: r.title, pubTypes: r.pubtype ?? [], journal: r.fulljournalname ?? r.source ?? null, year: Number.isFinite(year) && year > 1900 ? year : null }
  } catch (err) {
    logger.warn({ url, err }, '[source-fitness] paper record lookup failed')
    return null
  }
}

/** A paper is looked up once per process: the type check and the source card ask for the same record. */
const recordCache = new Map<string, ReturnType<FitnessDeps['paperRecord']>>()

export const liveFitnessDeps: FitnessDeps = {
  paperRecord(url) {
    const hit = recordCache.get(url)
    if (hit) return hit
    if (recordCache.size > 2000) recordCache.clear()
    const p = lookupPaperRecord(url).then((r) => {
      if (!r) recordCache.delete(url) // a failed lookup is retried next time
      return r
    })
    recordCache.set(url, p)
    return p
  },
  async abstract(pmid) {
    if (!pmid) return null
    try {
      const res = await ncbiQueue(() => fetch(`${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text${ncbiKey()}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }))
      if (!res.ok) return null
      const t = (await res.text()).replace(/\s+/g, ' ').trim()
      return t.length > 80 ? t : null
    } catch {
      return null
    }
  },
  async judge(prompt) {
    const key = await getSystemApiKey('gemini')
    if (!key) throw new Error('No Gemini key')
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FIT_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 900, temperature: 0, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}`)
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const input = j.usageMetadata?.promptTokenCount ?? 0
    const output = (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0)
    return { text, cost: meteredCost('gemini', FIT_MODEL, input, output), tokens: { input, output } }
  },
}

// ── 6. One source, start to finish ───────────────────────────────────────────

export interface Assessment {
  meta: SourceMeta
  card: SourceCard | null
  /** null = the source may be cited. */
  rejected: string | null
  facts: Array<{ use: FactUse; reason: string | null }>
  cost: number
  tokens: { input: number; output: number }
}

export async function assessSource(
  input: { url: string; title: string; practice: string; topic: string; sections?: string[]; facts: Array<{ fact: string; quote: string }>; text?: string | null },
  deps: FitnessDeps = liveFitnessDeps,
): Promise<Assessment> {
  const family = sourceFamily(input.url)
  const rec = family === 'paper' ? await deps.paperRecord(input.url) : null
  const meta: SourceMeta = { url: input.url, family, title: rec?.title || input.title, pubTypes: rec?.pubTypes ?? [], journal: rec?.journal ?? null, year: rec?.year ?? null, pmid: rec?.pmid || null }
  const dropAll = (reason: string): Assessment => ({ meta, card: null, rejected: reason, facts: input.facts.map(() => ({ use: 'drop' as const, reason })), cost: 0, tokens: { input: 0, output: 0 } })

  // PubMed holds a record for every PubMed and PMC address. Without it the paper's type is unknown, so it is not cited.
  const listed = identifyUrl(input.url)
  if (listed && listed.kind !== 'doi' && !rec) return dropAll('could not be vetted')

  // The type check costs nothing: a case report never reaches the model.
  if (family === 'paper') {
    const typed = classifyPaper(meta.pubTypes, meta.title)
    if (typed.reject) return dropAll(typed.reject)
  }

  // A search snippet is too little to judge a paper by: read its abstract unless the caller already holds real text.
  const held = input.text && input.text.length > 400 ? input.text : null
  const text = held ?? (meta.pmid ? await deps.abstract(meta.pmid) : null) ?? input.text ?? null
  let card: SourceCard | null = null
  let cost = 0
  const tokens = { input: 0, output: 0 }
  try {
    const r = await deps.judge(cardPrompt({ practice: input.practice, topic: input.topic, sections: input.sections, meta, text, facts: input.facts }))
    cost = r.cost
    tokens.input = r.tokens.input
    tokens.output = r.tokens.output
    card = parseCard(r.text, input.facts.length)
    if (!card) logger.warn({ url: input.url, raw: r.text.slice(0, 200) }, '[source-fitness] card unparseable')
  } catch (err) {
    logger.warn({ url: input.url, err }, '[source-fitness] judge failed')
  }
  // A paper nobody could vet is not cited; a page on an approved authority site is.
  if (!card && family === 'paper') return { ...dropAll('could not be vetted'), cost, tokens }

  const rejected = sourceRejection(meta, card)
  if (rejected) return { meta, card, rejected, facts: input.facts.map(() => ({ use: 'drop' as const, reason: rejected })), cost, tokens }
  return { meta, card, rejected: null, facts: input.facts.map((f, i) => factUse(meta, card, i, f.quote)), cost, tokens }
}
