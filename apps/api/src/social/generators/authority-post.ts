import { prisma, brandSettingsForUser } from '@omniply/shared'
import { loadSocialBrandTheme } from '../brand-theme'
import { getLLMAdapter } from '../../article-pipeline/llm/factory'
import { loadPromptTemplate } from '../../article-pipeline/enrichment/prompt-template'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { recordLLMUsage } from '../../lib/llm-usage'
import { logger } from '../../lib/logger'
import type { AutomationLogContext } from '../automation/log-context'
import { AUTHORITY_TYPES, isAuthorityType, type AuthorityType } from './authority-rotation'

/**
 * Authority post generator (.plans/authority-content-engine plan, v1 —
 * article-driven). One published article + one drawn rhetorical register →
 * one typed post in the owner's voice. Inherits the story-arc generator's
 * TRUTH frame wholesale: the narrator is a software builder whose personal
 * events come ONLY from the provided narrator moments; article material is
 * observation, never autobiography.
 *
 * Substance-first guardrail (system rule, not style note): every stance must
 * be grounded in the article material or a narrator moment. The model may
 * not manufacture an opinion; when the drawn register has no material, it
 * writes in the register the article best supports and declares it.
 *
 * Prompt override hook: PromptTemplate step 250 (none seeded — the inline
 * prompts below are the live source, same pattern as story-arc's step 230).
 */

export const AUTHORITY_PROMPT_STEP = 250

export interface AuthorityPostResult {
  /** Full post text (LinkedIn/FB content, IG caption). */
  postText: string
  /** Short hook line (max 12 words) — the FB/IG tinted-image text. */
  hookLine: string
  /** Register actually used (may differ from the drawn one on a fit swap). */
  usedType: AuthorityType
}

/** Per-register rhetorical shape for a short social post. */
const REGISTER_SHAPES: Record<AuthorityType, string> = {
  opinion:
    'OPINIONATED post. Shape: stake one clear claim in the first line → name the common bad advice it replaces → ' +
    'what that advice actually costs (money, patients, time; numbers only from the material) → what to do instead. ' +
    'No hedging words (no "maybe", "perhaps", "in my opinion"). The claim must be defensible from the material.',
  belief_shift:
    'BELIEF-SHIFTING post. Shape: open with the assumption most readers hold → acknowledge why it once made sense → ' +
    'the break: the evidence or change that invalidated it (from the material) → the new mental model, stated crisply, ' +
    'ideally with a short memorable name.',
  leadership:
    'THOUGHT-LEADERSHIP post. Shape: one concrete observation or pattern (from the material) → the lens that explains ' +
    'it → a prediction or operating principle. First person. Allowed to be early; never vague. ' +
    'One prediction maximum, and it must follow from the stated evidence.',
  proof:
    'PROOF-LED post. Shape: the before-state with context → what was done → the real number or verifiable fact ' +
    '(VERBATIM from the material; if the material has no usable number, use its strongest verifiable fact) → the ' +
    'generalizable lesson. Never round, derive, or estimate figures.',
  framework:
    'FRAMEWORK-DRIVEN post. Shape: name the model (short, memorable) → its 3 to 5 parts, each one line → when it ' +
    'applies → one concrete application from the material. The parts must come from the material, not be invented.',
}

/** Dominant-register directive for a LONG-FORM platform article (syndication). */
export function articleRegisterDirective(type: AuthorityType): string {
  return (
    `DOMINANT REGISTER FOR THIS ARTICLE: ${type}.\n` +
    `${REGISTER_SHAPES[type]}\n` +
    'Apply this register to the ARTICLE as a whole: it sets the lead, the hook, and the thesis. ' +
    'Other registers may appear as supporting ingredients inside sections, but the opening and the through-line ' +
    'belong to this register alone. All substance still comes from the source article; never manufacture claims, ' +
    'numbers, or events to serve the register.'
  )
}

const SYSTEM_PROMPT =
  'You are a ghostwriter for a business owner, writing a single first-person LinkedIn post in a specific rhetorical register. ' +
  'The voice must read like a real person: short lines, concrete specifics, no hype, no hashtags, no emoji. ' +
  'Never use em-dashes; use commas, colons, or separate sentences. ' +
  'TRUTH RULE (the most important rule): events that happened TO THE NARRATOR may come ONLY from the ' +
  'provided narrator moments, retold faithfully. You may NEVER invent a personal experience, test, audit, ' +
  'count, conversation, or discovery, even a plausible one. Article material must be voiced as ' +
  'OBSERVATION about the industry ("I keep seeing...", "Picture a practice owner who..."), never as something ' +
  'the narrator personally did or found. The narrator is a software builder, not a clinician: patients, patient ' +
  'files, clinics, or board letters may never appear as the narrator\'s own, and neither may invented business ' +
  'interactions: discovery calls, client consultations, or access to any practice\'s data. ' +
  'SUBSTANCE RULE: every claim, number, and stance must be grounded in the article material or a narrator moment. ' +
  'No source, no stance. Numbers appear VERBATIM from the material or not at all. ' +
  'COMPLIANCE: never identifiable patients or specific patient events; never promise business or health outcomes. ' +
  'Output ONLY a JSON object, no code fences, no commentary.'

function buildUserPrompt(opts: {
  register: AuthorityType
  narratorName: string
  narratorBeats: string
  writingStyle: string
  articleTitle: string
  articleMaterial: string
  priorPosts: string[]
}): string {
  const prior = opts.priorPosts.length
    ? opts.priorPosts.map((p, i) => `--- Prior post ${i + 1} (most recent first) ---\n${p}`).join('\n\n')
    : '(none yet)'
  return `Write ONE authority post based on this article, in the assigned register.

ASSIGNED REGISTER: ${opts.register}
${REGISTER_SHAPES[opts.register]}

FIT RULE: if the article genuinely contains no material for the assigned register (for example "proof" on a piece with no numbers or verifiable facts), do NOT force it or invent substance. Instead write the post in whichever of these registers the article best supports: ${AUTHORITY_TYPES.join(', ')} — and report the register you actually used in the "type" field. Prefer the assigned register whenever the material allows it.

NARRATOR: ${opts.narratorName}, the business owner, first person.
REAL narrator moments you may draw on (never invent biographical facts beyond these and the article):
${opts.narratorBeats || '(none provided: stay with industry observations and the article material only)'}

WRITING VOICE:
${opts.writingStyle || 'Plainspoken, concrete, operator-to-operator.'}

ARTICLE TITLE: ${opts.articleTitle}
ARTICLE MATERIAL (the post's substance; numbers may ONLY come from here):
${opts.articleMaterial}

RECENTLY PUBLISHED AUTHORITY POSTS (write something structurally and topically DISTINCT from all of these):
${prior}

POST RULES:
- 120 to 220 words. Short lines. Separate THOUGHTS with a BLANK line; never run two thoughts together in one paragraph.
- The first line must work alone as a scroll-stopper; never open with a summary or a greeting.
- No links, no web addresses, no "link in bio", no pointers to the article as a destination. The article may be a SOURCE ("the data I published this week shows..."), never a destination.
- No call-to-action, no "follow me", no engagement bait ("agree?", "thoughts?"). The post ends on its strongest line.
- Every figure written as numerals exactly as printed in the source; never spell numbers out.

Also produce "hook": ONE punchy line of at most 12 words that captures the post's core claim (this renders on a branded image; no digits-heavy strings, no URLs, no quotes).

Return ONLY a JSON object: {"post": "...", "hook": "...", "type": "<register actually used>"}
CRITICAL JSON RULE: inside string values, NEVER use straight double quotes. Quote words with typographic quotes (“like this”) or single quotes instead.`
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const body = cleaned.slice(start, end + 1)
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    // Same repair pass as story-arc: escape raw double quotes INSIDE string
    // values (structural quotes are followed by , } ] or :).
    try {
      let out = ''
      let inString = false
      for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        if (ch === '\\' && inString) { out += ch + (body[i + 1] ?? ''); i++; continue }
        if (ch !== '"') { out += ch; continue }
        if (!inString) { inString = true; out += ch; continue }
        const rest = body.slice(i + 1).match(/^\s*([,}\]:])/)
        if (rest) { inString = false; out += ch } else { out += '\\"' }
      }
      const parsed = JSON.parse(out)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}

export async function generateAuthorityPost(opts: {
  userId: string
  articleTitle: string
  articleMaterial: string
  register: AuthorityType
  logCtx: AutomationLogContext
}): Promise<AuthorityPostResult> {
  const { userId, register, logCtx } = opts

  const [brand, theme, t] = await Promise.all([
    brandSettingsForUser(userId),
    loadSocialBrandTheme(userId),
    loadPromptTemplate(AUTHORITY_PROMPT_STEP, { userId }),
  ])

  // Distinctness pool: the most recent authority posts already out the door.
  const prior = await prisma.post.findMany({
    where: {
      userId,
      postType: 'authority_text',
      platform: { in: ['linkedin', 'linkedin_personal'] },
      status: { in: ['ready', 'scheduled', 'published'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: { content: true },
    distinct: ['automationRunId'],
  })

  const userPrompt = buildUserPrompt({
    register,
    narratorName: brand?.storyNarratorName ?? brand?.defaultAuthorName ?? 'the owner',
    narratorBeats: brand?.storyBeats ?? '',
    writingStyle: theme.writingStyle || '',
    articleTitle: opts.articleTitle,
    articleMaterial: opts.articleMaterial,
    priorPosts: prior.map((p) => p.content),
  })

  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const adapter = getLLMAdapter(provider)

  let parsed: Record<string, unknown> | null = null
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const run = await adapter.call({
      systemPrompt: t?.systemPrompt ?? SYSTEM_PROMPT,
      userPrompt,
      model,
      temperature: attempt === 0 ? 0.7 : 0.6,
      maxTokens: 1500,
    })
    await recordLLMUsage(userId, 'authority_post', run)
    parsed = extractJsonObject(run.content)
    if (!parsed && attempt === 0) {
      logger.warn(
        { ...logCtx, rawLen: run.content.length, rawHead: run.content.slice(0, 200) },
        '[authority-post] unparseable output — retrying once',
      )
    }
  }
  if (!parsed) throw new Error('Authority post: unparseable model output after retry')

  const rawPost = typeof parsed.post === 'string' ? parsed.post.trim() : ''
  const rawHook = typeof parsed.hook === 'string' ? parsed.hook.split('\n')[0].trim() : ''
  if (!rawPost || !rawHook) throw new Error('Authority post: missing post or hook in output')
  const usedType: AuthorityType = isAuthorityType(parsed.type) ? parsed.type : register

  const stripDashes = (txt: string) => txt.replace(/\s*[—–]\s*/g, ', ')
  // Blank line after every thought (same rule as story posts).
  const blankLineThoughts = (txt: string) =>
    txt.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/([^\n])\n(?!\n)/g, '$1\n\n')

  const postText = blankLineThoughts(
    stripDashes((await sanitizeDashesText(rawPost, { ...logCtx, surface: 'authority_post' })).trim()),
  )
  // Hook hard caps: 12 words, dash-free, quote-free (it renders on the image).
  let hookLine = stripDashes(rawHook).replace(/["“”]/g, '').trim()
  const words = hookLine.split(/\s+/)
  if (words.length > 12) hookLine = words.slice(0, 12).join(' ')

  logger.info({ ...logCtx, register, usedType, words: postText.split(/\s+/).length }, '[authority-post] generated')
  return { postText, hookLine, usedType }
}
