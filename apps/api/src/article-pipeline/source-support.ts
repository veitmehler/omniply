/**
 * Source support check (bench B16, 2026-11-09).
 *
 * Identity (source-verify.ts) proves the URL is the paper or page it claims
 * to be and that it is on topic. It cannot tell whether the page actually
 * STATES the fact: "Non-radicular low back pain" is on topic for a back-pain
 * article and says nothing about radicular pain. This module reads the
 * source (PubMed abstract via NCBI efetch, otherwise the page text, through
 * the Oxylabs scraper when the page blocks bots) and asks a small model one
 * closed question: supported / partial / unsupported, with the supporting
 * sentence. The quote is code-checked against the source text.
 *
 * Rulings (Veit 2026-11-09): a qualitative claim whose source fails keeps its
 * text and loses the link; a figure whose source fails is dropped from the
 * feed. Those decisions are applied in source-verify.ts; this module only
 * answers the question.
 */
import { logger } from '../lib/logger'
import { runNewsletterPrompt } from '../newsletter/llm'
import { scrapeUrl } from '../newsletter/oxylabs'
import { identifyUrl, ncbiQueue, NCBI_BASE, ncbiKey, BOT_WALL_RE } from './source-verify'
import { getSystemApiKey } from '../lib/system-keys'
import { calculateCost } from './llm/cost-table'

export type SupportVerdict = 'supported' | 'partial' | 'unsupported' | 'unknown'

export interface SupportResult {
  verdict: SupportVerdict
  quote: string
  /** How the source text was obtained; 'none' when nothing could be read; 'google' = read by Gemini's URL-context tool. */
  via: 'abstract' | 'page' | 'scraper' | 'google' | 'none'
}

const URL_CONTEXT_MODEL = 'gemini-3.1-flash-lite'

const TIMEOUT_MS = 10_000
const MAX_SOURCE_CHARS = 6_000
/** B21c: below this a fetched page is a stub, not evidence of absence. */
const QUOTE_CHECK_MIN_CHARS = 2_500
const UA = 'OmniplyCitations/1.0 (+https://omniply.io; mailto:ops@omniply.io)'

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|third|quarter|double|twice|threefold|fourfold)\b/i

/** A "figure fact" carries a quantity: digits other than a lone year, a percentage, or a number word. */
export function isFigureFact(fact: string): boolean {
  const digits = fact.match(/\d+(?:[.,]\d+)?/g) ?? []
  const nonYear = digits.filter((d) => !/^(19|20)\d\d$/.test(d))
  if (nonYear.length > 0) return true
  if (/%|percent|per cent/i.test(fact)) return true
  return NUMBER_WORDS.test(fact)
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const body = await res.text()
    return body.slice(0, 400_000)
  } catch {
    return null
  }
}

export interface SupportDeps {
  pubmedAbstract: (pmid: string) => Promise<string | null>
  /** NCBI Bookshelf chapter (NBK id) → its PubMed record's abstract, through the E-utilities API. */
  bookshelfAbstract: (nbk: string) => Promise<string | null>
  pageHtml: (url: string) => Promise<string | null>
  scrape: (url: string) => Promise<string | null>
  judge: (fact: string, source: string) => Promise<{ text: string; cost: number }>
  /** Google reads the page (Gemini URL-context tool) and answers; null when retrieval failed. */
  judgeViaGoogle: (fact: string, url: string) => Promise<{ text: string; cost: number; retrieved: boolean } | null>
}

export const liveSupportDeps: SupportDeps = {
  async bookshelfAbstract(nbk) {
    try {
      const sr = await ncbiQueue(() => fetch(`${NCBI_BASE}/esearch.fcgi?db=pubmed&term=${nbk}&retmode=json${ncbiKey()}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }))
      const sj = (await sr.json()) as { esearchresult?: { idlist?: string[] } }
      const pmid = sj.esearchresult?.idlist?.[0]
      if (!pmid) return null
      return liveSupportDeps.pubmedAbstract(pmid)
    } catch {
      return null
    }
  },
  async judgeViaGoogle(fact, url) {
    const key = await getSystemApiKey('gemini')
    if (!key) return null
    const body = {
      contents: [{ role: 'user', parts: [{ text: `Read this page: ${url}\n\nDoes the page state the following? "${fact}"\nAnswer ONLY as JSON: {"verdict":"supported|partial|unsupported","quote":"<one sentence copied from the page, or empty>"}. "supported" means the page states the claim including any figure at the same scope; "partial" means it covers the claim but not the exact figure or scope; "unsupported" means the page does not say this.` }] }],
      tools: [{ url_context: {} }],
      generationConfig: { maxOutputTokens: 300 },
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${URL_CONTEXT_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; urlContextMetadata?: { urlMetadata?: Array<{ urlRetrievalStatus?: string }> }; url_context_metadata?: { url_metadata?: Array<{ url_retrieval_status?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number }
    }
    const c = j.candidates?.[0]
    const status = c?.urlContextMetadata?.urlMetadata?.[0]?.urlRetrievalStatus ?? c?.url_context_metadata?.url_metadata?.[0]?.url_retrieval_status ?? ''
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const um = j.usageMetadata ?? {}
    const cost = calculateCost(URL_CONTEXT_MODEL, (um.promptTokenCount ?? 0) + (um.toolUsePromptTokenCount ?? 0), (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0))
    return { text, cost, retrieved: /SUCCESS/i.test(status) }
  },
  async pubmedAbstract(pmid) {
    try {
      const res = await ncbiQueue(() =>
        fetch(`${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text${ncbiKey()}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }),
      )
      if (!res.ok) return null
      const t = (await res.text()).replace(/\s+/g, ' ').trim()
      return t.length > 80 ? t : null
    } catch {
      return null
    }
  },
  pageHtml: fetchText,
  async scrape(url) {
    try {
      const r = await scrapeUrl(url)
      return r.html || null
    } catch {
      return null
    }
  },
  async judge(fact, source) {
    const run = await runNewsletterPrompt('st_source_support', { fact, source })
    return { text: run.content.trim(), cost: run.response.cost }
  },
}

/** Read the source text: abstract for PubMed, page text otherwise, scraper on bot walls. */
export async function fetchSourceText(url: string, deps: SupportDeps = liveSupportDeps, opts: { full?: boolean } = {}): Promise<{ text: string; via: SupportResult['via'] }> {
  // B21b: the quote check needs the whole page; the judge gets the first MAX_SOURCE_CHARS.
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : MAX_SOURCE_CHARS
  const ident = identifyUrl(url)
  if (ident?.kind === 'pubmed') {
    const abs = await deps.pubmedAbstract(ident.id)
    if (abs) return { text: abs.slice(0, cap), via: 'abstract' }
  }
  const nbk = url.match(/ncbi\.nlm\.nih\.gov\/books\/(NBK\d+)/i)?.[1]
  if (nbk) {
    const abs = await deps.bookshelfAbstract(nbk)
    if (abs) return { text: abs.slice(0, cap), via: 'abstract' }
  }
  const html = await deps.pageHtml(url)
  let text = html ? stripHtml(html) : ''
  const titleMatch = html?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const blocked = !html || text.length < 400 || (titleMatch && BOT_WALL_RE.test(titleMatch[1]))
  if (blocked) {
    const scraped = await deps.scrape(url)
    const st = scraped ? stripHtml(scraped) : ''
    if (st.length >= 400) return { text: st.slice(0, cap), via: 'scraper' }
    if (text.length >= 400) return { text: text.slice(0, cap), via: 'page' }
    return { text: '', via: 'none' }
  }
  return { text: text.slice(0, cap), via: 'page' }
}

function parseVerdict(raw: string): { verdict: SupportVerdict; quote: string } | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { verdict?: string; quote?: string }
    const v = (j.verdict ?? '').toLowerCase().trim()
    if (v !== 'supported' && v !== 'partial' && v !== 'unsupported') return null
    return { verdict: v, quote: (j.quote ?? '').toString().trim().slice(0, 400) }
  } catch {
    return null
  }
}

/** The quote must largely occur in the source; otherwise the model is paraphrasing. */
export function quoteGrounded(quote: string, source: string): boolean {
  if (!quote) return false
  const src = source.toLowerCase().replace(/\s+/g, ' ')
  if (src.includes(quote.toLowerCase().replace(/\s+/g, ' '))) return true
  const words = quote.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  if (words.length < 4) return false
  const hits = words.filter((w) => src.includes(w)).length
  return hits / words.length >= 0.7
}

/**
 * Does the source state the fact? Never throws. 'unknown' means the source
 * could not be read; the caller decides what that means for the fact.
 */
export async function checkSupport(
  fact: string,
  url: string,
  ctx: Record<string, unknown> = {},
  deps: SupportDeps = liveSupportDeps,
): Promise<SupportResult & { cost: number }> {
  try {
    const src = await fetchSourceText(url, deps)
    if (!src.text) {
      // B18: the page blocks our server (Cloudflare / Akamai / reCAPTCHA): let Google read it.
      const g = await deps.judgeViaGoogle(fact, url)
      if (g && g.retrieved) {
        const parsed = parseVerdict(g.text)
        if (parsed) {
          logger.info({ ...ctx, url, verdict: parsed.verdict, cost: g.cost }, '[source-support] read by Google URL context')
          return { verdict: parsed.verdict, quote: parsed.quote, via: 'google', cost: g.cost }
        }
      }
      return { verdict: 'unknown', quote: '', via: 'none', cost: g?.cost ?? 0 }
    }
    const out = await deps.judge(fact, src.text)
    const parsed = parseVerdict(out.text)
    if (!parsed) {
      logger.info({ ...ctx, url, raw: out.text.slice(0, 120) }, '[source-support] judge output unparseable')
      return { verdict: 'unknown', quote: '', via: src.via, cost: out.cost }
    }
    let verdict = parsed.verdict
    let quote = parsed.quote
    if (verdict !== 'unsupported' && !quoteGrounded(quote, src.text)) {
      // A supporting sentence that is not in the source is not evidence.
      verdict = verdict === 'supported' ? 'partial' : verdict
      quote = ''
    }
    return { verdict, quote, via: src.via, cost: out.cost }
  } catch (err) {
    logger.warn({ ...ctx, url, err }, '[source-support] check failed')
    return { verdict: 'unknown', quote: '', via: 'none', cost: 0 }
  }
}

/** B21: is the retrieval quote present in the page? null when nobody can read the page. */
export async function quoteInPage(quote: string, url: string, deps: SupportDeps = liveSupportDeps): Promise<boolean | null> {
  try {
    const src = await fetchSourceText(url, deps, { full: true })
    if (!src.text) return null
    if (quoteGrounded(quote, src.text)) return true
    // A stub (JS shell, consent page, scraper fragment) is not the page the extractor read:
    // Johns Hopkins came back as 773 characters from the droplet. Undecided, not disproved.
    if (src.via !== 'abstract' && src.text.length < QUOTE_CHECK_MIN_CHARS) return null
    // An abstract cannot disprove a quote taken from the full chapter or article (NCBI Bookshelf,
    // PMC read through Google). Only a PubMed record, where extraction used the same abstract, can.
    if (src.via === 'abstract' && !/pubmed\.ncbi\.nlm\.nih\.gov/i.test(url)) return null
    return false
  } catch {
    return null
  }
}
