/**
 * System Health: what we read from outside. Everything here is cached in
 * memory and failure-tolerant: a status page that does not answer makes its
 * own cell read "no answer", it never fails the dashboard.
 */
import { withTimeout } from '../net/with-timeout'
import { twilioConfigured, getTwilioBalance } from '../twilio'

interface Cached<T> {
  at: number
  value: T
}
const cache = new Map<string, Cached<unknown>>()

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Test seam. */
export function clearExternalCache(): void {
  cache.clear()
}

export interface ProviderStatus {
  /** none = all good | minor | major | critical | maintenance | unreachable */
  indicator: string
  description: string
}

/** A provider's own status, from an Atlassian-style …/api/v2/status.json feed. */
export async function fetchStatusFeed(url: string): Promise<ProviderStatus> {
  return cached(`status:${url}`, 5 * 60_000, async () => {
    try {
      const res = await withTimeout((signal) => fetch(url, { signal, headers: { Accept: 'application/json' } }), 5_000, `status feed ${url}`)
      if (!res.ok) return { indicator: 'unreachable', description: `Status feed answered ${res.status}` }
      const data = (await res.json()) as { status?: { indicator?: string; description?: string } }
      return { indicator: data.status?.indicator ?? 'unreachable', description: data.status?.description ?? 'No status in the feed' }
    } catch {
      return { indicator: 'unreachable', description: 'Status feed did not answer' }
    }
  })
}

export interface DomainExpiry {
  expiresAt: string | null
  /** RDAP status values, e.g. "client hold" or "redemption period" when a domain has lapsed. */
  status: string[]
  error: string | null
}

/**
 * Registration expiry of a domain from the public registry record (RDAP).
 * socioply.com lapsed on 2026-11-21 without anyone noticing and took the deploy
 * pipeline with it; this is what would have shown it weeks ahead.
 */
export async function fetchDomainExpiry(domain: string): Promise<DomainExpiry> {
  return cached(`rdap:${domain}`, 12 * 60 * 60_000, async () => {
    try {
      const res = await withTimeout(
        (signal) => fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal, headers: { Accept: 'application/rdap+json' }, redirect: 'follow' }),
        8_000,
        `rdap ${domain}`,
      )
      if (!res.ok) return { expiresAt: null, status: [], error: `Registry lookup answered ${res.status}` }
      const data = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }>; status?: string[] }
      const exp = (data.events ?? []).find((e) => e.eventAction === 'expiration')?.eventDate ?? null
      return { expiresAt: exp, status: data.status ?? [], error: exp ? null : 'The registry record carries no expiry date' }
    } catch {
      return { expiresAt: null, status: [], error: 'Registry lookup did not answer' }
    }
  })
}

export interface LiveBalance {
  balance: number | null
  currency: string
  error: string | null
}

/** Balances a provider lets us read. Twilio today; fal.ai, the CRM wallet and DigitalOcean are the next ones. */
export async function fetchLiveBalance(serviceKey: string): Promise<LiveBalance> {
  return cached(`balance:${serviceKey}`, 5 * 60_000, async () => {
    try {
      if (serviceKey === 'twilio') {
        if (!twilioConfigured()) return { balance: null, currency: 'USD', error: 'Twilio credentials are not configured' }
        const b = await getTwilioBalance()
        return { balance: b.balance, currency: b.currency, error: null }
      }
      return { balance: null, currency: 'USD', error: 'Reading this balance is not built yet' }
    } catch (err) {
      return { balance: null, currency: 'USD', error: err instanceof Error ? err.message.slice(0, 160) : 'Balance lookup failed' }
    }
  })
}
