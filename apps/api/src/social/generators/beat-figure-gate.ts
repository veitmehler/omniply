import { listFigures } from '../../article-pipeline/enrichment/consistency-audit'
import { logger } from '../../lib/logger'
import type { AutomationLogContext } from '../automation/log-context'

/**
 * Arc-beat figure gate (chiro port prerequisite P2,
 * .plans/authority-engine-chiro plan): the story-arc prompt's verbatim-numbers
 * rule demonstrably leaks (~1 unsupported figure per 11 arcs on 2026-10-16 —
 * a "$72,000 annually" neither the audited article nor the beat's own inputs
 * supported). Prompt rules reduce; deterministic gates catch.
 *
 * Every figure in a beat must appear in the allowed corpus (article material,
 * narrator moments, CTA line), tolerant of formatting variants and percent
 * complements (71% is allowed when the corpus states 29%). A sentence carrying
 * an unsupported figure is DROPPED — same philosophy as the slide URL-stripper:
 * losing one sentence beats shipping an invented number in the client's name.
 */

function norm(s: string): string {
  // Suspended hyphens ("a 90- to 100-degree angle") must match the natural
  // phrasing a beat uses ("90 to 100 degrees"), so a digit's trailing hyphen
  // before whitespace is dropped. Attached ranges ("3-5") are untouched.
  return s
    .replace(/(\d)-(\s)/g, '$1$2')
    .replace(/,/g, '')
    .toLowerCase()
}

/** Formatting variants a corpus match may take for one figure. */
function variants(fig: string): string[] {
  const v = new Set<string>([norm(fig)])
  const km = fig.match(/^\$?([\d.]+)\s?[KkMm]$/)
  if (km) {
    const mult = /m$/i.test(fig) ? 1_000_000 : 1000
    const n = Number(km[1]) * mult
    v.add('$' + n)
    v.add(String(n))
  }
  const plain = fig.match(/^\$?([\d]+(?:\.\d+)?)$/)
  if (plain && Number(plain[1]) >= 1000) {
    v.add('$' + plain[1])
    v.add(plain[1])
  }
  if (/\sto\s/.test(fig)) {
    v.add(norm(fig.replace(/\s+to\s+/, '-')))
    v.add(norm(fig.replace(/\s+to\s+/, ' - ')))
  }
  if (/\d-\d/.test(fig)) v.add(norm(fig.replace(/-/, ' to ')))
  if (/x$/i.test(fig)) v.add(norm(fig.replace(/x$/i, ' times')))
  if (/\stimes$/i.test(fig)) v.add(norm(fig.replace(/\s+times$/i, 'x')))
  return [...v]
}

export interface AllowedFigureCorpus {
  allows(fig: string): boolean
}

/** Build the allowed-figure matcher from the arc's source texts. */
export function buildFigureCorpus(sources: Array<string | null | undefined>): AllowedFigureCorpus {
  const corpus = norm(sources.filter(Boolean).join('\n'))
  // Percent complements: corpus "29%" additionally allows "71%".
  const complements = new Set<string>()
  for (const m of corpus.matchAll(/(\d{1,2}(?:\.\d+)?)%/g)) {
    const p = Number(m[1])
    if (p > 0 && p < 100) {
      const c = 100 - p
      complements.add((Number.isInteger(c) ? String(c) : c.toFixed(1).replace(/\.0$/, '')) + '%')
    }
  }
  // Range endpoints: in "15–25%" / "15 to 25 percent" the unit attaches only
  // to the second number, so a beat's "15%" finds no substring. Both
  // endpoints of a percent range are allowed percents.
  for (const m of corpus.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/g)) {
    complements.add(m[1] + '%')
    complements.add(m[2] + '%')
  }
  return {
    allows(fig: string): boolean {
      if (variants(fig).some((v) => corpus.includes(v))) return true
      const pct = fig.match(/^(\d{1,3}(?:\.\d+)?)%$/)
      if (pct && complements.has(norm(fig))) return true
      return false
    },
  }
}

/** Figures in `text` that the corpus does not support. */
export function findUnsupportedFigures(text: string, corpus: AllowedFigureCorpus): string[] {
  if (!/\d/.test(text)) return []
  return listFigures(text).filter((f) => !corpus.allows(f))
}

/** Serialized-arc open-loop markers (the cliffhanger grammar). */
export const LOOP_MARKER_RX = /\b(Tonight|Tomorrow(\s+morning)?|Part 2)\b/i

/** Deterministic, label-correct teaser when a gate drop broke the open loop
 *  (morning beats tease tonight; evening beats tease tomorrow — mirrors
 *  fixLoopLabel's parity). */
export function fallbackLoopLine(beatIdx: number): string {
  return beatIdx % 2 === 0 ? 'Part 2 tonight.' : 'Tomorrow morning: part 2.'
}

/** Drop sentences containing unsupported figures; returns the cleaned text. */
export function stripUnsupportedFigureSentences(
  text: string,
  corpus: AllowedFigureCorpus,
  logCtx: AutomationLogContext,
  surface: string,
): string {
  if (!/\d/.test(text)) return text
  const cleaned = text
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((seg) => {
          const bad = listFigures(seg).filter((f) => !corpus.allows(f))
          if (bad.length) {
            logger.warn(
              { ...logCtx, surface, dropped: seg.slice(0, 120), figures: bad },
              '[beat-figure-gate] unsupported figure — sentence dropped',
            )
            return false
          }
          return true
        })
        .join(' '),
    )
    .filter((l, i, arr) => l.trim().length > 0 || (i > 0 && arr[i - 1].trim().length > 0))
    .join('\n')
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}
