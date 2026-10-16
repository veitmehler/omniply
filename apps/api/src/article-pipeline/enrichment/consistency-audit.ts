import { getLLMAdapter } from '../llm/factory'
import { loadPromptTemplate } from './prompt-template'
import { recordLLMUsage } from '../../lib/llm-usage'
import { wordTokens } from '../../lib/text/dash-sanitizer'
import { withTimeout } from '../../lib/net/with-timeout'
import { logger } from '../../lib/logger'

/**
 * Consistency audit — enrichment step 20.5
 * (.plans/article-consistency-audit.implementation-plan.md)
 *
 * Runs AFTER GEO summaries + Key Takeaways exist and BEFORE diagrams render,
 * so every downstream surface derives from corrected text and no render is
 * ever stranded. A forensic-auditor LLM call returns anchored find/replace
 * ops; deterministic guards decide each op's fate; rejected ops keep the
 * original text and are persisted for the (Phase 2) client suggestion cards.
 *
 * Born from the 2026-10-15/16 manual sweep: summary numbers diverging from
 * the article's own math ($54k vs $27k, $22k geo-summary vs $39k body),
 * mis-applied legal instruments (False Claims Act for advertising), stat-verb
 * drift (Oldroyd qualify→convert), and uncited precision benchmarks.
 *
 * NEVER blocks enrichment: any failure returns the inputs untouched.
 * Kill-switch: CONSISTENCY_AUDIT_ENABLED=0.
 */

export const AUDIT_PROMPT_STEP = 111
const MAX_OPS = 10
const MAX_TOKEN_EDITS = 12
const AUDIT_DEADLINE_MS = 4 * 60 * 1000
const MAX_SURFACE_CHARS = 150_000

export type AuditSurface = 'title' | 'excerpt' | 'intro' | 'keyTakeaways' | 'body'

export interface AuditOp {
  surface: AuditSurface
  find: string
  replace: string
  /** One sentence, client-readable. */
  reason: string
  /** Bare arithmetic expression; REQUIRED when `replace` changes a number. */
  math?: string
  /** Set by the guard chain on rejection. */
  rejectedBecause?: string
}

export interface AuditResult {
  title: string
  excerpt: string | null
  introHtml: string
  keyTakeawaysHtml: string | null
  bodyHtml: string
  applied: AuditOp[]
  rejected: AuditOp[]
  cost: number
  inputTokens: number
  outputTokens: number
}

// ── Figure extraction (deterministic) ────────────────────────────────────────

const FIGURE_RX =
  /\$[\d][\d,]*(?:\.\d+)?(?:\s?(?:billion|million|[KkMm])\b)?|\b\d[\d,]*(?:\.\d+)?%|\b\d[\d,]*(?:\.\d+)?\s?(?:x|times)\b|\b\d[\d,]*(?:\.\d+)?\s(?:to|-)\s\d[\d,]*(?:\.\d+)?\b/g

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Raw figure strings found in a text (tags stripped). */
export function listFigures(html: string, cap = 120): string[] {
  const text = stripTags(html)
  const out: string[] = []
  let m: RegExpExecArray | null
  const rx = new RegExp(FIGURE_RX.source, 'g')
  while ((m = rx.exec(text)) !== null && out.length < cap) out.push(m[0])
  return out
}

/** Labeled inventory of every figure in a surface, each with local context. */
export function extractFigures(surface: string, html: string): string[] {
  const text = stripTags(html)
  const out: string[] = []
  let m: RegExpExecArray | null
  const rx = new RegExp(FIGURE_RX.source, 'g')
  while ((m = rx.exec(text)) !== null && out.length < 80) {
    const start = Math.max(0, m.index - 80)
    const end = Math.min(text.length, m.index + m[0].length + 80)
    out.push(`[${surface}] "${m[0]}" — …${text.slice(start, end).trim()}…`)
  }
  return out
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** Structural fragments an op may never touch or cross. */
const FORBIDDEN_IN_FIND = /<h[1-6]\b|<\/h[1-6]>|<figure\b|href=|<\/?(p|li|ul|ol|div|section|blockquote|table)\b/i

/** Normalized numeric tokens in a string ("$27,000" → 27000, "14.8%" → 14.8). */
export function numericTokens(s: string): number[] {
  const out: number[] = []
  const rx = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(s)) !== null) out.push(Number(m[0].replace(/,/g, '')))
  return out
}

/** Evaluate a bare arithmetic expression; null on anything unsafe/invalid. */
export function safeEvalExpr(expr: string): number | null {
  if (!/^[\d\s+\-*/().,]+$/.test(expr)) return null
  const cleaned = expr.replace(/,/g, '')
  try {
    const v = new Function(`"use strict"; return (${cleaned})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Added+removed word tokens between find and replace (two-pointer alignment). */
export function tokenEditCount(find: string, replace: string): number {
  const a = wordTokens(find)
  const b = wordTokens(replace)
  // LCS length via simple DP (surfaces are sentences — tiny inputs).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const lcs = dp[a.length][b.length]
  return a.length - lcs + (b.length - lcs)
}

/**
 * Guard chain. Returns null when the op may apply, else the rejection reason.
 * `surfaceText` is the raw current content of the op's surface.
 */
export function guardOp(op: AuditOp, surfaceText: string): string | null {
  if (!op.find?.trim() || !op.replace?.trim()) return 'empty find/replace'
  if (op.find === op.replace) return 'no-op'

  // 1. Uniqueness: exactly one occurrence in the surface.
  const first = surfaceText.indexOf(op.find)
  if (first === -1) return 'find-string not present verbatim'
  if (surfaceText.indexOf(op.find, first + 1) !== -1) return 'find-string not unique'

  // 2. Scope: headings, figures, links, block boundaries are out of bounds.
  if (FORBIDDEN_IN_FIND.test(op.find)) return 'find-string touches protected structure'
  if (/href=|<h[1-6]\b|<figure\b/i.test(op.replace)) return 'replace introduces protected structure'

  // 3. Bounded diff: small edits only; no new links/dashes.
  if (/https?:\/\/|www\./i.test(op.replace) && !/https?:\/\/|www\./i.test(op.find)) return 'replace introduces a URL'
  if (/[—–]/.test(op.replace)) return 'replace introduces a dash'
  const edits = tokenEditCount(op.find, op.replace)
  if (edits > MAX_TOKEN_EDITS) return `diff too large (${edits} token edits)`

  // 4. Arithmetic: a number change requires a verifiable expression.
  const beforeNums = numericTokens(op.find)
  const afterNums = numericTokens(op.replace)
  const newNums = afterNums.filter((n) => !beforeNums.includes(n))
  if (newNums.length > 0) {
    if (!op.math?.trim()) return 'number change without math'
    const result = safeEvalExpr(op.math)
    if (result === null) return 'math expression invalid'
    const matches = newNums.some(
      (n) => n === Math.round(result) || Math.abs(n - result) / Math.max(1, Math.abs(result)) < 0.005,
    )
    if (!matches) return `math result ${result} does not match replacement numbers`
  }

  return null
}

/** Apply guard-passed ops; mutate nothing — returns new surface map + op fates. */
export function applyOps(
  surfaces: Record<AuditSurface, string>,
  ops: AuditOp[],
): { surfaces: Record<AuditSurface, string>; applied: AuditOp[]; rejected: AuditOp[] } {
  const out = { ...surfaces }
  const applied: AuditOp[] = []
  const rejected: AuditOp[] = []
  for (const op of ops.slice(0, MAX_OPS)) {
    const target = out[op.surface]
    if (typeof target !== 'string') {
      rejected.push({ ...op, rejectedBecause: `unknown surface ${op.surface}` })
      continue
    }
    const reason = guardOp(op, target)
    if (reason) {
      rejected.push({ ...op, rejectedBecause: reason })
      continue
    }
    out[op.surface] = target.split(op.find).join(op.replace)
    applied.push(op)
  }
  return { surfaces: out, applied, rejected }
}

// ── The audit call ───────────────────────────────────────────────────────────

const AUDIT_SYSTEM =
  'You are a forensic consistency auditor for a finished article. You do NOT judge style, structure, or quality — ' +
  'two other reviewers own that. You check exactly four things, in priority order:\n' +
  '1. ARITHMETIC: every derived figure must recompute from its stated inputs, and every summary surface ' +
  '(title, excerpt, key takeaways, the short answer paragraphs under headings) must agree with the body\'s own math. ' +
  'A summary number the body\'s arithmetic does not support is the single worst defect you can let through.\n' +
  '2. LEGAL INSTRUMENTS: every named law, agency, or case must match its actual function. ' +
  'HHS/OCR enforces PHI privacy, never marketing claims. The FTC and state licensing boards govern advertising. ' +
  'The False Claims Act concerns fraudulent billing to the government, never marketing statements. ' +
  'Guidance is not a mandate. There are no "HIPAA advertising guidelines".\n' +
  '3. STATISTIC FIDELITY: a quoted statistic keeps its source\'s verb and scope ' +
  '(e.g. research about QUALIFYING a lead must not become CONVERTING a lead).\n' +
  '4. UNSUPPORTED PRECISION: an exact benchmark with no named source and no derivation gets softened ' +
  '("up to", "roughly") or de-labeled (drop "conservative" from aggressive assumptions). Never invent a source.\n' +
  'You propose MINIMAL anchored edits. You never rewrite paragraphs, never touch headings, figures, or links, ' +
  'and never change the author\'s voice. Fewer, surer ops beat many speculative ones. ' +
  'Output ONLY a JSON object, no code fences, no commentary.'

function buildAuditUserPrompt(opts: {
  figureTable: string
  title: string
  excerpt: string
  introHtml: string
  keyTakeawaysHtml: string
  bodyHtml: string
}): string {
  return `FIGURE INVENTORY (deterministic extraction; reconcile these first):
${opts.figureTable || '(no figures found)'}

SURFACES (quote find-strings VERBATIM from these, including any HTML tags and entities, exactly as written):

=== title ===
${opts.title}

=== excerpt ===
${opts.excerpt || '(none)'}

=== intro ===
${opts.introHtml || '(none)'}

=== keyTakeaways ===
${opts.keyTakeawaysHtml || '(none)'}

=== body ===
${opts.bodyHtml}

RULES FOR OPS:
- At most ${MAX_OPS} ops. Only propose an op when you are CERTAIN; a clean article returns {"ops": []}.
- "find" must appear EXACTLY ONCE in its surface, copied verbatim (tags, entities, punctuation included). Extend the quote until it is unique.
- "find" must stay inside one paragraph/list item and must not contain headings, <figure>, or href attributes.
- "replace" changes as little as possible: the number, the hedge word, the mis-named instrument, the verb. Never more than a dozen words of difference.
- When "replace" introduces or changes a number, "math" is REQUIRED: a bare arithmetic expression (digits and + - * / ( ) only) whose result IS the new number, derived from figures the article itself states.
- "reason": one plain-language sentence a non-technical practice owner understands.
- When two surfaces disagree, the BODY's derivation wins; fix the summary surface.
- If the body itself states inputs and a wrong total, fix the total to what the inputs compute (show the math).

Return ONLY: {"ops": [{"surface": "...", "find": "...", "replace": "...", "reason": "...", "math": "..."}]}
CRITICAL JSON RULE: inside string values, never use unescaped double quotes — the find/replace strings must be valid JSON strings (escape embedded quotes as \\").`
}

function extractJsonObject(raw: string): { ops?: unknown[] } | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { ops?: unknown[] }
  } catch {
    return null
  }
}

function parseOps(raw: string): AuditOp[] {
  const parsed = extractJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.ops)) return []
  const SURFACES: AuditSurface[] = ['title', 'excerpt', 'intro', 'keyTakeaways', 'body']
  return parsed.ops
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => ({
      surface: SURFACES.includes(o.surface as AuditSurface) ? (o.surface as AuditSurface) : 'body',
      find: typeof o.find === 'string' ? o.find : '',
      replace: typeof o.replace === 'string' ? o.replace : '',
      reason: typeof o.reason === 'string' ? o.reason : '',
      math: typeof o.math === 'string' ? o.math : undefined,
    }))
    .filter((o) => o.find && o.replace)
}

export async function runConsistencyAudit(opts: {
  jobId: string
  userId: string
  title: string
  excerpt: string | null
  introHtml: string
  keyTakeawaysHtml: string | null
  bodyHtml: string
  /** Compute ops + guard verdicts but apply nothing (rollout validation). */
  dryRun?: boolean
}): Promise<AuditResult> {
  const untouched: AuditResult = {
    title: opts.title,
    excerpt: opts.excerpt,
    introHtml: opts.introHtml,
    keyTakeawaysHtml: opts.keyTakeawaysHtml,
    bodyHtml: opts.bodyHtml,
    applied: [],
    rejected: [],
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
  if (process.env.CONSISTENCY_AUDIT_ENABLED === '0') return untouched

  try {
    return await withTimeout(
      async () => {
        const surfaces: Record<AuditSurface, string> = {
          title: opts.title,
          excerpt: opts.excerpt ?? '',
          intro: opts.introHtml,
          keyTakeaways: opts.keyTakeawaysHtml ?? '',
          body: opts.bodyHtml.slice(0, MAX_SURFACE_CHARS),
        }

        const figureTable = (
          [
            ...extractFigures('title', surfaces.title),
            ...extractFigures('excerpt', surfaces.excerpt),
            ...extractFigures('intro', surfaces.intro),
            ...extractFigures('keyTakeaways', surfaces.keyTakeaways),
            ...extractFigures('body', surfaces.body),
          ]
        ).join('\n')

        const t = await loadPromptTemplate(AUDIT_PROMPT_STEP, { userId: opts.userId })
        const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
        const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
        const adapter = getLLMAdapter(provider)

        const run = await adapter.call({
          systemPrompt: t?.systemPrompt ?? AUDIT_SYSTEM,
          userPrompt: buildAuditUserPrompt({
            figureTable,
            title: surfaces.title,
            excerpt: surfaces.excerpt,
            introHtml: surfaces.intro,
            keyTakeawaysHtml: surfaces.keyTakeaways,
            bodyHtml: surfaces.body,
          }),
          model,
          temperature: 0.2,
          maxTokens: 4000,
        })
        await recordLLMUsage(opts.userId, 'consistency_audit', run)

        const ops = parseOps(run.content)
        const { surfaces: patched, applied, rejected } = opts.dryRun
          ? { surfaces, applied: [] as AuditOp[], rejected: ops.map((op) => ({ ...op, rejectedBecause: guardOp(op, surfaces[op.surface] ?? '') ?? 'dry-run (would apply)' })) }
          : applyOps(surfaces, ops)

        logger.info(
          {
            jobId: opts.jobId,
            opsProposed: ops.length,
            opsApplied: applied.length,
            opsRejected: rejected.length,
            rejectedReasons: rejected.map((r) => r.rejectedBecause),
            dryRun: !!opts.dryRun,
          },
          '[consistency-audit] complete',
        )

        return {
          title: patched.title,
          excerpt: opts.excerpt === null && !patched.excerpt ? null : patched.excerpt,
          introHtml: patched.intro,
          keyTakeawaysHtml: opts.keyTakeawaysHtml === null && !patched.keyTakeaways ? null : patched.keyTakeaways,
          bodyHtml: opts.bodyHtml.length > MAX_SURFACE_CHARS
            ? patched.body + opts.bodyHtml.slice(MAX_SURFACE_CHARS)
            : patched.body,
          applied,
          rejected,
          cost: run.cost,
          inputTokens: run.tokens.input,
          outputTokens: run.tokens.output,
        }
      },
      AUDIT_DEADLINE_MS,
      'consistency-audit',
    )
  } catch (err) {
    logger.warn({ jobId: opts.jobId, err }, '[consistency-audit] failed — article continues unaudited')
    return untouched
  }
}
