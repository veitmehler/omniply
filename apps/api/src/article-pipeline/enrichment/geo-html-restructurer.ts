import type { H2Section } from './html-parser'
import { extractH2Sections, stripTags, slugify } from './html-parser'

export interface GeoSectionData {
  position: number
  question: string
  summary?: string | null
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** h3 opening/closing tags → h4 within a string (simple replace, good enough for article HTML) */
function demoteH3ToH4(fragment: string): string {
  return fragment.replace(/<\/h3\s*>/gi, '</h4>').replace(/<h3(\s[^>]*)?>/gi, '<h4$1>')
}

/**
 * Produce a unique ID for a heading, avoiding collisions with previously used IDs.
 * First attempt: plain slug. On collision: append -2, -3, etc.
 */
function uniqueId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }
  let n = 2
  while (usedIds.has(`${base}-${n}`)) n++
  const id = `${base}-${n}`
  usedIds.add(id)
  return id
}

/**
 * Replace each H2 section that has GEO data: insert question H2 + optional summary,
 * demote original H2 to H3, demote inner h3→h4.
 * Processes from last section to first so string replacement stays aligned.
 *
 * Heading IDs use clean slugs only — no geo-/sec- prefixes, no position suffixes —
 * so ToC anchor links look natural to crawlers and users.
 */
export function restructureHtmlWithGeo(
  bodyHtml: string,
  _sections: H2Section[],
  geoByPosition: Map<number, GeoSectionData>,
  opts?: { answerFirst?: boolean },
): string {
  let result = bodyHtml
  const n = extractH2Sections(result).length
  // Track IDs used across the whole document to guarantee uniqueness
  const usedIds = new Set<string>()

  for (let idx = n - 1; idx >= 0; idx--) {
    const pos = idx + 1
    const geo = geoByPosition.get(pos)
    if (!geo) continue
    const q = geo.question?.trim()
    if (!q || q.toLowerCase() === 'null') continue

    const secsNow = extractH2Sections(result)
    const cur = secsNow[idx]
    if (!cur) continue

    const h2Match = cur.sectionHtml.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i)
    if (!h2Match) continue
    const titleInner = h2Match[1]
    const afterFirstH2 = cur.sectionHtml.slice(h2Match[0].length)
    const qEsc = escapeHtml(q)

    // Clean IDs: plain slugs, no prefixes or position suffixes
    const h2Id = uniqueId(slugify(q), usedIds)

    let newSection: string
    if (opts?.answerFirst) {
      // B7 answer-first shape: the question simply replaces the heading. No
      // visible summary block (the section's opening paragraph IS the answer,
      // written by the article step) and no demoted copy of the original
      // title — the injected H2→H3 restatement pair was a detector tell and
      // reads redundant to people too. Inner h3s keep their level.
      newSection = `<h2 id="${h2Id}">${q}</h2>\n` + afterFirstH2
    } else {
      const summaryBlock =
        geo.summary?.trim()
          ? `\n<div class="geo-summary" data-question="${qEsc}"><p>${escapeHtml(geo.summary.trim())}</p></div>\n`
          : '\n'
      const h3Id = uniqueId(cur.anchor, usedIds)
      newSection =
        `<h2 id="${h2Id}">${q}</h2>${summaryBlock}` +
        `<h3 id="${h3Id}">${titleInner}</h3>` +
        demoteH3ToH4(afterFirstH2)
    }

    const start = result.indexOf(cur.sectionHtml)
    if (start === -1) continue
    result = result.slice(0, start) + newSection + result.slice(start + cur.sectionHtml.length)
  }
  return result
}
