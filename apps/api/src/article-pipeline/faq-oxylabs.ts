/**
 * B16: "questions people ask" from real Google SERP data instead of a grounded
 * Gemini paraphrase. For the primary keyword and the salient entities we take
 * the People Also Ask block and the related searches, dedupe, drop local
 * intent, and hand the candidates to step 6 as {{paa_candidates}}; the model
 * then only selects and orders, it does not invent.
 */
import { logger } from '../lib/logger'
import { googleSerpQuestionBlocks } from '../newsletter/oxylabs'

const LOCAL_INTENT_RE = /\b(near me|close to me|nearby|in my area|open now)\b|\bin [A-Z][a-z]+(?: [A-Z][a-z]+)?$/

const COUNTRY_DOMAIN: Array<[RegExp, string, string]> = [
  [/australia/i, 'Australia', 'com.au'],
  [/new zealand/i, 'New Zealand', 'co.nz'],
  [/united kingdom|england|scotland|wales|\buk\b/i, 'United Kingdom', 'co.uk'],
  [/canada/i, 'Canada', 'ca'],
  [/ireland/i, 'Ireland', 'ie'],
  [/germany|deutschland/i, 'Germany', 'de'],
  [/united states|\busa?\b|america/i, 'United States', 'com'],
]

/** Map the brand's free-text geolocation ("Australia, Queensland") to an Oxylabs geo + Google domain. */
export function serpGeoFor(geolocation: string): { geo: string; domain: string } {
  for (const [re, geo, domain] of COUNTRY_DOMAIN) if (re.test(geolocation)) return { geo, domain }
  return { geo: 'United States', domain: 'com' }
}

function normKey(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Dedupe (case/punctuation-insensitive), drop local intent and near-duplicates of the given keyword list. */
export function cleanCandidates(raw: string[], excludeTexts: string[] = []): string[] {
  const exclude = new Set(excludeTexts.map(normKey).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []
  for (const q of raw) {
    const t = q.replace(/\s+/g, ' ').trim()
    if (!t || t.length < 8) continue
    if (LOCAL_INTENT_RE.test(t)) continue
    const k = normKey(t)
    if (seen.has(k) || exclude.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export interface PaaCandidates {
  questions: string[]
  relatedSearches: string[]
  queries: string[]
}

export async function fetchPaaCandidates(
  queries: string[],
  geolocation: string,
  excludeTexts: string[],
  ctx: Record<string, unknown> = {},
  fetcher: typeof googleSerpQuestionBlocks = googleSerpQuestionBlocks,
): Promise<PaaCandidates> {
  const { geo, domain } = serpGeoFor(geolocation)
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3)
  const questions: string[] = []
  const related: string[] = []
  for (const q of qs) {
    try {
      const b = await fetcher(q, geo, domain)
      questions.push(...b.questions)
      related.push(...b.relatedSearches)
    } catch (err) {
      logger.warn({ ...ctx, query: q, err }, '[faq-oxylabs] SERP fetch failed, continuing')
    }
  }
  const cleanQuestions = cleanCandidates(questions, excludeTexts)
  const cleanRelated = cleanCandidates(related, [...excludeTexts, ...cleanQuestions])
  logger.info({ ...ctx, queries: qs, geo, questions: cleanQuestions.length, related: cleanRelated.length }, '[faq-oxylabs] candidates fetched')
  return { questions: cleanQuestions, relatedSearches: cleanRelated, queries: qs }
}

/** The text block the step-6 prompt receives. */
export function formatPaaCandidates(c: PaaCandidates): string {
  const lines: string[] = []
  lines.push(`Searched: ${c.queries.map((q) => `"${q}"`).join(', ')}`)
  lines.push('')
  lines.push('People Also Ask (verbatim from Google):')
  if (c.questions.length === 0) lines.push('- (none returned)')
  for (const q of c.questions) lines.push(`- ${q}`)
  lines.push('')
  lines.push('Related searches (verbatim from Google):')
  if (c.relatedSearches.length === 0) lines.push('- (none returned)')
  for (const r of c.relatedSearches) lines.push(`- ${r}`)
  return lines.join('\n')
}
