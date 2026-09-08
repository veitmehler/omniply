/**
 * Frame-length Key Takeaways for the KT music video (user decision 2026-09-08).
 *
 * The article page and the post CAPTION keep the full takeaways VERBATIM —
 * quality is untouched by construction. The video FRAME gets one compressed
 * statement per takeaway so all of them fit ONE 7s loop-bait screen at a
 * readable size (the full set at ~190 words sat at the font floor and
 * ellipsis-truncated).
 *
 * Correctness model (the paraphrase-drift risk that created the old
 * "verbatim or nothing" rule): the LLM compresses WITH the full bullet in
 * hand, then a DETERMINISTIC gate enforces per bullet — label byte-identical,
 * every digit token in the short form present verbatim in its full sibling,
 * no new digits, word cap. Gate failure falls back to that bullet's full
 * verbatim text. Human review of the post remains the final layer.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { getLLMAdapter } from '../../article-pipeline/llm/factory'
import { recordLLMUsage } from '../../lib/llm-usage'

const MAX_SHORT_WORDS = 20

export interface KtBullet {
  label: string
  text: string
}

/** Parse `<li><b>Label</b>: text</li>` bullets from the stored KT HTML. */
export function parseKtBullets(keyTakeawaysHtml: string): KtBullet[] {
  const bullets: KtBullet[] = []
  for (const m of keyTakeawaysHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const inner = m[1]
    const label = /<b>([\s\S]*?)<\/b>/.exec(inner)?.[1]?.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim() ?? ''
    const text = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) bullets.push({ label, text })
  }
  return bullets
}

const DIGIT_TOKEN_RX = /\$?\d[\d,]*(?:\.\d+)?%?/g

/**
 * Deterministic gate: label byte-identical, digit tokens a subset of the
 * full bullet's, word cap respected. Returns null when the short form is
 * unsafe (caller falls back to the full text).
 */
export function gateShortTakeaway(full: KtBullet, candidate: { label?: string; short?: string }): string | null {
  const short = candidate.short?.replace(/\s+/g, ' ').trim() ?? ''
  if (!short) return null
  if ((candidate.label ?? '').replace(/\s+/g, ' ').trim() !== full.label) return null
  if (short.split(/\s+/).length > MAX_SHORT_WORDS) return null
  const fullNorm = full.text.replace(/,/g, '')
  for (const tok of short.match(DIGIT_TOKEN_RX) ?? []) {
    if (!fullNorm.includes(tok.replace(/,/g, ''))) return null
  }
  return short
}

const SYSTEM_PROMPT =
  'You compress Key Takeaways bullets into single short statements for a video frame. ' +
  'RULES per bullet: ONE declarative statement, at most 15 words after the label. ' +
  'Compress by DROPPING secondary clauses and qualifiers-of-context, NEVER by shortening the main claim: ' +
  'the subject, verb, object, and any qualifier that scopes the claim must survive intact. ' +
  'Keep AT MOST one number, copied EXACTLY as printed in the source (same digits, same $ and % signs); write every number as numerals, never as words. ' +
  'Never introduce a number, name, or entity that is not in the source bullet. ' +
  'Return the label byte-identical to the input label. ' +
  'No em-dashes. Output ONLY a JSON array: [{"label": "...", "short": "..."}, ...] in input order.'

/**
 * Return frame-ready lines ("Label: short statement"), deriving and caching
 * them on the SitePage the first time. Null → caller uses the full text.
 */
export async function ensureShortTakeaways(opts: {
  jobId: string
  userId: string
  logCtx: Record<string, unknown>
}): Promise<string[] | null> {
  const page = await prisma.sitePage.findFirst({
    where: { jobId: opts.jobId },
    select: { id: true, keyTakeawaysHtml: true, keyTakeawaysShortJson: true },
  })
  if (!page?.keyTakeawaysHtml) {
    logger.warn({ ...opts.logCtx }, '[kt-short] no page or takeaways HTML for jobId — full verbatim fallback')
    return null
  }
  if (Array.isArray(page.keyTakeawaysShortJson) && page.keyTakeawaysShortJson.length > 0) {
    return page.keyTakeawaysShortJson as string[]
  }

  const bullets = parseKtBullets(page.keyTakeawaysHtml)
  if (bullets.length === 0) return null

  try {
    const adapter = getLLMAdapter('anthropic')
    const run = await adapter.call({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify(bullets),
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.2,
      maxTokens: 1500,
    })
    await recordLLMUsage(opts.userId, 'kt_short_takeaways', run)
    const cleaned = run.content.replace(/```(?:json)?/g, '').trim()
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    const parsed = start !== -1 && end > start ? (JSON.parse(cleaned.slice(start, end + 1)) as unknown[]) : []

    let fallbacks = 0
    const lines = bullets.map((full, i) => {
      const gated = gateShortTakeaway(full, (parsed[i] ?? {}) as { label?: string; short?: string })
      if (!gated) {
        fallbacks++
        return full.label ? `${full.label}: ${full.text.replace(new RegExp(`^${full.label}\\s*:\\s*`), '')}` : full.text
      }
      const clean = gated.replace(/\s*[—–]\s*/g, ', ')
      return full.label ? `${full.label}: ${clean}` : clean
    })
    if (fallbacks > 0) {
      logger.warn({ ...opts.logCtx, fallbacks, bullets: bullets.length }, '[kt-short] gate rejected candidates — full text used for those bullets')
    }
    await prisma.sitePage.update({ where: { id: page.id }, data: { keyTakeawaysShortJson: lines } })
    logger.info({ ...opts.logCtx, bullets: bullets.length, fallbacks }, '[kt-short] short takeaways derived + cached')
    return lines
  } catch (err) {
    logger.warn({ ...opts.logCtx, err }, '[kt-short] derivation failed — video falls back to full verbatim takeaways')
    return null
  }
}
