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

const BANNED_HEADLINE_RX = /you won'?t believe|shocking|this one trick|doctors hate/i

/**
 * Gate the curiosity headline: 4–8 words, NO digits (a drifted number in a
 * headline is the worst place for one), no clickbait clichés. Null → caller
 * uses the deterministic count-tease fallback.
 */
export function gateHeadline(candidate: string | undefined): string | null {
  const h = candidate?.replace(/\s+/g, ' ').replace(/\s*[—–]\s*/g, ', ').trim() ?? ''
  if (!h) return null
  const words = h.split(/\s+/).length
  if (words < 4 || words > 8) return null
  if (/\d/.test(h)) return null
  if (BANNED_HEADLINE_RX.test(h)) return null
  return h
}

const SYSTEM_PROMPT =
  'You compress Key Takeaways bullets into single short statements for a video frame. ' +
  'RULES per bullet: ONE declarative statement, at most 15 words after the label. ' +
  'Compress by DROPPING secondary clauses and qualifiers-of-context, NEVER by shortening the main claim: ' +
  'the subject, verb, object, and any qualifier that scopes the claim must survive intact. ' +
  'Keep AT MOST one number, copied EXACTLY as printed in the source (same digits, same $ and % signs); write every number as numerals, never as words. ' +
  'Never introduce a number, name, or entity that is not in the source bullet. ' +
  'Return the label byte-identical to the input label. ' +
  'ALSO write ONE curiosity headline for the whole set: 5-7 words that open a curiosity gap the bullets close. ' +
  'Pick whichever style fits the material best, varying across articles: a question ("What your free guide quietly costs"), a contrarian statement ("Your best content converts nobody"), or a count tease ("Five numbers your practice ignores" — spell the count as a word). ' +
  'Headline rules: NO digits, no clickbait cliches, business pain only, NEVER health-fear (no disease or symptom scare language). ' +
  'No em-dashes anywhere. Output ONLY JSON: {"headline": "...", "bullets": [{"label": "...", "short": "..."}, ...]} with bullets in input order.'

/**
 * Return frame-ready lines ("Label: short statement"), deriving and caching
 * them on the SitePage the first time. Null → caller uses the full text.
 */
export interface ShortTakeaways {
  headline: string
  lines: string[]
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

export async function ensureShortTakeaways(opts: {
  jobId: string
  userId: string
  logCtx: Record<string, unknown>
}): Promise<ShortTakeaways | null> {
  const page = await prisma.sitePage.findFirst({
    where: { jobId: opts.jobId },
    select: { id: true, keyTakeawaysHtml: true, keyTakeawaysShortJson: true },
  })
  if (!page?.keyTakeawaysHtml) {
    logger.warn({ ...opts.logCtx }, '[kt-short] no page or takeaways HTML for jobId — full verbatim fallback')
    return null
  }
  const cached = page.keyTakeawaysShortJson as { headline?: string; lines?: string[] } | unknown[] | null
  // Plain-array caches predate the headline field (2026-09-08) → re-derive.
  if (cached && !Array.isArray(cached) && Array.isArray(cached.lines) && cached.lines.length > 0 && cached.headline) {
    return cached as ShortTakeaways
  }

  const bullets = parseKtBullets(page.keyTakeawaysHtml)
  if (bullets.length === 0) return null
  const fallbackHeadline = `The ${NUMBER_WORDS[bullets.length] ?? bullets.length} takeaways most clinics miss`

  try {
    const adapter = getLLMAdapter('anthropic')
    const run = await adapter.call({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify(bullets),
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.3,
      maxTokens: 1500,
    })
    await recordLLMUsage(opts.userId, 'kt_short_takeaways', run)
    const cleaned = run.content.replace(/```(?:json)?/g, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    const parsed = (start !== -1 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : {}) as {
      headline?: string
      bullets?: unknown[]
    }
    const candidates = Array.isArray(parsed.bullets) ? parsed.bullets : []

    let fallbacks = 0
    const lines = bullets.map((full, i) => {
      const gated = gateShortTakeaway(full, (candidates[i] ?? {}) as { label?: string; short?: string })
      if (!gated) {
        fallbacks++
        return full.label ? `${full.label}: ${full.text.replace(new RegExp(`^${full.label}\\s*:\\s*`), '')}` : full.text
      }
      const clean = gated.replace(/\s*[—–]\s*/g, ', ')
      return full.label ? `${full.label}: ${clean}` : clean
    })
    const headline = gateHeadline(parsed.headline) ?? fallbackHeadline
    if (fallbacks > 0 || headline === fallbackHeadline) {
      logger.warn(
        { ...opts.logCtx, fallbacks, headlineFallback: headline === fallbackHeadline, bullets: bullets.length },
        '[kt-short] gate rejected candidates — fallbacks used',
      )
    }
    const result: ShortTakeaways = { headline, lines }
    await prisma.sitePage.update({ where: { id: page.id }, data: { keyTakeawaysShortJson: result as unknown as object } })
    logger.info({ ...opts.logCtx, bullets: bullets.length, fallbacks, headline }, '[kt-short] short takeaways derived + cached')
    return result
  } catch (err) {
    logger.warn({ ...opts.logCtx, err }, '[kt-short] derivation failed — video falls back to full verbatim takeaways')
    return null
  }
}
