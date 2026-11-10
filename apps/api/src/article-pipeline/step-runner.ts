import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getLLMAdapter } from './llm/factory'
import { LLMError } from './llm/adapter'
import { cleanTextOutput, cleanAndParseJSON } from './output-cleaner'
import { resolveVariables } from './variable-resolver'
import type { PipelineContext } from './variable-resolver'

// Steps whose output is parsed as JSON
const JSON_STEPS = new Set([2, 12, 13])

// Steps that use Gemini generative search
// B16: step 6 (questions people ask) now reads real People Also Ask data via Oxylabs ({{paa_candidates}}); no grounding.
const SEARCH_STEPS = new Set([7, 8, 10, 12])

// Steps that need BOTH search grounding AND structured JSON output.
// Gemini can't do both in one call, so we use a two-phase approach:
//   Phase 1 — search call → returns grounded prose research
//   Phase 2 — standard call with jsonMode:true → converts prose to JSON
const SEARCH_JSON_STEPS = new Set([12])

// B16: research feeds must come from retrieved pages, not recall.
const GROUNDING_REQUIRED_STEPS = new Set([7, 8])
const FORCED_SEARCH_PREFIX =
  'MANDATORY: use the Google Search tool to find every fact below. Never answer from memory. The URL in each source tag must be a page you retrieved in this session for that fact; leave out any fact you cannot retrieve a page for.'

// Fallback token budget for JSON steps when no per-step maxTokens is set in the DB.
// Avoids truncation before the full JSON structure is emitted.
const JSON_STEP_MAX_TOKENS = 16384

// Set VERBOSE_LLM_LOGS=true in the environment to log full prompts + responses.
// Set VERBOSE_LLM_LOGS_TRUNCATE=0 to disable truncation (logs full text).
const VERBOSE = process.env.VERBOSE_LLM_LOGS === 'true'
const TRUNCATE = parseInt(process.env.VERBOSE_LLM_LOGS_TRUNCATE ?? '3000', 10)

function truncate(s: string, n: number): string {
  if (n <= 0) return s
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s
}

const MAX_RETRIES = 5
const BASE_RETRY_DELAY_MS = 1000
const BACKOFF_MULTIPLIER = 2

/** Stable fallback model used when the configured Gemini search model exhausts all retries. */
import { resolvePromptByStep } from '../lib/prompt-resolver'

const GEMINI_SEARCH_FALLBACK_MODEL = 'gemini-3.1-pro-preview'
const FALLBACK_RETRIES = 3

export interface StepRunResult {
  output: string
  parsedOutput?: unknown
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
  provider: string
  model: string
  groundingSources?: Array<{ title: string; uri: string; domain?: string }>
  groundingSupports?: Array<{ text: string; chunkIndices: number[] }>
  groundingChunkUris?: Array<string | null>
}

export class StepRunner {
  constructor(
    private jobId: string,
    private stepNumber: number,
    private ctx: PipelineContext,
  ) {}

  async execute(): Promise<StepRunResult> {
    const template = await resolvePromptByStep(this.stepNumber, { userId: this.ctx.userId })

    if (!template || !template.isActive) {
      throw new Error(`No active prompt template found for step ${this.stepNumber}`)
    }

    // Resolve variables in both prompts
    const [systemPrompt, userPrompt] = await Promise.all([
      template.systemPrompt ? resolveVariables(template.systemPrompt, this.ctx) : Promise.resolve(null),
      resolveVariables(template.userPrompt, this.ctx),
    ])

    const provider = template.defaultProvider
    const model = template.defaultModel
    const useSearch = SEARCH_STEPS.has(this.stepNumber)
    const isJsonStep = JSON_STEPS.has(this.stepNumber)
    const isTwoPhase = SEARCH_JSON_STEPS.has(this.stepNumber)

    // Guard: if this step is already completed (parallel execution race), skip it
    const existingStep = await prisma.pipelineStep.findUnique({
      where: { jobId_stepNumber: { jobId: this.jobId, stepNumber: this.stepNumber } },
      select: { status: true, output: true },
    })
    if (existingStep?.status === 'completed') {
      logger.warn({ jobId: this.jobId, step: this.stepNumber },
        '[step-runner] step already completed — skipping (parallel execution guard)')
      return {
        output: existingStep.output ?? '',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        durationMs: 0,
        provider: 'cached',
        model: 'cached',
      }
    }

    // Create/update the PipelineStep row to 'running'
    await prisma.pipelineStep.upsert({
      where: { jobId_stepNumber: { jobId: this.jobId, stepNumber: this.stepNumber } },
      create: {
        jobId: this.jobId,
        stepNumber: this.stepNumber,
        stepName: template.stepName,
        status: 'running',
        provider,
        model,
        startedAt: new Date(),
      },
      update: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
        retryCount: { increment: 0 },
      },
    })

    let lastError: LLMError | Error | null = null
    let attempt = 0
    const startTime = Date.now()

    while (attempt < MAX_RETRIES) {
      attempt++
      try {
        const adapter = getLLMAdapter(provider)

        // ── Phase 1: search-grounded research call ─────────────────────────
        // For two-phase steps (e.g. Step 12), run the search call first to get
        // grounded prose, then hand it to Phase 2 to extract structured JSON.
        let searchResearch: string | undefined
        let phase1Tokens = { input: 0, output: 0, total: 0 }
        let phase1Cost = 0
        if (isTwoPhase) {
          if (VERBOSE) {
            logger.info(
              { jobId: this.jobId, step: this.stepNumber, provider, model, phase: 1, userPrompt: truncate(userPrompt, TRUNCATE) },
              '[llm-verbose] PROMPT (phase-1 search)',
            )
          }
          const searchResponse = await adapter.call({
            systemPrompt,
            userPrompt,
            model,
            maxTokens: JSON_STEP_MAX_TOKENS,
            useGenerativeSearch: true,
          })
          searchResearch = searchResponse.content
          phase1Tokens = searchResponse.tokens
          phase1Cost = searchResponse.cost
          // For two-phase steps, grounding sources come from the search phase
          var searchGroundingSources = searchResponse.groundingSources
          var searchGroundingSupports = searchResponse.groundingSupports
          var searchGroundingChunkUris = searchResponse.groundingChunkUris
          if (VERBOSE) {
            logger.info(
              { jobId: this.jobId, step: this.stepNumber, phase: 1, response: truncate(searchResearch, TRUNCATE) },
              '[llm-verbose] RESPONSE (phase-1 search)',
            )
          }
          logger.info(
            { jobId: this.jobId, step: this.stepNumber, researchLength: searchResearch.length },
            '[step-runner] phase-1 search complete; proceeding to phase-2 JSON extraction',
          )
        }

        // ── Phase 2 (or standard call) ─────────────────────────────────────
        // For two-phase steps, build a lean structuring prompt from the phase-1
        // research.  For all other steps, use the original prompt as-is.
        const phase2UserPrompt = isTwoPhase && searchResearch
          ? buildStructuringPrompt(this.stepNumber, searchResearch)
          : userPrompt

        const phase2SystemPrompt = isTwoPhase ? null : systemPrompt

        if (VERBOSE) {
          logger.info(
            {
              jobId: this.jobId,
              step: this.stepNumber,
              provider,
              model,
              phase: isTwoPhase ? 2 : undefined,
              systemPrompt: phase2SystemPrompt ? truncate(phase2SystemPrompt, TRUNCATE) : null,
              userPrompt: truncate(phase2UserPrompt, TRUNCATE),
            },
            isTwoPhase ? '[llm-verbose] PROMPT (phase-2 json)' : '[llm-verbose] PROMPT',
          )
        }

        let llmResponse = await adapter.call({
          systemPrompt: phase2SystemPrompt,
          userPrompt: phase2UserPrompt,
          model,
          // Fix B: larger token budget for JSON steps — model must finish emitting
          // the full JSON structure without truncation mid-array.
          // Per-step value from DB takes precedence; fall back to JSON_STEP_MAX_TOKENS
          // for JSON steps (prevents mid-array truncation). Text steps with no DB value
          // pass undefined so each adapter uses its own safe default (8192 for
          // Anthropic/Gemini, model default for OpenAI).
          maxTokens: template.maxTokens ?? (isJsonStep ? JSON_STEP_MAX_TOKENS : undefined),
          // Two-phase steps use jsonMode (no search) in phase 2.
          // Other search steps continue using search grounding.
          useGenerativeSearch: isTwoPhase ? false : useSearch,
          jsonMode: isTwoPhase ? true : false,
        })

        // B16: on long research prompts Gemini often answers from memory without
        // calling Google Search (probe 2026-11-09: 11.7k chars, zero grounding
        // metadata). A grounded step that returns no grounding is re-run once
        // with the search made mandatory in the prompt itself.
        if (useSearch && !isTwoPhase && GROUNDING_REQUIRED_STEPS.has(this.stepNumber) && !(llmResponse.groundingSources?.length)) {
          logger.warn({ jobId: this.jobId, step: this.stepNumber }, '[step-runner] grounded step returned no grounding — retrying with mandatory search')
          const forced = await adapter.call({
            systemPrompt: phase2SystemPrompt,
            userPrompt: `${FORCED_SEARCH_PREFIX}\n\n${phase2UserPrompt}`,
            model,
            maxTokens: template.maxTokens ?? (isJsonStep ? JSON_STEP_MAX_TOKENS : undefined),
            useGenerativeSearch: true,
            jsonMode: false,
          })
          if (forced.groundingSources?.length) {
            llmResponse = {
              ...forced,
              tokens: { input: llmResponse.tokens.input + forced.tokens.input, output: llmResponse.tokens.output + forced.tokens.output, total: llmResponse.tokens.total + forced.tokens.total },
              cost: llmResponse.cost + forced.cost,
            }
          } else {
            logger.warn({ jobId: this.jobId, step: this.stepNumber }, '[step-runner] mandatory-search retry still ungrounded — keeping first output')
          }
        }

        if (VERBOSE) {
          logger.info(
            {
              jobId: this.jobId,
              step: this.stepNumber,
              provider,
              model,
              inputTokens: llmResponse.tokens.input,
              outputTokens: llmResponse.tokens.output,
              cost: llmResponse.cost,
              response: truncate(llmResponse.content, TRUNCATE),
            },
            isTwoPhase ? '[llm-verbose] RESPONSE (phase-2 json)' : '[llm-verbose] RESPONSE',
          )
        }

        const rawOutput = llmResponse.content
        let finalOutput: string
        let parsedOutput: unknown | undefined

        if (isJsonStep) {
          // Fix C: JSON parse failure is a real error for JSON steps — throw so
          // the retry loop can attempt recovery instead of silently storing prose.
          const { data, log } = cleanAndParseJSON(rawOutput)
          parsedOutput = data
          finalOutput = JSON.stringify(data)
          if (log.fixes.length) {
            logger.info(
              { jobId: this.jobId, step: this.stepNumber, fixes: log.fixes },
              '[step-runner] JSON fixes applied',
            )
          }
        } else {
          finalOutput = cleanTextOutput(rawOutput)
        }

        const durationMs = Date.now() - startTime

        // Accumulate tokens / cost across both phases for accurate accounting.
        const totalInputTokens  = llmResponse.tokens.input  + phase1Tokens.input
        const totalOutputTokens = llmResponse.tokens.output + phase1Tokens.output
        const totalTokens       = llmResponse.tokens.total  + phase1Tokens.total
        const totalCost         = llmResponse.cost           + phase1Cost

        // Always-on completion log: maxTokens ceiling + actual usage + stop signal.
        // finishReason 'length' means the model was cut off — a warning follows.
        const configuredMaxTokens = template.maxTokens ?? (isJsonStep ? JSON_STEP_MAX_TOKENS : undefined)
        logger.info(
          {
            jobId: this.jobId,
            step: this.stepNumber,
            stepName: template.stepName,
            provider,
            model,
            maxTokens: configuredMaxTokens ?? null,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            finishReason: llmResponse.finishReason,
            durationMs,
          },
          '[step-runner] step completed',
        )
        if (llmResponse.finishReason === 'length') {
          logger.warn(
            {
              jobId: this.jobId,
              step: this.stepNumber,
              stepName: template.stepName,
              outputTokens: totalOutputTokens,
              maxTokens: configuredMaxTokens ?? null,
            },
            '[step-runner] output may be truncated — model stopped at token limit (finishReason: length)',
          )
        }

        // Persist step result
        await prisma.pipelineStep.update({
          where: { jobId_stepNumber: { jobId: this.jobId, stepNumber: this.stepNumber } },
          data: {
            status: 'completed',
            output: finalOutput,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens,
            cost: totalCost,
            duration: durationMs,
            retryCount: attempt - 1,
            completedAt: new Date(),
          },
        })

        // Write LLMUsage row (combined across both phases). Model from the
        // RESPONSE, not the template: the adapter may resolve the configured id
        // to an env-overridden one (anthropic-models.ts) and telemetry must
        // show what actually ran.
        await prisma.lLMUsage.create({
          data: {
            userId: this.ctx.userId,
            jobId: this.jobId,
            source: `pipeline_step_${this.stepNumber}`,
            provider,
            model: llmResponse.model ?? model,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cost: totalCost,
          },
        })

        // Collect grounding sources — from the search phase for two-phase steps,
        // otherwise from the main LLM call for regular search steps.
        const sources = isTwoPhase
          ? searchGroundingSources
          : llmResponse.groundingSources
        const supports = isTwoPhase ? searchGroundingSupports : llmResponse.groundingSupports
        const chunkUris = isTwoPhase ? searchGroundingChunkUris : llmResponse.groundingChunkUris

        return {
          output: finalOutput,
          parsedOutput,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cost: totalCost,
          durationMs,
          provider,
          model,
          ...(sources?.length ? { groundingSources: sources } : {}),
          ...(supports?.length ? { groundingSupports: supports, groundingChunkUris: chunkUris ?? [] } : {}),
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const llmErr = err instanceof LLMError ? err : null

        logger.warn(
          {
            jobId: this.jobId,
            step: this.stepNumber,
            attempt,
            quotaType: llmErr?.quotaType,
            err: lastError.message,
          },
          '[step-runner] LLM call failed',
        )

        // Daily quota → fail immediately, no retry
        if (llmErr?.quotaType === 'daily') break

        if (attempt < MAX_RETRIES) {
          const sleepMs = llmErr?.retryAfterSeconds
            ? llmErr.retryAfterSeconds * 1000
            : BASE_RETRY_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1)
          logger.info({ jobId: this.jobId, step: this.stepNumber, sleepMs }, '[step-runner] retrying after delay')
          await sleep(sleepMs)
        }
      }
    }

    // ── Fallback: retry with stable GA model if the primary Gemini search model failed ──────────────
    // Only activates when (a) provider is gemini, (b) the step uses search grounding, and
    // (c) the configured model is not already the fallback (avoids infinite recursion).
    if (provider === 'gemini' && useSearch && model !== GEMINI_SEARCH_FALLBACK_MODEL) {
      logger.warn(
        {
          jobId: this.jobId,
          step: this.stepNumber,
          primaryModel: model,
          fallbackModel: GEMINI_SEARCH_FALLBACK_MODEL,
          primaryAttempts: attempt,
        },
        '[step-runner] primary model exhausted retries — falling back to stable model',
      )

      for (let fbAttempt = 1; fbAttempt <= FALLBACK_RETRIES; fbAttempt++) {
        try {
          const adapter = getLLMAdapter(provider)

          // ── Fallback Phase 1: search-grounded call with fallback model ──────
          let searchResearch: string | undefined
          let phase1Tokens = { input: 0, output: 0, total: 0 }
          let phase1Cost = 0
          let fbSearchGroundingSources: Array<{ title: string; uri: string; domain?: string }> | undefined
          let fbSearchGroundingSupports: Array<{ text: string; chunkIndices: number[] }> | undefined
          let fbSearchGroundingChunkUris: Array<string | null> | undefined
          if (isTwoPhase) {
            const searchResponse = await adapter.call({
              systemPrompt,
              userPrompt,
              model: GEMINI_SEARCH_FALLBACK_MODEL,
              maxTokens: JSON_STEP_MAX_TOKENS,
              useGenerativeSearch: true,
            })
            searchResearch = searchResponse.content
            phase1Tokens = searchResponse.tokens
            phase1Cost = searchResponse.cost
            fbSearchGroundingSources = searchResponse.groundingSources
            fbSearchGroundingSupports = searchResponse.groundingSupports
            fbSearchGroundingChunkUris = searchResponse.groundingChunkUris
            logger.info(
              { jobId: this.jobId, step: this.stepNumber, researchLength: searchResearch.length },
              '[step-runner] fallback phase-1 search complete; proceeding to phase-2',
            )
          }

          // ── Fallback Phase 2 (or standard call) ─────────────────────────────
          const fbPhase2UserPrompt = isTwoPhase && searchResearch
            ? buildStructuringPrompt(this.stepNumber, searchResearch)
            : userPrompt
          const fbPhase2SystemPrompt = isTwoPhase ? null : systemPrompt

          const llmResponse = await adapter.call({
            systemPrompt: fbPhase2SystemPrompt,
            userPrompt: fbPhase2UserPrompt,
            model: GEMINI_SEARCH_FALLBACK_MODEL,
            maxTokens: template.maxTokens ?? (isJsonStep ? JSON_STEP_MAX_TOKENS : undefined),
            useGenerativeSearch: isTwoPhase ? false : useSearch,
            jsonMode: isTwoPhase ? true : false,
          })

          const rawOutput = llmResponse.content
          let finalOutput: string
          let parsedOutput: unknown | undefined

          if (isJsonStep) {
            const { data, log } = cleanAndParseJSON(rawOutput)
            parsedOutput = data
            finalOutput = JSON.stringify(data)
            if (log.fixes.length) {
              logger.info(
                { jobId: this.jobId, step: this.stepNumber, fixes: log.fixes },
                '[step-runner] JSON fixes applied (fallback)',
              )
            }
          } else {
            finalOutput = cleanTextOutput(rawOutput)
          }

          const durationMs = Date.now() - startTime
          const totalInputTokens  = llmResponse.tokens.input  + phase1Tokens.input
          const totalOutputTokens = llmResponse.tokens.output + phase1Tokens.output
          const totalTokens       = llmResponse.tokens.total  + phase1Tokens.total
          const totalCost         = llmResponse.cost           + phase1Cost

          await prisma.pipelineStep.update({
            where: { jobId_stepNumber: { jobId: this.jobId, stepNumber: this.stepNumber } },
            data: {
              status: 'completed',
              output: finalOutput,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens,
              cost: totalCost,
              duration: durationMs,
              retryCount: attempt + fbAttempt - 1,
              completedAt: new Date(),
            },
          })

          await prisma.lLMUsage.create({
            data: {
              userId: this.ctx.userId,
              jobId: this.jobId,
              source: `pipeline_step_${this.stepNumber}`,
              provider,
              model: GEMINI_SEARCH_FALLBACK_MODEL,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cost: totalCost,
            },
          })

          logger.info(
            { jobId: this.jobId, step: this.stepNumber, model: GEMINI_SEARCH_FALLBACK_MODEL, fbAttempt },
            '[step-runner] fallback model succeeded',
          )

          const fbSources = isTwoPhase
            ? fbSearchGroundingSources
            : llmResponse.groundingSources
          const fbSupports = isTwoPhase ? fbSearchGroundingSupports : llmResponse.groundingSupports
          const fbChunkUris = isTwoPhase ? fbSearchGroundingChunkUris : llmResponse.groundingChunkUris

          return {
            output: finalOutput,
            parsedOutput,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cost: totalCost,
            durationMs,
            provider,
            model: GEMINI_SEARCH_FALLBACK_MODEL,
            ...(fbSources?.length ? { groundingSources: fbSources } : {}),
            ...(fbSupports?.length ? { groundingSupports: fbSupports, groundingChunkUris: fbChunkUris ?? [] } : {}),
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          const llmErr = err instanceof LLMError ? err : null

          logger.warn(
            {
              jobId: this.jobId,
              step: this.stepNumber,
              fbAttempt,
              quotaType: llmErr?.quotaType,
              err: lastError.message,
            },
            '[step-runner] fallback LLM call failed',
          )

          // Daily quota on fallback → stop immediately
          if (llmErr?.quotaType === 'daily') break

          if (fbAttempt < FALLBACK_RETRIES) {
            const sleepMs = llmErr?.retryAfterSeconds
              ? llmErr.retryAfterSeconds * 1000
              : BASE_RETRY_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, fbAttempt - 1)
            logger.info({ jobId: this.jobId, step: this.stepNumber, sleepMs }, '[step-runner] fallback retrying after delay')
            await sleep(sleepMs)
          }
        }
      }
    }

    // All retries (primary + fallback) exhausted — record failure
    const durationMs = Date.now() - startTime
    const errorMessage = lastError?.message ?? 'Unknown error'
    const quotaType =
      lastError instanceof LLMError ? (lastError.quotaType ?? 'unknown') : 'unknown'

    await prisma.pipelineStep.update({
      where: { jobId_stepNumber: { jobId: this.jobId, stepNumber: this.stepNumber } },
      data: {
        status: 'failed',
        errorMessage,
        retryCount: attempt - 1,
        duration: durationMs,
        completedAt: new Date(),
      },
    })

    await prisma.errorLog.create({
      data: {
        userId: this.ctx.userId,
        jobId: this.jobId,
        errorType: quotaType === 'daily' ? 'quota_exhausted' : quotaType === 'rate_limit' ? 'rate_limit' : 'api_error',
        errorMessage,
        stackTrace: lastError instanceof Error ? lastError.stack : undefined,
      },
    })

    throw lastError ?? new Error(`Step ${this.stepNumber} failed after ${attempt} attempts`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Builds a lean JSON-structuring prompt for two-phase steps.
 * Phase 1 produces grounded prose research; this prompt converts it to JSON.
 */
function buildStructuringPrompt(stepNumber: number, research: string): string {
  if (stepNumber === 12) {
    return `You are given grounded research about article citation sources.
Extract all citation sources mentioned in the research and return them as structured JSON.

Research:
${research}

Return ONLY valid JSON in this exact format — no markdown, no code fences, no commentary:
{
  "resource_links": [
    { "link_title": "<source title>", "link_url": "<source URL>", "link_date": "<publication date if known, else empty string>" },
    { "link_title": "<source title>", "link_url": "<source URL>", "link_date": "<publication date if known, else empty string>" }
  ]
}

Rules:
- Include only sources that have a real URL (skip any with placeholder or missing URLs).
- For link_date, use the format "Month YYYY" (e.g. "May 2025") or "YYYY" if only the year is known. Leave as "" if unknown.
- Aim for 8-12 entries.
- Output ONLY the JSON object. Nothing else.`
  }
  // Generic fallback: ask the model to structure whatever JSON the research implies.
  return `Convert the following research output into clean, structured JSON.
Return ONLY the JSON object. No commentary, no markdown fences.

Research:
${research}`
}
