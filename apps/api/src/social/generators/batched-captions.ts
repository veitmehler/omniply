import { getLLMAdapter } from '../../article-pipeline/llm/factory'
import { stripMetaCommentary } from '../../lib/text/meta-commentary'
import { loadPromptTemplate } from '../../article-pipeline/enrichment/prompt-template'
import { logger } from '../../lib/logger'
import { loadSocialBrandTheme } from '../brand-theme'
import { loadPlainLanguageConfig, formatExemplars } from '../../article-pipeline/enrichment/plain-language'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { recordLLMUsage } from '../../lib/llm-usage'
import { PLATFORM_CHAR_LIMITS } from '../automation/captions'
import type { AutomationLogContext } from '../automation/log-context'
import { PLATFORM_TONE, CAPTION_SYSTEM_PROMPT } from './platform-caption'

/**
 * Batched captions: ONE LLM call per platform produces the captions for ALL
 * of a run's feed slots together (.plans/social-sections-kt-video plan,
 * Phase 2). Generating siblings in the same call is what makes distinctness
 * enforceable — independent per-slot calls converged on the article's
 * recurring anecdote (2026-08-18 cadence test). Also cheaper: 3 calls per
 * run instead of slots x platforms, with the shared brand/tone rules sent
 * once per platform.
 *
 * Failure of a platform's batch falls back to the legacy per-slot path in
 * buildPostsForSpec (the pregenerated map simply lacks that platform).
 */

export interface CaptionSlotInput {
  slotKey: string
  postType: string
  /** Section heading (or Key Takeaways title) this slot is bound to. */
  title: string
  /** The ONLY content the caption may draw on. */
  text: string
}

const BATCH_RULES = `Rules for EVERY caption:
- FIRST LINE = the hook: a concrete moment, image, or surprising specific from that slot's section text. Never a summary, never the title restated.
- Open a loop the caption does not close; the payoff lives in the content, not the caption.
- Curiosity through specificity; no clickbait cliches ("you won't believe").
- When mentioning court cases or legal decisions: describe them ONLY as examples of what actually happened in that specific case; NEVER assert a case as "precedent" or claim it establishes a legal rule for a different context unless the source material explicitly states that holding applies.
- Write every figure as numerals exactly as printed in the source (15.6%, $5,000, 30-40%); NEVER spell numbers out in words.
- Stay under {{charLimit}} characters per caption.
- Do not use markdown or em-dashes.
- Match native {{platform}} posting style.
- Apply the brand writing style; if empty, default to the platform tone.
- Never comment on the source, the brief or your own choices inside a caption; if a slot's section text is thin, write from its heading and the article title without saying so.

Rules ACROSS the captions (critical):
- Each caption draws ONLY on its own section text. Never borrow scenes, anecdotes, statistics, or phrasings from another slot's section.
- The captions must be mutually distinct: different openings, different scenes, different angles. If two sections reference the same story, only the FIRST slot may use it; later slots must find different material in their own section.

Return ONLY a JSON object mapping slot keys to captions, e.g. {"P1": "...", "P2": "...", "P3": "..."}. No prose, no code fences.`

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Generate all slot captions for one platform in a single call.
 * Returns slotKey → caption. Throws when the batch cannot be produced —
 * callers treat that platform as "no pregenerated captions" and the
 * per-slot legacy path covers it.
 */
export async function generateBatchedCaptionsForPlatform(opts: {
  platform: string
  articleTitle: string
  slots: CaptionSlotInput[]
  logCtx: AutomationLogContext
}): Promise<Record<string, string>> {
  const { platform, articleTitle, slots, logCtx } = opts
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 2000
  const platformTone = PLATFORM_TONE[platform] ?? 'clear and engaging'

  const [t, brand] = await Promise.all([
    loadPromptTemplate(203, { userId: logCtx.userId }),
    loadSocialBrandTheme(logCtx.userId),
  ])

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

  const slotBlocks = slots
    .map(
      (s) =>
        `--- Slot ${s.slotKey} (${s.postType}) ---\nSection heading: ${s.title}\nSection text (the ONLY source for this caption):\n${s.text.slice(0, 3500)}`,
    )
    .join('\n\n')

  const userPrompt = `Write ${slots.length} ${platform} captions, one per slot below. They belong to the same day's posting plan for the article "${articleTitle}", so a reader may see all of them.

${slotBlocks}

Platform tone: ${platformTone}
Character limit per caption: ${charLimit}

Brand voice:
- Organization: ${brand.organizationName}
- Business: ${brand.businessDescription || 'Not specified'}
- Target audience: ${brand.who || 'Not specified'}
- Writing style: ${brand.writingStyle || 'Not specified'}

Metaphor exemplars (the craft bar for imagery; may be empty):
${exemplars}

Advertising restrictions (hard rules; may be empty):
${restrictions}

${BATCH_RULES.replace(/\{\{charLimit\}\}/g, String(charLimit)).replace(/\{\{platform\}\}/g, platform)}`

  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const adapter = getLLMAdapter(provider)
  const run = await adapter.call({
    systemPrompt: t?.systemPrompt ?? CAPTION_SYSTEM_PROMPT,
    userPrompt,
    model,
    temperature: 0.6,
    maxTokens: 512 * slots.length,
  })
  await recordLLMUsage(logCtx.userId, 'social_caption', run)

  const parsed = extractJsonObject(run.content)
  if (!parsed) throw new Error('Batched captions: response is not a JSON object')

  const out: Record<string, string> = {}
  for (const s of slots) {
    const raw = parsed[s.slotKey]
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`Batched captions: missing caption for slot ${s.slotKey}`)
    }
    const caption = stripMetaCommentary(
      (await sanitizeDashesText(raw.trim(), { ...logCtx, platform, slotKey: s.slotKey, surface: 'caption' })).trim(),
    )
    if (!caption) throw new Error(`Batched captions: only commentary came back for slot ${s.slotKey}`)
    out[s.slotKey] = caption.length <= charLimit ? caption : caption.slice(0, charLimit - 1).trim() + '…'
  }

  logger.info(
    { ...logCtx, platform, slots: slots.length },
    '[batched-captions] platform batch generated',
  )
  return out
}
