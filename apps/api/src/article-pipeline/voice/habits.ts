/**
 * Wording limits relative to the author (author-voice plan, stage 2,
 * sections 5 and 6).
 *
 * The writer no longer carries universal limits on questions, exclamations and
 * the like: a habit is a tell only when this author does not have it. The
 * limits are enforced here instead, after the writing, against the author's own
 * rate. Two failures are caught: a habit the author does not have, and a habit
 * the author does have, used so often that the article becomes a caricature.
 *
 * Code counts and picks the surplus sentences. A model that has the author's
 * words in front of it turns each into a plain statement. The first sentence
 * under a heading is never picked for a question limit's sake alone (it is the
 * answer AI search quotes) and a sentence with a link is never touched.
 */
import type { AuthorLimits } from '../../lib/voice/render'
import { editAcceptable, htmlSentences, replaceSentences, type HtmlSentence } from './sentence-edits'

export type Habit = 'question' | 'exclamation'

const isQuestion = (s: string) => /\?["”’)\]]*$/.test(s.trim())
const isExclamation = (s: string) => /!["”’)\]]*$/.test(s.trim())

export interface HabitCount {
  habit: Habit
  sentences: number
  found: number
  allowed: number
  surplus: HtmlSentence[]
}

/**
 * Which sentences are over the author's rate. One over is tolerated: at these
 * counts a single sentence is noise. The surplus is taken from the blocks that
 * hold the most of the habit, last first, so an early question or the one the
 * author would open with survives.
 */
export function overLimit(html: string, limits: AuthorLimits): HabitCount[] {
  const all = htmlSentences(html)
  const out: HabitCount[] = []
  for (const [habit, test, share] of [
    ['question', isQuestion, limits.questionShare],
    ['exclamation', isExclamation, limits.exclaimShare],
  ] as const) {
    const hits = all.filter((s) => test(s.text))
    const allowed = Math.ceil(all.length * share) + 1
    let surplus: HtmlSentence[] = []
    if (hits.length > allowed) {
      const perBlock = new Map<number, number>()
      for (const s of hits) perBlock.set(s.block, (perBlock.get(s.block) ?? 0) + 1)
      const candidates = hits.filter((s) => !s.hasLink && !s.opensSection).sort((a, b) => (perBlock.get(b.block) ?? 0) - (perBlock.get(a.block) ?? 0) || b.from - a.from)
      surplus = candidates.slice(0, hits.length - allowed)
    }
    out.push({ habit, sentences: all.length, found: hits.length, allowed, surplus })
  }
  return out
}

export const HABIT_REASON: Record<Habit, string> = {
  question: 'The article asks the reader more questions than you do when you write. Say this one as a plain statement that carries the same point. Do not answer it with a new fact.',
  exclamation: 'The article uses more exclamation marks than you do when you write. Say this one without it, as flatly as you would say it across a table.',
}

export type HabitRewriter = (sentence: string, reason: string, before: string) => Promise<{ text: string; cost: number }>

export interface HabitTrimResult {
  html: string
  counts: Array<{ habit: Habit; found: number; allowed: number; surplus: number; fixed: number }>
  llmCalls: number
  cost: number
}

/** Bring each habit back to the author's rate. A rewrite that still shows the habit, or adds anything, is not used. */
export async function trimHabits(html: string, limits: AuthorLimits, rewrite: HabitRewriter): Promise<HabitTrimResult> {
  const res: HabitTrimResult = { html, counts: [], llmCalls: 0, cost: 0 }
  const all = htmlSentences(html)
  const edits: Array<{ sentence: HtmlSentence; rewrite: string }> = []
  for (const c of overLimit(html, limits)) {
    let fixed = 0
    for (const s of c.surplus) {
      if (edits.some((e) => e.sentence.from === s.from)) continue
      const i = all.findIndex((x) => x.from === s.from)
      const before = i > 0 && all[i - 1].block === s.block ? all[i - 1].text : ''
      try {
        const r = await rewrite(s.text, HABIT_REASON[c.habit], before)
        res.llmCalls++
        res.cost += r.cost
        const text = r.text.trim().replace(/^["“]|["”]$/g, '')
        const still = c.habit === 'question' ? isQuestion(text) : isExclamation(text)
        if (!still && editAcceptable(s.text, text, 1.3)) {
          edits.push({ sentence: s, rewrite: text })
          fixed++
        }
      } catch {
        /* the sentence stays as the author's writer left it */
      }
    }
    res.counts.push({ habit: c.habit, found: c.found, allowed: c.allowed, surplus: c.surplus.length, fixed })
  }
  res.html = replaceSentences(html, edits).html
  return res
}
