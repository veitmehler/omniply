/**
 * Narrated-constraint gate (bench B10, 2026-11-06).
 *
 * The writer satisfied "never overclaim" by SAYING it could not claim: "I won't
 * hand out a number without examining you", "I don't have controlled data to
 * hand, so this is practitioner observation", "I'd rather tell you that than
 * quote a neat percentage". Every such sentence was born in step 9 and is the
 * strongest remaining AI tell (Gemini, B9). A clinician complies silently: the
 * claim is left out or stated once as plain opinion. Prompt rules reduce;
 * this gate catches what survives, the way the figure gate and the dash
 * sanitizer do.
 *
 * Three jobs, all HTML-aware and never throwing:
 *  1. Thinking-noises ("Hmm,", "Um,") at a sentence start are deleted
 *     deterministically. "Well," and "Look," are copywriting openers and stay
 *     (user ruling 2026-11-06).
 *  2. Narrated-evidence sentences are rewritten by `st_hedge_fix` (or deleted
 *     when they carry nothing but the narration), guarded in code: no new
 *     numbers, links or strengthening words, no surviving hedge, no growth.
 *  3. Exactly ONE first-person clinical boundary line per article is kept
 *     ("that depends on what I find when I examine you"); further ones are
 *     rewritten like any other hedge.
 */
import { logger } from '../logger'
import { runNewsletterPrompt } from '../../newsletter/llm'
import {
  maskProtected,
  sentenceEnds,
  splitTagAffixes,
  parseSimpleInlineTags,
  rewrapInlineTags,
  type InlineTagSpan,
} from './dash-sanitizer'

export type HedgeKind = 'narrated' | 'boundary'

const NARRATED: RegExp[] = [
  /\bI (won'?t|will not|can'?t|cannot|'?m not going to|am not going to) (claim|promise|pretend|cite|quote|hand (you|out)|give you|offer you|make claims|put a (number|figure)|name a (number|figure)|rank|guess)\b/i,
  /\bI (don'?t|do not) have (the |any |controlled |trial |hard |specific |published |good |solid )*(data|evidence|a trial|trials|figures?|numbers?|a study|studies)\b/i,
  /\b(data|evidence|trials?|figures?|numbers?|studies) (to hand|in front of me|on hand)\b/i,
  /\bpractitioner observation\b/i,
  /\bI'?d rather (tell you|say so|be straight|be honest|be upfront)\b/i,
  /\bso I won'?t\b/i,
  /\bso this is (my |just my |practitioner |clinical )?(observation|opinion|experience)\b/i,
  /\b(the )?honest answer\b/i,
  /\bI can'?t (cite|point to|point you to|quote) a (trial|study)\b/i,
  /\bI'?m not going to pretend\b/i,
  /\b(I'?ll|I will) (say so|be honest|be straight)\b/i,
  /\bI (don'?t|do not) know of (a|any) (trial|study|data)\b/i,
  /\bthe studies don'?t agree\b/i,
  /\bstudies disagree\b/i,
  /\bno single tidy number\b/i,
  /\bI won'?t (promise|pretend)\b/i,
]

const BOUNDARY: RegExp[] = [
  /\bwithout (examining|seeing|assessing) you\b/i,
  /\b(before|until) I'?ve (seen|examined|assessed) you\b/i,
  /\b(before|until) I (see|examine|assess) you\b/i,
  /\bdepends on (an|the|what I find in the) (examination|assessment)\b/i,
  /\bwhat I find when I (examine|assess|see) you\b/i,
  /\bexamine you (first|and watch)\b/i,
  /\bseen you move\b/i,
  /\bwatch how you move first\b/i,
]

/** Sentence-initial thinking-noises. "Well," and "Look," are NOT noise. */
const NOISE_RE = /(^|>|[.!?]["”']?\s+)(?:Hmm+|Hm+|Um+|Uh+|Erm|Ahem|Okay,? so|OK,? so)[,.:…]*\s+([a-zA-Z"“'])/g

const STRENGTHEN_RE = /\b(guarantee[sd]?|cure[sd]?|always works|proven|will fix|definitely)\b/i
const MAX_EXTRA_WORDS = 3

export function classifyHedge(plain: string): HedgeKind | null {
  if (BOUNDARY.some((r) => r.test(plain))) return 'boundary'
  if (NARRATED.some((r) => r.test(plain))) return 'narrated'
  return null
}

export function hasNarratedHedge(plain: string): boolean {
  return NARRATED.some((r) => r.test(plain))
}

export function stripThinkingNoise(html: string): { text: string; removed: number } {
  let removed = 0
  const text = html.replace(NOISE_RE, (_m, lead: string, next: string) => {
    removed++
    return lead + next.toUpperCase()
  })
  return { text, removed }
}

function plainText(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function numbers(s: string): Set<string> {
  return new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])
}

/**
 * Code guard for a rewrite: the gate exists to remove a tell, never to let a
 * model add or strengthen a claim in the clinician's name.
 */
export function rewriteAcceptable(original: string, rewrite: string): boolean {
  if (rewrite === '[DELETE]') return true
  if (!rewrite || rewrite.includes('<') || /https?:\/\//i.test(rewrite)) return false
  if (/[—–]|--/.test(rewrite)) return false
  if (classifyHedge(rewrite)) return false
  if (STRENGTHEN_RE.test(rewrite) && !STRENGTHEN_RE.test(original)) return false
  const origNums = numbers(original)
  for (const n of numbers(rewrite)) if (!origNums.has(n)) return false
  const ow = original.split(/\s+/).filter(Boolean).length
  const rw = rewrite.split(/\s+/).filter(Boolean).length
  if (rw > ow + MAX_EXTRA_WORDS) return false
  return true
}

export interface HedgeGateResult {
  text: string
  changed: boolean
  flagged: number
  rewritten: number
  deleted: number
  kept: number
  boundaryKept: number
  noiseRemoved: number
  llmCalls: number
  cost: number
}

export type HedgeRewriter = (sentence: string, before: string) => Promise<{ text: string; cost: number }>

const defaultRewriter: HedgeRewriter = async (sentence, before) => {
  const run = await runNewsletterPrompt('st_hedge_fix', { sentence, before })
  return { text: run.content.trim(), cost: run.response.cost }
}

/** Remove paragraphs/list items emptied by a deletion. */
function collapseEmptyBlocks(html: string): string {
  return html.replace(/<(p|li)(\s[^>]*)?>\s*<\/\1>\s*/gi, '')
}

export async function gateHedges(
  input: string,
  ctx: Record<string, unknown> = {},
  rewriter: HedgeRewriter = defaultRewriter,
): Promise<HedgeGateResult> {
  const res: HedgeGateResult = {
    text: input,
    changed: false,
    flagged: 0,
    rewritten: 0,
    deleted: 0,
    kept: 0,
    boundaryKept: 0,
    noiseRemoved: 0,
    llmCalls: 0,
    cost: 0,
  }
  if (!input) return res

  try {
    const noise = stripThinkingNoise(input)
    res.noiseRemoved = noise.removed
    const { masked, restore } = maskProtected(noise.text)
    let working = masked
    const ends = [0, ...sentenceEnds(working), working.length]

    // Document order first: the first boundary line is the one that stays.
    const spans: Array<{ from: number; to: number; kind: HedgeKind }> = []
    for (let s = 1; s < ends.length; s++) {
      const from = ends[s - 1]
      const to = ends[s]
      const kind = classifyHedge(plainText(working.slice(from, to)))
      if (kind) spans.push({ from, to, kind })
    }
    let boundarySeen = false
    const targets = spans.filter((sp) => {
      if (sp.kind === 'boundary' && !boundarySeen) {
        boundarySeen = true
        res.boundaryKept = 1
        return false
      }
      return true
    })
    res.flagged = targets.length

    // Splice last to first so earlier offsets stay valid.
    for (let t = targets.length - 1; t >= 0; t--) {
      const { from, to } = targets[t]
      const sentence = working.slice(from, to)
      const { lead, core, trail } = splitTagAffixes(sentence)
      let plain = core
      let tagSpans: InlineTagSpan[] = []
      if (/<[a-z/!]/i.test(core)) {
        const parsed = parseSimpleInlineTags(core)
        if (!parsed) {
          res.kept++
          logger.info({ ...ctx, sentence: plainText(sentence).slice(0, 80) }, '[hedge-gate] complex markup, sentence kept')
          continue
        }
        plain = parsed.plain
        tagSpans = parsed.spans
      }
      const before = plainText(working.slice(Math.max(0, from - 400), from)).split(/(?<=[.!?])\s+/).slice(-1)[0] ?? ''
      try {
        const out = await rewriter(plain.trim(), before)
        res.llmCalls++
        res.cost += out.cost
        const rewrite = out.text
        if (!rewriteAcceptable(plain.trim(), rewrite)) {
          res.kept++
          logger.info({ ...ctx, sentence: plain.slice(0, 80), rewrite: rewrite.slice(0, 80) }, '[hedge-gate] guard rejected rewrite, sentence kept')
          continue
        }
        if (rewrite === '[DELETE]') {
          working = working.slice(0, from) + lead.replace(/\s+$/, '') + trail.replace(/^\s+/, '') + working.slice(to).replace(/^[ \t]+/, '')
          res.deleted++
          continue
        }
        const rebuilt = tagSpans.length ? rewrapInlineTags(rewrite, tagSpans) : rewrite
        if (rebuilt === null) {
          res.kept++
          logger.info({ ...ctx, sentence: plain.slice(0, 80) }, '[hedge-gate] linked text changed by rewrite, sentence kept')
          continue
        }
        const spacing = /\s$/.test(sentence) ? ' ' : ''
        working = working.slice(0, from) + lead + rebuilt + spacing + trail + working.slice(to)
        res.rewritten++
      } catch (err) {
        res.kept++
        logger.warn({ ...ctx, err }, '[hedge-gate] rewrite call failed, sentence kept')
      }
    }
    res.text = collapseEmptyBlocks(restore(working))
  } catch (err) {
    logger.warn({ ...ctx, err }, '[hedge-gate] pass failed, text kept as-is')
    res.text = input
  }
  res.changed = res.text !== input
  return res
}

/** Metric helper for benches/dashboards: hedge sentences still on the page. */
export function countHedges(html: string): { narrated: number; boundary: number; noise: number } {
  const text = html.replace(/<figure[\s\S]*?<\/figure>/gi, '')
  const { masked } = maskProtected(text)
  const ends = [0, ...sentenceEnds(masked), masked.length]
  let narrated = 0
  let boundary = 0
  for (let s = 1; s < ends.length; s++) {
    const kind = classifyHedge(plainText(masked.slice(ends[s - 1], ends[s])))
    if (kind === 'narrated') narrated++
    else if (kind === 'boundary') boundary++
  }
  const noise = (text.match(NOISE_RE) ?? []).length
  return { narrated, boundary, noise }
}
