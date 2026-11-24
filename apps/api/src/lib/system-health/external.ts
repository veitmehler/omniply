/**
 * System Health: what we read from outside. Everything here is cached in
 * memory and failure-tolerant: a status page that does not answer makes its
 * own cell read "no answer", it never fails the dashboard.
 */
import { withTimeout } from '../net/with-timeout'
import { twilioConfigured, getTwilioBalance } from '../twilio'
import { getSystemApiKey } from '../system-keys'
import { getAgencyToken } from '../ghl/app-oauth'
import { prisma, decrypt } from '@omniply/shared'

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

async function getJson(url: string, headers: Record<string, string>, label: string): Promise<{ status: number; json: unknown }> {
  const res = await withTimeout((signal) => fetch(url, { signal, headers: { Accept: 'application/json', ...headers } }), 10_000, label)
  return { status: res.status, json: await res.json().catch(() => null) }
}

/**
 * fal.ai: the documented billing endpoint needs a key with the billing
 * permission, which an ordinary generation key lacks (403 on ours, 2026-11-23);
 * the balance endpoint fal's own dashboard uses answers with any key. Try the
 * documented one first so we move to it the day the key allows.
 */
async function falBalance(): Promise<LiveBalance> {
  const key = await getSystemApiKey('fal-ai')
  if (!key) return { balance: null, currency: 'USD', error: 'No fal.ai key is stored' }
  const auth = { Authorization: `Key ${key}` }
  const doc = await getJson('https://api.fal.ai/v1/account/billing?expand=credits', auth, 'fal billing')
  const docBal = (doc.json as { credits?: { current_balance?: number } } | null)?.credits?.current_balance
  if (doc.status === 200 && typeof docBal === 'number') return { balance: docBal, currency: 'USD', error: null }
  const alt = await getJson('https://rest.alpha.fal.ai/billing/user_balance', auth, 'fal balance')
  if (alt.status === 200 && typeof alt.json === 'number') return { balance: alt.json, currency: 'USD', error: null }
  return { balance: null, currency: 'USD', error: `fal.ai would not report the balance (${doc.status}/${alt.status})` }
}

/** The CRM platform's agency wallet: pays for phone calls, texts and email sending. Needs the wallet.readonly permission on our app. */
async function crmWalletBalance(): Promise<LiveBalance> {
  const agency = await getAgencyToken().catch(() => null)
  if (!agency) return { balance: null, currency: 'USD', error: 'No agency connection is stored for the CRM platform' }
  const r = await getJson('https://services.leadconnectorhq.com/wallet/balance', { Authorization: `Bearer ${agency.token}`, Version: 'v3' }, 'crm wallet')
  const bal = (r.json as { balance?: number } | null)?.balance
  if (r.status === 200 && typeof bal === 'number') return { balance: bal, currency: 'USD', error: null }
  if (r.status === 401 || r.status === 403) return { balance: null, currency: 'USD', error: 'Our CRM app lacks the wallet.readonly permission. Add it to the app, then reconnect the agency.' }
  return { balance: null, currency: 'USD', error: `The CRM platform answered ${r.status}` }
}

/** Balances a provider lets us read. */
export async function fetchLiveBalance(serviceKey: string): Promise<LiveBalance> {
  return cached(`balance:${serviceKey}`, 5 * 60_000, async () => {
    try {
      if (serviceKey === 'twilio') {
        if (!twilioConfigured()) return { balance: null, currency: 'USD', error: 'Twilio credentials are not configured' }
        const b = await getTwilioBalance()
        return { balance: b.balance, currency: b.currency, error: null }
      }
      if (serviceKey === 'fal-ai') return await falBalance()
      if (serviceKey === 'highlevel-wallet') return await crmWalletBalance()
      return { balance: null, currency: 'USD', error: 'Reading this balance is not built yet' }
    } catch (err) {
      return { balance: null, currency: 'USD', error: err instanceof Error ? err.message.slice(0, 160) : 'Balance lookup failed' }
    }
  })
}

export interface LiveUsage {
  /** Usage billed so far this month. */
  monthToDate: number | null
  /** What is owed right now (a negative number is credit on the account). */
  balance: number | null
  error: string | null
}

/** Month-to-date usage for services billed after the fact. DigitalOcean today. */
export async function fetchLiveUsage(serviceKey: string): Promise<LiveUsage | null> {
  if (serviceKey !== 'digitalocean') return null
  return cached(`usage:${serviceKey}`, 30 * 60_000, async () => {
    try {
      const token = await getSystemApiKey('digitalocean')
      if (!token) return { monthToDate: null, balance: null, error: 'Add a read-only DigitalOcean token on the LLM Keys page to read this live' }
      const r = await getJson('https://api.digitalocean.com/v2/customers/my/balance', { Authorization: `Bearer ${token}` }, 'digitalocean balance')
      const j = r.json as { month_to_date_usage?: string; month_to_date_balance?: string } | null
      if (r.status !== 200 || !j) return { monthToDate: null, balance: null, error: r.status === 403 ? 'The DigitalOcean token lacks the billing read permission' : `DigitalOcean answered ${r.status}` }
      return { monthToDate: Number(j.month_to_date_usage ?? NaN), balance: Number(j.month_to_date_balance ?? NaN), error: null }
    } catch (err) {
      return { monthToDate: null, balance: null, error: err instanceof Error ? err.message.slice(0, 160) : 'Lookup failed' }
    }
  })
}

export interface QuotaRow {
  account: string
  tier: string | null
  used: number | null
  limit: number | null
  resetsAt: string | null
  error: string | null
}

/**
 * ElevenLabs runs on each clinic's own key, so there is no one balance: one row
 * per stored key with the plan's character allowance and when it resets.
 */
export async function fetchElevenLabsQuotas(): Promise<QuotaRow[]> {
  return cached('quota:elevenlabs', 15 * 60_000, async () => {
    const keys = await prisma.apiKey.findMany({ where: { provider: 'elevenlabs' }, select: { userId: true, encryptedKey: true } })
    const users = keys.length ? await prisma.user.findMany({ where: { id: { in: keys.map((k) => k.userId) } }, select: { id: true, email: true, brandSettings: { select: { organizationName: true } } } }) : []
    const name = new Map(users.map((u) => [u.id, u.brandSettings?.organizationName || u.email]))
    return Promise.all(
      keys.map(async (k): Promise<QuotaRow> => {
        const account = name.get(k.userId) ?? k.userId
        try {
          const r = await getJson('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': decrypt(k.encryptedKey) }, 'elevenlabs subscription')
          const j = r.json as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number; detail?: { code?: string } } | null
          if (r.status !== 200 || !j) {
            const code = j?.detail?.code
            const why = code === 'invalid_api_key' ? 'The stored value is not a valid key' : r.status === 401 ? 'The key is not allowed to read its usage' : `ElevenLabs answered ${r.status}`
            return { account, tier: null, used: null, limit: null, resetsAt: null, error: why }
          }
          return {
            account,
            tier: j.tier ?? null,
            used: j.character_count ?? null,
            limit: j.character_limit ?? null,
            resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null,
            error: null,
          }
        } catch {
          return { account, tier: null, used: null, limit: null, resetsAt: null, error: 'ElevenLabs did not answer' }
        }
      }),
    )
  })
}
