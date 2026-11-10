import { getLLMAdapter } from '../llm/factory'
import { cleanTextOutput } from '../output-cleaner'
import { logger } from '../../lib/logger'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'

const PROVIDER = 'anthropic'
const MODEL = 'claude-haiku-4-5'
const MAX_SYNTAX = 600

// B17 (2026-11-09): alt text used to open with the Mermaid chart type
// ("State diagram tracing…", "Mindmap of…", "Class diagram linking…") because
// the prompt asked for exactly that. A screen-reader user wants to know what
// the picture shows about their back, not that it is a UML state diagram, and
// the chart-type vocabulary was the one text-level AI tell Gemini could still
// point at. Alt text now describes the clinical content; chart-type words are
// gated out in code.
const SYSTEM =
  'You write two descriptions for an explanatory diagram in a health article: ' +
  'an accessibility alt text and a visible caption. ' +
  'You respond with valid JSON only, no markdown, no code fences.'

const USER_TEMPLATE =
  `Article topic: {{articleTopic}}
Section heading: {{sectionTitle}}
Diagram content (Mermaid source, for your eyes only):
{{syntaxExcerpt}}

Return a JSON object with exactly two fields. They serve different readers and must not repeat each other.

"altText": for a reader who cannot see the image. In 60 to 110 characters, say what the picture shows about the subject: the things it connects, the sequence it lays out, the comparison it makes. Name the clinical content, never the kind of chart. Words such as diagram, chart, flowchart, mindmap, map, graph, nodes, branches, class, state, or the name of any drawing tool do not appear. Write a complete phrase that a person would say when describing the picture to a friend on the phone.

"caption": for a sighted reader. One sentence of 15 to 25 words giving the point the picture makes, the insight rather than the inventory. Do not begin with "This" or "The diagram". Do not repeat the alt text.

Respond with ONLY the JSON object.`

/** Chart-type and tooling vocabulary that must not appear in alt text. */
export const ALT_CHART_WORDS_RE =
  /\b(diagram|diagrams|chart|charts|flowchart|flow chart|mindmap|mind map|mind-map|graph|graphs|nodes?|branches|branching|class diagram|state diagram|sequence diagram|mermaid|uml|infographic|visuali[sz]ation|schematic)\b/i

/** Null when the alt text passes; otherwise the reason. */
export function altTextIssue(alt: string): string | null {
  const t = alt.trim()
  if (!t) return 'empty'
  if (ALT_CHART_WORDS_RE.test(t)) return 'chart-type vocabulary'
  if (t.length < 25) return 'too short'
  if (t.length > 160) return 'too long'
  if (/^(this|the) (image|picture|diagram)/i.test(t)) return 'self-reference'
  return null
}

export interface DiagramCaptionResult {
  altText: string
  caption: string
  inputTokens: number
  outputTokens: number
  cost: number
}

function parsePair(raw: string): { altText?: string; caption?: string } {
  try {
    const cleaned = cleanTextOutput(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    return {
      altText: typeof parsed.altText === 'string' ? parsed.altText.trim() : undefined,
      caption: typeof parsed.caption === 'string' ? parsed.caption.trim() : undefined,
    }
  } catch {
    return {}
  }
}

export async function generateDiagramCaption(opts: {
  articleTopic: string
  sectionTitle: string
  diagramType: string
  mermaidSyntax: string
  jobId: string
  position: number
}): Promise<DiagramCaptionResult> {
  const adapter = getLLMAdapter(PROVIDER)
  const userPrompt = USER_TEMPLATE
    .replace('{{articleTopic}}', opts.articleTopic)
    .replace('{{sectionTitle}}', opts.sectionTitle)
    .replace('{{syntaxExcerpt}}', opts.mermaidSyntax.slice(0, MAX_SYNTAX))

  // Fallbacks name the content, never the chart type.
  const fallbackAltText = `Illustration of ${opts.sectionTitle.replace(/[?.!]+$/, '').trim()}`
  const fallbackCaption = `${opts.sectionTitle.replace(/[?.!]+$/, '').trim()}, in one picture.`

  let inputTokens = 0
  let outputTokens = 0
  let cost = 0
  let altText = fallbackAltText
  let caption = fallbackCaption

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = attempt === 1 ? userPrompt : `${userPrompt}\n\nYour previous alt text was rejected: ${altTextIssue(altText) ?? 'unusable'}. Describe what the picture shows about the subject without naming the kind of chart.`
      const run = await adapter.call({ systemPrompt: SYSTEM, userPrompt: prompt, model: MODEL, temperature: 0.3, maxTokens: 220 })
      inputTokens += run.tokens.input
      outputTokens += run.tokens.output
      cost += run.cost
      const pair = parsePair(run.content)
      if (!pair.altText && !pair.caption) {
        logger.warn({ jobId: opts.jobId, position: opts.position, raw: run.content.slice(0, 200) }, '[enrichment] caption-gen JSON parse failed')
        continue
      }
      if (pair.caption) caption = pair.caption
      if (pair.altText) altText = pair.altText
      const issue = altTextIssue(altText)
      if (!issue) break
      logger.info({ jobId: opts.jobId, position: opts.position, attempt, issue, altText: altText.slice(0, 100) }, '[enrichment] alt text rejected by gate')
      if (attempt === 2) altText = fallbackAltText
    }
    if (altTextIssue(altText)) altText = fallbackAltText

    altText = await sanitizeDashesText(altText, { jobId: opts.jobId, surface: 'diagram_alt' })
    caption = await sanitizeDashesText(caption, { jobId: opts.jobId, surface: 'diagram_caption' })
    return { altText, caption, inputTokens, outputTokens, cost }
  } catch (err) {
    logger.warn({ jobId: opts.jobId, position: opts.position, err }, '[enrichment] caption-gen failed — using fallback')
    return { altText: fallbackAltText, caption: fallbackCaption, inputTokens, outputTokens, cost }
  }
}
