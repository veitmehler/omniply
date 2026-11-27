/**
 * Belief language is contained (Veit, 2026-11-27).
 *
 * An article is an opinion piece on the author's worldview. Voice bench 1
 * showed the cost of letting that worldview run through every section: eight
 * to eleven terms of the author's own philosophy per article, a caveat on
 * Expertise in every outside read, and one such term defined as plain fact.
 *
 * The ruling: the author's convictions live in the opening, the close and one
 * section. Everywhere else the body and the treatment are explained in the
 * words any clinician would use. A term of the author's philosophy is never
 * given a factual definition; where it is used, the author says what they mean
 * by it.
 *
 * The take names the home section and the author's own terms. The writer is
 * told the rule; this module makes it hold, one sentence at a time.
 */
import { hasPresence } from '../../lib/text/editor-pass'
import { DELETE_MARK, editAcceptable, htmlSentences, replaceSentences, type HtmlSentence } from './sentence-edits'

const tidy = (s: string) => s.replace(/[‘’]/g, "'")
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A term as a pattern: its plural too; exact case when the author writes it with a capital ("Innate"). */
export function termPattern(term: string): RegExp {
  const t = tidy(term).trim()
  const body = escRe(t).replace(/\s+/g, '\\s+')
  return new RegExp(`(?<![A-Za-z])${body}(?:e?s|'s)?(?![A-Za-z])`, /[A-Z]/.test(t) ? '' : 'i')
}

export function usesTerm(sentence: string, terms: string[]): string | null {
  const s = tidy(sentence)
  return terms.find((t) => termPattern(t).test(s)) ?? null
}

/**
 * "A subluxation is a …", "Innate means …": the term as the subject of a definition.
 * A slogan ("Innate is Boss") is a conviction, which the compliance check reads, not a definition.
 */
export function definesTerm(sentence: string, terms: string[]): string | null {
  const s = tidy(sentence).trim()
  const DEFINES = '(?:(?:is|are)\\s+(?:an?|the|what|when|where|how|simply|just|basically)\\b|are\\s+(?:[a-z-]+\\s+){1,3}(?:that|which)\\b|means\\b|refers to\\b|describes\\b)'
  return terms.find((t) => new RegExp(`^(?:An?\\s+|The\\s+)?${termPattern(t).source}\\s+${DEFINES}`, /[A-Z]/.test(t) ? '' : 'i').test(s)) ?? null
}

export interface ContainmentPlan {
  /** The section (index of its H2 in the article) where the conviction is developed. */
  home: number | null
  /** Sentences that carry one of the author's own terms outside the three places. */
  outside: Array<{ sentence: HtmlSentence; term: string }>
  /** Sentences, anywhere, that define one of the author's own terms as plain fact. */
  defined: Array<{ sentence: HtmlSentence; term: string }>
  /** Sentences with one of the terms, in all. */
  carrying: number
}

/**
 * Where each of the author's own terms sits, against where it may sit: before
 * the first H2, in the last three paragraphs, and in the home section. The
 * home section is the one the take named when the article kept the outline's
 * sequence; otherwise the section that carries most of the terms.
 */
export function planContainment(html: string, terms: string[], homeIndex: number | null, outlineSections: number): ContainmentPlan {
  const plan: ContainmentPlan = { home: null, outside: [], defined: [], carrying: 0 }
  if (!terms.length) return plan
  const sentences = htmlSentences(html)
  const h2Starts: number[] = []
  const h2Re = /<h2[\s>]/gi
  let m: RegExpExecArray | null
  while ((m = h2Re.exec(html)) !== null) h2Starts.push(m.index)
  const sectionOf = (s: HtmlSentence) => h2Starts.filter((x) => x <= s.from).length - 1 // -1 = before the first H2
  const lastBlock = sentences.length ? sentences[sentences.length - 1].block : 0
  // The close: the last three paragraphs or list items of the article.
  const closing = new Set<number>([...new Set(sentences.map((s) => s.block))].filter((b) => b <= lastBlock).slice(-3))

  const carriers = sentences.map((s) => ({ s, term: usesTerm(s.text, terms) })).filter((x): x is { s: HtmlSentence; term: string } => x.term !== null)
  plan.carrying = carriers.length
  let home = homeIndex !== null && h2Starts.length === outlineSections && homeIndex < h2Starts.length ? homeIndex : null
  if (home === null) {
    const perSection = new Map<number, number>()
    for (const c of carriers) {
      const sec = sectionOf(c.s)
      if (sec >= 0 && !closing.has(c.s.block)) perSection.set(sec, (perSection.get(sec) ?? 0) + 1)
    }
    home = [...perSection.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
  }
  plan.home = home
  for (const c of carriers) {
    const sec = sectionOf(c.s)
    const allowed = sec < 0 || sec === home || closing.has(c.s.block)
    if (!allowed) plan.outside.push({ sentence: c.s, term: c.term })
    else if (definesTerm(c.s.text, terms) && !hasPresence(c.s.text)) plan.defined.push({ sentence: c.s, term: c.term })
  }
  return plan
}

export const OUTSIDE_REASON = (term: string) =>
  `This article keeps the vocabulary of your own philosophy ("${term}" is part of it) to its opening, its close and one section. This sentence sits outside those. Say the same point in the words any clinician would use to explain the body or the treatment, without that term and without any other term of your philosophy. If nothing is left once the term is gone, output [DELETE].`

export const DEFINED_REASON = (term: string) =>
  `This sentence defines "${term}", a term of your own philosophy, as though it were established fact. Keep the term and say what YOU mean by it, as your own usage and view ("what I call", "when I say", "by … I mean"). Do not state it as what the thing simply is.`

export type ContainRewriter = (sentence: string, reason: string, before: string) => Promise<{ text: string; cost: number }>

export interface ContainmentResult {
  html: string
  home: number | null
  carrying: number
  outside: number
  moved: number
  removed: number
  defined: number
  restated: number
  llmCalls: number
  cost: number
  changes: Array<{ before: string; after: string; why: string }>
}

/** Make the rule hold. A rewrite that still carries a term, or adds anything, is not used and the sentence stays. */
export async function contain(html: string, terms: string[], homeIndex: number | null, outlineSections: number, rewrite: ContainRewriter): Promise<ContainmentResult> {
  const plan = planContainment(html, terms, homeIndex, outlineSections)
  const res: ContainmentResult = { html, home: plan.home, carrying: plan.carrying, outside: plan.outside.length, moved: 0, removed: 0, defined: plan.defined.length, restated: 0, llmCalls: 0, cost: 0, changes: [] }
  const all = htmlSentences(html)
  const beforeOf = (s: HtmlSentence) => {
    const i = all.findIndex((x) => x.from === s.from)
    return i > 0 && all[i - 1].block === s.block ? all[i - 1].text : ''
  }
  const edits: Array<{ sentence: HtmlSentence; rewrite: string }> = []
  for (const { sentence: s, term } of plan.outside) {
    if (s.hasLink) continue
    try {
      const r = await rewrite(s.text, OUTSIDE_REASON(term), beforeOf(s))
      res.llmCalls++
      res.cost += r.cost
      const text = r.text.trim().replace(/^["“]|["”]$/g, '')
      if (text === DELETE_MARK) {
        if (s.opensSection) continue
        edits.push({ sentence: s, rewrite: '' })
        res.removed++
        res.changes.push({ before: s.text, after: '', why: `"${term}" outside its place` })
      } else if (!usesTerm(text, terms) && editAcceptable(s.text, text, 1.4)) {
        edits.push({ sentence: s, rewrite: text })
        res.moved++
        res.changes.push({ before: s.text, after: text, why: `"${term}" outside its place` })
      }
    } catch {
      /* the sentence stays as written */
    }
  }
  for (const { sentence: s, term } of plan.defined) {
    if (s.hasLink) continue
    try {
      const r = await rewrite(s.text, DEFINED_REASON(term), beforeOf(s))
      res.llmCalls++
      res.cost += r.cost
      const text = r.text.trim().replace(/^["“]|["”]$/g, '')
      if (text !== DELETE_MARK && hasPresence(text) && !definesTerm(text, terms) && editAcceptable(s.text, text, 1.5)) {
        edits.push({ sentence: s, rewrite: text })
        res.restated++
        res.changes.push({ before: s.text, after: text, why: `"${term}" defined as fact` })
      }
    } catch {
      /* the sentence stays as written */
    }
  }
  res.html = replaceSentences(html, edits).html
  return res
}

/**
 * The step that adds explanations runs after the writing. An explanation of one
 * of the author's own terms has to be the author saying what they mean by it;
 * one that states the term as fact is taken out again.
 */
export function dropFactualOwnTermGlosses(html: string, terms: string[]): { html: string; dropped: string[] } {
  const dropped: string[] = []
  if (!terms.length) return { html, dropped }
  const out = html.replace(/<span class="term"[^>]*>([\s\S]*?)<\/span>/gi, (whole, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    if (usesTerm(text, terms) && !hasPresence(text)) {
      dropped.push(text)
      return ''
    }
    return whole
  })
  return { html: out, dropped }
}

/** What the explanation step is told about the author's own terms. */
export function ownTermsForExplanations(terms: string[]): string {
  if (!terms.length) return ''
  return `These terms belong to the author's own philosophy: ${terms.map((t) => `"${t}"`).join(', ')}. Do not explain any of them. If the passage needs one explained, the author has already said what they mean by it.`
}
