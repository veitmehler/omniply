/**
 * Per-provider call outcomes, kept in memory and flushed to the database once
 * a minute (ProviderCallStat: one row per provider per UTC hour).
 *
 * Until 2026-11-23 the only record of whether a provider was answering was the
 * container log, which a deploy discards and nobody reads: Gemini returned
 * "402 prepayment credits are depleted" 829 times in a week and the admin had
 * no screen that said so. The System Health dashboard reads these rows.
 *
 * Never throws and never blocks a provider call: recording is a Map update,
 * the write happens on a timer, and a failed flush puts its counts back.
 */
import { logger } from '../logger'

interface Pending {
  ok: number
  failed: number
  skipped: number
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
  lastErrorStatus: number | null
  lastErrorMessage: string | null
}

const FLUSH_MS = 60_000
/** Names used by unit tests and internal plumbing, never real providers. */
const IGNORED = new Set(['circuit-test', 'p', 'cached', 'test'])

const pending = new Map<string, Pending>()
let timer: NodeJS.Timeout | null = null

function slot(provider: string): Pending {
  let p = pending.get(provider)
  if (!p) {
    p = { ok: 0, failed: 0, skipped: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorStatus: null, lastErrorMessage: null }
    pending.set(provider, p)
  }
  return p
}

function ensureTimer(): void {
  if (timer || process.env.VITEST) return
  timer = setInterval(() => {
    void flushCallStats()
  }, FLUSH_MS)
  timer.unref()
}

export function recordCallOutcome(
  provider: string,
  outcome: 'success' | 'error' | 'circuit-open',
  detail?: { status?: number; message?: string },
): void {
  if (!provider || IGNORED.has(provider)) return
  const p = slot(provider)
  const now = new Date()
  if (outcome === 'success') {
    p.ok++
    p.lastSuccessAt = now
  } else if (outcome === 'circuit-open') {
    p.skipped++
  } else {
    p.failed++
    p.lastErrorAt = now
    p.lastErrorStatus = detail?.status ?? null
    p.lastErrorMessage = (detail?.message ?? '').slice(0, 500) || null
  }
  ensureTimer()
}

// ── Spend, measured where the call leaves for the provider ───────────────────

interface PendingSpend {
  provider: string
  model: string
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
}

const pendingSpend = new Map<string, PendingSpend>()

/**
 * Record what one provider call cost. Called by the LLM adapters, the raw
 * Gemini fetches and the image helpers, i.e. at the wire, so it does not
 * matter whether the caller has a user, a job, or remembers to account for it.
 * LLMUsage keeps attributing cost to accounts; this is what the provider bills.
 */
export function recordProviderSpend(
  provider: string,
  model: string,
  cost: number,
  tokens?: { input?: number; output?: number },
): void {
  if (!provider || IGNORED.has(provider) || !Number.isFinite(cost) || cost < 0) return
  const key = `${provider}|${model}`
  let p = pendingSpend.get(key)
  if (!p) {
    p = { provider, model, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 }
    pendingSpend.set(key, p)
  }
  p.cost += cost
  p.calls++
  p.inputTokens += tokens?.input ?? 0
  p.outputTokens += tokens?.output ?? 0
  ensureTimer()
}

/** Test seam: spend waiting to be written. */
export function pendingProviderSpend(): Map<string, PendingSpend> {
  return pendingSpend
}

export function hourBucket(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()))
}

/** Test seam: what is waiting to be written. */
export function pendingCallStats(): Map<string, Pending> {
  return pending
}

async function flushSpend(): Promise<void> {
  if (pendingSpend.size === 0) return
  const batch = [...pendingSpend.values()]
  pendingSpend.clear()
  const at = new Date()
  try {
    const { prisma } = await import('@omniply/shared')
    await prisma.providerSpend.createMany({
      data: batch.map((p) => ({ provider: p.provider, model: p.model, at, cost: p.cost, calls: p.calls, inputTokens: p.inputTokens, outputTokens: p.outputTokens })),
    })
  } catch (err) {
    for (const p of batch) {
      const key = `${p.provider}|${p.model}`
      const cur = pendingSpend.get(key)
      if (cur) {
        cur.cost += p.cost
        cur.calls += p.calls
        cur.inputTokens += p.inputTokens
        cur.outputTokens += p.outputTokens
      } else pendingSpend.set(key, p)
    }
    logger.warn({ err }, '[call-stats] spend flush failed, amounts kept for the next one')
  }
}

export async function flushCallStats(): Promise<void> {
  await flushSpend()
  if (pending.size === 0) return
  const batch = [...pending.entries()]
  pending.clear()
  const bucket = hourBucket(new Date())
  try {
    const { prisma } = await import('@omniply/shared')
    for (const [provider, p] of batch) {
      const last = {
        ...(p.lastSuccessAt ? { lastSuccessAt: p.lastSuccessAt } : {}),
        ...(p.lastErrorAt ? { lastErrorAt: p.lastErrorAt, lastErrorStatus: p.lastErrorStatus, lastErrorMessage: p.lastErrorMessage } : {}),
      }
      await prisma.providerCallStat.upsert({
        where: { provider_bucket: { provider, bucket } },
        create: { provider, bucket, ok: p.ok, failed: p.failed, skipped: p.skipped, ...last },
        update: { ok: { increment: p.ok }, failed: { increment: p.failed }, skipped: { increment: p.skipped }, ...last },
      })
    }
  } catch (err) {
    // Put the counts back so the next flush carries them; a stats write must never cost a provider call.
    for (const [provider, p] of batch) {
      const cur = slot(provider)
      cur.ok += p.ok
      cur.failed += p.failed
      cur.skipped += p.skipped
      cur.lastSuccessAt = cur.lastSuccessAt ?? p.lastSuccessAt
      if (!cur.lastErrorAt && p.lastErrorAt) {
        cur.lastErrorAt = p.lastErrorAt
        cur.lastErrorStatus = p.lastErrorStatus
        cur.lastErrorMessage = p.lastErrorMessage
      }
    }
    logger.warn({ err }, '[call-stats] flush failed, counts kept for the next one')
  }
}
