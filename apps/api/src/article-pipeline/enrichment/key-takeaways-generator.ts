import { getLLMAdapter } from '../llm/factory'
import { cleanTextOutput } from '../output-cleaner'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { loadPromptTemplate } from './prompt-template'
import { withGeoRetry } from './geo-retry'
import { logger } from '../../lib/logger'

// In-code fallbacks mirror packages/db/prisma/article-writer-prompts.ts
// (KEY_TAKEAWAYS_*); the DB row (step 107) is what runs in practice.
const DEF_SYS =
  "You write the recap block that sits above a practitioner's article, in the practitioner's own voice. A reader who reads only this block leaves knowing what the author actually thinks about the subject and what to do about it. NUMBERS RULE: figures may ONLY be copied verbatim from the article. NEVER compute, sum, derive, or estimate a figure; if the article states a total, use that total; if it states none, present the point without one."

const DEF_USER = `Write the recap for the article below.

Article HTML:
{{bodyHtml}}

Primary keyword: {{primaryKeyword}}

What the recap does for the reader: each point is one complete thought the author would say across the desk, a judgment call from the article rather than a topic it covers, phrased so a reader could repeat it to a friend. Points are short, a single line each, and carry at most one figure. They carry no study names, no years, no source language, and no words about the article itself; the author speaks, nothing summarises the author.

Three to five points. Respond with ONLY the HTML list (<ul> with <li> items), no heading, no explanation.`

const MAX_HTML = 30_000

const PROSE_OVERRIDE = `

FORMAT (replaces the list format above): no list. Write ONE paragraph of two or three sentences giving the author's bottom line in the author's voice, each sentence following the same rules as a point above. Respond with ONLY the paragraph wrapped in <p>…</p>.`

/**
 * Form gate (consolidation round 2026-11-09, Veit): the recap is for readers,
 * so it is kept on every article, but its shape is enforced in code rather
 * than described at length in the prompt. A point fails when it is long,
 * carries more than one figure, names a study, year or source, or talks about
 * the article itself.
 */
export const TAKEAWAY_MAX_WORDS = 22
export const TAKEAWAY_MAX_NUMBERS = 1

const SOURCE_WORDS_RE = /\b(study|studies|trial|trials|review|meta-analysis|researchers?|et al|journal|published|according to|research (shows|suggests|found))\b/i
const YEAR_RE = /\b(19|20)\d\d\b/
const META_RE = /\b(this|the) (article|guide|piece|post|section|recap)\b/i

export function takeawayIssue(plain: string): string | null {
  const text = plain.replace(/\s+/g, ' ').trim()
  if (!text) return 'empty'
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount > TAKEAWAY_MAX_WORDS) return `long (${wordCount} words)`
  const nums = text.match(/\d+(?:[.,]\d+)?(?:\s?(?:%|percent|per cent))?/g) ?? []
  if (nums.length > TAKEAWAY_MAX_NUMBERS) return `numbers (${nums.length})`
  if (YEAR_RE.test(text)) return 'year'
  if (SOURCE_WORDS_RE.test(text)) return 'source language'
  if (META_RE.test(text)) return 'article self-reference'
  return null
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

/** Split a list or paragraph into its points (li inner HTML, or sentences). */
export function splitPoints(html: string, prose: boolean): string[] {
  if (!prose) return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim())
  const inner = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? html).trim()
  return stripTags(inner)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function gateTakeaways(html: string, prose: boolean): { html: string; dropped: string[]; issues: string[] } {
  const points = splitPoints(html, prose)
  const issues = points.map((p) => takeawayIssue(stripTags(p)))
  const bad = issues.filter((i): i is string => i !== null)
  if (bad.length === 0) return { html, dropped: [], issues: [] }
  if (prose) {
    // A paragraph is one unit: drop failing sentences when at least two survive.
    const keep = points.filter((_, i) => issues[i] === null)
    if (keep.length >= 2) return { html: `<p>${keep.join(' ')}</p>`, dropped: points.filter((_, i) => issues[i] !== null), issues: bad }
    return { html, dropped: [], issues: bad }
  }
  const keep = points.filter((_, i) => issues[i] === null)
  if (keep.length >= 3) {
    return { html: `<ul>\n${keep.map((k) => `  <li>${k}</li>`).join('\n')}\n</ul>`, dropped: points.filter((_, i) => issues[i] !== null), issues: bad }
  }
  return { html, dropped: [], issues: bad }
}

export async function generateKeyTakeaways(opts: {
  bodyHtml: string
  primaryKeyword: string
  jobId: string
  /** 'bullets' (default, the classic list) or 'prose' (a short-version paragraph). */
  style?: 'bullets' | 'prose'
}): Promise<{
  sectionHtml: string
  inputTokens: number
  outputTokens: number
  cost: number
}> {
  const t = await loadPromptTemplate(107)
  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const prose = opts.style === 'prose'
  const baseUserPrompt = (t?.userPrompt ?? DEF_USER)
    .replace(/\{\{bodyHtml\}\}/g, opts.bodyHtml.slice(0, MAX_HTML))
    .replace(/\{\{primaryKeyword\}\}/g, opts.primaryKeyword || '')
    + (prose ? PROSE_OVERRIDE : '')

  const adapter = getLLMAdapter(provider)
  let inputTokens = 0
  let outputTokens = 0
  let cost = 0

  const callOnce = async (userPrompt: string, attempt: number, asProse: boolean = prose) => {
    // 1536, not 512: B7 shipped a Key Takeaways bullet hard-truncated
    // mid-sentence ("…interrupts creep before") because dense, citation-rich
    // bullets alone can exceed 512 tokens.
    const run = await withGeoRetry(`geo_key_takeaways_${opts.jobId}_${attempt}`, () =>
      adapter.call({
        systemPrompt: t?.systemPrompt ?? DEF_SYS,
        userPrompt,
        model,
        temperature: 0.35,
        maxTokens: 1536,
      }),
    )
    inputTokens += run.tokens.input
    outputTokens += run.tokens.output
    cost += run.cost
    let listInner = await sanitizeDashesText(
      cleanTextOutput(run.content).trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, ''),
      { jobId: opts.jobId, surface: 'key_takeaways' },
    )
    // Completeness guard: a truncated output is worse than a shorter complete
    // one. Drop any unterminated trailing <li>, and ensure the list closes.
    if (!asProse && listInner.includes('<ul')) {
      if (!/<\/ul>\s*$/i.test(listInner)) {
        const lastClose = listInner.lastIndexOf('</li>')
        listInner = lastClose >= 0 ? listInner.slice(0, lastClose + 5) + '\n</ul>' : listInner + '</ul>'
      }
    } else if (asProse && !/[.!?]\s*(?:<\/p>)?\s*$/.test(listInner)) {
      const lastEnd = Math.max(listInner.lastIndexOf('. '), listInner.lastIndexOf('.</'))
      if (lastEnd > 40) listInner = listInner.slice(0, lastEnd + 1) + (listInner.includes('<p') ? '</p>' : '')
    }
    return listInner
  }

  let listInner = await callOnce(baseUserPrompt, 1)
  let gate = gateTakeaways(listInner, prose)
  let usedProse = prose
  if (gate.issues.length > 0) {
    // One retry with the specific failures named; then the deterministic drop.
    const feedback =
      `\n\nYour previous attempt had these problems, one per point: ${gate.issues.join('; ')}. ` +
      `Each point stays under ${TAKEAWAY_MAX_WORDS} words, carries at most one figure, and names no study, year, or source.`
    const second = await callOnce(baseUserPrompt + feedback, 2)
    const secondGate = gateTakeaways(second, prose)
    if (secondGate.issues.length < gate.issues.length || secondGate.issues.length === 0) {
      listInner = second
      gate = secondGate
    }
    logger.info(
      { jobId: opts.jobId, prose, firstIssues: gate.issues, secondIssues: secondGate.issues, dropped: gate.dropped.length },
      '[key-takeaways] form gate applied',
    )
    listInner = gate.html
    // B16: the prose variant cannot be trimmed below two sentences; when it fails
    // twice, fall back to the bullets variant deterministically.
    if (prose && gate.issues.length > 0) {
      const bulletsPrompt = (t?.userPrompt ?? DEF_USER)
        .replace(/\{\{bodyHtml\}\}/g, opts.bodyHtml.slice(0, MAX_HTML))
        .replace(/\{\{primaryKeyword\}\}/g, opts.primaryKeyword || '')
      const bullets = await callOnce(bulletsPrompt, 3, false)
      const bGate = gateTakeaways(bullets, false)
      listInner = bGate.html
      usedProse = false
      logger.info({ jobId: opts.jobId, issues: bGate.issues, dropped: bGate.dropped.length }, '[key-takeaways] prose failed twice, fell back to bullets')
    }
  }

  const sectionHtml = usedProse
    ? `<section class="key-takeaways" aria-label="Summary">\n<h2 id="key-takeaways-heading">The short version</h2>\n${listInner}\n</section>`
    : `<section class="key-takeaways" aria-label="Summary">\n<h2 id="key-takeaways-heading">Key Takeaways</h2>\n${listInner}\n</section>`

  return { sectionHtml, inputTokens, outputTokens, cost }
}
