/**
 * System Health: the pure rules. No database, no network, so every number on
 * the dashboard and every alert decision can be tested directly.
 */

export interface LedgerEntry {
  kind: string // 'set' | 'topup'
  amount: number
  at: Date
}

export interface TrackedBalance {
  /** null = nothing recorded yet, so there is no balance to show. */
  balance: number | null
  /** Metered spend is subtracted from this moment on. */
  since: Date | null
  /** The stated balance or first top-up the calculation starts from. */
  base: number
  /** Top-ups added after the starting point. */
  toppedUp: number
  /** Our metered spend since `since`. */
  spent: number
}

/**
 * A tracked balance starts at the most recent "the account showed $X" entry;
 * with none recorded it starts at the first top-up. Later top-ups add, our
 * metered spend since the starting point subtracts.
 *
 * `spendSince` is handed the starting moment and returns the metered spend from
 * then on, so the caller decides where spend comes from (LLMUsage in practice).
 */
export function trackedBalanceStart(ledger: LedgerEntry[]): { since: Date; base: number; toppedUp: number } | null {
  if (ledger.length === 0) return null
  const sorted = [...ledger].sort((a, b) => a.at.getTime() - b.at.getTime())
  let startIdx = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].kind === 'set') {
      startIdx = i
      break
    }
  }
  if (startIdx === -1) startIdx = 0 // no stated balance: the first top-up is the start
  const start = sorted[startIdx]
  const toppedUp = sorted.slice(startIdx + 1).filter((e) => e.kind === 'topup').reduce((acc, e) => acc + e.amount, 0)
  return { since: start.at, base: start.amount, toppedUp }
}

export function trackedBalance(ledger: LedgerEntry[], spentSince: number): TrackedBalance {
  const start = trackedBalanceStart(ledger)
  if (!start) return { balance: null, since: null, base: 0, toppedUp: 0, spent: 0 }
  return { balance: start.base + start.toppedUp - spentSince, since: start.since, base: start.base, toppedUp: start.toppedUp, spent: spentSince }
}

/**
 * Daily spend used for runway: the higher of the 7-day and the 30-day average.
 * The higher one is the cautious one. After an outage the last 7 days read
 * near zero (Gemini, Nov 14 to 23: $0.16 a day against $2.94 before), and a
 * runway built on that would look endless right when it matters.
 */
export function dailySpend(spent7d: number, spent30d: number): number {
  return Math.max(spent7d / 7, spent30d / 30)
}

/** Days the balance lasts at the given daily spend. null = no balance known; Infinity = nothing is being spent. */
export function runwayDays(balance: number | null, perDay: number): number | null {
  if (balance === null) return null
  if (balance <= 0) return 0
  if (perDay <= 0) return Infinity
  return balance / perDay
}

export type CreditLevel = 'unknown' | 'ok' | 'warn' | 'critical' | 'depleted'

export function creditLevel(balance: number | null, runway: number | null, warnDays: number, criticalDays: number): CreditLevel {
  if (balance === null || runway === null) return 'unknown'
  if (balance <= 0) return 'depleted'
  if (runway < criticalDays) return 'critical'
  if (runway < warnDays) return 'warn'
  return 'ok'
}

/**
 * An error that means "add money", not "try again". Gemini reports its empty
 * prepaid balance as 402, and per Google's own forum sometimes as 429 with the
 * same sentence, so the text is matched as well as the code.
 */
const BILLING_ERROR_RE =
  /prepayment credits are depleted|payment required|credit balance is too low|insufficient (?:credits?|balance|funds|quota)|billing (?:hard )?limit|exceeded your current quota|account (?:is )?(?:suspended|past due)|out of credits?/i

export function isBillingError(status: number | null | undefined, message: string | null | undefined): boolean {
  return status === 402 || BILLING_ERROR_RE.test(message ?? '')
}

export interface CallWindow {
  ok: number
  failed: number
  skipped: number
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
  lastErrorStatus: number | null
  lastErrorMessage: string | null
}

export type ServiceState = 'unknown' | 'idle' | 'ok' | 'degraded' | 'down' | 'blocked'

/**
 * What our own calls say about a provider, from the last 7 days of stats.
 *  - blocked:  the latest failure is a billing error and nothing has succeeded since
 *  - down:     5 or more failed or skipped calls in the last hour and nothing has succeeded since the latest failure
 *  - degraded: failures in the last 24 hours, but calls are getting through
 *  - ok:       calls getting through, no failures in 24 hours
 *  - idle:     no calls at all in 7 days
 *  - unknown:  the service is not called through the instrumented layer
 */
export function serviceState(hasCallProvider: boolean, week: CallWindow, day: CallWindow, hour: CallWindow): ServiceState {
  if (!hasCallProvider) return 'unknown'
  if (week.ok + week.failed + week.skipped === 0) return 'idle'
  const failingNow = week.lastErrorAt !== null && (week.lastSuccessAt === null || week.lastSuccessAt.getTime() < week.lastErrorAt.getTime())
  if (failingNow && isBillingError(week.lastErrorStatus, week.lastErrorMessage)) return 'blocked'
  if (failingNow && hour.failed + hour.skipped >= 5) return 'down'
  if (day.failed + day.skipped > 0) return 'degraded'
  return 'ok'
}

export type AlertLevel = 'warn' | 'critical' | 'depleted' | 'blocked' | 'down'

/** The one condition worth alerting on for a service right now, worst first. null = nothing to say. */
export function alertLevelFor(credit: CreditLevel, state: ServiceState): AlertLevel | null {
  if (state === 'blocked') return 'blocked'
  if (credit === 'depleted') return 'depleted'
  if (state === 'down') return 'down'
  if (credit === 'critical') return 'critical'
  if (credit === 'warn') return 'warn'
  return null
}

const SEVERITY: Record<AlertLevel, number> = { warn: 1, critical: 2, down: 3, depleted: 4, blocked: 4 }

export const ALERT_REMINDER_MS = 24 * 60 * 60 * 1000

/**
 * Whether to send now, given what was last alerted for this service:
 *  - a condition appears, or gets worse  → send
 *  - the same condition 24 hours later   → send a reminder
 *  - it eases to a milder one, or clears → stay quiet
 */
export function shouldAlert(current: AlertLevel | null, lastLevel: string | null, lastAt: Date | null, now: Date): 'send' | 'remind' | 'quiet' {
  if (!current) return 'quiet'
  const last = lastLevel && lastLevel in SEVERITY ? (lastLevel as AlertLevel) : null
  if (!last || SEVERITY[current] > SEVERITY[last]) return 'send'
  if (lastAt && now.getTime() - lastAt.getTime() >= ALERT_REMINDER_MS) return 'remind'
  return 'quiet'
}

/** Critical enough for a text message: production has stopped, or will within days, on a service we cannot run without. */
export function needsSms(level: AlertLevel, isCore: boolean): boolean {
  return isCore && level !== 'warn'
}
