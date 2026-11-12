import { getLLMAdapter } from '../../article-pipeline/llm/factory'
import { cleanTextOutput } from '../../article-pipeline/output-cleaner'
import { stripMetaCommentary } from '../../lib/text/meta-commentary'
import { loadPromptTemplate } from '../../article-pipeline/enrichment/prompt-template'
import { sendFailureAlert } from '../../lib/alerts'
import { logger } from '../../lib/logger'
import { loadSocialBrandTheme } from '../brand-theme'
import type { AutomationLogContext } from '../automation/log-context'
import type { ArticleContentContext } from '../automation/content'
import { resolveSlotContent } from '../automation/content'
import { buildPlatformCaption, PLATFORM_CHAR_LIMITS } from '../automation/captions'
import { loadPlainLanguageConfig, formatExemplars } from '../../article-pipeline/enrichment/plain-language'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { recordLLMUsage } from '../../lib/llm-usage'

export const PLATFORM_TONE: Record<string, string> = {
  linkedin:  'professional, thought-leadership tone; 1–2 short paragraphs; minimal hashtags',
  twitter:   'punchy, concise, conversational; no title repetition; 0–2 hashtags max',
  threads:   'casual, conversational, slightly playful; short sentences',
  instagram: 'engaging, visual-first caption; line breaks ok; 2–4 relevant hashtags at end',
  facebook:  'friendly, community-oriented; clear hook in first line',
  telegram:  'direct and informative; minimal fluff',
}

// Kept in lockstep with the DB row (stepNumber 203) — see
// packages/db/prisma/deai-prompts.ts and .plans/de-ai-writing.implementation-plan.md.
export const CAPTION_SYSTEM_PROMPT =
  'You write platform-native social media captions that HOOK. The first line decides everything: it must ' +
  'earn the tap on "more" with a concrete scene, striking image, or surprising specific — never a summary, ' +
  'never the title restated. Open a curiosity loop and do not close it. Match the platform tone and brand ' +
  'voice exactly. Never invent facts not in the source content. Never promise health outcomes. Never use ' +
  'em-dashes; use commas, colons, or separate sentences.'

const DEF_USER = `Write a {{platform}} caption for slot {{slotKey}} ({{postType}}).

Article title: {{title}}
Section text (this slot's source):
{{sectionText}}

Platform tone: {{platformTone}}
Character limit: {{charLimit}}

Brand voice:
- Organization: {{organizationName}}
- Business: {{businessDescription}}
- Target audience: {{who}}
- Writing style: {{writingStyle}}

Metaphor exemplars (the craft bar for imagery; may be empty):
{{exemplars}}

Advertising restrictions (hard rules; may be empty):
{{restrictions}}

Rules:
- FIRST LINE = the hook: a concrete moment, image, or surprising specific from the source content. Never a summary, never the title restated.
- Open a loop the caption does not close; the payoff lives in the content, not the caption.
- Curiosity through specificity; no clickbait cliches ("you won't believe").
- Return ONLY the caption text: no quotes, labels, or JSON. Never comment on the source, the brief or your own choices; if the source is thin, write from the heading and title without saying so.
- Stay under {{charLimit}} characters
- Do not use markdown or em-dashes
- Match native {{platform}} posting style
- Apply the brand writing style above; if writing style is empty, default to the platform tone`

export async function generatePlatformCaption(opts: {
  postType: string
  articleCtx: ArticleContentContext
  logCtx: AutomationLogContext
}): Promise<string> {
  const { logCtx, postType, articleCtx } = opts
  const platform  = logCtx.platform ?? 'unknown'
  const slotKey   = logCtx.slotKey ?? 'unknown'
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 2000
  const platformTone = PLATFORM_TONE[platform] ?? 'clear and engaging'

  try {
    const [t, brand] = await Promise.all([
      loadPromptTemplate(203, { userId: logCtx.userId }),
      loadSocialBrandTheme(logCtx.userId),
    ])

    // Per-industry metaphor exemplars + advertising restrictions for the hook
    // craft (empty when the industry has no PlainLanguageConfig — non-fatal).
    let exemplars = ''
    let restrictions = ''
    try {
      const plConfig = await loadPlainLanguageConfig(brand.industry)
      if (plConfig) {
        exemplars = formatExemplars(plConfig)
        restrictions = plConfig.restrictions
      }
    } catch {
      /* captions proceed without exemplars */
    }

    const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
    const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'

    const slotContent = resolveSlotContent(slotKey, articleCtx)
    const sectionText  = slotContent.text.slice(0, 4000)
    const sectionTitle = slotContent.title ?? articleCtx.title

    const userPrompt = (t?.userPrompt ?? DEF_USER)
      .replace(/\{\{platform\}\}/g, platform)
      .replace(/\{\{slotKey\}\}/g, slotKey)
      .replace(/\{\{postType\}\}/g, postType)
      .replace(/\{\{title\}\}/g, articleCtx.title)
      .replace(/\{\{sectionText\}\}/g, sectionText)
      .replace(/\{\{sectionTitle\}\}/g, sectionTitle)
      .replace(/\{\{content\}\}/g, sectionText)
      .replace(/\{\{platformTone\}\}/g, platformTone)
      .replace(/\{\{charLimit\}\}/g, String(charLimit))
      .replace(/\{\{organizationName\}\}/g, brand.organizationName)
      .replace(/\{\{businessDescription\}\}/g, brand.businessDescription || 'Not specified')
      .replace(/\{\{who\}\}/g, brand.who || 'Not specified')
      .replace(/\{\{writingStyle\}\}/g, brand.writingStyle || 'Not specified')
      .replace(/\{\{industry\}\}/g, brand.industry || 'general business')
      .replace(/\{\{call_to_action\}\}/g, brand.socialCallToAction || '')
      .replace(/\{\{callToAction\}\}/g, brand.socialCallToAction || '')
      .replace(/\{\{exemplars\}\}/g, exemplars)
      .replace(/\{\{restrictions\}\}/g, restrictions)

    const adapter = getLLMAdapter(provider)
    const run = await adapter.call({
      systemPrompt: t?.systemPrompt ?? CAPTION_SYSTEM_PROMPT,
      userPrompt,
      model,
      temperature: 0.6,
      maxTokens: 512,
    })
    await recordLLMUsage(logCtx.userId, 'social_caption', run)

    const caption = stripMetaCommentary((await sanitizeDashesText(cleanTextOutput(run.content), { ...logCtx, surface: 'caption' })).trim())
    if (!caption) throw new Error('Empty caption (only commentary came back)')

    return caption.length <= charLimit ? caption : caption.slice(0, charLimit - 1).trim() + '…'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(
      { ...logCtx, err },
      '[platform-caption] LLM generation failed — falling back to template',
    )
    void sendFailureAlert({
      userId: logCtx.userId,
      jobId: logCtx.jobId,
      errorType: 'social_caption_fallback',
      message: `LLM caption failed for ${platform}/${slotKey}: ${message}`,
      context: { ...logCtx },
    }).catch(() => {})
    return buildPlatformCaption(platform, articleCtx, slotKey)
  }
}
