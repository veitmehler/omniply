import { getLLMAdapter } from '../llm/factory'
import { cleanTextOutput } from '../output-cleaner'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { loadPromptTemplate } from './prompt-template'
import { withGeoRetry } from './geo-retry'

const DEF_SYS =
  'You are an expert content strategist creating "Key Takeaways" sections for Generative Engine Optimization (GEO). Your takeaways must be declarative statements packed with specific data, entities, and actionable insights. ' +
  'NUMBERS RULE: figures may ONLY be copied verbatim from the article. NEVER compute, sum, derive, or estimate a ' +
  'figure — if the article states a total, use that total; if it states none, present items without one.'

const DEF_USER = `Generate a "Key Takeaways" section for the following article.

Article HTML:
{{bodyHtml}}

Primary keyword: {{primaryKeyword}}

Rules:
- Write exactly 3–5 bullet points.
- Each bullet must be a declarative sentence (not a question).
- Front-load the most important information in the first 10 words of each bullet.
- Include specific numbers, names, laws, or locations from the article where available.
- Each bullet should use a bold lead-in label (2–3 words), then the statement.
- Do NOT use vague language like "important considerations" or "key factors."
- Respond with ONLY the HTML list — no heading, no explanation.

Example format:
<ul>
  <li><b>Infrastructure Reality</b>: While Starlink (RD$2,900/mo) has solved internet issues, electricity remains unstable; solar ROI is now under three years.</li>
  <li><b>Legal Necessity</b>: Never purchase DR property without a verified Deslinde (Law 108-05) to avoid boundary disputes.</li>
</ul>`

const MAX_HTML = 30_000

export async function generateKeyTakeaways(opts: {
  bodyHtml: string
  primaryKeyword: string
  jobId: string
}): Promise<{
  sectionHtml: string
  inputTokens: number
  outputTokens: number
  cost: number
}> {
  const t = await loadPromptTemplate(107)
  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const userPrompt = (t?.userPrompt ?? DEF_USER)
    .replace(/\{\{bodyHtml\}\}/g, opts.bodyHtml.slice(0, MAX_HTML))
    .replace(/\{\{primaryKeyword\}\}/g, opts.primaryKeyword || '')

  const adapter = getLLMAdapter(provider)
  const run = await withGeoRetry(`geo_key_takeaways_${opts.jobId}`, () =>
    adapter.call({
      systemPrompt: t?.systemPrompt ?? DEF_SYS,
      userPrompt,
      model,
      temperature: 0.35,
      maxTokens: 512,
    }),
  )
  const listInner = await sanitizeDashesText(
    cleanTextOutput(run.content).trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, ''),
    { jobId: opts.jobId, surface: 'key_takeaways' },
  )
  const sectionHtml = `<section class="key-takeaways" aria-label="Key Takeaways">\n<h2 id="key-takeaways-heading">Key Takeaways</h2>\n${listInner}\n</section>`

  return {
    sectionHtml,
    inputTokens: run.tokens.input,
    outputTokens: run.tokens.output,
    cost: run.cost,
  }
}
