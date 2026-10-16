import { getLLMAdapter } from '../llm/factory'
import { cleanTextOutput } from '../output-cleaner'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { loadPromptTemplate } from './prompt-template'
import { withGeoRetry } from './geo-retry'

const DEF_SYS =
  'You are an expert content writer creating concise AI-optimised summaries for Generative Engine Optimisation (GEO). ' +
  'You always provide direct, factual answers. You never say "the article does not contain" or "this section doesn\'t mention" — ' +
  'you synthesise an authoritative answer from the context provided and your domain knowledge. ' +
  // Verbatim-numbers rule (consistency-audit plan): a step-19 summary once
  // invented its own "$22,000" total from partial items — the diagrams then
  // inherited it. Derivative surfaces never do arithmetic.
  'NUMBERS RULE: figures may ONLY be copied verbatim from the provided section. NEVER compute, sum, derive, or ' +
  'estimate a figure — if the section states a total, use that total; if it states none, present items without one.'

const DEF_USER = `Write a concise 40-60 word answer to the following question.

Question: {{question}}

Article section content (for context):
{{content}}

Rules:
- Answer the question directly and factually.
- Use the article section as your primary source. If the section does not fully address the question, supplement with established domain knowledge that is consistent with the article's topic and perspective.
- NEVER say "the article does not contain", "this section doesn't mention", or any variant. Always give a direct answer.
- Stay between 40 and 60 words.
- Write in third person, informational tone.
- Do NOT use bullet points or headings.
- Respond with ONLY the summary paragraph — nothing else.`

const MAX_CONTENT = 2000

export async function generateAiSummary(opts: {
  question: string
  sectionContent: string
  jobId: string
  position: number
}): Promise<{
  summary: string
  inputTokens: number
  outputTokens: number
  cost: number
  provider: string
  model: string
}> {
  const t = await loadPromptTemplate(104)
  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const content = opts.sectionContent.slice(0, MAX_CONTENT)
  const userPrompt = (t?.userPrompt ?? DEF_USER)
    .replace(/\{\{question\}\}/g, opts.question)
    .replace(/\{\{content\}\}/g, content)

  const adapter = getLLMAdapter(provider)
  const run = await withGeoRetry(`geo_step_104_${opts.position}`, () =>
    adapter.call({
      systemPrompt: t?.systemPrompt ?? DEF_SYS,
      userPrompt,
      model,
      temperature: 0.3,
      maxTokens: 512,
    }),
  )
  const summary = await sanitizeDashesText(cleanTextOutput(run.content).trim(), {
    jobId: opts.jobId,
    surface: 'geo_summary',
  })
  return {
    summary,
    inputTokens: run.tokens.input,
    outputTokens: run.tokens.output,
    cost: run.cost,
    provider,
    model,
  }
}
