/**
 * Sentence-level edits on finished body HTML, shared by the belief compliance
 * check and the habit limits (author-voice plan, stage 2, sections 6 and 7).
 *
 * Both do the same thing: find particular sentences in the article, have them
 * rewritten as the author, and put the rewrite back without touching anything
 * else. A sentence is only replaced where it can be found unambiguously in a
 * paragraph or list item; one that carries a link is never touched, so no
 * citation can be lost or moved.
 */

export interface HtmlSentence {
  text: string
  /** Index of the paragraph or list item block it sits in. */
  block: number
  from: number
  to: number
  hasLink: boolean
  /** First sentence of the first block under a heading: the answer an AI search engine quotes. */
  opensSection: boolean
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘').replace(/&quot;/g, '"')

/** The sentences of every <p> and <li>, with their place in the HTML. Headings, tables and figures are left out. */
export function htmlSentences(html: string): HtmlSentence[] {
  const out: HtmlSentence[] = []
  const blockRe = /<(p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  let block = 0
  let lastHeadingEnd = -1
  const headingRe = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi
  const headingEnds: number[] = []
  let h: RegExpExecArray | null
  while ((h = headingRe.exec(html)) !== null) headingEnds.push(h.index + h[0].length)
  const seenHeading = new Set<number>()
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2]
    const innerStart = m.index + m[0].indexOf(inner)
    lastHeadingEnd = [...headingEnds].reverse().find((e) => e <= m!.index) ?? -1
    const firstUnderHeading = lastHeadingEnd >= 0 && !seenHeading.has(lastHeadingEnd)
    if (lastHeadingEnd >= 0) seenHeading.add(lastHeadingEnd)
    // Split on sentence ends that sit outside tags.
    const re = /(?:<[^>]+>|[^.!?…<])+(?:[.!?…]+(?:["”’)\]]|<\/(?:strong|em|b|i|a)>)*|$)/g
    let s: RegExpExecArray | null
    let first = true
    while ((s = re.exec(inner)) !== null) {
      if (!s[0]) {
        re.lastIndex++
        continue
      }
      const raw = s[0]
      const lead = raw.length - raw.trimStart().length
      const text = decode(raw.replace(/<[^>]+>/g, '')).trim()
      if (!/[A-Za-z]{2}/.test(text)) continue
      out.push({ text, block, from: innerStart + s.index + lead, to: innerStart + s.index + raw.trimEnd().length, hasLink: /<a\s/i.test(raw), opensSection: firstUnderHeading && first })
      first = false
    }
    block++
  }
  return out
}

const numbers = (s: string): Set<string> => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')))
export const STRENGTHEN_RE = /\b(guarantee[sd]?|cure[sd]?|always works|proven|will fix|definitely|certainly will|100%)\b/i

/** A rewrite may not add a figure, a link or a stronger claim, and may not balloon. */
export function editAcceptable(original: string, rewrite: string, growth = 1.5): boolean {
  const r = rewrite.trim()
  if (!r || /https?:\/\/|<[a-z/]/i.test(r)) return false
  const had = numbers(original)
  for (const n of numbers(r)) if (!had.has(n)) return false
  if (STRENGTHEN_RE.test(r) && !STRENGTHEN_RE.test(original)) return false
  const words = (s: string) => s.trim().split(/\s+/).length
  return words(r) <= words(original) * growth + 8
}

const esc = (s: string) => s.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Replace sentences in the HTML. Each edit names a sentence found by
 * htmlSentences; a sentence with a link, or one whose markup is more than plain
 * emphasis, is skipped. Later places first, so earlier offsets stay valid.
 */
export function replaceSentences(html: string, edits: Array<{ sentence: HtmlSentence; rewrite: string }>): { html: string; applied: number; skipped: number } {
  let out = html
  let applied = 0
  let skipped = 0
  for (const e of [...edits].sort((a, b) => b.sentence.from - a.sentence.from)) {
    const current = out.slice(e.sentence.from, e.sentence.to)
    if (e.sentence.hasLink || /<(?!\/?(?:strong|em|b|i)\b)/i.test(current)) {
      skipped++
      continue
    }
    out = out.slice(0, e.sentence.from) + esc(e.rewrite.trim()) + out.slice(e.sentence.to)
    applied++
  }
  return { html: out, applied, skipped }
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Find the article sentence a model quoted back. It has to match word for word; a near miss is not acted on. */
export function findQuoted(sentences: HtmlSentence[], quote: string): HtmlSentence | null {
  const want = norm(quote)
  if (want.split(' ').length < 4) return null
  const hits = sentences.filter((s) => norm(s.text) === want)
  return hits.length === 1 ? hits[0] : null
}
