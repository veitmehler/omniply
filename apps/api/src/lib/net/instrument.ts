import { logger } from '../logger'
import { statusOf } from './retry'
import { getCircuitBreaker } from './circuit-breaker'
import { Semaphore } from '../concurrency'
import { recordCallOutcome } from './call-stats'

/**
 * Global per-provider concurrency caps — the guard rail that makes the Phase-1
 * parallelization safe under multi-client bursts. Module-level = spans every
 * job on this worker. Env-tunable: PROVIDER_CONCURRENCY_<NAME>=n.
 * See .plans/production-throughput.implementation-plan.md Phase 1d.
 */
// Sized against actual account tiers (2026-07-11): Anthropic Scale tier +
// Gemini API Tier 2 — both leave these far below hard limits; Anthropic's
// binding constraint is TPM on long writer calls, not request count. OpenAI
// tier unconfirmed → moderate. fal has its own queue semantics.
const DEFAULT_PROVIDER_CONCURRENCY: Record<string, number> = {
  gemini: 16,
  anthropic: 8,
  openai: 6,
  'fal-ai': 5,
}
const FALLBACK_CONCURRENCY = 6
const SLOW_WAIT_LOG_MS = 5_000

const providerSemaphores = new Map<string, Semaphore>()

function providerSemaphore(provider: string): Semaphore {
  let sem = providerSemaphores.get(provider)
  if (!sem) {
    const envKey = `PROVIDER_CONCURRENCY_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
    const fromEnv = Number(process.env[envKey])
    const max = Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : DEFAULT_PROVIDER_CONCURRENCY[provider] ?? FALLBACK_CONCURRENCY
    sem = new Semaphore(max)
    providerSemaphores.set(provider, sem)
  }
  return sem
}

/**
 * Wrap an external call with structured timing/outcome logging, a per-provider
 * circuit breaker, AND enrich a failure's message with provider/op/status/
 * duration before re-throwing.
 *
 * Why enrich the message rather than just log: the 2026-07-08 Fal 403 incident
 * surfaced as a bare "Forbidden" in SocialAutomationSpecResult.error — no
 * provider, no status code, no duration. That field only ever stores
 * `err.message` (see matrix-processor.ts / story-processor.ts catch blocks),
 * so a structured log line alone wouldn't have fixed what the admin UI and
 * sendFailureAlert actually show. Enriching the message at the source means
 * every downstream consumer (DB error field, alert emails, admin UI, logs)
 * gets the context for free with no changes anywhere else.
 *
 * The original message is preserved verbatim as a suffix so callers that
 * pattern-match on it (parseAnthropicError/parseOpenAIError/parseGeminiError
 * keyword-match for 429/quota/etc.) keep working unmodified.
 *
 * Why a circuit breaker here specifically: Phases 1-5 bound and gracefully
 * handle any ONE call's failure, but during a SUSTAINED outage (the 403
 * incident lasted far longer than any single call's timeout budget) every
 * call still pays its full timeout/retry cost before failing. Once a
 * provider has failed `failureThreshold` times in a row, skip straight to
 * failure — frees worker capacity immediately instead of one multi-minute
 * timeout at a time. See lib/net/circuit-breaker.ts.
 */
export async function instrumentCall<T>(
  meta: { provider: string; op: string },
  fn: () => Promise<T>,
): Promise<T> {
  const breaker = getCircuitBreaker(meta.provider)
  try {
    breaker.assertClosed()
  } catch (err) {
    logger.warn({ provider: meta.provider, op: meta.op, outcome: 'circuit-open' }, '[net] call skipped — circuit open')
    recordCallOutcome(meta.provider, 'circuit-open')
    throw err
  }

  // Per-provider concurrency gate (global across jobs). Acquired AFTER the
  // breaker check so an open circuit never queues waiters.
  const sem = providerSemaphore(meta.provider)
  const waitStart = Date.now()
  const release = await sem.acquire()
  const waitedMs = Date.now() - waitStart
  if (waitedMs > SLOW_WAIT_LOG_MS) {
    logger.warn(
      { provider: meta.provider, op: meta.op, waitedMs, pending: sem.pending },
      '[net] provider concurrency gate wait',
    )
  }

  const start = Date.now()
  try {
    const result = await fn()
    breaker.onSuccess()
    recordCallOutcome(meta.provider, 'success')
    logger.info(
      { provider: meta.provider, op: meta.op, durationMs: Date.now() - start, outcome: 'success' },
      '[net] call succeeded',
    )
    return result
  } catch (err) {
    breaker.onFailure()
    const durationMs = Date.now() - start
    const status = statusOf(err)
    const rawMessage = err instanceof Error ? err.message : String(err)
    recordCallOutcome(meta.provider, 'error', { status, message: rawMessage })

    logger.warn(
      { provider: meta.provider, op: meta.op, durationMs, status, outcome: 'error', message: rawMessage },
      '[net] call failed',
    )

    const enriched = new Error(
      `${meta.provider} ${meta.op}${status !== undefined ? ` (${status})` : ''} failed after ${durationMs}ms: ${rawMessage}`,
    )
    if (err instanceof Error && err.stack) enriched.stack = err.stack
    enriched.cause = err
    throw enriched
  } finally {
    release()
  }
}
