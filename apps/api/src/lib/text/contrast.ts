/**
 * "This, not that" (voice bench 1, 2026-11-27).
 *
 * Setting one thing against another in a single sentence is the cadence a
 * reader now takes for machine writing. The three bench articles written as
 * one author carried it six to twelve times as often as his own 31,000 words
 * do. It is a habit like any other: counted on the author's own words, and
 * brought back to that rate after the writing (article-pipeline/voice/habits.ts).
 *
 * Only forms that live inside one sentence are counted, because only those can
 * be repaired by rewriting one sentence.
 */
const CONTRAST_PATTERNS: RegExp[] = [
  // "the path, not the source"
  /,\s+not\s+(?!only\b|just\b|least\b|to mention\b|that\b|unlike\b)[a-z]/i,
  // "not a cure but a start"; "not only … but also" adds, it does not oppose
  /\bnot\s+(?!only\b|just\b)[^.,;:!?]{1,40}?,?\s+but\s+(?!also\b)/i,
  /\brather than\b/i,
  // "it isn't the chair; it's the stillness"
  /\b(?:isn't|aren't|wasn't|weren't|is not|are not)\b[^.;:!?]{1,60}[;:]\s*(?:it's|it is|they're|they are|that's|you're|you are)\b/i,
]

const tidy = (s: string) => s.replace(/[‘’]/g, "'")

export function isContrast(sentence: string): boolean {
  const s = tidy(sentence)
  return CONTRAST_PATTERNS.some((re) => re.test(s))
}

/** Sentences of running prose (not HTML). */
export function proseSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["”’)\]]?)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]{2}/.test(s))
}

/** Share of an author's own sentences that set one thing against another. */
export function contrastShare(texts: string[]): number {
  const all = texts.flatMap(proseSentences)
  return all.length ? all.filter(isContrast).length / all.length : 0
}

/** A sentence that opens on a spoken filler: "Hmmmm, …", "Um, …". */
export const INTERJECTION_RE = /^\s*["“]?(?:h+m+|u+m+|u+h+|er+m+|ahem)\b[!,.…]*/i
export const hasInterjection = (sentence: string): boolean => INTERJECTION_RE.test(sentence)

/**
 * Put two pieces of text back together after a sentence between them was
 * removed. Voice bench 1: a deleted sentence left "feels like.Some people",
 * because the space on both sides went with it.
 */
export function joinAfterDelete(left: string, right: string): string {
  const gap = /[^\s>]$/.test(left) && /^[^\s<.,;:!?)\]]/.test(right) ? ' ' : ''
  return left + gap + right
}
