/**
 * Listing trust (.plans/places-trust.implementation-plan.md Item 1).
 *
 * One rule, applied at every Places consumer (agent context, onboarding
 * probe side-effects, weekly review poll): a resolved listing is trusted
 * iff its name resembles the brand's, OR the clinic explicitly confirmed
 * it ("yes, that listing is us" → BrandSettings.googleListingConfirmedAt).
 * Untrusted → the probe's data (hours, rating, periods, reviews) must not
 * be used anywhere.
 */

/**
 * Does the resolved Places listing plausibly belong to this brand?
 * Compares distinctive name tokens (generic industry words dropped). When
 * either side has no distinctive tokens we can't judge — keep the probe
 * (legacy behavior) unless normalized containment also fails both ways.
 */
const GENERIC_NAME_TOKENS = new Set([
  'the', 'and', 'of', 'at', 'dr', 'llc', 'inc', 'pllc', 'pc',
  'chiropractic', 'chiropractor', 'clinic', 'center', 'centre', 'practice',
  'family', 'care', 'health', 'wellness', 'spine', 'medical', 'office', 'group',
])

export function listingMatchesBrand(listingName?: string | null, brandName?: string | null): boolean {
  if (!listingName?.trim() || !brandName?.trim()) return true
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const nl = norm(listingName)
  const nb = norm(brandName)
  if (nl === nb || nl.includes(nb) || nb.includes(nl)) return true
  const distinct = (s: string) => s.split(' ').filter((w) => w.length >= 3 && !GENERIC_NAME_TOKENS.has(w))
  const a = distinct(nl)
  const b = new Set(distinct(nb))
  if (!a.length || !b.size) return true
  return a.some((w) => b.has(w))
}

export function listingTrusted(opts: {
  listingName?: string | null
  brandName?: string | null
  confirmedAt?: Date | string | null
}): boolean {
  return Boolean(opts.confirmedAt) || listingMatchesBrand(opts.listingName, opts.brandName)
}
