/**
 * The draft in the author's own words (voice bench 1, 2026-11-27).
 *
 * Two things in a draft are not the author's words, whatever the writer was told:
 *
 *  1. A fact carried over in the wording of the source. Research stores each
 *     fact as the sentence the source page states, and the writer repeated
 *     seven to eighteen of them per article, several whole. An outside reader
 *     matched them to the pages they came from. That is copying, and it reads
 *     as a machine summarising its sources.
 *
 *  2. A section that opens by saying its heading back ("Sitting makes your
 *     lower back ache because…" under "Why does sitting make your lower back
 *     ache?"). The first sentence still has to answer the heading, because AI
 *     search quotes it; it does not have to repeat the heading to do so.
 *
 * Both are found in code and repaired one sentence at a time, by a step that
 * has the author's own words in front of it. This runs on the draft, before
 * the fact check, so the fact check reads the wording that will be published.
 * A rewrite that changes a figure, widens a claim, drops what the link would
 * need to find it again, or still repeats the source, is not used.
 */
import { contentTerms, stemTerm } from '../source-verify'
import { draftSentences } from './fact-fix'
import { longestSharedRun } from './rotation'
import { STRENGTHEN_RE } from './sentence-edits'

export interface SourceFact {
  text: string
  /** '' for the author's own observation. */
  tag: string
  safety?: boolean
}

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[*_`]+/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const termsOf = (s: string): Set<string> => new Set([...contentTerms(s)].map(stemTerm))
const numbersOf = (s: string): string[] => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')).sort()

/** Words in a row a sentence may share with a source before it counts as carried over. */
export const LIFT_RUN = 7
/** What a rewrite has to stay under. */
export const LIFT_RUN_AFTER = 6

export interface Lifted {
  text: string
  from: number
  to: number
  fact: SourceFact
  run: number
}

/** Draft sentences that repeat a source's wording. The author's own observations are theirs already. */
export function liftedSentences(md: string, facts: SourceFact[]): Lifted[] {
  const sources = facts.filter((f) => f.tag && !/^\[OBS/i.test(f.tag)).map((f) => ({ f, w: wordsOf(f.text) }))
  const out: Lifted[] = []
  for (const s of draftSentences(md)) {
    // A sentence with markup or a link is left to the steps that understand it.
    if (/[*_`\[\]]|https?:\/\//.test(s.text)) continue
    const w = wordsOf(s.text)
    if (w.length < 6) continue
    let best: { f: SourceFact; run: number } | null = null
    for (const src of sources) {
      const run = longestSharedRun(w, src.w)
      const whole = run >= 5 && run >= src.w.length * 0.8
      if ((run >= LIFT_RUN || whole) && (!best || run > best.run)) best = { f: src.f, run }
    }
    if (best) out.push({ ...s, fact: best.f, run: best.run })
  }
  return out
}

/** May this rewrite stand in for a sentence that repeated its source? */
export function ownWordsAcceptable(original: string, rewrite: string, fact: SourceFact): boolean {
  const r = rewrite.trim()
  if (!r || r === '[DELETE]' || /https?:\/\/|<[a-z/]|\]\(/i.test(r)) return false
  // The same figures, no more and no fewer.
  if (numbersOf(r).join('|') !== numbersOf(original).join('|')) return false
  if (STRENGTHEN_RE.test(r) && !STRENGTHEN_RE.test(original)) return false
  const count = (s: string) => s.trim().split(/\s+/).length
  if (count(r) > count(original) * 1.35 + 6) return false
  if (longestSharedRun(wordsOf(r), wordsOf(fact.text)) >= LIFT_RUN_AFTER) return false
  // It still has to be findable as this fact when the link is placed, and a warning sign keeps its substance.
  const factTerms = termsOf(fact.text)
  const had = [...termsOf(original)].filter((t) => factTerms.has(t)).length
  const has = [...termsOf(r)].filter((t) => factTerms.has(t)).length
  const need = Math.min(had, Math.max(3, Math.ceil(had * (fact.safety ? 0.6 : 0.3))))
  return has >= need
}

export const LIFT_REASON = (fact: string) =>
  `This sentence repeats the wording of the source it came from. The source says: "${fact}" Say the same fact the way you would say it to the person in front of you: your words, your sentence shape, the terms you use yourself. Keep every figure exactly, keep who or what it applies to, and keep the direction and the strength of the claim. Add nothing and leave nothing out.`

// ── Section openers that say the heading back ────────────────────────────────

const HEADING_STOP = new Set(
  'a an the and or but of to in on for with by from at as is are was were be been being do does did can could should would will may might must have has had what why how when where which who whom whose that this these those it its your you my me i we our us their they them not no than then so if into about after before during while there here actually really just more most less very much any some all'.split(
    ' ',
  ),
)
const stem = (w: string) => (w.length > 5 ? w.replace(/(?:ing|ed|es|s)$/, '') : w.length >= 4 && !w.endsWith('ss') ? w.replace(/s$/, '') : w)
const headingTerms = (h: string): string[] => [...new Set(wordsOf(h.replace(/-/g, ' ')).filter((w) => w.length > 2 && !w.includes("'") && !HEADING_STOP.has(w) && !/^\d+$/.test(w)).map(stem))]

/**
 * Does the sentence open by saying its heading back? Measured on the sentence's
 * first twelve words. Naming the subject is not an echo ("A five-minute reset
 * reverses the three things a chair does"); turning the question into its own
 * definition is ("A weekly recovery plan is…", "Sitting makes your back ache
 * because…"). So: half of the heading's own words are back and the sentence
 * runs straight into "is", "are" or "because"; or most of the heading is back,
 * whatever follows.
 */
export function echoesHeading(heading: string, sentence: string): boolean {
  const h = headingTerms(heading)
  if (h.length < 2) return false
  const opening = wordsOf(sentence.replace(/-/g, ' ')).slice(0, 12)
  const first = new Set(opening.map(stem))
  const shared = h.filter((t) => first.has(t)).length
  if (shared < (h.length <= 3 ? 2 : 3)) return false
  const share = shared / h.length
  const definitional = opening.some((w) => w === 'is' || w === 'are' || w === 'means' || w === 'because')
  return share >= 0.6 || (definitional && share >= 0.5)
}

export interface Opener {
  heading: string
  text: string
  from: number
  to: number
}

/** The first sentence under each H2 of a markdown draft. */
export function sectionOpeners(md: string): Opener[] {
  const sentences = draftSentences(md)
  const out: Opener[] = []
  let offset = 0
  const heads: Array<{ level: number; text: string; end: number }> = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, text: m[2].replace(/[*_`]+/g, '').trim(), end: offset + line.length })
    offset += line.length + 1
  }
  heads.forEach((h, i) => {
    if (h.level !== 2) return
    const until = heads[i + 1]?.end ?? md.length
    const first = sentences.find((s) => s.from > h.end && s.from < until)
    if (first) out.push({ heading: h.text, ...first })
  })
  return out
}

export const echoOpeners = (md: string): Opener[] => sectionOpeners(md).filter((o) => !/[*_`\[\]]|https?:\/\//.test(o.text) && echoesHeading(o.heading, o.text))

const PRONOUN_OPENER = /^\s*(?:they|it|this|these|those|that|he|she)\b/i

export function openerAcceptable(heading: string, original: string, rewrite: string): boolean {
  const r = rewrite.trim()
  if (!r || r === '[DELETE]' || /https?:\/\/|<[a-z/]|\]\(/i.test(r)) return false
  if (echoesHeading(heading, r) || PRONOUN_OPENER.test(r) || /\?["”’)\]]*$/.test(r)) return false
  if (numbersOf(r).join('|') !== numbersOf(original).join('|')) return false
  if (STRENGTHEN_RE.test(r) && !STRENGTHEN_RE.test(original)) return false
  const count = (s: string) => s.trim().split(/\s+/).length
  return count(r) <= count(original) * 1.3 + 6
}

export const ECHO_REASON = (heading: string) =>
  `This is the first sentence under the heading "${heading}", and it says the heading back before it answers. The reader has just read the heading. Give the answer itself, straight away, in your own words: a statement that names what it is about and still makes sense quoted alone. Do not reuse the heading's phrasing, do not open with a pronoun (it, this, they, these, that), and do not ask a question.`

export type OwnWordsRewriter = (sentence: string, reason: string, before: string) => Promise<{ text: string; cost: number }>

export interface OwnWordsResult {
  text: string
  openers: { found: number; fixed: number }
  lifted: { found: number; fixed: number }
  llmCalls: number
  cost: number
  changes: Array<{ kind: 'opener' | 'lifted'; before: string; after: string }>
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

const tidyRewrite = (s: string) => s.trim().replace(/^["“]|["”]$/g, '').trim()

/** Openers first, then carried-over facts on what that left, so no sentence is rewritten twice from a stale copy. */
export async function inOwnWords(md: string, facts: SourceFact[], rewrite: OwnWordsRewriter, opts: { concurrency?: number } = {}): Promise<OwnWordsResult> {
  const res: OwnWordsResult = { text: md, openers: { found: 0, fixed: 0 }, lifted: { found: 0, fixed: 0 }, llmCalls: 0, cost: 0, changes: [] }
  const size = opts.concurrency ?? 4
  const apply = (text: string, edits: Array<{ from: number; to: number; rewrite: string }>) => {
    let out = text
    for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.rewrite + out.slice(e.to)
    return out
  }

  const openers = echoOpeners(res.text)
  res.openers.found = openers.length
  const openerEdits: Array<{ from: number; to: number; rewrite: string }> = []
  await pool(openers, size, async (o) => {
    try {
      const r = await rewrite(o.text, ECHO_REASON(o.heading), '')
      res.llmCalls++
      res.cost += r.cost
      const text = tidyRewrite(r.text)
      if (openerAcceptable(o.heading, o.text, text)) {
        openerEdits.push({ from: o.from, to: o.to, rewrite: text })
        res.changes.push({ kind: 'opener', before: o.text, after: text })
      }
    } catch {
      /* the opener stays as written */
    }
  })
  res.openers.fixed = openerEdits.length
  res.text = apply(res.text, openerEdits)

  const all = draftSentences(res.text)
  const lifted = liftedSentences(res.text, facts)
  res.lifted.found = lifted.length
  const liftEdits: Array<{ from: number; to: number; rewrite: string }> = []
  await pool(lifted, size, async (l) => {
    const i = all.findIndex((s) => s.from === l.from)
    const before = i > 0 ? all[i - 1].text : ''
    try {
      const r = await rewrite(l.text, LIFT_REASON(l.fact.text), before)
      res.llmCalls++
      res.cost += r.cost
      const text = tidyRewrite(r.text)
      if (ownWordsAcceptable(l.text, text, l.fact)) {
        liftEdits.push({ from: l.from, to: l.to, rewrite: text })
        res.changes.push({ kind: 'lifted', before: l.text, after: text })
      }
    } catch {
      /* the sentence stays as written */
    }
  })
  res.lifted.fixed = liftEdits.length
  res.text = apply(res.text, liftEdits)
  return res
}
