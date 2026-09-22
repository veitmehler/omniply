import { getLLMAdapter } from '../llm/factory'
import { cleanTextOutput } from '../output-cleaner'
import { loadPromptTemplate } from './prompt-template'
import { withGeoRetry } from './geo-retry'
import { logger } from '../../lib/logger'
import { assertSafeWpUrl } from '../../lib/ssrf'

const DEF_SYS =
  'You are a content categorization expert. Given an article topic and a list of WordPress categories, select the single most appropriate category.'
const DEF_USER = `Select the most appropriate WordPress category for this article.

Article topic: {{topic}}
Article title: {{title}}

Available categories (JSON):
{{categories}}

Rules:
- Select exactly ONE category from the list.
- Respond with ONLY the category ID as a number — nothing else.
- If no category is a good fit, respond with the ID of the most general/default category.`

export async function fetchWpCategories(
  siteUrl: string,
  authHeader: string,
): Promise<Array<{ id: number; name: string; slug: string }>> {
  const base = siteUrl.replace(/\/$/, '')
  await assertSafeWpUrl(base)
  const catRes = await fetch(`${base}/wp-json/wp/v2/categories?per_page=100`, {
    headers: { Authorization: authHeader },
  })
  if (!catRes.ok) {
    logger.warn({ status: catRes.status }, '[wp-category] categories fetch failed')
    return []
  }
  const rows = (await catRes.json()) as Array<{ id: number; name: string; slug: string }>
  // "Uncategorized" (WP default, id 1) is a non-choice — offering it lets the
  // LLM pick it over real categories on ambiguous topics.
  return rows.filter((c) => c.id !== 1).map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
}

export async function selectWordPressCategory(opts: {
  topic: string
  title: string
  siteUrl: string
  authHeader: string
  jobId: string
}): Promise<{
  categoryId: number | null
  inputTokens: number
  outputTokens: number
  cost: number
}> {
  const categories = await fetchWpCategories(opts.siteUrl, opts.authHeader)
  if (categories.length === 0) {
    return { categoryId: null, inputTokens: 0, outputTokens: 0, cost: 0 }
  }

  const t = await loadPromptTemplate(108)
  const provider = (t?.defaultProvider ?? 'openai').toLowerCase()
  const model = t?.defaultModel ?? 'gpt-4o-mini'
  const catJson = JSON.stringify(categories)
  const userPrompt = (t?.userPrompt ?? DEF_USER)
    .replace(/\{\{topic\}\}/g, opts.topic)
    .replace(/\{\{title\}\}/g, opts.title)
    .replace(/\{\{categories\}\}/g, catJson)

  const adapter = getLLMAdapter(provider)
  const run = await withGeoRetry(`wp_category_${opts.jobId}`, () =>
    adapter.call({
      systemPrompt: t?.systemPrompt ?? DEF_SYS,
      userPrompt,
      model,
      temperature: 0.1,
      maxTokens: 32,
    }),
  )

  const raw = cleanTextOutput(run.content).trim()
  const num = parseInt(raw.replace(/[^\d-]/g, ''), 10)
  const validIds = new Set(categories.map((c) => c.id))
  const categoryId =
    Number.isFinite(num) && validIds.has(num)
      ? num
      : categories[0]?.id ?? null

  return {
    categoryId,
    inputTokens: run.tokens.input,
    outputTokens: run.tokens.output,
    cost: run.cost,
  }
}
