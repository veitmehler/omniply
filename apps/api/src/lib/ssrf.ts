import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for user-supplied WordPress site URLs.
 *
 * The API fetches these URLs server-side (connection verify, category/tag
 * lookups, publishing), so without a guard an authenticated user could point a
 * "WordPress connection" at internal services or the cloud metadata endpoint and
 * observe the responses. assertSafeWpUrl() requires https (configurable) and
 * rejects any URL whose host resolves to a private/loopback/link-local address.
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true // unparseable → treat as unsafe
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10/8 private
  if (a === 127) return true // 127/8 loopback
  if (a === 169 && b === 254) return true // 169.254/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 168) return true // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true // 192.0.0/24 + 192.0.2/24 (special/test)
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmark
  if (a >= 224) return true // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // strip any zone id
  if (addr === '::1' || addr === '::') return true // loopback / unspecified
  const first = addr.split(':')[0]
  if (/^f[cd]/.test(first)) return true // fc00::/7 unique-local
  if (/^fe[89ab]/.test(first)) return true // fe80::/10 link-local
  const v4mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4mapped) return isBlockedIpv4(v4mapped[1])
  return false
}

/** True if the IP is in a private / loopback / link-local / reserved range. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isBlockedIpv4(ip)
  if (v === 6) return isBlockedIpv6(ip)
  return true // not a valid IP literal → unsafe
}

/**
 * Throw SsrfError if `rawUrl` is not a safe public WordPress target.
 *
 * - Only http(s) schemes (https required unless WP_ALLOW_HTTP=true).
 * - Hostnames are DNS-resolved and every returned address is checked, so a name
 *   pointing at an internal IP is rejected.
 * - WP_SSRF_ALLOWLIST (comma-separated hostnames) bypasses the check for known
 *   internal/self-hosted instances.
 */
export async function assertSafeWpUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`)
  }

  const allowHttp = process.env.WP_ALLOW_HTTP === 'true'
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new SsrfError(`Blocked URL scheme "${url.protocol}" — https is required`)
  }

  const host = url.hostname

  const allowlist = (process.env.WP_SSRF_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.includes(host.toLowerCase())) return

  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      const resolved = await lookup(host, { all: true })
      addresses = resolved.map((r) => r.address)
    } catch {
      throw new SsrfError(`Could not resolve host: ${host}`)
    }
    if (addresses.length === 0) throw new SsrfError(`Host did not resolve: ${host}`)
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfError(`Refusing to connect to non-public address for ${host} (${addr})`)
    }
  }
}

/**
 * SSRF guard for general user-supplied web URLs (audit F4, 2026-09-11):
 * identical private-range protection to assertSafeWpUrl, but allows plain
 * http (clinic websites and video URLs are not always https) and ignores
 * the WP-specific env toggles. Callers should also pass redirect:'manual'
 * to their fetch — a 302 to an internal address bypasses any pre-check.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfError(`Blocked URL scheme "${url.protocol}"`)
  }
  const host = url.hostname
  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      const resolved = await lookup(host, { all: true })
      addresses = resolved.map((r) => r.address)
    } catch {
      throw new SsrfError(`Could not resolve host: ${host}`)
    }
    if (addresses.length === 0) throw new SsrfError(`Host did not resolve: ${host}`)
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfError(`Refusing to connect to non-public address for ${host} (${addr})`)
    }
  }
}
