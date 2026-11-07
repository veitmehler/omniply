import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { StepRunner } from './step-runner'
import { DuplicateKeywordError, validatePrimaryKeywordUniqueness } from './keyword-validator'
import { assignOutlineFramework } from './outline-assignment'
import { sanitizeKeywordJson, sanitizeKeywordText } from './keyword-sanitizer'
import type { PipelineContext } from './variable-resolver'
import { extractCitationsForValidation, validateCitationUrls } from './citation-validator'
import { insertInlineCitations } from './citation-inserter'
import { rankCitationPool, enrichTitles } from './citation-policy'
import { cleanStepOutput } from './approval-service'
import { getBoss, QUEUES } from '../queues/index'
import { resolveGroundingUrls } from './grounding-resolver'
import { injectClientStory } from './client-stories/select'
import { sanitizeDashes } from '../lib/text/dash-sanitizer'
import { gateHedges } from '../lib/text/hedge-gate'

const PHASE_A_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MAX_KEYWORD_RETRIES = 3

/** Prose steps that get em-dash elimination right after completion (title + final
 * fact-adjusted body — the body MUST be sanitized before inline-citation insertion,
 * since tier 2 skips sentences containing markup). See
 * .plans/de-ai-writing.implementation-plan.md. */
const DASH_SANITIZE_STEPS = new Set([0, 11])

/** The fact-adjusted body gets the narrated-constraint gate (hedge-gate.ts)
 * before dash sanitation, so any rewrite is dash-cleaned too. */
const HEDGE_GATE_STEPS = new Set([11])

/** Steps whose Gemini grounding sources should be captured as research sources (Tier 1 citations). */
const GROUNDING_CAPTURE_STEPS = new Set([6, 7, 8, 10])

/** Executes Phase A (Steps 0–12) for a given ArticleJob. */
export async function runPipelinePhaseA(jobId: string): Promise<void> {
  // Load job + topic
  const job = await prisma.articleJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { topic: true },
  })

  // Fill topic.realCaseStudies from the account's client-story bank if the user hasn't
  // provided their own — before any step reads it. Best-effort: never blocks the pipeline.
  await injectClientStory(job.topicId).catch((err) =>
    logger.warn({ jobId, err }, '[article-pipeline] client-story injection failed (non-fatal)'),
  )

  const userId = job.userId
  const topicId = job.topicId

  // Build initial context
  const ctx: PipelineContext = {
    jobId,
    userId,
    topicId,
    topicText: job.topic.topic,
    topicSlug: job.topic.slug,
    completedSteps: new Map(),
    parsedSteps: new Map(),
  }

  // Pre-load any already-completed steps (for resume support)
  const existingSteps = await prisma.pipelineStep.findMany({
    where: { jobId, status: 'completed' },
    orderBy: { stepNumber: 'asc' },
  })
  for (const step of existingSteps) {
    ctx.completedSteps.set(step.stepNumber, step.output ?? '')
    if ([2, 12, 13].includes(step.stepNumber) && step.output) {
      try {
        ctx.parsedSteps.set(step.stepNumber, JSON.parse(step.output))
      } catch { /* ignore */ }
    }
  }

  // Atomically claim the job — only proceed if it is not already in_progress.
  // This prevents a parallel pg-boss re-pick from running Phase A twice.
  const claimed = await prisma.articleJob.updateMany({
    where: { id: jobId, status: { notIn: ['in_progress'] } },
    data: { status: 'in_progress', startedAt: new Date() },
  })
  if (claimed.count === 0) {
    logger.warn({ jobId }, '[executor] job already in_progress — aborting duplicate execution')
    return
  }

  // pg-boss retry support (throughput plan 1f): clear failed step rows so the
  // resume logic re-runs only what actually failed — completed steps stay.
  // Mirrors the manual salvage procedure used during the 2026-07-11 prod E2E.
  const clearedFailed = await prisma.pipelineStep.deleteMany({
    where: { jobId, status: 'failed' },
  })
  if (clearedFailed.count > 0) {
    logger.info({ jobId, clearedFailed: clearedFailed.count }, '[executor] cleared failed steps for retry resume')
  }

  // Pre-flight: ensure the topic has an outline framework assigned.
  // Runs here (in the worker) instead of in POST /api/topics so the HTTP
  // response is fast and not subject to Vercel's serverless function timeout.
  // Idempotent — does nothing if a framework is already set.
  try {
    await assignOutlineFramework(topicId)
  } catch (err) {
    // assignOutlineFramework already falls back to framework #1 internally;
    // any unexpected failure here is logged and we continue with whatever the topic has.
    logger.warn({ jobId, topicId, err }, '[executor] outline auto-assignment failed — continuing')
  }

  for (const stepNumber of PHASE_A_STEPS) {
    // Skip already-completed steps (resume support)
    if (ctx.completedSteps.has(stepNumber)) {
      logger.info({ jobId, stepNumber }, '[executor] skipping already-completed step')
      continue
    }

    logger.info({ jobId, stepNumber }, '[executor] running step')

    try {
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { currentStep: stepNumber },
      })

      if (stepNumber === 2) {
        await executeStep2WithValidation(jobId, stepNumber, ctx)
      } else {
        const result = await new StepRunner(jobId, stepNumber, ctx).execute()

        // Strip local-intent keyword modifiers ("near me" etc.) from plain-text keyword steps
        let stepOutput = result.output
        if (stepNumber === 3 || stepNumber === 6) {
          stepOutput = sanitizeKeywordText(stepOutput, stepNumber, jobId)
        }

        if (HEDGE_GATE_STEPS.has(stepNumber) && process.env.HEDGE_GATE !== '0') {
          try {
            const g = await gateHedges(stepOutput, { jobId, stepNumber })
            if (g.changed) {
              stepOutput = g.text
              await prisma.pipelineStep.updateMany({
                where: { jobId, stepNumber, status: 'completed' },
                data: { output: stepOutput },
              })
            }
            logger.info(
              { jobId, stepNumber, flagged: g.flagged, rewritten: g.rewritten, deleted: g.deleted, kept: g.kept, boundaryKept: g.boundaryKept, noiseRemoved: g.noiseRemoved, llmCalls: g.llmCalls, cost: g.cost },
              '[executor] hedge gate ran',
            )
          } catch (err) {
            logger.warn({ jobId, stepNumber, err }, '[executor] hedge gate failed — output kept as-is')
          }
        }

        if (DASH_SANITIZE_STEPS.has(stepNumber)) {
          try {
            const s = await sanitizeDashes(stepOutput, { jobId, stepNumber })
            if (s.changed) {
              stepOutput = s.text
              await prisma.pipelineStep.updateMany({
                where: { jobId, stepNumber, status: 'completed' },
                data: { output: stepOutput },
              })
              logger.info(
                { jobId, stepNumber, llmCalls: s.llmCalls, kept: s.kept },
                '[executor] dash-sanitized step output',
              )
            }
          } catch (err) {
            logger.warn({ jobId, stepNumber, err }, '[executor] dash sanitize failed — output kept as-is')
          }
        }

        ctx.completedSteps.set(stepNumber, stepOutput)
        if (result.parsedOutput !== undefined) {
          ctx.parsedSteps.set(stepNumber, result.parsedOutput)
        }

        // Capture grounding sources from Gemini search steps for Tier 1 citations
        if (GROUNDING_CAPTURE_STEPS.has(stepNumber) && result.groundingSources?.length) {
          try {
            const resolved = await resolveGroundingUrls(result.groundingSources, stepNumber, jobId)
            if (!ctx.researchSources) ctx.researchSources = []
            const existing = new Set(ctx.researchSources.map((s) => s.url))
            for (const src of resolved) {
              if (!existing.has(src.url)) {
                ctx.researchSources.push(src)
                existing.add(src.url)
              }
            }
          } catch (err) {
            logger.warn({ jobId, stepNumber, err }, '[executor] grounding URL resolution failed — continuing')
          }
        }
      }
    } catch (err) {
      logger.error({ jobId, stepNumber, err }, '[executor] step failed — aborting pipeline')
      await prisma.articleJob.update({
        where: { id: jobId },
        data: { status: 'failed' },
      })
      await updateJobMetrics(jobId)
      throw err
    }

    // Update metrics after each step
    await updateJobMetrics(jobId)
  }

  await ensurePhaseAInlineCitations(jobId, ctx)

  // Persist accumulated research sources so the approval service can reconstruct them.
  // Stored as step 120 (synthetic, not a real LLM step) to avoid schema changes.
  if (ctx.researchSources?.length) {
    const sourcesJson = JSON.stringify(ctx.researchSources)
    await prisma.pipelineStep.upsert({
      where: { jobId_stepNumber: { jobId, stepNumber: 120 } },
      create: {
        jobId,
        stepNumber: 120,
        stepName: 'research_sources',
        status: 'completed',
        output: sourcesJson,
        completedAt: new Date(),
      },
      update: { output: sourcesJson, completedAt: new Date() },
    })
    logger.info({ jobId, count: ctx.researchSources.length }, '[executor] persisted research sources as step 120')
  }

  // Phase A complete → hand off to the automated quality gate. The job sits in a
  // dedicated 'reviewing' status (not 'completed') so the UI never shows it as
  // "awaiting manual approval" while the gate evaluates / rewrites / re-gates.
  await prisma.articleJob.update({
    where: { id: jobId },
    data: { status: 'reviewing', currentStep: 12 },
  })
  logger.info({ jobId }, '[executor] Phase A complete — handing off to quality gate (status=reviewing)')

  try {
    const boss = await getBoss()
    await boss.send(QUEUES.ARTICLE_QUALITY_GATE, { jobId })
    logger.info({ jobId }, '[executor] enqueued quality gate')
  } catch (err) {
    // Fallback only: if we can't enqueue the gate, drop to 'completed' so the
    // article can still be approved manually.
    logger.error({ jobId, err }, '[executor] failed to enqueue quality gate — falling back to manual approval (status=completed)')
    await prisma.articleJob
      .update({ where: { id: jobId }, data: { status: 'completed' } })
      .catch(() => {})
  }
}

/**
 * Robustly extract the primary keyword string from whatever JSON shape an LLM returns.
 * Handles all observed Gemini / OpenAI response variants:
 *   { primary_keyword: "string" }
 *   { primary_keyword: { keyword: "string", ... } }
 *   { keyword_research: { primary_keyword: { keyword: "string" } } }
 *   { keywords: [{ type: "Primary Keyword", keyword: "string" }, ...] }
 */
function extractPrimaryKeyword(parsed: Record<string, unknown> | undefined): string | undefined {
  if (!parsed) return undefined

  // Helper to unwrap a leaf that may be a plain string or an object with a keyword/value/term field
  function unwrap(v: unknown): string | undefined {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const leaf = o.keyword ?? o.value ?? o.term ?? o.phrase
      if (typeof leaf === 'string' && leaf.trim()) return leaf.trim()
    }
    return undefined
  }

  // 1. Top-level primary_keyword / primaryKeyword / "Primary Keyword"
  const direct =
    unwrap(parsed.primary_keyword) ??
    unwrap(parsed.primaryKeyword) ??
    unwrap(parsed['Primary Keyword'])
  if (direct) return direct

  // 2. Wrapped inside a keyword_research object: { keyword_research: { primary_keyword: ... } }
  if (parsed.keyword_research && typeof parsed.keyword_research === 'object') {
    const kr = extractPrimaryKeyword(parsed.keyword_research as Record<string, unknown>)
    if (kr) return kr
  }

  // 3. keywords array: [{ type: "Primary Keyword", keyword: "..." }]
  if (Array.isArray(parsed.keywords)) {
    const kwArray = parsed.keywords as Array<Record<string, unknown>>
    const pkEntry = kwArray.find((k) => {
      const t = String(k.type ?? k.keyword_type ?? k.category ?? '').toLowerCase()
      return t.includes('primary')
    })
    const candidate = pkEntry ?? kwArray[0]
    if (candidate) {
      const kw = unwrap(candidate.keyword ?? candidate.value ?? candidate.term ?? candidate)
      if (kw) return kw
    }
  }

  return undefined
}

/** Special handling for Step 2: retry up to 3 times if the primary keyword is not unique. */
async function executeStep2WithValidation(
  jobId: string,
  stepNumber: number,
  ctx: PipelineContext,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_KEYWORD_RETRIES; attempt++) {
    // Delete any failed or previous attempt for this step
    await prisma.pipelineStep.deleteMany({
      where: { jobId, stepNumber, status: { not: 'completed' } },
    })

    const result = await new StepRunner(jobId, stepNumber, ctx).execute()

    // Sanitize local-intent modifiers ("near me" etc.) from all keyword values
    const rawParsed = result.parsedOutput as Record<string, unknown> | undefined
    const sanitizedParsed = rawParsed ? sanitizeKeywordJson(rawParsed, jobId) : undefined
    ctx.completedSteps.set(stepNumber, sanitizedParsed ? JSON.stringify(sanitizedParsed) : result.output)
    if (sanitizedParsed !== undefined) {
      ctx.parsedSteps.set(stepNumber, sanitizedParsed)
    }

    const parsed = sanitizedParsed
    const primaryKeyword = extractPrimaryKeyword(parsed)

    if (!primaryKeyword) {
      logger.warn({ jobId, attempt }, '[executor] step 2 produced no primary keyword — retrying')
      await prisma.pipelineStep.deleteMany({ where: { jobId, stepNumber } })
      ctx.completedSteps.delete(stepNumber)
      ctx.parsedSteps.delete(stepNumber)
      continue
    }

    const validation = await validatePrimaryKeywordUniqueness(primaryKeyword, ctx.userId, jobId)
    if (validation.isUnique) {
      // Upsert a partial SitePage so future jobs' Step 2 can see this keyword
      await prisma.sitePage.upsert({
        where: { jobId },
        create: {
          jobId,
          userId: ctx.userId,
          slug: `pending-${jobId.slice(0, 8)}`,
          title: ctx.topicText,
          primaryKeyword: primaryKeyword.toLowerCase().trim(),
        },
        update: { primaryKeyword: primaryKeyword.toLowerCase().trim() },
      })

      // Invalidate the excluded keywords cache so subsequent steps see the new keyword
      ctx.excludedKeywordsCache = undefined
      return
    }

    // Duplicate keyword — add to topic's exclusion list and retry
    logger.info(
      { jobId, attempt, primaryKeyword, conflict: validation.conflict },
      '[executor] primary keyword duplicate — adding to excluded list and retrying',
    )
    await prisma.topic.update({
      where: { id: ctx.topicId },
      data: { excludedKeywords: { push: primaryKeyword } },
    })
    ctx.excludedKeywordsCache = undefined

    // Delete the step so the runner creates a fresh one next iteration
    await prisma.pipelineStep.deleteMany({ where: { jobId, stepNumber } })
    ctx.completedSteps.delete(stepNumber)
    ctx.parsedSteps.delete(stepNumber)
  }

  throw new DuplicateKeywordError('(exhausted)')
}

/** Sum step costs/tokens and write to ArticleJob. */
async function updateJobMetrics(jobId: string): Promise<void> {
  const steps = await prisma.pipelineStep.findMany({
    where: { jobId, status: 'completed' },
    select: { cost: true, totalTokens: true },
  })
  const totalCost = steps.reduce((s, r) => s + (r.cost ?? 0), 0)
  const totalTokens = steps.reduce((s, r) => s + (r.totalTokens ?? 0), 0)
  await prisma.articleJob.update({
    where: { id: jobId },
    data: { totalCost, totalTokens },
  })
}

/** True when every URL appears as the href of an anchor (string match including query strings). */
function htmlHasCitationAnchorsForUrls(html: string, urls: string[]): boolean {
  return urls.every((url) => {
    if (!url) return false
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`<a\\b[^>]*href\\s*=\\s*(["'])${escaped}\\1`, 'i')
    return re.test(html)
  })
}

/**
 * After Phase A steps 0–12: validate citations and insert inline links into Step 11 HTML.
 *
 * Two-tier approach:
 *   Tier 1 (inline) — research sources gathered from Gemini search grounding (Steps 6, 7, 8, 10)
 *   Tier 2 (bottom-of-page) — Step 12 citations, kept separate
 *
 * If research sources are available, they are used as the primary inline citation pool.
 * Step 12 citations are used as fallback when no research sources exist.
 */
async function ensurePhaseAInlineCitations(jobId: string, ctx: PipelineContext): Promise<void> {
  const step11Raw = ctx.completedSteps.get(11) ?? ctx.completedSteps.get(9) ?? ''
  if (!step11Raw.trim()) return

  const normalized = cleanStepOutput(step11Raw)

  // B12 citation pool: the curated step-12 list (authority ≥ 7) first, then
  // grounding sources that pass the domain policy; everything else is logged
  // and dropped. Grounding titles are host names, so matching titles are
  // fetched for the survivors (the inserter needs something to match claims
  // against — "nih.gov" × 21 is why it invented links in B11).
  const researchPairs = (ctx.researchSources ?? []).map((s) => ({ title: s.title, url: s.url }))
  const step12Raw = ctx.completedSteps.get(12)
  const step12Pairs = step12Raw?.trim() ? extractCitationsForValidation(step12Raw) : []
  const ranked = rankCitationPool(step12Pairs, researchPairs)
  logger.info(
    {
      jobId,
      curated: step12Pairs.length,
      grounding: researchPairs.length,
      pool: ranked.pool.length,
      rejected: ranked.rejected.length,
      rejectedHosts: ranked.rejected.map((r) => { try { return new URL(r.url).hostname } catch { return r.url.slice(0, 30) } }),
    },
    '[executor] step 12.5 — citation pool after domain policy',
  )
  if (ranked.pool.length === 0) return
  const candidatePairs = await enrichTitles(ranked.pool.map((c) => ({ title: c.title, url: c.url })))

  let validated: Awaited<ReturnType<typeof validateCitationUrls>>
  try {
    validated = await validateCitationUrls(candidatePairs, jobId)
  } catch (err) {
    logger.warn({ jobId, err }, '[executor] step 12.5 — citation validation failed, skipping')
    return
  }

  const live = validated.filter((c) => c.status !== 'dead')
  const deadCount = validated.length - live.length
  if (deadCount > 0) {
    logger.warn({ jobId, deadCount }, '[executor] step 12.5 — omitted dead citation URLs')
  }
  if (live.length === 0) return

  const urls = live.map((c) => c.url)
  if (htmlHasCitationAnchorsForUrls(normalized, urls)) {
    logger.info({ jobId }, '[executor] step 12.5 — inline citations already present, skipping')
    return
  }

  logger.info({ jobId, count: live.length, curatedInPool: ranked.pool.filter((c) => c.origin === 'curated').length }, '[executor] step 12.5 — using citation pool')

  try {
    const { linkedHtml, insertedCount } = await insertInlineCitations(normalized, live, jobId, ctx)
    if (linkedHtml === normalized) {
      logger.warn({ jobId, insertedCount }, '[executor] step 12.5 — no HTML change from citation inserter')
      return
    }
    ctx.completedSteps.set(11, linkedHtml)
    await prisma.pipelineStep.updateMany({
      where: { jobId, stepNumber: 11, status: 'completed' },
      data: { output: linkedHtml },
    })
    logger.info({ jobId, insertedCount, total: live.length }, '[executor] step 12.5 — inline citations inserted')
  } catch (err) {
    logger.warn({ jobId, err }, '[executor] step 12.5 — citation insertion failed, continuing')
    return
  }

  await updateJobMetrics(jobId)
}
