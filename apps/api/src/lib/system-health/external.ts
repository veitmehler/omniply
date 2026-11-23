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
  /** The earlier of the registry's and the registrar's date: the registrar's is the one that bites. */
  expiresAt: string | null
  /** RDAP status values, e.g. "client hold" or "redemption period" when a domain has lapsed. */
  status: string[]
  nameservers: string[]
  /** The nameservers point at a parking service: the domain has lapsed or been taken off our DNS. */
  parked: boolean
  error: string | null
}

/** Registry RDAP servers we use directly; rdap.org refuses requests from datacenter addresses. */
const RDAP_BASE: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
  io: 'https://rdap.identitydigital.services/rdap/domain/',
}
const PARKING_NS_RE = /lander|parking|parked|parity\.domains|sedoparking|afternic|bodis|above\.com|expired|suspended/i
const RDAP_HEADERS = { Accept: 'application/rdap+json', 'User-Agent': 'omniply-system-health/1.0' }

interface RdapDomain {
  events?: Array<{ eventAction?: string; eventDate?: string }>
  status?: string[]
  nameservers?: Array<{ ldhName?: string }>
  links?: Array<{ rel?: string; href?: string }>
}

async function rdapGet(url: string): Promise<RdapDomain | null> {
  const res = await withTimeout((signal) => fetch(url, { signal, headers: RDAP_HEADERS, redirect: 'follow' }), 8_000, `rdap ${url}`)
  return res.ok ? ((await res.json()) as RdapDomain) : null
}

const eventDate = (d: RdapDomain | null, action: string) => (d?.events ?? []).find((e) => e.eventAction === action)?.eventDate ?? null

/** Pure part, so the lapse rules can be tested without the network. */
export function readDomainRecords(registry: RdapDomain | null, registrar: RdapDomain | null): DomainExpiry {
  if (!registry) return { expiresAt: null, status: [], nameservers: [], parked: false, error: 'The registry has no record of this domain' }
  const dates = [eventDate(registry, 'expiration'), eventDate(registrar, 'registrar expiration'), eventDate(registrar, 'expiration')].filter((d): d is string => Boolean(d))
  const expiresAt = dates.length ? dates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] : null
  const nameservers = (registry.nameservers ?? []).map((n) => (n.ldhName ?? '').toLowerCase()).filter(Boolean)
  const status = [...new Set([...(registry.status ?? []), ...(registrar?.status ?? [])])]
  const parked = nameservers.some((n) => PARKING_NS_RE.test(n)) || status.some((st) => /hold|redemption|pending delete/i.test(st))
  return { expiresAt, status, nameservers, parked, error: expiresAt ? null : 'The registry record carries no expiry date' }
}

/**
 * Registration state of a domain from the public registry record (RDAP), plus
 * the registrar's own record when the registry links to it.
 *
 * socioply.com lapsed at the registrar on 2026-11-21 and took the deploy
 * pipeline with it. The REGISTRY still showed an expiry a year out that day
 * (registries auto-extend during the grace period), so the date alone would
 * not have caught it. What did change was the nameservers, which moved to a
 * parking service; that is checked too, along with the registrar's own date.
 */
export async function fetchDomainExpiry(domain: string): Promise<DomainExpiry> {
  return cached(`rdap:${domain}`, 6 * 60 * 60_000, async () => {
    try {
      const tld = domain.split('.').pop() ?? ''
      const registry = await rdapGet(`${RDAP_BASE[tld] ?? 'https://rdap.org/domain/'}${encodeURIComponent(domain)}`)
      const related = (registry?.links ?? []).find((l) => l.rel === 'related' && /rdap/i.test(l.href ?? ''))?.href
      const registrar = related ? await rdapGet(related).catch(() => null) : null
      return readDomainRecords(registry, registrar)
    } catch {
      return { expiresAt: null, status: [], nameservers: [], parked: false, error: 'Registry lookup did not answer' }
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
