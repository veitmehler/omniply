/**
 * Meta-commentary guard (Sonnet 5.5 social bench, 2026-11-11).
 *
 * Given thin input, the model sometimes narrates its own constraint before (or
 * instead of) the deliverable: "The section text I was given is only the
 * article title, so there's no scene I can pull from... Here is a caption built
 * on...". That is the same tell family as the article writer's narrated
 * hedges (B10): the audience must never see it. Deterministic, prompt-free:
 * leading paragraphs that talk about the input, the instructions or the
 * model's own choices are dropped; what remains is the deliverable.
 */

const META_LINE_RE =
  /\b(section text|the text (?:I was|you) (?:given|provided)|I was given|you gave me|I won't invent|I will not invent|I can'?t invent|here(?:'s| is) a caption|here(?:'s| is) (?:the|an?) (?:caption|post|version)|built (?:on|from) what the title|without inventing|no body copy|only the article title|the brief|the instructions?|as instructed|note:)\b/i

/** Does this paragraph talk ABOUT the task instead of doing it? */
export function isMetaParagraph(p: string): boolean {
  const t = p.trim()
  if (!t) return false
  return META_LINE_RE.test(t) && /\b(I|me|you|my|we)\b/.test(t)
}

/**
 * Strip leading (and trailing) meta paragraphs. Returns '' when nothing but
 * commentary came back, so the caller can retry or fall back.
 */
export function stripMetaCommentary(text: string): string {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/)
  let start = 0
  while (start < paras.length && isMetaParagraph(paras[start])) start++
  let end = paras.length
  while (end > start && isMetaParagraph(paras[end - 1])) end--
  return paras.slice(start, end).join('\n\n').trim()
}

/** "...her energy.Her heavy metals scan..." — a missing space after a sentence end (lowercase before, capital after). */
export function fixSentenceSpacing(text: string): string {
  return text.replace(/(?<=[a-z])\.(?=[A-Z])/g, '. ')
}
