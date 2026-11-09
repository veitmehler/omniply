/**
 * Boundary-sentence restore (B16).
 *
 * The writer (step 9) is asked for exactly one first-person clinical boundary
 * sentence: what the practitioner checks in person and what that decides. In
 * B15 the back-pain draft had one and the step-11 edit (fact correction +
 * HTML conversion) dropped it. This module detects boundary sentences in both
 * versions and, when the draft had one and the edited HTML has none, puts the
 * draft's sentence back after the edited paragraph that best matches the
 * draft paragraph it came from. Deterministic, never throws.
 */
import { classifyHedge } from './hedge-gate'

/** B14+ boundary shapes: written fresh per article, so detect the function, not a phrase. */
const FRESH_BOUNDARY: RegExp[] = [
  /\b(when|once|if) (you come in|i assess you|i see you|i examine you|you're in front of me|someone comes in)\b[^.!?]{0,220}\bi (check|test|watch|look|assess|examine|feel|press|measure)/i,
  /\bi (check|test|watch|look at|assess|examine|feel|press|measure)\b[^.!?]{0,200}\b(that|which|what i find) (decides|tells me|settles|determines|shapes)\b/i,
  /\bwhat i find (in the room|when i (see|assess|examine) you|on the table)\b/i,
]

export function isBoundarySentence(sentence: string): boolean {
  const plain = sentence.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return false
  if (classifyHedge(plain) === 'boundary') return true
  return FRESH_BOUNDARY.some((r) => r.test(plain))
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3))
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.max(1, Math.min(a.size, b.size))
}

export interface BoundaryRestoreResult {
  text: string
  changed: boolean
  draftHad: number
  editedHad: number
  lost: boolean
}

/**
 * @param draft  step-9 output (markdown)
 * @param edited step-11 output (HTML)
 */
export function restoreBoundary(draft: string, edited: string): BoundaryRestoreResult {
  const res: BoundaryRestoreResult = { text: edited, changed: false, draftHad: 0, editedHad: 0, lost: false }
  if (!draft || !edited) return res
  try {
    const draftBoundaries = sentencesOf(draft).filter(isBoundarySentence)
    res.draftHad = draftBoundaries.length
    res.editedHad = sentencesOf(edited).filter(isBoundarySentence).length
    if (res.draftHad === 0 || res.editedHad > 0) return res
    res.lost = true

    const sentence = draftBoundaries[0]
    // The draft paragraph that held the sentence, minus the sentence itself.
    const draftPara = draft.split(/\n\s*\n/).find((p) => p.includes(sentence)) ?? ''
    const neighbour = words(draftPara.replace(sentence, ''))
    if (neighbour.size < 4) return res

    // Best-matching edited <p> (plain, no inline markup): append the sentence to it.
    const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi
    let best: { start: number; end: number; inner: string; score: number } | null = null
    let m: RegExpExecArray | null
    while ((m = re.exec(edited)) !== null) {
      if (/<[a-z/!]/i.test(m[1])) continue
      const score = overlap(neighbour, words(m[1]))
      if (score >= 0.5 && (!best || score > best.score)) best = { start: m.index, end: m.index + m[0].length, inner: m[1], score }
    }
    if (!best) return res
    const inner = best.inner.replace(/\s+$/, '')
    const rebuilt = `<p>${inner} ${sentence}</p>`
    res.text = edited.slice(0, best.start) + rebuilt + edited.slice(best.end)
    res.changed = true
    return res
  } catch {
    return res
  }
}
