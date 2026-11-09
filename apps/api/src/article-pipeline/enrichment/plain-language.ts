/**
 * Plain-language storytelling injection — additive metaphors/stories next to
 * jargon terms and complex concepts in FINAL, fact-checked content. The LLM
 * only ever produces text; all HTML splicing happens here in code, so the
 * fact-checked prose is never modified — only added to.
 * See .plans/plain-language-storytelling.implementation-plan.md.
 *
 * Used by BOTH pipelines:
 *  - article enrichment (runPlainLanguagePass, hooked after the GEO restructure)
 *  - newsletter articles (runNewsletterPlainLanguage, hooked after the writer)
 */
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { runNewsletterPrompt, runNewsletterJsonPrompt } from '../../newsletter/llm'
import type { LLMResponse } from '../llm/adapter'
import { extractH2Sections, stripTags } from './html-parser'

/** Rotating labels for concept story boxes — varied across content, stable per anchor. */
// B11: boxes carry a title the device writes about the concept itself ("Why
// discs soak up water overnight"); the generic device labels ("The Simple
// Version", "In Everyday Terms") were quoted verbatim as AI artefacts. The one
// reader-facing label survives as the fallback for callers that need a fixed
// string (newsletter marker rotation).
export const PL_BOX_LABELS = ['What this means for you'] as const

// Mirrors enrichment/index.ts GEO_EXCLUDE (kept local — index.ts imports from
// this module, so importing back from it would be circular).
const SECTION_EXCLUDE = /^(faq|frequently asked questions|conclusion|key takeaways)\b/i

// B5 anti-uniformity dials (2026-11-04): detectors and readers key on the
// device repeating wall-to-wall, so density is capped and the packaging of
// each concept explanation is drawn by a per-article seeded lottery — the
// same explanation renders as flowing prose more often than as a labeled box.
// B8 (2026-11-05): density halved. The vehicle registry killed repetition, at
// which point Gemini's complaint shifted to the SUCCESSION of distinct
// engineered metaphors — and answer-first sections made the base prose plain
// enough that many devices were re-explaining already-plain text. Fewer,
// better-placed devices is both the length cut and the formula cut.
const MAX_BOXES_PER_ARTICLE = 1
const MAX_GLOSSES_PER_ARTICLE = 4
// B15 (2026-11-09): the INLINE concept form is retired. An unmarked plain
// explanation glued under the paragraph it explains is, to a reader, the same
// paragraph twice (Gemini's "double paragraph" on B14 back pain and stiffness).
// Boxes carry the explanation, framed as an explainer, and always with an image.
const CONCEPT_INLINE_P = 0 // retired
const CONCEPT_BOXED_P = 0.5 // labeled box (remainder is skipped entirely)

const MAX_TERMS_PER_SECTION = 2
const MAX_GLOSS_CHARS = 480
const MAX_STORY_CHARS = 1200
const SECTION_TEXT_CAP = 8000

export interface PlainLanguageConfigData {
  exemplars: Array<{ kind: string; subject: string; metaphor: string }>
  restrictions: string
}

export interface PlainLanguageVoice {
  writingStyle: string
  audience: string
  industry: string
}

interface DetectJson {
  terms?: Array<{ term?: string; sentence?: string }>
  concept?: { summary?: string; anchorQuote?: string } | null
}

interface VerifyJson {
  ok?: boolean
  reason?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** djb2 — deterministic label choice so re-runs produce stable output. */
function stableHash(seed: string): number {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  return h
}

export function rotatedLabel(seed: string): string {
  return PL_BOX_LABELS[stableHash(seed) % PL_BOX_LABELS.length]
}

/** Deterministic per-article RNG (mulberry32): every article draws its own
 *  layout, but a given jobId reproduces exactly — debuggable randomness. */
export function seededRng(seed: string): () => number {
  let t = stableHash(seed)
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** B11: the box title is written by the device on its first line ("TITLE: …"). */
export const TITLE_RULE =
  'TITLE LINE (hard rule): put a title on the very first line as "TITLE: <3 to 7 words>" that states what the reader learns about THIS mechanism, written fresh from the passage (a why / what / how phrase naming the body part and what it does), then a blank line, then the explanation. Never a stock phrase, never a phrase you have seen used as a title before: the title names the thing itself, never "simple", "plain", "version", "idea", "think", "picture", "terms", "put", "gist", "short", "explained", "in other words", "here is". Never end the title with a colon or a question mark.'

const TITLE_META_RE = /\b(simple|simply|plain|plainly|version|idea|think|picture|imagine|terms|put|gist|short|explained|explainer|other words|here is|here's|everyday)\b/i

export function splitTitle(text: string): { title: string | null; body: string } {
  const m = text.match(/^\s*TITLE:\s*(.+?)\s*\n+([\s\S]*)$/)
  if (!m) return { title: null, body: text.trim() }
  return { title: m[1].trim().replace(/^["“]|["”]$/g, '').replace(/[.:]$/, ''), body: m[2].trim() }
}

/** Null = usable title; otherwise why it is dropped (the box then renders untitled). */
export function titleGateReason(title: string): string | null {
  const words = title.split(/\s+/).filter(Boolean)
  if (words.length < 3 || words.length > 7) return `title has ${words.length} words (3 to 7 allowed)`
  if (/[?:]$/.test(title)) return 'title ends with a question mark or colon'
  if (TITLE_META_RE.test(title)) return 'title uses a meta word (simple/plain/version/idea/…)'
  if (LIKE_FRAME_RE.test(title)) return 'title is a simile'
  return null
}

const CLOSER_PLAIN =
  'End on the image itself or the practical point. Do NOT end with a question.'

// B9 (2026-11-05): the B6 opener lottery fixed the "Think of…" scaffold but
// its scene draw produced INVENTED eyewitness memories ("Last winter I
// watched a neighbour…") — fabricated experience in a real practitioner's
// byline, and the parable shape (scene → mapping sentence → button) remained
// the core detector tell. Devices are now plain across-the-table explanations
// with at most one in-sentence image clause, drawn half the time to none.
export const IMAGE_NONE =
  'IMAGERY (hard rule): use NO imagery at all. Explain the mechanism plainly in short concrete sentences, the way a senior clinician talks across the table. Never open with "Think of", "Picture" or "Imagine". Never invent a witnessed scene or a specific person.'
export const IMAGE_LIKE =
  'IMAGERY (hard rule): you may use at most ONE brief image, as a modifier inside a single sentence (a few words, e.g. "like a sponge soaking up water"). Never develop the image beyond that clause, never open the explanation with it, and never write a sentence mapping it back ("your spine works the same way"). Never open with "Think of", "Picture" or "Imagine". Never invent a witnessed scene or a specific person.'
/** Back-compat name for the "like a …" frame. */
export const IMAGE_CLAUSE = IMAGE_LIKE
// B11: the frame was the tell, not the image. Four "much like / a bit like /
// rather like" clauses per article read as a formula even with fresh images,
// so the frame is drawn per device and the "like" frame is capped at one per
// article.
export const IMAGE_APPOSITION =
  'IMAGERY (hard rule): you may use at most ONE brief image, carried by a plain apposition or noun phrase inside a single sentence (e.g. "the disc\'s soft centre, the jammy filling"). Never introduce it with "like", "as if", "much like", "a bit like" or "the way a…". Never develop the image beyond that phrase, never open the explanation with it, and never write a sentence mapping it back. Never open with "Think of", "Picture" or "Imagine". Never invent a witnessed scene or a specific person.'
export const IMAGE_VERB =
  'IMAGERY (hard rule): you may use at most ONE brief image, carried by a verb or an adjective only (e.g. "the nerve sulks for days", "a gummed-up hinge of a joint"). Never write "like", "as if", "much like", "a bit like" or "the way a…". Never develop the image, never open the explanation with it, and never write a sentence mapping it back. Never open with "Think of", "Picture" or "Imagine". Never invent a witnessed scene or a specific person.'

export interface ImageState {
  likeUsed: boolean
}

/** Image-mode draw for devices: half get no imagery at all (the human
 *  distribution is asymmetric). Of the rest, the "like a …" frame is allowed
 *  once per article when a state is tracked; the others carry the image as an
 *  apposition or a verb. Legacy callers without a state keep the old pair. */
export function pickImageMode(rng: () => number, state?: ImageState, opts: { requireImage?: boolean } = {}): string {
  if (!opts.requireImage && rng() < 0.5) return IMAGE_NONE
  if (!state) return IMAGE_LIKE
  if (!state.likeUsed && rng() < 0.4) {
    state.likeUsed = true
    return IMAGE_LIKE
  }
  return rng() < 0.5 ? IMAGE_APPOSITION : IMAGE_VERB
}

/** Comparison frames ("works much like a…", "as if", "the way a…"). Only a
 *  device drawn with IMAGE_LIKE may carry one; "would like a coffee" and
 *  "things like this" do not match. */
export const LIKE_FRAME_RE =
  /\b(?:much|a\s+bit|rather|a\s+little|somewhat|sort\s+of|kind\s+of)\s+like\b|\b(?:is|was|are|were|feels?|felt|works?|acts?|behaves?|moves?|sits?|runs?|looks?|sounds?|goes|went|become|becomes)\s+(?:a\s+bit\s+|rather\s+|much\s+|somewhat\s+)?like\s+(?:a|an|the|your|those|when|how)\b|\bas\s+if\b|\bthe\s+way\s+(?:a|an)\s+\w+/i
/** "Break the word in two: 'lumbar' is…" — dictionary pedantry, quoted as a tell. */
export const DICTIONARY_SPLIT_RE = /\bbreak\s+(?:the\s+(?:word|term)|it)\s+(?:in\s+two|down|apart|into)\b/i

// Parable-anatomy gates (B9): the explicit mapping sentence and the neat
// closing question are the engineered-analogy signature; the invented-witness
// frame is fabricated first-person experience. All three reject for free.
export const MAPPING_SENTENCE_RE =
  /\b(?:works?|behaves?|happens?)\s+(?:in\s+)?(?:much\s+)?the\s+same\s+way\b|\bsame\s+(?:thing|principle)\s+(?:happens|applies)\b|\bthat(?:'s| is)\s+exactly\s+what(?:'s| is)\s+happening\b/i
export const FABRICATED_WITNESS_RE =
  /\b(?:last\s+(?:week|weekend|winter|summer|month|year)|the\s+other\s+(?:day|morning|week)|yesterday)\b[^.!?]{0,50}\bI\s+(?:watched|saw|noticed|met)\b|\ba\s+(?:neighbour|neighbor|mate|bloke|friend)\s+of\s+mine\b/i

export function deviceShapeReason(text: string, opts: { allowLike?: boolean } = {}): string | null {
  if (MAPPING_SENTENCE_RE.test(text)) {
    return 'it ends the image with an explicit mapping sentence ("…the same way"), which your IMAGERY rule forbids'
  }
  if (!opts.allowLike && LIKE_FRAME_RE.test(text)) {
    return 'it uses a "like a …" / "as if" comparison frame, which your IMAGERY rule for this explanation forbids (carry the image as an apposition or a verb, or use none)'
  }
  if (DICTIONARY_SPLIT_RE.test(text)) {
    return 'it splits the word up like a dictionary entry ("break the word in two"), which reads as pedantry; explain what the thing is instead'
  }
  if (FABRICATED_WITNESS_RE.test(text)) {
    return 'it invents a witnessed scene or specific person ("last weekend I watched…"), which is fabricated experience and forbidden'
  }
  if (/\?\s*$/.test(text.trim())) {
    return 'it ends on a rhetorical question, which is forbidden for these explanations'
  }
  return null
}

// B8: gloss construction lottery. Gemini's B7 round flagged the gloss
// template's favorite move — "X just means Y" — repeated three times per
// article. Construction is now drawn per gloss, with "just means" allowed
// only by the apposition draw and at most once per article.
export const GLOSS_CONSEQUENCE =
  'GLOSS CONSTRUCTION (hard rule): define the term by what it does or causes in the body, woven mid-sentence. Never write "just means" or "simply means". Never open with "Think of", "Picture" or "Imagine".'
export const GLOSS_EXAMPLE =
  'GLOSS CONSTRUCTION (hard rule): define the term through one quick, concrete everyday example. Never write "just means" or "simply means". Never open with "Think of", "Picture" or "Imagine".'
export const GLOSS_PLAIN =
  'GLOSS CONSTRUCTION (hard rule): explain the term in one plain sentence, as if across the table. No metaphor scaffold, and never "just means" or "simply means". Never open with "Think of", "Picture" or "Imagine".'
export const GLOSS_APPOSITION =
  'GLOSS CONSTRUCTION: restate the term as a short plain apposition right after it. You may use "just means" this one time. Never open with "Think of", "Picture" or "Imagine".'

/** Gloss construction draw: apposition ("just means") at most once per article. */
export function pickGlossOpener(rng: () => number, state?: { justMeansUsed: boolean }): string {
  if (state && !state.justMeansUsed && rng() < 0.25) {
    state.justMeansUsed = true
    return GLOSS_APPOSITION
  }
  const pool = [GLOSS_CONSEQUENCE, GLOSS_EXAMPLE, GLOSS_PLAIN]
  return pool[Math.floor(rng() * pool.length)]
}

export const JUST_MEANS_RE = /\b(?:just|simply)\s+means\b/i

// B8: anchor-overlap gate. B7 devices sometimes RESTATED the passage they
// were spliced under, nearly verbatim ("Psychological stress doesn't cause a
// disc to herniate, but…" twice in adjacent paragraphs). Any 6-word verbatim
// run shared with the source passage is a restatement, not an illustration.
function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean)
}

export function overlapReason(text: string, passage: string, n = 6): string | null {
  const pw = normalizeWords(passage)
  if (pw.length < n) return null
  const grams = new Set<string>()
  for (let i = 0; i <= pw.length - n; i++) grams.add(pw.slice(i, i + n).join(' '))
  const tw = normalizeWords(text)
  for (let i = 0; i <= tw.length - n; i++) {
    const g = tw.slice(i, i + n).join(' ')
    if (grams.has(g)) {
      return `it repeats wording from the passage it sits under ("…${g}…") — illustrate, never restate`
    }
  }
  return null
}

// Deterministic output gates (B6). The generators are handed the article and
// asked to explain a concept "from" it, so they sometimes write from outside
// the byline ("the article notes…") — a persona break that reads as a prompt
// artifact once the text is spliced into first-person prose. Nothing else in
// the pipeline scans for this (pl_verify checks factual fidelity only), so it
// is caught here, before the paid verify call.
export const STANCE_LEAK_RE =
  /\b(?:the|this)\s+(?:article|passage|excerpt|piece)\b|\bthe author\b|\bas\s+(?:mentioned|noted|described)\s+(?:above|earlier)\b|\b(?:the|that)\s+(?:study|trial|review|paper|research)\s+I\s+(?:mentioned|cited|referred\s+to|quoted)\b|\bas\s+I\s+(?:said|mentioned|noted)\b|\bmentioned\s+(?:above|earlier)\b/i
export const SCAFFOLD_OPENER_RE = /^\s*(?:think of|picture|imagine)\b/i

/** Returns a rejection reason if the generated text breaks stance or opens
 *  with a banned scaffold, or null if it passes. */
export function lexicalGateReason(text: string, allowScaffoldOpener: boolean): string | null {
  if (STANCE_LEAK_RE.test(text)) {
    return 'it refers to "the article"/"the author" instead of speaking as the author in first person'
  }
  if (!allowScaffoldOpener && SCAFFOLD_OPENER_RE.test(text)) {
    return 'it opens with "Think of"/"Picture"/"Imagine", which your instructions forbid'
  }
  return null
}

// B7 (2026-11-04): cross-layer metaphor-vehicle registry. The B6 Gemini round
// flagged the same vehicle (sponge, honey…) recurring across the base article
// and the injected devices — three generators that never saw each other's
// imagery. The registry is seeded from the base article, grown per device,
// fed to the prompts as the ban list, and enforced here deterministically.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Returns a rejection reason if the text reuses a registered vehicle. */
export function vehicleReuseReason(text: string, vehicles: Iterable<string>): string | null {
  for (const v of vehicles) {
    const w = v.trim()
    if (w.length < 3) continue
    if (new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(text)) {
      return `it reuses the imagery "${w}", which this article has already used once`
    }
  }
  return null
}

/** LLM vehicle extraction via the pl_extract_vehicles template. Fail-soft:
 *  a missing template or any error returns [] and the pass behaves as before. */
export async function extractVehicles(
  text: string,
  logCtx: Record<string, unknown>,
  onResponse?: (r: LLMResponse) => Promise<void>,
): Promise<string[]> {
  try {
    const res = await runNewsletterJsonPrompt<{ vehicles?: string[] }>('pl_extract_vehicles', {
      text: text.slice(0, 12000),
    })
    if (onResponse) await onResponse(res.response)
    return (res.data.vehicles ?? [])
      .filter((v): v is string => typeof v === 'string' && v.trim().length >= 3)
      .map((v) => v.trim().toLowerCase())
      .slice(0, 40)
  } catch (err) {
    logger.warn({ ...logCtx, err }, '[plain-language] vehicle extraction skipped')
    return []
  }
}

/** Inline rendering of a concept story: same content, no box chrome. */
export function buildInlineHtml(storyText: string): string {
  return `<p>${escapeHtml(storyText)}</p>`
}

/** Case-insensitive index of `needle` in `haystack`, or -1. */
function indexOfCi(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from)
}

/** Ranges of already-injected blocks (geo summaries, our boxes) — paragraphs inside
 * them must never serve as splice/insert anchors. */
function injectedBlockRanges(html: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /<div (?:class="(?:geo-summary|plain-language-box|note)"|data-pl-box)[^>]*>[\s\S]*?<\/div>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

/** Split HTML into `<p>…</p>` chunks with their offsets, excluding paragraphs that
 * live inside injected blocks (non-p content between chunks is preserved). */
function paragraphSpans(html: string): Array<{ start: number; end: number; inner: string }> {
  const blocked = injectedBlockRanges(html)
  const spans: Array<{ start: number; end: number; inner: string }> = []
  const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const start = m.index
    if (blocked.some((b) => start >= b.start && start < b.end)) continue
    spans.push({ start, end: start + m[0].length, inner: m[1] })
  }
  return spans
}

/**
 * Find the end of the sentence containing the first occurrence of `term` within
 * paragraph HTML: scan forward from the term, skipping tag contents, to the first
 * `.`/`!`/`?` followed by whitespace/tag/end. Returns the insertion offset (just
 * after the punctuation and any immediately-following closing quote), or -1.
 */
export function sentenceEndAfterTerm(paragraphHtml: string, term: string): number {
  const termIdx = indexOfCi(paragraphHtml, term)
  if (termIdx === -1) return -1
  let inTag = false
  for (let i = termIdx + term.length; i < paragraphHtml.length; i++) {
    const ch = paragraphHtml[i]
    if (ch === '<') { inTag = true; continue }
    if (ch === '>') { inTag = false; continue }
    if (inTag) continue
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = paragraphHtml[i + 1]
      // Treat as sentence end when followed by space, tag, quote, or paragraph end.
      if (next === undefined || next === ' ' || next === '\n' || next === '<' || next === '"' || next === '”' || next === "'") {
        let end = i + 1
        if (next === '"' || next === '”' || next === "'") end++
        return end
      }
    }
  }
  return -1
}

/**
 * Weave a gloss into a section: directly after the sentence containing the term's
 * first occurrence (searching paragraphs only — headings are never touched).
 * Fallback when the term/sentence can't be located in raw HTML (e.g. markup
 * splits the term): a standalone gloss paragraph after the anchor paragraph.
 * Returns null when no paragraph contains the term at all.
 */
export function spliceGloss(sectionHtml: string, term: string, gloss: string): string | null {
  const spans = paragraphSpans(sectionHtml)
  const glossSpan = `<span class="term"> ${escapeHtml(gloss.trim())}</span>`
  for (const span of spans) {
    if (span.inner.length === 0) continue
    if (indexOfCi(stripTags(span.inner), term) === -1) continue
    const rel = sentenceEndAfterTerm(span.inner, term)
    if (rel !== -1) {
      const newInner = span.inner.slice(0, rel) + glossSpan + span.inner.slice(rel)
      return sectionHtml.slice(0, span.start) +
        sectionHtml.slice(span.start, span.end).replace(span.inner, newInner) +
        sectionHtml.slice(span.end)
    }
    // Fallback: standalone paragraph right after this one.
    return sectionHtml.slice(0, span.end) +
      `\n<p class="term">${escapeHtml(gloss.trim())}</p>` +
      sectionHtml.slice(span.end)
  }
  return null
}

/** Inline-styled story box (WordPress-theme-proof; class kept for site CSS overrides). */
export function buildBoxHtml(label: string, storyText: string, accentHex: string): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentHex) ? accentHex : '#4a5568'
  const title = label.trim() ? `<p style="margin:0 0 6px;font-weight:600;font-size:0.95em;">${escapeHtml(label.trim())}</p>` : ''
  return (
    `\n<div class="note" style="border-left:4px solid ${accent};background:${accent}14;` +
    `padding:16px 20px;margin:20px 0;border-radius:6px;">` +
    title +
    `<p style="margin:0;">${escapeHtml(storyText.trim())}</p></div>\n`
  )
}

/** Email-safe marker for newsletter bodies — render.ts swaps it for a themed block. */
export function buildBoxMarker(label: string, storyText: string): string {
  return `\n<div data-pl-box data-pl-label="${escapeHtml(label)}"><p>${escapeHtml(storyText.trim())}</p></div>\n`
}

/**
 * Insert a box after the paragraph containing `anchorQuote` (whitespace-normalized,
 * case-insensitive match on stripped text; fallback: the section's first paragraph).
 * Adjacency rule: if the insertion point directly abuts another injected block
 * (geo-summary or a previous box), shift down one paragraph. Returns null only
 * when the section has no paragraphs at all.
 */
export function insertBoxAfterAnchor(sectionHtml: string, anchorQuote: string | null, boxHtml: string): string | null {
  const spans = paragraphSpans(sectionHtml)
  if (spans.length === 0) return null

  const normalized = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const quote = anchorQuote ? normalized(anchorQuote) : ''
  let idx = 0
  if (quote) {
    const found = spans.findIndex((sp) => normalized(stripTags(sp.inner)).includes(quote))
    if (found >= 0) idx = found
  }

  // Adjacency: don't butt up against an existing injected block.
  const follows = (i: number) => sectionHtml.slice(spans[i].end).trimStart()
  while (
    idx < spans.length - 1 &&
    (follows(idx).startsWith('<div class="plain-language-box"') ||
      follows(idx).startsWith('<div class="note"') ||
      follows(idx).startsWith('<div data-pl-box') ||
      follows(idx).startsWith('<div class="geo-summary"'))
  ) {
    idx++
  }

  const at = spans[idx].end
  return sectionHtml.slice(0, at) + boxHtml + sectionHtml.slice(at)
}

export function formatExemplars(config: PlainLanguageConfigData): string {
  return config.exemplars
    .map((e) => `- [${e.kind}] ${e.subject}:\n  "${e.metaphor}"`)
    .join('\n')
}

/** Case-insensitive PlainLanguageConfig lookup; null → the whole pass should skip. */
export async function loadPlainLanguageConfig(industry: string | null | undefined): Promise<PlainLanguageConfigData | null> {
  const trimmed = industry?.trim()
  if (!trimmed) return null
  const row = await prisma.plainLanguageConfig.findFirst({
    where: { industry: { equals: trimmed, mode: 'insensitive' } },
  })
  if (!row) return null
  const exemplars = Array.isArray(row.exemplars)
    ? (row.exemplars as Array<{ kind: string; subject: string; metaphor: string }>)
    : []
  if (exemplars.length === 0) return null
  return { exemplars, restrictions: row.restrictions }
}

interface GenerationUsage {
  cost: number
  inputTokens: number
  outputTokens: number
  provider: string
  model: string
}

function usageOf(responses: LLMResponse[]): GenerationUsage {
  return {
    cost: responses.reduce((s, r) => s + r.cost, 0),
    inputTokens: responses.reduce((s, r) => s + r.tokens.input, 0),
    outputTokens: responses.reduce((s, r) => s + r.tokens.output, 0),
    provider: responses[responses.length - 1]?.provider ?? '',
    model: responses[responses.length - 1]?.model ?? '',
  }
}

interface GenerateArgs {
  kind: 'term' | 'concept'
  vars: Record<string, string>
  config: PlainLanguageConfigData
  maxChars: number
  logCtx: Record<string, unknown>
  onResponse?: (r: LLMResponse) => Promise<void>
  /** Metaphor vehicles already used anywhere in the article (base prose or
   * earlier devices) — reuse is rejected deterministically. */
  bannedVehicles?: Iterable<string>
  /** The device was drawn with the "like a …" image frame (B11 cap: one per article). */
  allowLike?: boolean
  /** Boxed concept: the device writes a "TITLE:" first line (B11). */
  wantTitle?: boolean
}

/**
 * write → verify → (regenerate once with the failure reason) → verify → text or null.
 * A null result means "skip this injection" — the content simply stays as-is.
 */
async function generateVerified(args: GenerateArgs): Promise<{ text: string; title: string | null; usage: GenerationUsage; verified: boolean } | null> {
  const key = args.kind === 'term' ? 'pl_write_gloss' : 'pl_write_story'
  const responses: LLMResponse[] = []
  let restrictions = args.config.restrictions

  const allowJustMeans = args.vars.openerStyle === GLOSS_APPOSITION
  for (let attempt = 1; attempt <= 2; attempt++) {
    const written = await runNewsletterPrompt(key, { openerStyle: '', titleRule: args.wantTitle ? TITLE_RULE : '', ...args.vars, restrictions })
    responses.push(written.response)
    if (args.onResponse) await args.onResponse(written.response)
    const raw = (await sanitizeDashesText(written.content, args.logCtx)).trim()
    const split = args.wantTitle ? splitTitle(raw) : { title: null, body: raw }
    const text = split.body
    let title: string | null = null
    if (args.wantTitle) {
      const why = split.title ? titleGateReason(split.title) : 'no TITLE line'
      if (why) logger.info({ ...args.logCtx, attempt, why, title: split.title }, '[plain-language] box title dropped, rendering untitled')
      else title = split.title
    }
    if (!text || text.length > args.maxChars) {
      logger.warn({ ...args.logCtx, attempt, len: text.length }, '[plain-language] generated text empty/oversized — skipping')
      return null
    }

    // Free deterministic gates before the paid verify call.
    const gateReason =
      lexicalGateReason(text, false) ??
      (args.bannedVehicles ? vehicleReuseReason(text, args.bannedVehicles) : null) ??
      (!allowJustMeans && JUST_MEANS_RE.test(text)
        ? 'it uses the "just means" construction, which your GLOSS CONSTRUCTION forbids'
        : null) ??
      overlapReason(text, args.vars.sectionExcerpt ?? '') ??
      deviceShapeReason(text, { allowLike: args.allowLike })
    if (gateReason) {
      logger.warn({ ...args.logCtx, attempt, gateReason }, '[plain-language] lexical gate failed')
      if (attempt === 1) {
        restrictions = `${args.config.restrictions}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BECAUSE ${gateReason} — fix exactly this.`
        continue
      }
      return null
    }

    try {
      const verify = await runNewsletterJsonPrompt<VerifyJson>('pl_verify', {
        sectionExcerpt: args.vars.sectionExcerpt,
        generatedText: text,
        restrictions: args.config.restrictions,
      })
      responses.push(verify.response)
      if (args.onResponse) await args.onResponse(verify.response)
      if (verify.data.ok === true) {
        return { text, title, usage: usageOf(responses), verified: true }
      }
      const reason = verify.data.reason ?? 'unspecified'
      logger.warn({ ...args.logCtx, attempt, reason }, '[plain-language] verify failed')
      if (attempt === 1) {
        restrictions = `${args.config.restrictions}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED FOR: ${reason} — fix exactly this.`
      }
    } catch (err) {
      // Verifier itself failed — err on the side of skipping (a missing gloss is harmless).
      logger.warn({ ...args.logCtx, err }, '[plain-language] verifier errored — skipping injection')
      return null
    }
  }
  return null
}

interface PlannedGloss {
  term: string
  text: string
  usage: GenerationUsage
}

interface PlannedBox {
  form: 'boxed' | 'inline'
  label: string | null
  subject: string
  anchorQuote: string | null
  text: string
  usage: GenerationUsage
}

interface SectionPlan {
  position: number
  sectionHtml: string
  glosses: PlannedGloss[]
  box: PlannedBox | null
}

export interface PlainLanguagePassResult {
  html: string
  cost: number
  inputTokens: number
  outputTokens: number
  injectedGlosses: number
  injectedBoxes: number
  injectedInline: number
}

export interface ArticlePassArgs {
  jobId: string
  sitePageId: string
  html: string
  voice: PlainLanguageVoice
  config: PlainLanguageConfigData
  /** Brand accent hex for box styling (themeFromBrand().primaryColor). */
  accentHex: string
}

/**
 * The article-enrichment pass: section-by-section detection (mirroring the GEO
 * pass), verified generation, then last-to-first application so string offsets
 * stay valid. Per-section failures are logged and skipped — never fatal.
 */
export async function runPlainLanguagePass(args: ArticlePassArgs): Promise<PlainLanguagePassResult> {
  const { jobId, sitePageId, html, voice, config } = args
  const result: PlainLanguagePassResult = {
    html,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    injectedGlosses: 0,
    injectedBoxes: 0,
    injectedInline: 0,
  }

  await prisma.plainLanguageBlock.deleteMany({ where: { sitePageId } })

  const sections = extractH2Sections(html).filter((s) => !SECTION_EXCLUDE.test(s.heading.trim()))
  if (sections.length === 0) return result

  const rng = seededRng(jobId)
  const glossState = { justMeansUsed: false }
  const imageState: ImageState = { likeUsed: false }
  let plannedGlossTotal = 0
  let plannedBoxTotal = 0
  let lastBoxedSectionIdx = -2

  const exemplars = formatExemplars(config)
  const explainedTerms = new Set<string>()
  // Vehicle registry: seeded from the base article's own imagery so devices
  // never double a metaphor the author already spent (B6's main residual tell).
  const tallyUsage = async (r: LLMResponse) => {
    result.cost += r.cost
    result.inputTokens += r.tokens.input
    result.outputTokens += r.tokens.output
  }
  const usedImagery: string[] = await extractVehicles(stripTags(html), { jobId, scope: 'base-article' }, tallyUsage)
  if (usedImagery.length > 0) {
    logger.info({ jobId, baseVehicles: usedImagery }, '[plain-language] base-article vehicles registered')
  }
  const plans: SectionPlan[] = []

  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx]
    const plan: SectionPlan = { position: section.position, sectionHtml: section.sectionHtml, glosses: [], box: null }
    try {
      const sectionText = stripTags(section.sectionHtml).slice(0, SECTION_TEXT_CAP)
      const detect = await runNewsletterJsonPrompt<DetectJson>('pl_detect_section', {
        sectionHeading: section.heading,
        sectionText,
        industry: voice.industry,
        audience: voice.audience,
      })
      result.cost += detect.response.cost
      result.inputTokens += detect.response.tokens.input
      result.outputTokens += detect.response.tokens.output

      const baseVars = {
        sectionExcerpt: sectionText,
        writingStyle: voice.writingStyle,
        audience: voice.audience,
        industry: voice.industry,
        exemplars,
        alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet',
      }

      const terms = (detect.data.terms ?? [])
        .filter((t): t is { term: string; sentence?: string } => Boolean(t.term?.trim()))
        .slice(0, MAX_TERMS_PER_SECTION)
      for (const t of terms) {
        if (plannedGlossTotal >= MAX_GLOSSES_PER_ARTICLE) break
        const norm = t.term.trim().toLowerCase()
        if (explainedTerms.has(norm)) continue
        const glossImage = pickImageMode(rng, imageState)
        const generated = await generateVerified({
          kind: 'term',
          vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', term: t.term.trim(), sentence: t.sentence ?? '', openerStyle: `${pickGlossOpener(rng, glossState)}\n\n${glossImage}` },
          config,
          maxChars: MAX_GLOSS_CHARS,
          logCtx: { jobId, position: section.position, term: t.term },
          bannedVehicles: usedImagery,
          allowLike: glossImage === IMAGE_LIKE,
        })
        result.cost += generated?.usage.cost ?? 0
        result.inputTokens += generated?.usage.inputTokens ?? 0
        result.outputTokens += generated?.usage.outputTokens ?? 0
        if (!generated) continue
        explainedTerms.add(norm)
        plannedGlossTotal++
        // Register this device's actual vehicles so later devices can't reuse them.
        usedImagery.push(...await extractVehicles(generated.text, { jobId, position: section.position, scope: 'gloss' }, tallyUsage))
        plan.glosses.push({ term: t.term.trim(), text: generated.text, usage: generated.usage })
      }

      const concept = detect.data.concept
      if (concept?.summary?.trim()) {
        // Form lottery first (before any LLM spend): inline prose most often,
        // a labeled box sometimes, nothing at all for the remainder. Boxes are
        // additionally capped per article and never land in adjacent sections.
        const draw = rng()
        let form: 'inline' | 'boxed' | 'skip' =
          draw < CONCEPT_INLINE_P ? 'inline' : draw < CONCEPT_INLINE_P + CONCEPT_BOXED_P ? 'boxed' : 'skip'
        if (form === 'boxed' && (plannedBoxTotal >= MAX_BOXES_PER_ARTICLE || sectionIdx - lastBoxedSectionIdx <= 1)) {
          form = 'skip'
        }
        if (form !== 'skip') {
          // Boxed explanations always carry an image (B15): without one the box is a paraphrase.
          const conceptImage = pickImageMode(rng, imageState, { requireImage: true })
          const generated = await generateVerified({
            kind: 'concept',
            vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', conceptSummary: concept.summary.trim(), closerStyle: CLOSER_PLAIN, openerStyle: conceptImage },
            config,
            maxChars: MAX_STORY_CHARS,
            logCtx: { jobId, position: section.position, concept: concept.summary, form },
            bannedVehicles: usedImagery,
            allowLike: conceptImage === IMAGE_LIKE,
            wantTitle: form === 'boxed',
          })
          result.cost += generated?.usage.cost ?? 0
          result.inputTokens += generated?.usage.inputTokens ?? 0
          result.outputTokens += generated?.usage.outputTokens ?? 0
          if (generated) {
            usedImagery.push(...await extractVehicles(generated.text, { jobId, position: section.position, scope: 'story' }, tallyUsage))
            if (form === 'boxed') {
              plannedBoxTotal++
              lastBoxedSectionIdx = sectionIdx
            }
            plan.box = {
              form,
              label: form === 'boxed' ? (generated.title ?? '') : null,
              subject: concept.summary.trim(),
              anchorQuote: concept.anchorQuote?.trim() || null,
              text: generated.text,
              usage: generated.usage,
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ jobId, position: section.position, err }, '[plain-language] section pass failed — skipping section')
    }
    if (plan.glosses.length > 0 || plan.box) plans.push(plan)
  }

  // Apply last-to-first so earlier sections' offsets stay valid (GEO's pattern).
  let out = html
  for (let i = plans.length - 1; i >= 0; i--) {
    const plan = plans[i]
    let section = plan.sectionHtml
    const applied: Array<{ kind: 'term' | 'concept'; subject: string; label: string | null; text: string; usage: GenerationUsage }> = []

    for (const g of plan.glosses) {
      const spliced = spliceGloss(section, g.term, g.text)
      if (spliced) {
        section = spliced
        applied.push({ kind: 'term', subject: g.term, label: null, text: g.text, usage: g.usage })
      } else {
        logger.warn({ jobId, position: plan.position, term: g.term }, '[plain-language] gloss anchor not found — dropped')
      }
    }
    if (plan.box) {
      const blockHtml =
        plan.box.form === 'boxed'
          ? buildBoxHtml(plan.box.label ?? '', plan.box.text, args.accentHex)
          : buildInlineHtml(plan.box.text)
      const inserted = insertBoxAfterAnchor(section, plan.box.anchorQuote, blockHtml)
      if (inserted) {
        section = inserted
        applied.push({ kind: 'concept', subject: plan.box.subject, label: plan.box.label, text: plan.box.text, usage: plan.box.usage })
      } else {
        logger.warn({ jobId, position: plan.position }, '[plain-language] box anchor not found — dropped')
      }
    }

    const start = out.indexOf(plan.sectionHtml)
    if (start === -1) {
      logger.warn({ jobId, position: plan.position }, '[plain-language] section drifted — injections dropped')
      continue
    }
    out = out.slice(0, start) + section + out.slice(start + plan.sectionHtml.length)

    for (const a of applied) {
      if (a.kind === 'term') result.injectedGlosses++
      else if (a.label !== null) result.injectedBoxes++
      else result.injectedInline++
      await prisma.plainLanguageBlock
        .create({
          data: {
            sitePageId,
            sectionPosition: plan.position,
            kind: a.kind,
            subject: a.subject,
            label: a.label,
            generatedText: a.text,
            verified: true,
            llmProvider: a.usage.provider,
            llmModel: a.usage.model,
            inputTokens: a.usage.inputTokens,
            outputTokens: a.usage.outputTokens,
            cost: a.usage.cost,
          },
        })
        .catch((err) => logger.warn({ jobId, err }, '[plain-language] block record failed (non-fatal)'))
    }
  }

  result.html = out
  return result
}

export interface NewsletterPassArgs {
  bodyHtml: string
  voice: PlainLanguageVoice
  config: PlainLanguageConfigData
  /** Stable seed for label rotation (topicId+userId). */
  labelSeed: string
  onResponse: (r: LLMResponse) => Promise<void>
}

/**
 * Newsletter-article variant: the whole (short) body is treated as one section,
 * budget 1 box + 2 glosses total, box emitted as a data-pl-box marker that
 * render.ts styles with the email theme. Any error → body returned unmodified.
 */
export async function runNewsletterPlainLanguage(args: NewsletterPassArgs): Promise<string> {
  const { bodyHtml, voice, config } = args
  try {
    const bodyText = stripTags(bodyHtml).slice(0, SECTION_TEXT_CAP)
    const detect = await runNewsletterJsonPrompt<DetectJson>('pl_detect_section', {
      sectionHeading: 'Newsletter article',
      sectionText: bodyText,
      industry: voice.industry,
      audience: voice.audience,
    })
    await args.onResponse(detect.response)

    const exemplars = formatExemplars(config)
    const usedImagery: string[] = []
    const nlRng = seededRng(args.labelSeed)
    const nlGlossState = { justMeansUsed: false }
    const nlImageState: ImageState = { likeUsed: false }
    const baseVars = {
      sectionExcerpt: bodyText,
      writingStyle: voice.writingStyle,
      audience: voice.audience,
      industry: voice.industry,
      exemplars,
      alreadyUsedMetaphors: 'none yet',
    }

    let html = bodyHtml
    const explained = new Set<string>()
    const terms = (detect.data.terms ?? [])
      .filter((t): t is { term: string; sentence?: string } => Boolean(t.term?.trim()))
      .slice(0, MAX_TERMS_PER_SECTION)
    for (const t of terms) {
      const norm = t.term.trim().toLowerCase()
      if (explained.has(norm)) continue
      const nlGlossImage = pickImageMode(nlRng, nlImageState)
      const generated = await generateVerified({
        kind: 'term',
        vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', term: t.term.trim(), sentence: t.sentence ?? '', openerStyle: `${pickGlossOpener(nlRng, nlGlossState)}\n\n${nlGlossImage}` },
        allowLike: nlGlossImage === IMAGE_LIKE,
        config,
        maxChars: MAX_GLOSS_CHARS,
        logCtx: { newsletter: true, term: t.term },
        onResponse: args.onResponse,
      })
      if (!generated) continue
      const spliced = spliceGloss(html, t.term.trim(), generated.text)
      if (spliced) {
        html = spliced
        explained.add(norm)
        usedImagery.push(generated.text.slice(0, 80))
      }
    }

    const concept = detect.data.concept
    if (concept?.summary?.trim()) {
      const nlConceptImage = pickImageMode(nlRng, nlImageState)
      const generated = await generateVerified({
        kind: 'concept',
        vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', conceptSummary: concept.summary.trim(), closerStyle: CLOSER_PLAIN, openerStyle: nlConceptImage },
        config,
        maxChars: MAX_STORY_CHARS,
        logCtx: { newsletter: true, concept: concept.summary },
        onResponse: args.onResponse,
        allowLike: nlConceptImage === IMAGE_LIKE,
        wantTitle: true,
      })
      if (generated) {
        const marker = buildBoxMarker(generated.title ?? '', generated.text)
        const inserted = insertBoxAfterAnchor(html, concept.anchorQuote?.trim() || null, marker)
        if (inserted) html = inserted
      }
    }

    return html
  } catch (err) {
    logger.warn({ err }, '[plain-language] newsletter pass failed — body unmodified')
    return bodyHtml
  }
}
