/**
 * The voice path of the article pipeline (author-voice plan, stage 2).
 *
 * For an account with an enabled voice profile (or a job forced on), the
 * pipeline runs these in place of, or next to, the standard steps:
 *
 *   81  author_take          what this author would say on the topic
 *   82  select_core_facts    the short set of facts the article rests on
 *    9  write_article        the voice writer (prompt `av_writer`)
 *   10  fact_check_article   judges factual claims, leaves convictions alone
 *   11  adjust_incorrect_facts   only the flagged sentences, then markdown to HTML in code
 *   85  own_words            after the writer: source wording and heading echoes restated as the author
 *   83  belief_compliance_check  would the regulator accept each conviction as written
 *   86  belief_containment       the author's own terms kept to the opening, the close and one section
 *   84  author_habit_limits      habits brought back to the author's own rate
 *
 * Step 80 records the decision for the job, so a resumed or rewritten job
 * stays on the path it started on, and a bench can force a job either way.
 *
 * Everything here fails soft where a failure would only cost quality (the take,
 * the selection, the checks) and hard where the article could not be produced.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { runNewsletterPrompt } from '../../newsletter/llm'
import type { LLMResponse } from '../llm/adapter'
import type { VoiceProfile } from '../../lib/voice/profile'
import { authorLimits, authorSays, renderAuthorVoice, renderAuthorVoiceShort, type AuthorLimits } from '../../lib/voice/render'
import { bannedPhraseIn, type EditorIssue, type ParagraphRewriter, type SentenceRewriter } from '../../lib/text/editor-pass'
import type { HedgeRewriter } from '../../lib/text/hedge-gate'
import type { PipelineContext } from '../variable-resolver'
import type { StepRunResult } from '../step-runner'
import { coreStats, factsForSelector, outlineH2s, parseResearchFacts, parseSelection, renderCore, restatesFact, selectCore } from './facts'
import { parseTake, renderTake, takeBeliefs, takeMaterial, type Resting, type Take } from './take'
import { restingFrom, LOOKBACK, type PastArticle } from './rotation'
import { inOwnWords } from './own-words'
import { contain, ordinaryTerms, ownTermsForExplanations } from './containment'
import { applyFixes, fixRequests, parseFactCheck, parseFixes } from './fact-fix'
import { markdownToHtml } from './markdown'
import { applyBeliefFindings, articleForCheck, parseBeliefFindings } from './belief-check'
import { trimHabits } from './habits'

/** Keep the author's own terms to the opening, the close and one section. Off unless a strict regulator calls for it. */
export const BELIEF_ZONES = process.env.VOICE_BELIEF_ZONES === '1'

export const VOICE_STEPS = { mode: 80, take: 81, core: 82, beliefs: 83, habits: 84, ownWords: 85, containment: 86 } as const

export interface VoiceContext {
  profile: VoiceProfile
  /** The full rendering, for the writer. */
  full: string
  /** The short rendering, for a step that repairs one sentence. */
  short: string
  /** Everything the author said, normalised: "does this author use that phrase themselves?" */
  says: string
  limits: AuthorLimits
  /** Rendered take, set once step 81 has run. */
  takeText?: string
  take?: Take
  /** Rendered core facts, set once step 82 has run. */
  coreText?: string
  /** Stories and phrases the author's recent articles already used. */
  rest: Resting
}

interface Usage {
  provider?: string
  model?: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
}

const usageOf = (r: LLMResponse | undefined, started: number): Usage => ({
  provider: r?.provider,
  model: r?.model,
  inputTokens: r?.tokens.input ?? 0,
  outputTokens: r?.tokens.output ?? 0,
  cost: r?.cost ?? 0,
  durationMs: Date.now() - started,
})

/** Store a step this module ran itself, the way the step runner stores its own: a row for resume and for the job's cost. */
async function saveStep(ctx: PipelineContext, stepNumber: number, stepName: string, output: string, u: Usage): Promise<void> {
  const data = {
    stepName,
    status: 'completed',
    provider: u.provider ?? null,
    model: u.model ?? null,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.inputTokens + u.outputTokens,
    cost: u.cost,
    duration: u.durationMs,
    output,
    errorMessage: null,
    completedAt: new Date(),
  }
  await prisma.pipelineStep.upsert({
    where: { jobId_stepNumber: { jobId: ctx.jobId, stepNumber } },
    create: { jobId: ctx.jobId, stepNumber, startedAt: new Date(Date.now() - u.durationMs), ...data },
    update: data,
  })
  ctx.completedSteps.set(stepNumber, output)
  if (u.cost > 0 && u.provider && u.model) {
    await prisma.lLMUsage
      .create({ data: { userId: ctx.userId, jobId: ctx.jobId, source: `pipeline_step_${stepNumber}`, provider: u.provider, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost } })
      .catch((err) => logger.warn({ jobId: ctx.jobId, stepNumber, err }, '[voice] usage row not written (non-fatal)'))
  }
}

/**
 * Decide whether this job runs on the voice path, and load what it needs.
 * A step-80 row forces the job ('on' or 'off'); otherwise the account's profile
 * decides. Without a stored profile there is no voice path, whatever was asked.
 */
export async function resolveVoice(ctx: PipelineContext): Promise<VoiceContext | null> {
  const forced = (ctx.completedSteps.get(VOICE_STEPS.mode) ?? '').trim().toLowerCase()
  if (forced === 'off') return null
  const row = await prisma.voiceProfile.findUnique({ where: { userId: ctx.userId } })
  if (!row) {
    if (forced === 'on') logger.warn({ jobId: ctx.jobId }, '[voice] job forced on the voice path but the account has no voice profile; running the standard path')
    return null
  }
  if (forced !== 'on' && !row.enabled) return null
  const profile = row.profile as unknown as VoiceProfile
  if (!forced) await saveStep(ctx, VOICE_STEPS.mode, 'voice_mode', 'on', { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 })
  const rest = await recentUse(ctx.userId, ctx.jobId, profile).catch((err) => {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] recent articles could not be read; nothing rests for this one')
    return { stories: new Set<number>(), phrases: [] } as Resting
  })
  const voice: VoiceContext = { profile, full: renderAuthorVoice(profile, { restStories: rest.stories }), short: renderAuthorVoiceShort(profile), says: authorSays(profile), limits: authorLimits(profile), rest }
  // A resumed job: pick up what the earlier run produced.
  restore(ctx, voice)
  return voice
}

/**
 * What the author's latest articles on the voice path used: read from their stored take and
 * from the article text itself. An article still being written counts as soon as it has a take.
 */
export async function recentUse(userId: string, jobId: string, profile: VoiceProfile): Promise<Resting> {
  const takes = await prisma.pipelineStep.findMany({
    where: { stepNumber: VOICE_STEPS.take, status: 'completed', jobId: { not: jobId }, job: { userId } },
    orderBy: { completedAt: 'desc' },
    take: LOOKBACK,
    select: { jobId: true, output: true },
  })
  if (!takes.length) return { stories: new Set<number>(), phrases: [] }
  const bodies = await prisma.pipelineStep.findMany({ where: { jobId: { in: takes.map((t) => t.jobId) }, stepNumber: { in: [9, 11] }, status: 'completed' }, select: { jobId: true, stepNumber: true, output: true } })
  const past: PastArticle[] = takes.map((t) => {
    let take: Take | null = null
    try {
      take = (JSON.parse(t.output ?? '') as { take: Take }).take
    } catch {
      /* an unreadable take still leaves the article text */
    }
    const mine = bodies.filter((b) => b.jobId === t.jobId)
    return { take, text: (mine.find((b) => b.stepNumber === 11) ?? mine.find((b) => b.stepNumber === 9))?.output ?? '' }
  })
  return restingFrom(profile, past)
}

function restore(ctx: PipelineContext, voice: VoiceContext): void {
  try {
    const t = ctx.completedSteps.get(VOICE_STEPS.take)
    if (t) {
      const j = JSON.parse(t) as { take: Take; rendered: string }
      voice.take = j.take
      voice.takeText = j.rendered
    }
    const c = ctx.completedSteps.get(VOICE_STEPS.core)
    if (c) voice.coreText = (JSON.parse(c) as { rendered: string }).rendered
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] stored take or core facts unreadable; they will be rebuilt')
    ctx.completedSteps.delete(VOICE_STEPS.take)
    ctx.completedSteps.delete(VOICE_STEPS.core)
  }
}

/**
 * For a step that runs after Phase A and has no pipeline context (enrichment): the author's voice
 * if this job was written on the voice path, else null.
 */
export async function voiceForJob(jobId: string, userId: string): Promise<{ profile: VoiceProfile; short: string; ownTerms: string[] } | null> {
  if (process.env.AUTHOR_VOICE === '0') return null
  const mode = await prisma.pipelineStep.findUnique({ where: { jobId_stepNumber: { jobId, stepNumber: VOICE_STEPS.mode } }, select: { output: true } })
  if ((mode?.output ?? '').trim().toLowerCase() !== 'on') return null
  const row = await prisma.voiceProfile.findUnique({ where: { userId } })
  if (!row) return null
  const profile = row.profile as unknown as VoiceProfile
  let ownTerms: string[] = []
  try {
    const t = await prisma.pipelineStep.findUnique({ where: { jobId_stepNumber: { jobId, stepNumber: VOICE_STEPS.take } }, select: { output: true } })
    ownTerms = (JSON.parse(t?.output ?? '{}') as { take?: Take }).take?.ownTerms ?? []
  } catch {
    /* no stored take: no terms to keep out of the explanations */
  }
  return { profile, short: renderAuthorVoiceShort(profile), ownTerms }
}

/** How this author explains things, for the step that adds explanations: their voice, and the images they reach for themselves. */
export function voiceForExplanations(v: { profile: VoiceProfile; short: string; ownTerms?: string[] }): string {
  const images = v.profile.manner.habits.filter((h) => /metaphor|image|analog|compar|simile|picture/i.test(h.habit)).map((h) => `"${h.example}"`)
  return [
    'Write this as the author would explain it, in their own voice. The author, in their own words:',
    v.short,
    images.length ? `The kind of image this author reaches for: ${images.join(' ')}` : '',
    ownTermsForExplanations(v.ownTerms ?? []),
  ]
    .filter(Boolean)
    .join('\n')
}

const titleOf = (ctx: PipelineContext) => (ctx.completedSteps.get(0) ?? '').trim().replace(/^["#\s]+|["\s]+$/g, '') || ctx.topicText
const headingsOf = (ctx: PipelineContext) => outlineH2s(ctx.completedSteps.get(4) ?? ctx.completedSteps.get(1) ?? '')

/** Step 81: what this author would say on the topic. A failure leaves the article with the author's manner and no stated position. */
export async function runTake(ctx: PipelineContext, voice: VoiceContext): Promise<void> {
  const started = Date.now()
  const p = voice.profile
  const h2s = headingsOf(ctx)
  let take: Take = parseTake('', p, h2s, voice.rest)
  let response: LLMResponse | undefined
  try {
    const m = takeMaterial(p, voice.rest)
    const run = await runNewsletterPrompt(
      'av_take',
      { author_name: p.author.name, industry: p.author.industry, practice: p.author.practice, location: p.author.location, beliefs: m.beliefs, stories: m.stories, habits: m.habits, resting: m.resting, vocabulary: m.vocabulary, title: titleOf(ctx), topic: ctx.topicText, headings: h2s.map((h) => `- ${h}`).join('\n') || '(no outline headings)' },
      { userId: ctx.userId, jsonMode: true },
    )
    response = run.response
    take = parseTake(run.content, p, h2s, voice.rest)
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] take step failed; the article keeps the author\'s manner without a stated position')
  }
  voice.take = take
  voice.takeText = renderTake(take, p, h2s, voice.rest, { zones: BELIEF_ZONES })
  await saveStep(ctx, VOICE_STEPS.take, 'author_take', JSON.stringify({ take, rendered: voice.takeText, resting: { stories: [...voice.rest.stories], phrases: voice.rest.phrases } }), usageOf(response, started))
  logger.info(
    { jobId: ctx.jobId, hasPosition: take.hasPosition, beliefs: take.beliefs.length, myth: take.myth !== null, story: take.story !== null, sections: take.sections.length, home: take.home ?? null, ownTerms: take.ownTerms?.length ?? 0, restingStories: voice.rest.stories.size, restingPhrases: voice.rest.phrases.length },
    '[voice] author take',
  )
}

/** Step 82: the core facts. A failed selection falls back to a choice made in code, so the writer always gets a short set. */
export async function runCoreFacts(ctx: PipelineContext, voice: VoiceContext): Promise<void> {
  const started = Date.now()
  const facts = parseResearchFacts(ctx.completedSteps.get(8), ctx.completedSteps.get(7))
  const h2s = headingsOf(ctx)
  let picks: ReturnType<typeof parseSelection> = []
  let response: LLMResponse | undefined
  if (facts.length > 0) {
    try {
      const run = await runNewsletterPrompt(
        'av_fact_select',
        { title: titleOf(ctx), headings: h2s.map((h) => `- ${h}`).join('\n'), position: voice.take?.hasPosition ? voice.take.position : '(the author has stated no position on this topic)', facts: factsForSelector(facts) },
        { userId: ctx.userId, jsonMode: true },
      )
      response = run.response
      picks = parseSelection(run.content)
    } catch (err) {
      logger.warn({ jobId: ctx.jobId, err }, '[voice] fact selection failed; the core is chosen in code')
    }
  }
  const core = selectCore(facts, picks, h2s)
  const stats = coreStats(core)
  voice.coreText = renderCore(core)
  const ids = (xs: Array<{ id: number }>) => xs.map((f) => f.id)
  await saveStep(
    ctx,
    VOICE_STEPS.core,
    'select_core_facts',
    JSON.stringify({ stats, selectorUsed: picks.length > 0, sections: core.sections.map((s) => ({ heading: s.heading, facts: ids(s.facts) })), safety: ids(core.safety), reserve: ids(core.reserve), rendered: voice.coreText }),
    usageOf(response, started),
  )
  logger.info({ jobId: ctx.jobId, researched: facts.length, selectorUsed: picks.length > 0, ...stats }, '[voice] core facts selected')
}

/**
 * Step 11 on the voice path: correct only the sentences the fact check failed,
 * then turn the draft into body HTML in code. Returns what the step runner
 * would, so the gates that follow run unchanged.
 */
export async function runVoiceCorrection(ctx: PipelineContext, voice: VoiceContext): Promise<StepRunResult> {
  const started = Date.now()
  const draft = ctx.completedSteps.get(9) ?? ''
  if (!draft.trim()) throw new Error('voice correction: the writer produced no draft (step 9 is empty)')
  const claims = parseFactCheck(ctx.completedSteps.get(10) ?? '')
  const { requests, notFound } = fixRequests(draft, claims)
  let text = draft
  let response: LLMResponse | undefined
  let outcome = { applied: 0, deleted: 0, refused: 0 }
  if (requests.length > 0) {
    try {
      const run = await runNewsletterPrompt(
        'av_fact_fix',
        {
          author_name: voice.profile.author.name,
          author_voice: voice.short,
          requests: requests.map((r) => `#${r.id}\nSentence: ${r.sentence}\nIts paragraph: ${r.paragraph}\nThe fact check found: ${r.problem}`).join('\n\n'),
        },
        { userId: ctx.userId, jsonMode: true },
      )
      response = run.response
      const r = applyFixes(draft, requests, parseFixes(run.content))
      text = r.text
      outcome = { applied: r.applied, deleted: r.deleted, refused: r.refused }
    } catch (err) {
      // The draft is still the author's article; an uncorrected claim is caught again by the quality gate.
      logger.warn({ jobId: ctx.jobId, err }, '[voice] fact correction call failed; the draft goes on uncorrected')
    }
  }
  const html = markdownToHtml(text)
  const u = usageOf(response, started)
  await saveStep(ctx, 11, 'adjust_incorrect_facts', html, u)
  logger.info({ jobId: ctx.jobId, claims: claims.length, failed: claims.filter((c) => !c.ok).length, located: requests.length, notFound: notFound.length, ...outcome }, '[voice] fact correction, flagged sentences only')
  return { output: html, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, durationMs: u.durationMs, provider: u.provider ?? 'code', model: u.model ?? 'code' }
}

/**
 * Step 85, straight after the writer: sentences that repeat a source's wording, and section openers
 * that say their heading back, are restated as the author. It runs before the fact check, so the
 * fact check reads the wording that will be published. A failure leaves the draft as written.
 */
export async function runOwnWords(ctx: PipelineContext, voice: VoiceContext, draft: string): Promise<string> {
  const started = Date.now()
  try {
    const facts = parseResearchFacts(ctx.completedSteps.get(8), ctx.completedSteps.get(7))
    const r = await inOwnWords(draft, facts, voiceRewriters(ctx, voice).sentence)
    await saveStep(ctx, VOICE_STEPS.ownWords, 'own_words', JSON.stringify({ openers: r.openers, lifted: r.lifted, llmCalls: r.llmCalls, changes: r.changes.slice(0, 40) }), { inputTokens: 0, outputTokens: 0, cost: r.cost, durationMs: Date.now() - started })
    logger.info({ jobId: ctx.jobId, openers: r.openers, lifted: r.lifted, llmCalls: r.llmCalls }, '[voice] draft restated in the author\'s own words')
    return r.text
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] own-words pass failed; the draft goes on as written')
    return draft
  }
}

/** Step 86: the author's own terms stay in the opening, the close and the home section, and are never defined as fact. */
export async function runContainment(ctx: PipelineContext, voice: VoiceContext, html: string): Promise<string> {
  const started = Date.now()
  const terms = voice.take?.ownTerms ?? []
  if (!terms.length) return html
  try {
    // A capitalised term that research uses as a plain word is the author's only where the capital is a choice.
    const ordinary = ordinaryTerms(terms, `${ctx.completedSteps.get(7) ?? ''} ${ctx.completedSteps.get(8) ?? ''}`)
    const r = await contain(html, terms, voice.take?.home ?? null, headingsOf(ctx).length, voiceRewriters(ctx, voice).sentence, ordinary, BELIEF_ZONES)
    const { html: out, cost, ...counts } = r
    await saveStep(ctx, VOICE_STEPS.containment, 'belief_containment', JSON.stringify({ terms, ...counts }), { inputTokens: 0, outputTokens: 0, cost, durationMs: Date.now() - started })
    logger.info({ jobId: ctx.jobId, terms: terms.length, home: r.home, carrying: r.carrying, outside: r.outside, moved: r.moved, removed: r.removed, defined: r.defined, restated: r.restated }, '[voice] belief language contained')
    return out
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] containment failed; the article goes on unchanged')
    return html
  }
}

/** Step 83: the compliance check of the author's convictions. Returns the article, changed where a sentence would not pass. */
export async function runBeliefCheck(ctx: PipelineContext, voice: VoiceContext, html: string, jurisdiction: string): Promise<string> {
  const started = Date.now()
  try {
    const run = await runNewsletterPrompt(
      'av_belief_check',
      {
        jurisdiction: jurisdiction || 'the country the practice is in',
        industry: voice.profile.author.industry,
        author_voice: voice.short,
        author_convictions: voice.take ? takeBeliefs(voice.take, voice.profile) : '(none on record)',
        article: articleForCheck(html),
      },
      { userId: ctx.userId, jsonMode: true },
    )
    const researched = parseResearchFacts(ctx.completedSteps.get(8), ctx.completedSteps.get(7))
    const r = applyBeliefFindings(html, parseBeliefFindings(run.content), { isFinding: (s) => restatesFact(s, researched, 0.45) })
    await saveStep(ctx, VOICE_STEPS.beliefs, 'belief_compliance_check', JSON.stringify({ jurisdiction, found: r.found, applied: r.applied, changes: r.changes, open: r.open }), usageOf(run.response, started))
    logger.info({ jobId: ctx.jobId, found: r.found, applied: r.applied, open: r.open.length }, '[voice] belief compliance check')
    return r.html
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] belief compliance check failed; the article goes on unchanged')
    return html
  }
}

const HEDGE_REASON =
  'It narrates a limit instead of saying something: what you cannot say, how thin the evidence is, or your own caution. Say what you know or think, plainly, in the same space. If nothing is left once the narration is gone, output [DELETE].'

/** Sentence and paragraph fixers that write as the author, and the exemptions an author's own habits earn. */
export function voiceRewriters(ctx: PipelineContext, voice: VoiceContext): {
  sentence: SentenceRewriter
  paragraph: ParagraphRewriter
  hedge: HedgeRewriter
  exempt: (plain: string, issue: EditorIssue) => boolean
  keepNoise: boolean
} {
  const base = { author_name: voice.profile.author.name, author_voice: voice.short }
  const sentence: SentenceRewriter = async (s, reason, before) => {
    const run = await runNewsletterPrompt('av_sentence_fix', { ...base, sentence: s, reason, before }, { userId: ctx.userId })
    return { text: run.content.trim(), cost: run.response.cost }
  }
  return {
    sentence,
    paragraph: async (paragraph, heading) => {
      const run = await runNewsletterPrompt('av_paragraph_fix', { ...base, paragraph, heading }, { userId: ctx.userId })
      return { text: run.content.trim(), cost: run.response.cost }
    },
    hedge: (s, before) => sentence(s, HEDGE_REASON, before),
    // A stock phrase is a tell only when this author does not use it themselves.
    exempt: (plain, issue) => {
      if (issue !== 'phrase') return false
      const phrase = bannedPhraseIn(plain)
      return !!phrase && voice.says.includes(phrase.toLowerCase().replace(/[‘’]/g, "'"))
    },
    keepNoise: /\b(h+m+|um+|uh+)\b[!,.]/.test(voice.says),
  }
}

/** Step 84: bring questions and exclamations back to the author's own rate. */
export async function runHabitTrim(ctx: PipelineContext, voice: VoiceContext, html: string): Promise<string> {
  const started = Date.now()
  try {
    const r = await trimHabits(html, voice.limits, voiceRewriters(ctx, voice).sentence)
    await saveStep(ctx, VOICE_STEPS.habits, 'author_habit_limits', JSON.stringify({ limits: voice.limits, counts: r.counts, llmCalls: r.llmCalls }), { inputTokens: 0, outputTokens: 0, cost: r.cost, durationMs: Date.now() - started })
    logger.info({ jobId: ctx.jobId, counts: r.counts, llmCalls: r.llmCalls }, '[voice] habits against the author\'s own rate')
    return r.html
  } catch (err) {
    logger.warn({ jobId: ctx.jobId, err }, '[voice] habit limits failed; the article goes on unchanged')
    return html
  }
}
