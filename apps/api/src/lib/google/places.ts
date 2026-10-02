/**
 * Google Places client (google-reviews plan Tier 2 + hours lookup).
 *
 * Uses the LEGACY Place Details endpoint deliberately: it supports
 * `reviews_sort` (most_relevant | newest), which is the only way to pull two
 * different top-5 review sets (~6-10 unique reviews) — the New Places API has
 * no review sorting. Platform-keyed (`GOOGLE_MAPS_API_KEY`); clinics set up
 * nothing. Every function is a no-op returning null/[] when the key is unset,
 * so the whole feature stays dormant until the key exists.
 *
 * Rapid re-polling is pointless: the top-5 selection is cached/deterministic
 * per sort; rotation happens over days. The weekly cron harvests it.
 */
import { logger } from '../logger'

const BASE = 'https://maps.googleapis.com/maps/api/place'

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY)
}

function key(): string {
  return process.env.GOOGLE_MAPS_API_KEY ?? ''
}

export interface PlaceProbe {
  placeId: string
  name?: string
  rating?: number
  totalReviews?: number
  /** Weekly hours as newline-joined weekday_text (owner-editable afterwards). */
  openingHours?: string
  /** Structured weekly periods (chat agent's open-now computation). */
  periods?: PlacePeriod[]
  /** Minutes offset from UTC at the place (legacy `utc_offset`). */
  utcOffsetMinutes?: number
  formattedAddress?: string
  formattedPhone?: string
  reviews: PlaceReview[]
}

/** Legacy Place Details opening_hours period: day 0=Sunday, time "HHMM". */
export interface PlacePeriod {
  open: { day: number; time: string }
  close?: { day: number; time: string }
}

export interface PlaceReview {
  authorName: string | null
  rating: number | null
  text: string
  relativeTime: string | null
}

export interface ResolvedPlace {
  placeId: string
  /** 'link' = derived from the clinic's own URL (any rung); 'search' = name+address text search. */
  source: 'link' | 'search'
}

/** Hosts a Google short link may redirect through / land on. */
export function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase()
  if (['maps.app.goo.gl', 'goo.gl', 'g.co', 'g.page', 'maps.google.com', 'consent.google.com'].includes(h)) return true
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)
}

/** Structured references extractable from a full Maps/GBP URL. */
export interface PlaceUrlRefs {
  placeId?: string
  /** `!1s0x…:0x…` fragment / ftid param — legacy Details accepts it as `ftid`. */
  ftid?: string
  cid?: string
  /** `/maps/place/<name>/@lat,lng` — name + exact coordinates for a biased Find Place. */
  nameAtPoint?: { name: string; lat: number; lng: number }
}

export function placeRefsFromUrl(url: string): PlaceUrlRefs {
  const refs: PlaceUrlRefs = {}
  const placeId = url.match(/place_?id[=:]([A-Za-z0-9_-]{20,})/i)?.[1]
  if (placeId) refs.placeId = placeId
  const ftid = url.match(/(?:[?&]ftid=|!1s)(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1]
  if (ftid) refs.ftid = ftid
  const cid = url.match(/[?&]cid=(\d{5,})/)?.[1]
  if (cid) refs.cid = cid
  const m = url.match(/\/maps\/place\/([^/@?#]+)\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
  if (m) {
    try {
      const name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
      if (name) refs.nameAtPoint = { name, lat: Number(m[2]), lng: Number(m[3]) }
    } catch {
      // malformed percent-encoding — ignore this rung
    }
  }
  return refs
}

const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'g.page'])

/**
 * Expand a Google short link (maps.app.goo.gl / goo.gl / g.co / g.page) by
 * following redirects manually — every hop must stay on a Google host (SSRF
 * posture: hardcoded allowlist, GET only, no body, 5s per hop, max 3 hops).
 * An EU consent interstitial wraps the destination in `continue=`.
 */
export async function expandGoogleShortLink(url: string): Promise<string | null> {
  let current: URL
  try {
    current = new URL(url)
  } catch {
    return null
  }
  if (!SHORT_LINK_HOSTS.has(current.host.toLowerCase())) return null
  for (let hop = 0; hop < 3; hop++) {
    let res: Response
    try {
      res = await fetch(current.toString(), { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    } catch (err) {
      logger.warn({ err, url: current.host }, '[places] short-link expansion failed')
      return null
    }
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) {
      return isGoogleHost(current.host) ? current.toString() : null
    }
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      return null
    }
    if (!isGoogleHost(next.host)) {
      logger.warn({ host: next.host }, '[places] short link redirected off Google — aborting expansion')
      return null
    }
    if (next.host.toLowerCase() === 'consent.google.com') {
      const wrapped = next.searchParams.get('continue')
      if (!wrapped) return null
      try {
        next = new URL(wrapped)
      } catch {
        return null
      }
      if (!isGoogleHost(next.host)) return null
    }
    current = next
  }
  return isGoogleHost(current.host) ? current.toString() : null
}

/** Legacy Details lookup by ftid/cid (semi-documented params) — place_id only. */
async function detailsLookupId(param: 'ftid' | 'cid', value: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/details/json?${param}=${encodeURIComponent(value)}&fields=place_id&key=${key()}`)
    if (!res.ok) return null
    const data = (await res.json()) as { status?: string; result?: { place_id?: string } }
    return (data.status === 'OK' && data.result?.place_id) || null
  } catch {
    return null
  }
}

async function findPlace(input: string, locationBias?: { lat: number; lng: number }): Promise<string | null> {
  try {
    const bias = locationBias ? `&locationbias=point:${locationBias.lat},${locationBias.lng}` : ''
    const res = await fetch(
      `${BASE}/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id${bias}&key=${key()}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as { status?: string; error_message?: string; candidates?: { place_id?: string }[] }
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      // e.g. REQUEST_DENIED when the caller's IP is not on the key's
      // allowlist — surfaced loudly; this failed silently once (staging).
      logger.warn({ status: data.status, error: data.error_message }, '[places] find-place returned non-OK status')
    }
    return data.candidates?.[0]?.place_id ?? null
  } catch (err) {
    logger.warn({ err }, '[places] place resolution failed')
    return null
  }
}

/**
 * Resolve a Place ID, link-first (places-trust plan Item 1). Ladder:
 * place_id param → short-link expansion → /maps/place/name/@lat,lng parse
 * (coordinate-biased Find Place) → ftid/cid Details lookup → plain
 * name+address text search. Every link-derived rung reports source 'link';
 * only the final text-search fallback is 'search' — callers use the
 * provenance to decide how a name-mismatched listing is handled.
 */
export async function resolvePlaceId(
  gbpUrl: string | null,
  nameAndAddress: string,
): Promise<ResolvedPlace | null> {
  if (!placesConfigured()) return null

  if (gbpUrl) {
    let refs = placeRefsFromUrl(gbpUrl)
    if (!refs.placeId && !refs.ftid && !refs.cid && !refs.nameAtPoint) {
      const expanded = await expandGoogleShortLink(gbpUrl)
      if (expanded) refs = placeRefsFromUrl(expanded)
    }
    if (refs.placeId) return { placeId: refs.placeId, source: 'link' }
    if (refs.nameAtPoint) {
      const id = await findPlace(refs.nameAtPoint.name, refs.nameAtPoint)
      if (id) return { placeId: id, source: 'link' }
    }
    if (refs.ftid) {
      const id = await detailsLookupId('ftid', refs.ftid)
      if (id) return { placeId: id, source: 'link' }
    }
    if (refs.cid) {
      const id = await detailsLookupId('cid', refs.cid)
      if (id) return { placeId: id, source: 'link' }
    }
  }

  const id = nameAndAddress.trim() ? await findPlace(nameAndAddress) : null
  return id ? { placeId: id, source: 'search' } : null
}

async function details(placeId: string, sort: 'most_relevant' | 'newest'): Promise<PlaceProbe | null> {
  const fields = 'name,rating,user_ratings_total,opening_hours,utc_offset,formatted_address,formatted_phone_number,reviews'
  const res = await fetch(
    `${BASE}/details/json?place_id=${placeId}&fields=${fields}&reviews_sort=${sort}&reviews_no_translations=true&key=${key()}`,
  )
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    result?: {
      name?: string
      rating?: number
      user_ratings_total?: number
      opening_hours?: { weekday_text?: string[]; periods?: PlacePeriod[] }
      utc_offset?: number
      formatted_address?: string
      formatted_phone_number?: string
      reviews?: { author_name?: string; rating?: number; text?: string; relative_time_description?: string }[]
    }
  }
  if (data.status !== 'OK' || !data.result) {
    if (data.status && data.status !== 'ZERO_RESULTS') {
      logger.warn({ status: data.status, placeId }, '[places] details returned non-OK status')
    }
    return null
  }
  return {
    placeId,
    name: data.result.name,
    rating: data.result.rating,
    totalReviews: data.result.user_ratings_total,
    openingHours: data.result.opening_hours?.weekday_text?.join('\n'),
    periods: data.result.opening_hours?.periods,
    utcOffsetMinutes: data.result.utc_offset,
    formattedAddress: data.result.formatted_address,
    formattedPhone: data.result.formatted_phone_number,
    reviews: (data.result.reviews ?? [])
      .filter((r) => r.text?.trim())
      .map((r) => ({
        authorName: r.author_name ?? null,
        rating: r.rating ?? null,
        text: r.text!.trim(),
        relativeTime: r.relative_time_description ?? null,
      })),
  }
}

/** Dual-sort probe: most_relevant + newest → up to ~10 unique reviews + hours. */
export async function probePlace(placeId: string): Promise<PlaceProbe | null> {
  if (!placesConfigured()) return null
  try {
    const [relevant, newest] = await Promise.all([details(placeId, 'most_relevant'), details(placeId, 'newest')])
    const base = relevant ?? newest
    if (!base) return null
    const seen = new Set(base.reviews.map((r) => r.text.slice(0, 80)))
    for (const r of newest?.reviews ?? []) {
      if (!seen.has(r.text.slice(0, 80))) {
        base.reviews.push(r)
        seen.add(r.text.slice(0, 80))
      }
    }
    return base
  } catch (err) {
    logger.warn({ err, placeId }, '[places] probe failed')
    return null
  }
}

/** The public "write a review" deep link for a place. */
export function reviewDeepLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`
}
