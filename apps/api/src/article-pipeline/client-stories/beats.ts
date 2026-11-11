/**
 * Story bank — onboarding beats (Veit 2026-11-11).
 *
 * Every spoken onboarding answer (declaration, enemy, myths, tribe, line,
 * moments, proof) plus the writing sample is scanned for real stories. Each
 * story is rewritten by `cs_beat_extract` into a publishable first-person beat
 * (names gone, cause/cure turned into observation, grey-zone substances
 * generic) and stored in `client_stories` with source 'onboarding'. A
 * deterministic lint runs after the model; a beat that still trips it is
 * dropped, never flagged for a human. Idempotent: upsert on the hash of the
 * owner's original excerpt.
 *
 * One pool feeds both consumers: articles (select.ts) and social story arcs
 * (bank.ts → story-arc.ts). The authority engine's "proof" pool is rebuilt
 * from the same rows.
 */
import { createHash } from 'crypto'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { runNewsletterJsonPrompt } from '../../newsletter/llm'

export const VOICE_STEPS = ['q_declaration', 'q_enemy', 'q_myths', 'q_tribe', 'q_line', 'q_moments', 'q_proof', 'writing_sample'] as const

export interface Transcript {
  step: string
  text: string
}

export interface ExtractedBeat {
  step?: string
  originalExcerpt?: string
  kind?: string
  text?: string
  topicTags?: unknown
}

/** Pull the spoken answers (and the writing sample) out of an onboarding session's stepData. */
export function transcriptsFromStepData(stepData: unknown): Transcript[] {
  const sd = (stepData && typeof stepData === 'object' ? stepData : {}) as Record<string, unknown>
  const out: Transcript[] = []
  for (const step of VOICE_STEPS) {
    const a = sd[step]
    const text = typeof a === 'string' ? a : a && typeof a === 'object' ? String((a as { text?: unknown }).text ?? '') : ''
    const t = text.trim()
    if (t.length >= 40) out.push({ step, text: t })
  }
  return out
}

/** Grey-zone substances and certainty words that must never reach a published beat. */
const BANNED_RE =
  /\b(peptides?|bpc[- ]?157|tb[- ]?500|semaglutide|ozempic|wegovy|tirzepatide|ivermectin|hcg|testosterone|steroids?|hgh|growth hormone|nandrolone|sarms?|clenbuterol|ketamine|psilocybin|ibogaine)\b|\b(the true cause|cured|cures?\b|healed|reversed|fixed (?:her|his|their)|poison(?:ed|ing)?)\b|(?<!\b(?:no|not|never|don't|can't|won't|without|isn't|wasn't)\s)\bguarantee[ds]?\b/i
/** Honorific + capitalised name, the one name shape the model keeps slipping through. */
const NAMED_PERSON_RE = /\b(Dr|Doctor|Mr|Mrs|Ms|Nurse|Coach)\.?\s+[A-Z][a-z]+/
const EXACT_AGE_RE = /\b(?:aged?|age of|years? old)\b[^.]{0,6}\b\d{2}\b|\b\d{2}-year-old\b/i

export interface LintResult {
  ok: boolean
  reason?: string
}

/** Deterministic gate after the model. A failing beat is dropped (no human review step). */
export function lintBeat(text: string): LintResult {
  const t = text.trim()
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  if (t.length < 60) return { ok: false, reason: 'too short' }
  if (sentences.length > 5) return { ok: false, reason: 'too long' }
  const banned = t.match(BANNED_RE)
  if (banned) return { ok: false, reason: `banned term: ${banned[0]}` }
  if (NAMED_PERSON_RE.test(t)) return { ok: false, reason: 'named person' }
  if (EXACT_AGE_RE.test(t)) return { ok: false, reason: 'exact age' }
  return { ok: true }
}

export function beatHash(originalExcerpt: string): string {
  return createHash('sha256').update(originalExcerpt.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex')
}

function cleanTags(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().toLowerCase()).slice(0, 4) : []
}

export interface BeatStoreResult {
  extracted: number
  stored: number
  dropped: Array<{ reason: string; text: string }>
}

/**
 * Extract + sanitize + upsert beats for an account from its transcripts.
 * `runPrompt` is injectable for tests.
 */
export async function extractAndStoreBeats(
  accountId: string,
  transcripts: Transcript[],
  ctx: Record<string, unknown> = {},
  runPrompt: (vars: Record<string, string>) => Promise<{ beats?: ExtractedBeat[] }> = async (vars) =>
    (await runNewsletterJsonPrompt<{ beats?: ExtractedBeat[] }>('cs_beat_extract', vars, { maxTokens: 4096 })).data,
): Promise<BeatStoreResult> {
  const result: BeatStoreResult = { extracted: 0, stored: 0, dropped: [] }
  if (transcripts.length === 0) return result
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  const brand = account?.ownerUserId ? await brandSettingsForUser(account.ownerUserId) : null
  const blocks = transcripts.map((t) => `[step: ${t.step}]\n${t.text.slice(0, 8000)}`).join('\n\n')
  const data = await runPrompt({
    ownerName: brand?.defaultAuthorName ?? brand?.organizationName ?? 'the owner',
    industry: brand?.industry ?? '',
    businessName: brand?.organizationName ?? '',
    transcripts: blocks,
  })
  const beats = Array.isArray(data?.beats) ? data.beats : []
  result.extracted = beats.length
  for (const b of beats) {
    const text = (b.text ?? '').trim()
    const original = (b.originalExcerpt ?? '').trim()
    if (!text || !original) {
      result.dropped.push({ reason: 'empty', text })
      continue
    }
    const lint = lintBeat(text)
    if (!lint.ok) {
      result.dropped.push({ reason: lint.reason ?? 'lint', text })
      logger.info({ ...ctx, accountId, reason: lint.reason, text: text.slice(0, 120) }, '[client-stories/beats] beat dropped by lint')
      continue
    }
    const kind = b.kind === 'owner_moment' ? 'owner_moment' : 'client_case'
    const sourceHash = beatHash(original)
    await prisma.clientStory.upsert({
      where: { accountId_sourceHash: { accountId, sourceHash } },
      create: { accountId, storyText: text, topicTags: cleanTags(b.topicTags), source: 'onboarding', kind, originalText: original, sourceHash },
      update: { storyText: text, topicTags: cleanTags(b.topicTags), kind, originalText: original },
    })
    result.stored++
  }
  await syncProofPool(accountId).catch((err) => logger.warn({ ...ctx, accountId, err }, '[client-stories/beats] proof pool sync failed'))
  logger.info({ ...ctx, accountId, ...result, dropped: result.dropped.length }, '[client-stories/beats] onboarding beats stored')
  return result
}

/** Run extraction from the account's stored onboarding session (completion hook + backfill). */
export async function extractBeatsFromOnboardingSession(accountId: string, ctx: Record<string, unknown> = {}): Promise<BeatStoreResult | null> {
  const session = await prisma.onboardingSession.findUnique({ where: { accountId }, select: { stepData: true } })
  if (!session) return null
  const transcripts = transcriptsFromStepData(session.stepData)
  if (transcripts.length === 0) return { extracted: 0, stored: 0, dropped: [] }
  return extractAndStoreBeats(accountId, transcripts, ctx)
}

/**
 * The authority engine's "proof" register draws from brand_settings.authorityPools.proof.
 * Rebuild it from the bank so the engine never sees the raw transcript again.
 */
export async function syncProofPool(accountId: string): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  if (!account?.ownerUserId) return
  const brand = await brandSettingsForUser(account.ownerUserId)
  if (!brand) return
  const rows = await prisma.clientStory.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' }, select: { storyText: true } })
  const pools = brand.authorityPools && typeof brand.authorityPools === 'object' && !Array.isArray(brand.authorityPools) ? { ...(brand.authorityPools as Record<string, unknown>) } : {}
  pools.proof = rows.map((r) => r.storyText)
  await prisma.brandSettings.update({ where: { userId: brand.userId }, data: { authorityPools: pools as object } })
}
