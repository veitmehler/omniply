/**
 * Rotation of an author's stories and catchphrases (voice bench 1, 2026-11-27).
 *
 * A profile holds a handful of stories and turns of phrase. Three bench
 * articles for one author told the same river story twice and used the same
 * interjection in all three: a reader of the author's site would meet the same
 * story every other week. What a recent article used rests for a while.
 *
 * Use is read from the articles themselves, not only from what the take step
 * chose, because a writer can reach for a story nobody directed it to.
 */
import type { VoiceProfile } from '../../lib/voice/profile'
import { ownStories, type Resting, type Take } from './take'

/** How many of the author's latest articles are looked at. */
export const LOOKBACK = 6
/**
 * A story or a catchphrase rests for this many articles after one that used it. Voice bench 2
 * rested a story for six articles: with three stories on record most articles then had none,
 * and read as the author with the personality taken out (Veit, 2026-11-27: "stories must be
 * back"). Now only the article before counts, so nothing is told twice running.
 */
export const STORY_REST = 1
export const PHRASE_REST = 1

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** The longest run of words two texts share, in order. */
export function longestSharedRun(a: string[], b: string[]): number {
  let best = 0
  let prev = new Uint16Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

/**
 * A story counts as told when the article repeats ten of its words in a row. Measured on
 * voice bench 1: a told story shared 16 to 54 words in a row with the article, an article
 * that only borrowed a catchphrase from a story shared 7, and every other article 2 or 3.
 */
export const STORY_RUN = 10

export interface PastArticle {
  /** The stored take of that article, if it was written on the voice path. */
  take?: Take | null
  /** The article as written (draft or body). */
  text: string
}

/**
 * What rests, given the author's latest articles, newest first: the story the
 * previous article told and the catchphrases it used.
 */
export function restingFrom(p: VoiceProfile, past: PastArticle[]): Resting {
  const own = ownStories(p)
  const storyWords = own.map((s) => words(s.text))
  const stories = new Set<number>()
  past.slice(0, STORY_REST).forEach((a) => {
    if (a.take && a.take.story !== null && a.take.story !== undefined && a.take.story < own.length) stories.add(a.take.story)
    const w = a.text ? words(a.text) : []
    if (!w.length) return
    storyWords.forEach((sw, i) => {
      if (!stories.has(i) && longestSharedRun(sw, w) >= STORY_RUN) stories.add(i)
    })
  })
  const recent = past.slice(0, PHRASE_REST).map((a) => ` ${words(a.text).join(' ')} `)
  const phrases = p.manner.phrases.filter((x) => {
    const want = ` ${words(x).join(' ')} `
    return want.trim().length > 0 && recent.some((t) => t.includes(want))
  })
  return { stories, phrases }
}
