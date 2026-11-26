/**
 * The compliance check for the author's convictions (author-voice plan,
 * stage 2, section 7).
 *
 * An article is an opinion piece built on the author's worldview. The fact
 * check no longer judges a conviction as if it were a claim about evidence, so
 * something else has to ask the one question that still applies to it: would
 * the author's regulator accept this sentence as written?
 *
 * A model reads the article and quotes back the sentences that would not pass,
 * each with a rewrite that keeps the conviction and removes the problem (a
 * promise, an absolute, a conviction dressed as a proven result, advice to
 * drop medical care, another profession run down). Code acts only on a
 * sentence it can find word for word and only on a rewrite that adds nothing.
 */
import { editAcceptable, findQuoted, htmlSentences, replaceSentences, type HtmlSentence } from './sentence-edits'
import { hasPresence } from '../../lib/text/editor-pass'

export interface BeliefFinding {
  sentence: string
  problem: string
  rewrite: string
}

export function parseBeliefFindings(raw: string): BeliefFinding[] {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { findings?: unknown }
    return (Array.isArray(j.findings) ? (j.findings as Array<Record<string, unknown>>) : [])
      .map((f) => ({ sentence: String(f.sentence ?? '').trim(), problem: String(f.problem ?? '').trim().slice(0, 300), rewrite: String(f.rewrite ?? '').trim() }))
      .filter((f) => f.sentence && f.rewrite)
  } catch {
    return []
  }
}

export interface BeliefCheckResult {
  html: string
  found: number
  applied: number
  /** Findings that could not be acted on, kept so a person can see them. */
  open: Array<BeliefFinding & { why: string }>
  changes: Array<{ before: string; after: string; problem: string }>
}

export function applyBeliefFindings(html: string, findings: BeliefFinding[], opts: { isFinding?: (sentence: string) => boolean } = {}): BeliefCheckResult {
  const sentences = htmlSentences(html)
  const edits: Array<{ sentence: HtmlSentence; rewrite: string }> = []
  const open: BeliefCheckResult['open'] = []
  const changes: BeliefCheckResult['changes'] = []
  for (const f of findings) {
    const at = findQuoted(sentences, f.sentence)
    if (!at) {
      open.push({ ...f, why: 'the sentence was not found word for word in the article' })
      continue
    }
    if (at.hasLink) {
      open.push({ ...f, why: 'the sentence carries a citation link' })
      continue
    }
    // A restated research finding must stay a general statement: as "We find…" it could no longer carry its
    // citation. An unmarked conviction is the opposite case, and gaining its "I believe" is the point.
    if (opts.isFinding?.(at.text) && !hasPresence(at.text) && hasPresence(f.rewrite)) {
      open.push({ ...f, why: 'the rewrite turns a restated finding into a first-person claim' })
      continue
    }
    if (!editAcceptable(at.text, f.rewrite, 1.6)) {
      open.push({ ...f, why: 'the rewrite adds a figure, a link or a stronger claim, or is much longer' })
      continue
    }
    if (edits.some((e) => e.sentence.from === at.from)) continue
    edits.push({ sentence: at, rewrite: f.rewrite })
    changes.push({ before: at.text, after: f.rewrite, problem: f.problem })
  }
  const r = replaceSentences(html, edits)
  return { html: r.html, found: findings.length, applied: r.applied, open, changes }
}

/** The article as the check reads it: plain paragraphs under their headings. */
export function articleForCheck(html: string): string {
  return html
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n')
    .replace(/<\/(p|li|ul|ol|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
