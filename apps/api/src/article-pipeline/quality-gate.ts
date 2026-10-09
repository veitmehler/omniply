/**
 * Automated article quality gate (replaces the manual "paste into Gemini" check).
 *
 *   1. Gemini 3.1 Pro evaluates the finished Phase A body like a senior content
 *      reviewer and states a verdict in plain prose.
 *   2. GPT-4o-mini reads that prose and returns a STRUCTURED pass/revise/fail
 *      decision. Framing favors PASS — only substantive problems fail.
 *   3. A deterministic validator checks the JSON-LD schema markup.
 *
 * Orchestration (enqueue → approve | rewrite | needs_review) lives in the
 * handler; this module holds the model calls + the pure, testable helpers.
 */
import { prisma } from '@omniply/shared'
import { getLLMAdapter } from './llm/factory'
import { sanitizeDashes } from '../lib/text/dash-sanitizer'
import { logger } from '../lib/logger'

// The available "Gemini 3.1 Pro" model id on the generativelanguage API is the
// preview alias (plain `gemini-3.1-pro` 404s); it's the same model the article
// prompts use.
const GEMINI_MODEL = 'gemini-3.1-pro-preview'
const JUDGE_MODEL = 'gpt-4o-mini'

export type Verdict = 'pass' | 'revise' | 'fail'

export interface QualityVerdict {
  verdict: Verdict
  severity: 'none' | 'minor' | 'major'
  reasons: string[]
  geminiSummary: string
}

const EVAL_SYSTEM = `You are a senior content-quality reviewer assessing an article the way Google's helpful-content and E-E-A-T guidelines would. Judge depth, originality, accuracy, helpfulness to a real reader, structure, and readability.

State your OVERALL verdict in the very first sentence (e.g. "This is a high-quality, helpful article." or "This article needs significant improvement before publishing."). Then briefly note key strengths and any concrete issues. Be fair: a strong article with only minor polish suggestions is still high quality. Keep it under ~200 words.`

const JUDGE_SYSTEM = `You read a senior editor's evaluation of an article and decide whether it can PASS to publishing or needs revision. The evaluation usually states the overall verdict in its FIRST sentence — weight that heavily.

Rules:
- If the reviewer is overall positive and offers only minor, optional, or "nice to have" polish suggestions, return "pass". Minor suggestions must NOT cause a failure.
- Return "revise" only for SUBSTANTIVE problems: factual errors, thin/shallow or padded content, off-topic sections, missing key information, or poor structure that hurts the reader.
- Return "fail" only for severe problems that make the article unusable as-is.

Output STRICT JSON only, no prose:
{"verdict":"pass"|"revise"|"fail","severity":"none"|"minor"|"major","reasons":["short reason", ...]}
For "pass" use severity "none" or "minor" and an empty or short reasons array.`

/** Strip HTML to readable text for the evaluator (the body is stored as HTML). */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Evaluator input (truncation bug, live test 2026-10-09): the old flat
 * .slice(0, 24000) amputated every article longer than ~24k chars MID-BODY,
 * so the judge read a cut-off text and verdicted "incomplete ending" —
 * deterministically, on exactly the longest articles. One wasted full-body
 * rewrite + re-gate + needs_review per long article ($0.91 + a stuck review).
 * The cap is now generous (Gemini's context dwarfs any article) and if it
 * EVER trips, the ending is preserved and the cut is declared to the judge.
 */
export const EVAL_INPUT_CAP = 150_000
const EVAL_TAIL_KEEP = 8_000
export function prepareEvalText(articleHtml: string): string {
  const text = htmlToText(articleHtml)
  if (text.length <= EVAL_INPUT_CAP) return text
  return (
    text.slice(0, EVAL_INPUT_CAP - EVAL_TAIL_KEEP) +
    '\n\n[middle of the article omitted for length — the true ENDING follows; do not judge completeness from the omission]\n\n' +
    text.slice(-EVAL_TAIL_KEEP)
  )
}

/** Gemini 3.1 Pro evaluation — returns the reviewer's prose verdict. */
export async function evaluateArticleQuality(
  articleHtml: string,
): Promise<{ text: string; cost: number; tokens: number }> {
  const text = prepareEvalText(articleHtml)
  // The evaluator must know today's date: without it, models with older
  // knowledge cutoffs flag legitimately recent statistics (e.g. "2025 data"
  // read in 2026) as unverifiable "future-dated" claims — observed on the
  // Azavea pilot v3, which needs_review'd twice on exactly this.
  const today = new Date().toISOString().slice(0, 10)
  const res = await getLLMAdapter('gemini').call({
    model: GEMINI_MODEL,
    systemPrompt: EVAL_SYSTEM,
    userPrompt: `Today's date: ${today}. Statistics dated in recent years up to today are NOT future-dated.\n\nEvaluate this article:\n\n${text}`,
    temperature: 0.2,
    maxTokens: 1200,
  })
  return { text: res.content, cost: res.cost, tokens: res.tokens.total }
}

/**
 * Parse the GPT-4o-mini judge JSON into a typed verdict. Pure + defensive:
 * unparseable / unknown output is treated as "revise" (conservative — it routes
 * to a rewrite and, after retries, to human review; it never silently ships).
 */
export function parseVerdict(raw: string, geminiSummary: string): QualityVerdict {
  const fallback: QualityVerdict = {
    verdict: 'revise',
    severity: 'major',
    reasons: ['Could not parse the quality judge output.'],
    geminiSummary,
  }
  if (!raw?.trim()) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return fallback
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return fallback
    }
  }

  const obj = parsed as Record<string, unknown>
  const v = String(obj.verdict ?? '').toLowerCase()
  const verdict: Verdict = v === 'pass' || v === 'revise' || v === 'fail' ? (v as Verdict) : 'revise'
  const sevRaw = String(obj.severity ?? '').toLowerCase()
  const severity = sevRaw === 'none' || sevRaw === 'minor' || sevRaw === 'major'
    ? (sevRaw as QualityVerdict['severity'])
    : verdict === 'pass'
      ? 'none'
      : 'major'
  const reasons = Array.isArray(obj.reasons)
    ? obj.reasons.map((r) => String(r)).filter(Boolean).slice(0, 10)
    : []

  // Enforce the judge's own rubric deterministically: "minor suggestions must
  // NOT cause a failure". Judges occasionally return revise+minor anyway
  // (observed: Azavea pilot v5, "formatting" — cost a full-body rewrite
  // cycle for a non-substantive nit). Only severity 'major' may trigger the
  // rewrite path; 'fail' verdicts are never coerced.
  if (verdict === 'revise' && severity === 'minor') {
    return { verdict: 'pass', severity: 'minor', reasons, geminiSummary }
  }

  return { verdict, severity, reasons, geminiSummary }
}

/** GPT-4o-mini structured judgment of the Gemini evaluation. */
export async function judgeQualityVerdict(geminiText: string): Promise<QualityVerdict> {
  const res = await getLLMAdapter('openai').call({
    model: JUDGE_MODEL,
    systemPrompt: JUDGE_SYSTEM,
    userPrompt: geminiText,
    temperature: 0,
    jsonMode: true,
    maxTokens: 500,
  })
  return parseVerdict(res.content, geminiText)
}

export interface SchemaValidationResult {
  ok: boolean
  errors: string[]
}

/**
 * Deterministic JSON-LD validation for the article schema markup. Checks the
 * essentials Google needs for an Article rich result: valid JSON, schema.org
 * @context, an @type, and a non-empty headline on the article node. Lenient —
 * non-fatal in the pipeline (rebuild once, else log/flag).
 */
export function validateSchemaJsonLd(schema: unknown): SchemaValidationResult {
  const errors: string[] = []
  let obj: Record<string, unknown>
  try {
    obj = typeof schema === 'string' ? JSON.parse(schema) : (schema as Record<string, unknown>)
  } catch {
    return { ok: false, errors: ['Schema is not valid JSON.'] }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Schema is empty or not an object.'] }

  const ctx = JSON.stringify(obj['@context'] ?? '')
  if (!ctx.toLowerCase().includes('schema.org')) errors.push('Missing or invalid @context (expected schema.org).')

  // Collect candidate nodes (single object or @graph array).
  const graph = obj['@graph']
  const nodes: Array<Record<string, unknown>> = Array.isArray(graph)
    ? (graph as Array<Record<string, unknown>>)
    : [obj]

  if (!nodes.some((n) => n && n['@type'])) errors.push('No node has an @type.')

  const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'MedicalWebPage', 'WebPage']
  const articleNode = nodes.find((n) => {
    const t = JSON.stringify(n?.['@type'] ?? '')
    return ARTICLE_TYPES.some((at) => t.includes(at))
  })
  if (articleNode) {
    const headline = articleNode.headline ?? articleNode.name
    if (!headline || !String(headline).trim()) errors.push('Article node is missing a headline.')
  }

  return { ok: errors.length === 0, errors }
}

const REWRITE_SYSTEM = `You are an expert editor. Revise the article to fix the specified issues while preserving its meaning, structure, formatting, and any existing hyperlinks/citations. Return ONLY the full corrected article in the SAME format (HTML if given HTML), with no preamble or commentary.`

/**
 * Regenerate the Phase A body addressing the verdict's reasons, overwriting the
 * step-11 (body) output in place. Best-effort improvement before re-gating.
 */
export async function rewriteArticleBody(jobId: string, reasons: string[]): Promise<boolean> {
  const bodyStep =
    (await prisma.pipelineStep.findFirst({ where: { jobId, stepNumber: 11 } })) ??
    (await prisma.pipelineStep.findFirst({ where: { jobId, stepNumber: 9 } }))
  if (!bodyStep?.output) {
    logger.warn({ jobId, }, '[quality-gate] no body step to rewrite')
    return false
  }

  const provider = bodyStep.provider || 'gemini'
  const model = bodyStep.model || GEMINI_MODEL

  // The rewrite must not strip the account's voice or editorial rules
  // (observed on the Azavea pilot: a generic rewrite flattened the house
  // style and dropped the single product mention).
  const job = await prisma.articleJob.findUnique({ where: { id: jobId }, select: { userId: true } })
  const settings = job?.userId
    ? await prisma.settings.findUnique({ where: { userId: job.userId }, select: { writingStyle: true } })
    : null
  const voiceBlock = settings?.writingStyle?.trim()
    ? `\n\nHOUSE WRITING VOICE — the revised article must keep this voice exactly:\n${settings.writingStyle.trim()}`
    : ''

  const issues = reasons.length ? reasons.map((r) => `- ${r}`).join('\n') : '- Improve overall depth, accuracy, and helpfulness.'
  try {
    const res = await getLLMAdapter(provider).call({
      model,
      systemPrompt: REWRITE_SYSTEM,
      userPrompt: `Issues to fix:\n${issues}${voiceBlock}\n\nAdditional rules:\n- Preserve the article's voice, register, and rhetorical style — fix ONLY the listed issues.\n- If the article mentions the publisher's product or company, keep exactly the same mentions (same count, similar placement). Never add promotional content; never remove an existing single product mention.\n- Never use em-dashes; use commas, colons, or separate sentences.\n\nArticle:\n${bodyStep.output}`,
      temperature: 0.4,
      maxTokens: 8000,
    })
    let revised = res.content?.trim()
    if (!revised) return false

    // Same de-AI dash pass the executor applies to prose steps — the rewrite
    // regenerates the body AFTER that pass ran, so it must re-run here.
    try {
      const s = await sanitizeDashes(revised, { jobId, stepNumber: bodyStep.stepNumber })
      if (s.changed) {
        revised = s.text
        logger.info({ jobId, llmCalls: s.llmCalls, kept: s.kept }, '[quality-gate] rewrite dash-sanitized')
      }
    } catch (err) {
      logger.warn({ jobId, err }, '[quality-gate] rewrite dash sanitize failed — output kept as-is')
    }

    await prisma.pipelineStep.update({
      where: { id: bodyStep.id },
      data: { output: revised },
    })
    logger.info({ jobId, stepNumber: bodyStep.stepNumber }, '[quality-gate] body rewritten')
    return true
  } catch (err) {
    logger.error({ jobId, err }, '[quality-gate] rewrite failed')
    return false
  }
}

/** Read the Phase A body HTML for evaluation (step 11, fallback step 9). */
export async function getArticleBodyHtml(jobId: string): Promise<string | null> {
  const step =
    (await prisma.pipelineStep.findFirst({ where: { jobId, stepNumber: 11 } })) ??
    (await prisma.pipelineStep.findFirst({ where: { jobId, stepNumber: 9 } }))
  return step?.output ?? null
}

/** Run evaluation + judgment for a job's body. Throws on LLM failure. */
export async function runQualityCheck(jobId: string): Promise<QualityVerdict> {
  const body = await getArticleBodyHtml(jobId)
  if (!body) throw new Error(`No article body found for job ${jobId}`)
  const evaluation = await evaluateArticleQuality(body)
  const verdict = await judgeQualityVerdict(evaluation.text)
  return verdict
}
