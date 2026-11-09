/**
 * Inline citation inserter.
 *
 * Takes the article HTML and a list of validated citations, then calls the
 * LLM (step 110 — insert_inline_citations) to wrap relevant text passages
 * in <a> tags that link to the citation source.
 *
 * Safety guarantees (enforced in post-processing regardless of LLM output):
 *  - Each citation URL appears AT MOST ONCE in the returned HTML
 *  - If the LLM drops H2 headings, we discard its output and return the original
 *  - Every external <a> link has target="_blank" and rel="noopener noreferrer"
 */

import { logger } from '../lib/logger'
import { stripUnpooledLinks } from './citation-policy'
import { StepRunner } from './step-runner'
import type { PipelineContext } from './variable-resolver'
import type { ValidatedCitation } from './citation-validator'

/** Count occurrences of a substring in a string. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

/** Count <h2 elements in an HTML string (rough but reliable). */
function countH2s(html: string): number {
  return (html.match(/<h2[\s>]/gi) ?? []).length
}

/**
 * Ensure every external <a> tag (href not starting with "#") has
 * target="_blank" and rel="noopener noreferrer", regardless of what the LLM
 * produced. Existing correct attributes are left untouched; missing or
 * incomplete ones are injected/normalised.
 */
function normalizeExternalLinkAttrs(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    // Extract href value
    const hrefMatch = /href\s*=\s*["']?([^"'\s>]*)["']?/i.exec(attrs)
    const href = hrefMatch?.[1] ?? ''

    // Leave internal anchor links (#...) and empty hrefs unchanged
    if (!href || href.startsWith('#')) return `<a${attrs}>`

    let result = attrs

    // Inject target="_blank" if absent
    if (!/\btarget\s*=/i.test(result)) {
      result += ' target="_blank"'
    }

    // Inject or normalise rel to include both noopener and noreferrer
    const relMatch = /\brel\s*=\s*["']([^"']*)["']/i.exec(result)
    if (!relMatch) {
      result += ' rel="noopener noreferrer"'
    } else {
      const relVal = relMatch[1]
      const parts = relVal.split(/\s+/).filter(Boolean)
      if (!parts.includes('noopener')) parts.push('noopener')
      if (!parts.includes('noreferrer')) parts.push('noreferrer')
      result = result.replace(/\brel\s*=\s*["'][^"']*["']/i, `rel="${parts.join(' ')}"`)
    }

    return `<a ${result.trim()}>`
  })
}

/**
 * Strip duplicate <a href="url"> tags for a given URL, keeping only the first
 * occurrence. Works by replacing all but the first complete <a ...>...</a>
 * wrapping that exact href.
 */
function deduplicateCitationLinks(html: string, url: string): string {
  // Escape url for use in regex
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match <a> tags whose href attribute is exactly this URL (with optional quotes)
  const anchorRe = new RegExp(
    `<a\\b[^>]*href=["']?${escaped}["']?[^>]*>[\\s\\S]*?<\\/a>`,
    'gi',
  )
  let firstSeen = false
  return html.replace(anchorRe, (match) => {
    if (!firstSeen) {
      firstSeen = true
      return match // keep the first occurrence
    }
    // For subsequent occurrences, strip the <a> wrapper and keep the inner text
    return match.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '')
  })
}

/**
 * Insert validated citations as inline hyperlinks into the article HTML.
 *
 * @param articleHtml     The article body HTML (step 11 output)
 * @param liveCitations   Citations that passed URL validation (valid + uncertain)
 * @param jobId           For logging
 * @param ctx             Pipeline context for StepRunner
 */
export async function insertInlineCitations(
  articleHtml: string,
  liveCitations: ValidatedCitation[],
  jobId: string,
  ctx: PipelineContext,
): Promise<{ linkedHtml: string; insertedCount: number }> {
  if (liveCitations.length === 0) {
    return { linkedHtml: articleHtml, insertedCount: 0 }
  }

  // Store citations in context so the variable resolver can inject them as {{validated_citations}}
  ctx.completedSteps.set(110, JSON.stringify(liveCitations))

  const runner = new StepRunner(jobId, 110, ctx)
  const originalH2Count = countH2s(articleHtml)
  const allowedUrls = liveCitations.map((c) => c.url)

  // One pass = LLM call + the deterministic post-processing. The pass is
  // retried once when it yields almost nothing from a usable pool (B13: a
  // 13-source pool produced zero links after the allowlist).
  const runPass = async (attempt: number): Promise<{ html: string; inserted: number } | null> => {
    let result: Awaited<ReturnType<typeof runner.execute>>
    try {
      result = await runner.execute()
    } catch (err) {
      logger.error({ jobId, attempt, err }, '[citation-inserter] LLM call failed')
      if (attempt === 1) throw err
      return null
    }
    let linkedHtml = result.output.trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim()
    if (originalH2Count > 0 && countH2s(linkedHtml) < originalH2Count) {
      logger.warn({ jobId, attempt, originalH2Count, linkedH2Count: countH2s(linkedHtml) }, '[citation-inserter] LLM dropped H2 headings — discarding this pass')
      return null
    }
    // B12 hard allowlist: the model may only link to the validated pool
    // (B11 stiffness: 11 of 15 links were URLs from its own memory).
    const allow = stripUnpooledLinks(linkedHtml, allowedUrls)
    if (allow.stripped > 0 || allow.recovered > 0) {
      linkedHtml = allow.html
      logger.warn({ jobId, attempt, stripped: allow.stripped, recovered: allow.recovered, hosts: allow.strippedHosts }, '[citation-inserter] links outside the validated pool: recovered by host or stripped')
    }
    for (const citation of liveCitations) {
      if (countOccurrences(linkedHtml, citation.url) > 1) linkedHtml = deduplicateCitationLinks(linkedHtml, citation.url)
    }
    linkedHtml = normalizeExternalLinkAttrs(linkedHtml)
    const inserted = liveCitations.filter((c) => linkedHtml.includes(c.url)).length
    return { html: linkedHtml, inserted }
  }

  let best = await runPass(1)
  if (!best) return { linkedHtml: articleHtml, insertedCount: 0 }
  if (best.inserted < Math.min(3, liveCitations.length) && liveCitations.length >= 5) {
    logger.info({ jobId, inserted: best.inserted, pool: liveCitations.length }, '[citation-inserter] low yield, retrying once')
    const second = await runPass(2)
    if (second && second.inserted > best.inserted) best = second
  }
  const linkedHtml = best.html

  // Count how many citation URLs actually appear in the final HTML
  const insertedCount = liveCitations.filter((c) =>
    linkedHtml.includes(c.url),
  ).length

  logger.info({ jobId, insertedCount, total: liveCitations.length }, '[citation-inserter] done')

  return { linkedHtml, insertedCount }
}
