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
export const PL_BOX_LABELS = [
  'In Plain English',
  'Simply Put',
  'Think of It This Way',
  'What This Means for You',
  'The Simple Version',
  'Picture It Like This',
  'Here Is the Idea',
  'In Everyday Terms',
] as const

// Mirrors enrichment/index.ts GEO_EXCLUDE (kept local — index.ts imports from
// this module, so importing back from it would be circular).
const SECTION_EXCLUDE = /^(faq|frequently asked questions|conclusion|key takeaways)\b/i

// B5 anti-uniformity dials (2026-11-04): detectors and readers key on the
// device repeating wall-to-wall, so density is capped and the packaging of
// each concept explanation is drawn by a per-article seeded lottery — the
// same explanation renders as flowing prose more often than as a labeled box.
const MAX_BOXES_PER_ARTICLE = 2
const MAX_GLOSSES_PER_ARTICLE = 8
const CONCEPT_INLINE_P = 0.5 // inline paragraph, no box chrome
const CONCEPT_BOXED_P = 0.3 // labeled box (remainder is skipped entirely)
const BOX_CLOSER_QUESTION_P = 0.25

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

function pickLabel(rng: () => number, used: Set<string>): string {
  const pool = PL_BOX_LABELS.filter((l) => !used.has(l))
  const from = pool.length > 0 ? pool : PL_BOX_LABELS
  const label = from[Math.floor(rng() * from.length)]
  used.add(label)
  return label
}

const CLOSER_QUESTION =
  'End with one short, fresh question that turns the image toward the reader. Never a stock phrase; never reuse a question pattern from elsewhere in the article.'
const CLOSER_PLAIN =
  'End on the image itself or the practical point. Do NOT end with a question.'

// B6 (2026-11-04): the device CONTENT read fine in detector testing, but
// near-every injection opened with the same "Think of… / Picture…" scaffold,
// which stacked to 10+ identical openers per article once inline forms landed.
// The opener is now a per-device seeded draw, and the classic scaffold is
// rationed to one use per article.
const OPENER_THINK_OF_P = 0.15
export const OPENER_SCENE =
  'OPENER STYLE (hard rule): open with a one-sentence everyday moment happening to a person, told in your own voice. Never open with "Think of", "Picture" or "Imagine".'
export const OPENER_WEAVE =
  'OPENER STYLE (hard rule): weave the comparison into the middle of a sentence ("…works like…", "…much the way a… does"). Never open with "Think of", "Picture" or "Imagine".'
export const OPENER_PLAIN =
  'OPENER STYLE (hard rule): no metaphor scaffold at all. Explain it plainly in everyday words and concrete nouns, as if answering someone across the table. Never open with "Think of", "Picture" or "Imagine".'
export const OPENER_THINK_OF =
  'OPENER STYLE: you may open with "Think of…" or "Picture…" this one time.'

/** Story opener draw: the classic scaffold at most once per article, the rest
 *  split evenly across scene/weave/plain. */
export function pickStoryOpener(rng: () => number, state: { thinkOfUsed: boolean }): string {
  if (!state.thinkOfUsed && rng() < OPENER_THINK_OF_P) {
    state.thinkOfUsed = true
    return OPENER_THINK_OF
  }
  const pool = [OPENER_SCENE, OPENER_WEAVE, OPENER_PLAIN]
  return pool[Math.floor(rng() * pool.length)]
}

/** Gloss opener draw: glosses are 1-2 sentences, so only weave/plain fit. */
export function pickGlossOpener(rng: () => number): string {
  return rng() < 0.5 ? OPENER_WEAVE : OPENER_PLAIN
}

// Deterministic output gates (B6). The generators are handed the article and
// asked to explain a concept "from" it, so they sometimes write from outside
// the byline ("the article notes…") — a persona break that reads as a prompt
// artifact once the text is spliced into first-person prose. Nothing else in
// the pipeline scans for this (pl_verify checks factual fidelity only), so it
// is caught here, before the paid verify call.
export const STANCE_LEAK_RE =
  /\b(?:the|this)\s+(?:article|passage|excerpt|piece)\b|\bthe author\b|\bas\s+(?:mentioned|noted|described)\s+(?:above|earlier)\b/i
export const SCAFFOLD_OPENER_RE = /^\s*(?:think of|picture|imagine)\b/i

/** Returns a rejection reason if the generated text breaks stance or opens
 *  with a banned scaffold, or null if it passes. */
export function lexicalGateReason(text: string, allowScaffoldOpener: boolean): string | null {
  if (STANCE_LEAK_RE.test(text)) {
    return 'it refers to "the article"/"the author" instead of speaking as the author in first person'
  }
  if (!allowScaffoldOpener && SCAFFOLD_OPENER_RE.test(text)) {
    return 'it opens with "Think of"/"Picture"/"Imagine", which your OPENER STYLE forbids'
  }
  return null
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
  const re = /<div (?:class="(?:geo-summary|plain-language-box)"|data-pl-box)[^>]*>[\s\S]*?<\/div>/gi
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
  const glossSpan = `<span class="plain-gloss"> ${escapeHtml(gloss.trim())}</span>`
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
      `\n<p class="plain-gloss">${escapeHtml(gloss.trim())}</p>` +
      sectionHtml.slice(span.end)
  }
  return null
}

/** Inline-styled story box (WordPress-theme-proof; class kept for site CSS overrides). */
export function buildBoxHtml(label: string, storyText: string, accentHex: string): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentHex) ? accentHex : '#4a5568'
  return (
    `\n<div class="plain-language-box" style="border-left:4px solid ${accent};background:${accent}14;` +
    `padding:16px 20px;margin:20px 0;border-radius:6px;">` +
    `<p style="margin:0 0 6px;font-weight:600;font-size:0.95em;">${escapeHtml(label)}</p>` +
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
}

/**
 * write → verify → (regenerate once with the failure reason) → verify → text or null.
 * A null result means "skip this injection" — the content simply stays as-is.
 */
async function generateVerified(args: GenerateArgs): Promise<{ text: string; usage: GenerationUsage; verified: boolean } | null> {
  const key = args.kind === 'term' ? 'pl_write_gloss' : 'pl_write_story'
  const responses: LLMResponse[] = []
  let restrictions = args.config.restrictions

  const allowScaffoldOpener = args.vars.openerStyle === OPENER_THINK_OF
  for (let attempt = 1; attempt <= 2; attempt++) {
    const written = await runNewsletterPrompt(key, { openerStyle: '', ...args.vars, restrictions })
    responses.push(written.response)
    if (args.onResponse) await args.onResponse(written.response)
    const text = (await sanitizeDashesText(written.content, args.logCtx)).trim()
    if (!text || text.length > args.maxChars) {
      logger.warn({ ...args.logCtx, attempt, len: text.length }, '[plain-language] generated text empty/oversized — skipping')
      return null
    }

    // Free deterministic gate before the paid verify call.
    const gateReason = lexicalGateReason(text, allowScaffoldOpener)
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
        return { text, usage: usageOf(responses), verified: true }
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
  const usedLabels = new Set<string>()
  const openerState = { thinkOfUsed: false }
  let plannedGlossTotal = 0
  let plannedBoxTotal = 0
  let lastBoxedSectionIdx = -2

  const exemplars = formatExemplars(config)
  const explainedTerms = new Set<string>()
  const usedImagery: string[] = []
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
        const generated = await generateVerified({
          kind: 'term',
          vars: { ...baseVars, term: t.term.trim(), sentence: t.sentence ?? '', openerStyle: pickGlossOpener(rng) },
          config,
          maxChars: MAX_GLOSS_CHARS,
          logCtx: { jobId, position: section.position, term: t.term },
        })
        result.cost += generated?.usage.cost ?? 0
        result.inputTokens += generated?.usage.inputTokens ?? 0
        result.outputTokens += generated?.usage.outputTokens ?? 0
        if (!generated) continue
        explainedTerms.add(norm)
        plannedGlossTotal++
        // Feed the actual opening imagery forward (not just the term name) so later
        // sections don't reuse the same metaphor vehicle (hose, bridge, ...).
        usedImagery.push(generated.text.slice(0, 80))
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
          form = 'inline'
        }
        if (form !== 'skip') {
          const closerStyle = form === 'boxed' && rng() < BOX_CLOSER_QUESTION_P ? CLOSER_QUESTION : CLOSER_PLAIN
          const generated = await generateVerified({
            kind: 'concept',
            vars: { ...baseVars, conceptSummary: concept.summary.trim(), closerStyle, openerStyle: pickStoryOpener(rng, openerState) },
            config,
            maxChars: MAX_STORY_CHARS,
            logCtx: { jobId, position: section.position, concept: concept.summary, form },
          })
          result.cost += generated?.usage.cost ?? 0
          result.inputTokens += generated?.usage.inputTokens ?? 0
          result.outputTokens += generated?.usage.outputTokens ?? 0
          if (generated) {
            usedImagery.push(generated.text.slice(0, 80))
            if (form === 'boxed') {
              plannedBoxTotal++
              lastBoxedSectionIdx = sectionIdx
            }
            plan.box = {
              form,
              label: form === 'boxed' ? pickLabel(rng, usedLabels) : null,
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
          ? buildBoxHtml(plan.box.label ?? PL_BOX_LABELS[0], plan.box.text, args.accentHex)
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
    const nlOpenerState = { thinkOfUsed: false }
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
      const generated = await generateVerified({
        kind: 'term',
        vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', term: t.term.trim(), sentence: t.sentence ?? '', openerStyle: pickGlossOpener(nlRng) },
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
      const generated = await generateVerified({
        kind: 'concept',
        vars: { ...baseVars, alreadyUsedMetaphors: usedImagery.join(', ') || 'none yet', conceptSummary: concept.summary.trim(), closerStyle: CLOSER_PLAIN, openerStyle: pickStoryOpener(nlRng, nlOpenerState) },
        config,
        maxChars: MAX_STORY_CHARS,
        logCtx: { newsletter: true, concept: concept.summary },
        onResponse: args.onResponse,
      })
      if (generated) {
        const marker = buildBoxMarker(rotatedLabel(args.labelSeed), generated.text)
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
