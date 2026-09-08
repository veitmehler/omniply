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

// The frame budget is measured in CHARACTERS/lines, not words (the model
// cannot count words reliably — gating there rejected half its natural
// output, 2026-09-08). Cap = rendered line "Label: short" length.
const MAX_LINE_CHARS = 110 // back-solved from the base-26 fit budget: 5 bullets x 3 wrapped lines

// ── Fit estimator ─────────────────────────────────────────────────────────
// Mirrors overlayBulletsOnVideo's layout math on the canonical 704×1248
// Seedance frame, evaluated at the MID font (base 30) so the real overlay
// always lands above its 24 floor. Approximate by design; the overlay's own
// auto-fit remains the authority at render time.
const FRAME_W = 704
const FRAME_H = 1248
const SCALE = FRAME_H / 1080
const USABLE_W = FRAME_W * 0.84
const MAX_BLOCK_H = FRAME_H * 0.88
const TARGET_BASE = 26 // ~30px rendered; the base-30 target demanded <90-char lines while the gate allowed 120 (2026-09-08)
const BULLET_FS = TARGET_BASE * SCALE
const BULLET_LH = TARGET_BASE * 1.44 * SCALE
const BULLET_CHARS = Math.floor(USABLE_W / (BULLET_FS * 0.52))
const HEAD_FS = TARGET_BASE * 1.35 * SCALE
const HEAD_LH = TARGET_BASE * 1.35 * 1.3 * SCALE
const HEAD_CHARS = Math.floor(USABLE_W / (HEAD_FS * 0.55))

/** True when headline + lines fit the frame at the mid font. Exported for tests. */
export function estimateFits(headline: string, lines: string[]): boolean {
  const headLines = Math.min(3, Math.ceil(headline.length / HEAD_CHARS))
  const textLines = lines.reduce((n, l) => n + Math.ceil(l.length / BULLET_CHARS), 0)
  const gaps = Math.max(0, lines.length - 1)
  const totalH = headLines * HEAD_LH + BULLET_LH * 1.2 + textLines * BULLET_LH + gaps * BULLET_LH
  return totalH <= MAX_BLOCK_H
}

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
export function gateShortTakeaway(
  full: KtBullet,
  candidate: { label?: string; short?: string },
): { short: string } | { reason: string } {
  const short = candidate.short?.replace(/\s+/g, ' ').trim() ?? ''
  if (!short) return { reason: 'empty' }
  if ((candidate.label ?? '').replace(/\s+/g, ' ').trim() !== full.label) {
    return { reason: `label must be exactly "${full.label}"` }
  }
  const lineLen = full.label.length + 2 + short.length
  if (lineLen > MAX_LINE_CHARS) {
    return { reason: `too long: ${lineLen} chars incl. label, max ${MAX_LINE_CHARS} — cut a clause` }
  }
  const fullNorm = full.text.replace(/,/g, '')
  for (const tok of short.match(DIGIT_TOKEN_RX) ?? []) {
    if (!fullNorm.includes(tok.replace(/,/g, ''))) {
      return { reason: `number ${tok} does not appear in the source bullet — copy numbers exactly or omit them` }
    }
  }
  return { short }
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
  'RULES per bullet: ONE declarative statement, at most 90 CHARACTERS after the label. ' +
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
    const callJson = async (userPrompt: string): Promise<{ headline?: string; bullets?: unknown[] }> => {
      const run = await adapter.call({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.3,
        maxTokens: 1500,
      })
      await recordLLMUsage(opts.userId, 'kt_short_takeaways', run)
      const cleaned = run.content.replace(/```(?:json)?/g, '').trim()
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      return start !== -1 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : {}
    }

    // Initial attempt over the full set.
    const parsed = await callJson(JSON.stringify(bullets))
    const candidates = Array.isArray(parsed.bullets) ? parsed.bullets : []
    const shorts: (string | null)[] = bullets.map((_, i) => null)
    const failReasons: (string | null)[] = bullets.map(() => null)
    bullets.forEach((full, i) => {
      const gated = gateShortTakeaway(full, (candidates[i] ?? {}) as { label?: string; short?: string })
      if ('short' in gated) shorts[i] = gated.short
      else failReasons[i] = gated.reason
    })

    // Per-bullet REPAIR rounds with explicit feedback (blind whole-set
    // rerolls sampled the same failures — 2026-09-08). Also used to shorten
    // the longest bullets when the set fails the FIT estimate.
    const lineOf = (i: number) =>
      bullets[i].label ? `${bullets[i].label}: ${shorts[i] ?? ''}` : (shorts[i] ?? '')
    for (let round = 0; round < 3; round++) {
      let targets = bullets.map((_, i) => i).filter((i) => shorts[i] === null)
      if (targets.length === 0) {
        const assembled = bullets.map((_, i) => lineOf(i))
        const headlineNow = gateHeadline(parsed.headline) ?? fallbackHeadline
        if (estimateFits(headlineNow, assembled)) break
        // Fit repair: shrink the longest gated line further.
        const longest = bullets.map((_, i) => i).sort((a, b) => lineOf(b).length - lineOf(a).length)[0]
        failReasons[longest] = `still too long for the frame at ${lineOf(longest).length} chars — compress to at most 85 characters after the label`
        shorts[longest] = null
        targets = [longest]
      }
      const repairPayload = targets.map((i) => ({
        label: bullets[i].label,
        source_bullet: bullets[i].text,
        your_failed_attempt: (candidates[i] as { short?: string } | undefined)?.short ?? null,
        failure_reason: failReasons[i],
      }))
      const repair = await callJson(
        'REPAIR these failed compressions. Fix EXACTLY what failure_reason says, change nothing else about your approach. ' +
          'Output ONLY JSON: {"bullets": [{"label": "...", "short": "..."}, ...]} in input order.\n' +
          JSON.stringify(repairPayload),
      ).catch(() => ({}) as { bullets?: unknown[] })
      const repaired = Array.isArray(repair.bullets) ? repair.bullets : []
      targets.forEach((bulletIdx, j) => {
        const gated = gateShortTakeaway(bullets[bulletIdx], (repaired[j] ?? {}) as { label?: string; short?: string })
        if ('short' in gated) {
          shorts[bulletIdx] = gated.short
          failReasons[bulletIdx] = null
        } else {
          failReasons[bulletIdx] = gated.reason
        }
      })
    }

    const headline = gateHeadline(parsed.headline) ?? fallbackHeadline
    const missing = shorts.filter((s) => s === null).length
    const lines = bullets.map((_, i) => lineOf(i).replace(/\s*[—–]\s*/g, ', '))
    if (missing > 0 || !estimateFits(headline, lines)) {
      // Clean degrade: NO hybrid frames (one full-text monster among shorts
      // wrecked the layout repeatedly). Whole set falls back to the known
      // full-verbatim video; not cached, so the next regen retries.
      logger.warn(
        { ...opts.logCtx, missing, fits: estimateFits(headline, lines), reasons: failReasons.filter(Boolean) },
        '[kt-short] could not converge — full verbatim fallback, not cached',
      )
      return null
    }
    const result: ShortTakeaways = { headline, lines }
    await prisma.sitePage.update({ where: { id: page.id }, data: { keyTakeawaysShortJson: result as unknown as object } })
    logger.info({ ...opts.logCtx, bullets: bullets.length, headline }, '[kt-short] short takeaways derived + cached')
    return result
  } catch (err) {
    logger.warn({ ...opts.logCtx, err }, '[kt-short] derivation failed — video falls back to full verbatim takeaways')
    return null
  }
}
