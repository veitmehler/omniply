/**
 * Editor pass (consolidation round, 2026-11-09).
 *
 * The step-9 prompt shrank from 26 blocks to 10 and lost its 48-line banned
 * phrase list, its banned openers and transitions, and its citation-metadata
 * rules as prose. Those rules now live HERE, as deterministic detection with
 * guarded LLM rewrites, in the same shape as hedge-gate.ts and
 * dash-sanitizer.ts: prompt rules reduce, gates catch.
 *
 * Four jobs, all HTML-aware, none throwing:
 *  1. Checkbox / bullet glyphs that the writer prints as text (☐ □ ✓ •) are
 *     removed deterministically (they appeared at step 11 in B13).
 *  2. Sentences carrying a stock AI phrase, article self-reference, tour-guide
 *     transition, or citation metadata (study years, "et al.", "researchers
 *     at", journal names, a study as the grammatical subject) are rewritten by
 *     `st_phrase_fix`, guarded in code (no new numbers, links or strengthening
 *     words, no surviving hedge or phrase, no growth beyond +3 words).
 *  3. Consecutive H2 sections that open with the same words have the later
 *     opening sentence rewritten (`st_phrase_fix`, reason "opener").
 *  4. An H2 section with no first-person presence at all gets one paragraph
 *     rewritten by `st_presence_fix`, guarded (same numbers, no links, bounded
 *     growth, must now carry a first-person marker, no hedge or phrase).
 *
 * Kill switch: EDITOR_PASS=0 (executor.ts). Rewriters are injectable for tests.
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
import { classifyHedge, rewriteAcceptable } from './hedge-gate'
import { extractH2Sections } from '../../article-pipeline/enrichment/html-parser'

export type EditorIssue = 'phrase' | 'source'

/** Stock phrases, self-reference and tour-guide transitions (ex step-9 prompt). */
export const BANNED_PHRASES: RegExp[] = [
  /\bin (today'?s|the) (fast-paced|digital|modern|ever-?evolving|ever-?changing|rapidly (evolving|changing)) (world|landscape|age|era|environment)\b/i,
  /\bin today'?s (world|landscape|age|era|climate|environment|market)\b/i,
  /\bit'?s no secret that\b/i,
  /\bwith that (being )?said\b/i,
  /\b(the|here'?s the) bottom line( is)?\b/i,
  /\bin (conclusion|summary|closing)\b/i,
  /\bas we'?ve seen\b/i,
  /\bfinal thoughts\b/i,
  /\b(this|the following|the) (article|guide|piece|post|blog)( will| aims| is going to)? (explore|explores|delve|delves|cover|covers|walk|walks|aim|aims|break|breaks|is about|exists)\b/i,
  /\b(this|the following) (article|guide|piece|sections?|post)\b/i,
  /\bwhy this (guide|article) exists\b/i,
  /\bwhat this (article|guide) covers\b/i,
  /\blet'?s (dive|explore|unpack|begin|start|get started|take a (closer |quick )?look|break (this|it|that) down|get into)\b/i,
  /\ba journey (through|into)\b/i,
  /\bto shed light on\b/i,
  /\bit('s|’s| is) (important|crucial|essential|vital|worth) (to (understand|note|remember|mention|recognize|recognise)|noting|remembering|mentioning)\b/i,
  /\bultimately, (the key|this highlights)\b/i,
  /\bplays? an? (significant|pivotal|crucial|vital|key|important) role\b/i,
  /\baims? to explore\b/i,
  /\bleverag(e|es|ed|ing)\b/i,
  /\boptimi[sz](e|es|ing) your\b/i,
  /\bseamless(ly)?\b/i,
  /\bstreamlin(e|es|ed|ing)\b/i,
  /\bholistic approach\b/i,
  /\bstay ahead of the curve\b/i,
  /\btransform your\b/i,
  /\bempower(s|ed|ing)? (your|you|users|patients|people)\b/i,
  /\bdeliver(s|ing)? results\b/i,
  /\bdrive (success|growth)\b/i,
  /\b(revolutionary|game-?changing|groundbreaking|transformative|paradigm shift)\b/i,
  /\binnovative (solutions?|approach)\b/i,
  /\b(cutting-?edge|next-?level|future-?proof|best-in-class|industry-leading|the new standard)\b/i,
  /\bcomprehensive (guide|solution|overview)\b/i,
  /\bunlock (the|your) (potential|power)\b/i,
  /\bunleash the power\b/i,
  /\bredefining the way\b/i,
  /\belevate your\b/i,
  /\btake your \w+ to the next level\b/i,
  /\bthe ultimate guide\b/i,
  /\bexplore the possibilities\b/i,
  /\bdigital transformation\b/i,
  /\buser-centric\b/i,
  /\ba testament to\b/i,
  /\bdelv(e|es|ed|ing) (into|deeper)\b/i,
  /\btapestry\b/i,
  /\bnestled\b/i,
  /\bnow,? let'?s turn to\b/i,
  /\bnext,? (we'?ll|let'?s) (examine|look at|explore|turn to)\b/i,
  /\bmoving on to\b/i,
  /\bbut that'?s not all\b/i,
  /\bhere'?s where it gets interesting\b/i,
  /\bwith that foundation\b/i,
  /\bbefore we (dive|begin|start|get into)\b/i,
  /\bfirst,? let'?s (understand|look)\b/i,
  /\bto understand \w+,? we (need to |must )?first\b/i,
  /\bas (we'?ll see|mentioned|discussed|noted) (below|earlier|above)\b/i,
  /\bcutting through the noise\b/i,
  /\bthe takeaway here is\b/i,
  /^imagine (a|an|you|that|if|this|for a moment)\b/i,
  /\bgreat question\b/i,
  /\bfascinating (point|question)\b/i,
]

/** Citation metadata in prose: the link is the citation (step-9 §3). Statistic
 * periods ("2022 data", "in 2023, 16 percent…") are allowed and not matched. */
export const SOURCE_METADATA: RegExp[] = [
  /\bet al\b/i,
  /\band colleagues\b/i,
  /\bpublished in\b/i,
  /'s (research )?(group|team|lab|laboratory)\b/i,
  /\b(researchers|scientists|a team|investigators|a group) (at|in|from|led by|based in)\b/i,
  /\b(a|an|one|another|the same|that|this|a (recent|large|small|major|landmark|new|older|classic|well-known|big)) (\d{4} )?(study|trial|review|meta-analysis|analysis|survey|paper|experiment|cohort( study)?|rct|randomi[sz]ed( controlled)? trial|systematic review|clinical trial)\b[^.?!]{0,60}?\b(found|finds|showed|shows|reported|reports|concluded|noted|measured|suggests?|suggested|estimated|put|tracked|followed|compared|linked|confirmed|demonstrated|looked at|examined|recorded|observed)\b/i,
  /\b(study|trial|review|meta-analysis|survey|paper|researchers) (from|in|of|published) (19|20)\d\d\b/i,
  /\b(19|20)\d\d (study|trial|review|meta-analysis|survey|paper|research)\b/i,
  /\b[A-Z][a-z]+ \((19|20)\d\d\)/,
  /\b(journal of|the lancet|\bbmj\b|\bjama\b|new england journal|annals of|archives of|british journal|american journal|european journal|international journal)\b/i,
  // B19: research register leaking from the fact feed into prose (judges: "reads like an abstract pasted in").
  /\b(intervention(s)?|cohort(s)?|participants|study subjects|outcome measure(s)?|at baseline|statistically significant|randomi[sz]ed|placebo-controlled|meta-analytic|effect size|confidence interval|the sample)\b/i,
]

const GLYPH_RE = /(^|>|\n)([ \t]*)[☐☑☒□■✓✔✗➜➤•▪◦][ \t]*(?=\S)/g

/** First-person markers. "I" is case-sensitive; "us" is left out (US). */
const PRESENCE_RE = /(^|[^A-Za-z'’])(I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll)(?![A-Za-z])|\b(me|my|mine|myself|we|we're|we’re|we've|we’ve|we'd|we’d|we'll|we’ll|our|ours|ourselves)\b/i

export function hasPresence(plain: string): boolean {
  // The "I" alternatives must match exactly (case-sensitive); the rest are case-insensitive.
  if (/(^|[^A-Za-z'’])(I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll)(?![A-Za-z])/.test(plain)) return true
  return /\b(me|my|mine|myself|we|we're|we’re|we've|we’ve|we'd|we’d|we'll|we’ll|our|ours|ourselves)\b/i.test(plain)
}
void PRESENCE_RE

export function classifyEditorIssue(plain: string): EditorIssue | null {
  if (BANNED_PHRASES.some((r) => r.test(plain))) return 'phrase'
  if (SOURCE_METADATA.some((r) => r.test(plain))) return 'source'
  return null
}

function plainText(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function numbers(s: string): Set<string> {
  return new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/** Guard for a sentence rewrite: the hedge-gate guard plus "no new tell". */
export function sentenceRewriteAcceptable(original: string, rewrite: string): boolean {
  if (!rewriteAcceptable(original, rewrite)) return false
  if (rewrite !== '[DELETE]' && classifyEditorIssue(rewrite)) return false
  return true
}

/** Guard for a presence rewrite of a whole paragraph. */
export function presenceRewriteAcceptable(original: string, rewrite: string): boolean {
  if (!rewrite || rewrite.includes('<') || /https?:\/\//i.test(rewrite)) return false
  if (/[—–]|--/.test(rewrite)) return false
  if (!hasPresence(rewrite)) return false
  if (classifyHedge(rewrite) || classifyEditorIssue(rewrite)) return false
  if (/\b(guarantee[sd]?|cure[sd]?|always works|proven|will fix|definitely)\b/i.test(rewrite) && !/\b(guarantee[sd]?|cure[sd]?|always works|proven|will fix|definitely)\b/i.test(original)) return false
  const origNums = numbers(original)
  for (const n of numbers(rewrite)) if (!origNums.has(n)) return false
  if (words(rewrite) > words(original) + 14) return false
  if ((rewrite.match(/\?/g) ?? []).length > 1) return false
  return true
}

export function stripGlyphs(html: string): { text: string; removed: number } {
  let removed = 0
  const text = html.replace(GLYPH_RE, (_m, lead: string, ws: string) => {
    removed++
    return lead + ws
  })
  return { text, removed }
}

/** Opening signature of a section: first words of its first paragraph. */
function openingSignature(sectionHtml: string, n: number): string {
  const body = sectionHtml.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '')
  const p = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  const text = plainText(p ? p[1] : body)
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'’\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(' ')
}

/** Positions (0-based section index) whose opening repeats the previous section's. */
export function repeatedOpenerIndexes(html: string): number[] {
  const secs = extractH2Sections(html)
  const out: number[] = []
  const seen3 = new Map<string, number>()
  for (let i = 0; i < secs.length; i++) {
    const s3 = openingSignature(secs[i].sectionHtml, 3)
    const s2 = openingSignature(secs[i].sectionHtml, 2)
    if (!s2) continue
    const prev2 = i > 0 ? openingSignature(secs[i - 1].sectionHtml, 2) : ''
    const count3 = (seen3.get(s3) ?? 0) + 1
    seen3.set(s3, count3)
    if ((prev2 && s2 === prev2) || (s3 && count3 >= 3)) out.push(i)
  }
  return out
}

/** Sections (0-based index) whose text carries no first-person marker. */
export function sectionsWithoutPresence(html: string): number[] {
  const secs = extractH2Sections(html)
  const out: number[] = []
  secs.forEach((s, i) => {
    const body = s.sectionHtml.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '')
    if (!hasPresence(plainText(body))) out.push(i)
  })
  return out
}

export interface EditorPassResult {
  text: string
  changed: boolean
  glyphsRemoved: number
  phraseFlagged: number
  sourceFlagged: number
  rewritten: number
  deleted: number
  kept: number
  repeatedOpeners: number
  openersRewritten: number
  sectionsWithoutPresence: number
  presenceAdded: number
  llmCalls: number
  cost: number
}

export type SentenceRewriter = (sentence: string, reason: string, before: string) => Promise<{ text: string; cost: number }>
export type ParagraphRewriter = (paragraph: string, heading: string) => Promise<{ text: string; cost: number }>

const REASONS: Record<EditorIssue | 'opener', string> = {
  phrase: 'It contains a stock phrase, a tour-guide transition, or a reference to the article itself. Say the same thing plainly, the way a person would in conversation, or drop the empty part.',
  source: 'It carries citation metadata or research register: a study year, a journal, researchers or authors, a study as the subject of the sentence, or words like intervention, cohort, participants, outcome measure. Say what happened to people and what it means, the way a clinician would across the desk; the link added later is the citation.',
  opener: 'It opens this section with the same words as the previous section. Open it differently, keeping the same content.',
}

const defaultSentenceRewriter: SentenceRewriter = async (sentence, reason, before) => {
  const run = await runNewsletterPrompt('st_phrase_fix', { sentence, reason, before })
  return { text: run.content.trim(), cost: run.response.cost }
}

const defaultParagraphRewriter: ParagraphRewriter = async (paragraph, heading) => {
  const run = await runNewsletterPrompt('st_presence_fix', { paragraph, heading })
  return { text: run.content.trim(), cost: run.response.cost }
}

function collapseEmptyBlocks(html: string): string {
  return html.replace(/<(p|li)(\s[^>]*)?>\s*<\/\1>\s*/gi, '')
}

interface Span {
  from: number
  to: number
  reason: string
}

/** Rewrite the given sentence spans (last to first) inside `working`. */
async function rewriteSpans(
  working: string,
  spans: Span[],
  rewriter: SentenceRewriter,
  res: EditorPassResult,
  ctx: Record<string, unknown>,
  beforeFor?: (span: Span) => string,
): Promise<string> {
  for (let t = spans.length - 1; t >= 0; t--) {
    const { from, to, reason } = spans[t]
    const sentence = working.slice(from, to)
    const { lead, core, trail } = splitTagAffixes(sentence)
    let plain = core
    let tagSpans: InlineTagSpan[] = []
    if (/<[a-z/!]/i.test(core)) {
      const parsed = parseSimpleInlineTags(core)
      if (!parsed) {
        res.kept++
        logger.info({ ...ctx, sentence: plainText(sentence).slice(0, 80) }, '[editor-pass] complex markup, sentence kept')
        continue
      }
      plain = parsed.plain
      tagSpans = parsed.spans
    }
    const before = beforeFor
      ? beforeFor(spans[t])
      : (plainText(working.slice(Math.max(0, from - 400), from)).split(/(?<=[.!?])\s+/).slice(-1)[0] ?? '')
    try {
      const out = await rewriter(plain.trim(), reason, before)
      res.llmCalls++
      res.cost += out.cost
      const rewrite = out.text
      if (!sentenceRewriteAcceptable(plain.trim(), rewrite)) {
        res.kept++
        logger.info({ ...ctx, sentence: plain.slice(0, 80), rewrite: rewrite.slice(0, 80) }, '[editor-pass] guard rejected rewrite, sentence kept')
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
        logger.info({ ...ctx, sentence: plain.slice(0, 80) }, '[editor-pass] linked text changed by rewrite, sentence kept')
        continue
      }
      const spacing = /\s$/.test(sentence) ? ' ' : ''
      working = working.slice(0, from) + lead + rebuilt + spacing + trail + working.slice(to)
      res.rewritten++
    } catch (err) {
      res.kept++
      logger.warn({ ...ctx, err }, '[editor-pass] rewrite call failed, sentence kept')
    }
  }
  return working
}

export async function runEditorPass(
  input: string,
  ctx: Record<string, unknown> = {},
  rewriters: { sentence?: SentenceRewriter; paragraph?: ParagraphRewriter } = {},
): Promise<EditorPassResult> {
  const sentenceRewriter = rewriters.sentence ?? defaultSentenceRewriter
  const paragraphRewriter = rewriters.paragraph ?? defaultParagraphRewriter
  const res: EditorPassResult = {
    text: input,
    changed: false,
    glyphsRemoved: 0,
    phraseFlagged: 0,
    sourceFlagged: 0,
    rewritten: 0,
    deleted: 0,
    kept: 0,
    repeatedOpeners: 0,
    openersRewritten: 0,
    sectionsWithoutPresence: 0,
    presenceAdded: 0,
    llmCalls: 0,
    cost: 0,
  }
  if (!input) return res

  try {
    // 1. glyphs
    const g = stripGlyphs(input)
    res.glyphsRemoved = g.removed

    // 2. phrase + source sentences
    const { masked, restore } = maskProtected(g.text)
    let working = masked
    {
      const ends = [0, ...sentenceEnds(working), working.length]
      const spans: Span[] = []
      for (let s = 1; s < ends.length; s++) {
        const from = ends[s - 1]
        const to = ends[s]
        const issue = classifyEditorIssue(plainText(working.slice(from, to)))
        if (!issue) continue
        if (issue === 'phrase') res.phraseFlagged++
        else res.sourceFlagged++
        spans.push({ from, to, reason: REASONS[issue] })
      }
      working = await rewriteSpans(working, spans, sentenceRewriter, res, ctx)
    }

    // 3. repeated section openers
    {
      const idxs = repeatedOpenerIndexes(working)
      res.repeatedOpeners = idxs.length
      const secs = extractH2Sections(working)
      const spans: Span[] = []
      const befores = new Map<number, string>()
      for (const i of idxs) {
        const sec = secs[i]
        const body = sec.sectionHtml.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '')
        const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body)
        if (!p) continue
        const pStart = sec.h2StartOffset + (sec.sectionHtml.length - body.length) + p.index + p[0].indexOf(p[1])
        const inner = p[1]
        const ends = sentenceEnds(inner)
        const firstEnd = ends.find((e) => e > 0) ?? inner.length
        const from = pStart
        const to = pStart + firstEnd
        spans.push({ from, to, reason: REASONS.opener })
        const prevBody = i > 0 ? secs[i - 1].sectionHtml.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '') : ''
        const prevP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(prevBody)
        befores.set(from, plainText(prevP ? prevP[1] : '').split(/(?<=[.!?])\s+/)[0] ?? '')
      }
      spans.sort((a, b) => a.from - b.from)
      const rewrittenBefore = res.rewritten
      working = await rewriteSpans(working, spans, sentenceRewriter, res, ctx, (sp) => befores.get(sp.from) ?? '')
      res.openersRewritten = res.rewritten - rewrittenBefore
    }

    // 4. presence per section
    {
      const idxs = sectionsWithoutPresence(working)
      res.sectionsWithoutPresence = idxs.length
      // Last to first so offsets stay valid.
      for (let k = idxs.length - 1; k >= 0; k--) {
        const secs = extractH2Sections(working)
        const sec = secs[idxs[k]]
        if (!sec) continue
        const headingLen = sec.sectionHtml.length - sec.sectionHtml.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '').length
        const body = sec.sectionHtml.slice(headingLen)
        const paras: Array<{ start: number; end: number; inner: string }> = []
        const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
        let m: RegExpExecArray | null
        while ((m = re.exec(body)) !== null) {
          paras.push({ start: m.index + m[0].indexOf(m[1]), end: m.index + m[0].indexOf(m[1]) + m[1].length, inner: m[1] })
        }
        // Prefer the second plain paragraph (the first carries the answer-first
        // opening); fall back to the first plain one.
        const plainParas = paras.filter((p) => !/<[a-z/!]/i.test(p.inner) && words(p.inner) >= 12)
        const target = plainParas[1] ?? plainParas[0]
        if (!target) {
          logger.info({ ...ctx, heading: sec.heading }, '[editor-pass] no plain paragraph to carry presence, section kept')
          continue
        }
        try {
          const out = await paragraphRewriter(target.inner.trim(), sec.heading)
          res.llmCalls++
          res.cost += out.cost
          if (!presenceRewriteAcceptable(target.inner.trim(), out.text)) {
            logger.info({ ...ctx, heading: sec.heading, rewrite: out.text.slice(0, 80) }, '[editor-pass] guard rejected presence rewrite, section kept')
            continue
          }
          const absStart = sec.h2StartOffset + headingLen + target.start
          const absEnd = sec.h2StartOffset + headingLen + target.end
          working = working.slice(0, absStart) + out.text + working.slice(absEnd)
          res.presenceAdded++
        } catch (err) {
          logger.warn({ ...ctx, err }, '[editor-pass] presence rewrite failed, section kept')
        }
      }
    }

    res.text = collapseEmptyBlocks(restore(working))
  } catch (err) {
    logger.warn({ ...ctx, err }, '[editor-pass] pass failed, text kept as-is')
    res.text = input
  }
  res.changed = res.text !== input
  return res
}

/** Metric helper for benches: what the pass would flag on a finished page. */
export function countEditorIssues(html: string): {
  phrase: number
  source: number
  glyphs: number
  repeatedOpeners: number
  sectionsWithoutPresence: number
} {
  const text = html.replace(/<figure[\s\S]*?<\/figure>/gi, '')
  const { masked } = maskProtected(text)
  const ends = [0, ...sentenceEnds(masked), masked.length]
  let phrase = 0
  let source = 0
  for (let s = 1; s < ends.length; s++) {
    const issue = classifyEditorIssue(plainText(masked.slice(ends[s - 1], ends[s])))
    if (issue === 'phrase') phrase++
    else if (issue === 'source') source++
  }
  return {
    phrase,
    source,
    glyphs: (text.match(GLYPH_RE) ?? []).length,
    repeatedOpeners: repeatedOpenerIndexes(text).length,
    sectionsWithoutPresence: sectionsWithoutPresence(text).length,
  }
}
