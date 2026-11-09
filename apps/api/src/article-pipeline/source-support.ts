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

export type SupportVerdict = 'supported' | 'partial' | 'unsupported' | 'unknown'

export interface SupportResult {
  verdict: SupportVerdict
  quote: string
  /** How the source text was obtained; 'none' when nothing could be read. */
  via: 'abstract' | 'page' | 'scraper' | 'none'
}

const TIMEOUT_MS = 10_000
const MAX_SOURCE_CHARS = 6_000
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
  pageHtml: (url: string) => Promise<string | null>
  scrape: (url: string) => Promise<string | null>
  judge: (fact: string, source: string) => Promise<{ text: string; cost: number }>
}

export const liveSupportDeps: SupportDeps = {
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
export async function fetchSourceText(url: string, deps: SupportDeps = liveSupportDeps): Promise<{ text: string; via: SupportResult['via'] }> {
  const ident = identifyUrl(url)
  if (ident?.kind === 'pubmed') {
    const abs = await deps.pubmedAbstract(ident.id)
    if (abs) return { text: abs.slice(0, MAX_SOURCE_CHARS), via: 'abstract' }
  }
  const html = await deps.pageHtml(url)
  let text = html ? stripHtml(html) : ''
  const titleMatch = html?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const blocked = !html || text.length < 400 || (titleMatch && BOT_WALL_RE.test(titleMatch[1]))
  if (blocked) {
    const scraped = await deps.scrape(url)
    const st = scraped ? stripHtml(scraped) : ''
    if (st.length >= 400) return { text: st.slice(0, MAX_SOURCE_CHARS), via: 'scraper' }
    if (text.length >= 400) return { text: text.slice(0, MAX_SOURCE_CHARS), via: 'page' }
    return { text: '', via: 'none' }
  }
  return { text: text.slice(0, MAX_SOURCE_CHARS), via: 'page' }
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
    if (!src.text) return { verdict: 'unknown', quote: '', via: 'none', cost: 0 }
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
