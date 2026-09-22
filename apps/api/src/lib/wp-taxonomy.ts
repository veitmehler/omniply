/**
 * WordPress taxonomy bootstrap (Veit 2026-09-22): a freshly-connected clinic
 * site usually has only "Uncategorized" and zero tags, which starves the
 * publish-time category/tag selectors. On connect we create a small curated,
 * vertical-aware set ONCE — the selectors then pick among real choices.
 * Deliberately deterministic (no LLM): predictable names, no sprawl.
 */
import { logger } from './logger'
import { assertSafeWpUrl } from './ssrf'

export const CHIRO_WP_CATEGORIES = [
  'Back & Neck Pain',
  'Pregnancy & Pediatrics',
  'Injury Recovery',
  'Posture & Exercise',
  'Wellness & Prevention',
  'Nutrition & Lifestyle',
]

export const CHIRO_WP_TAGS = [
  'chiropractor',
  'spine health',
  'back pain',
  'neck pain',
  'posture',
  'stretching',
  'pregnancy',
  'kids',
  'sports injury',
  'sciatica',
  'headaches',
  'wellness',
]

interface WpTerm { id: number; name: string }

async function listTerms(url: string, authHeader: string): Promise<WpTerm[]> {
  const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`WP terms fetch failed (${res.status})`)
  const data = (await res.json()) as Array<{ id: number; name: string }>
  return Array.isArray(data) ? data.map((t) => ({ id: t.id, name: t.name })) : []
}

async function createTerm(url: string, authHeader: string, name: string): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (res.ok) return true
  const body = (await res.json().catch(() => ({}))) as { code?: string }
  // Already exists (race or manual creation) — that's success for our purposes.
  if (body.code === 'term_exists') return false
  throw new Error(`WP term create failed (${res.status}): ${body.code ?? res.statusText}`)
}

function norm(s: string): string {
  return s.toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

/**
 * Idempotent: compares case-insensitively against what the site already has
 * and only creates the missing terms. Safe to call on every (re)connect.
 */
export async function bootstrapWpTaxonomy(opts: {
  siteUrl: string
  authHeader: string
  vertical?: string | null
}): Promise<{ createdCategories: number; createdTags: number }> {
  // Vertical-aware: only clinic verticals get the chiro set. Azavea (B2B)
  // manages its own WP taxonomy.
  if (opts.vertical === 'azavea') return { createdCategories: 0, createdTags: 0 }

  const base = opts.siteUrl.replace(/\/$/, '')
  await assertSafeWpUrl(base)

  let createdCategories = 0
  let createdTags = 0

  const existingCats = await listTerms(`${base}/wp-json/wp/v2/categories?per_page=100`, opts.authHeader)
  const catNames = new Set(existingCats.map((c) => norm(c.name)))
  for (const name of CHIRO_WP_CATEGORIES) {
    if (catNames.has(norm(name))) continue
    if (await createTerm(`${base}/wp-json/wp/v2/categories`, opts.authHeader, name)) createdCategories++
  }

  const existingTags = await listTerms(`${base}/wp-json/wp/v2/tags?per_page=100`, opts.authHeader)
  const tagNames = new Set(existingTags.map((t) => norm(t.name)))
  for (const name of CHIRO_WP_TAGS) {
    if (tagNames.has(norm(name))) continue
    if (await createTerm(`${base}/wp-json/wp/v2/tags`, opts.authHeader, name)) createdTags++
  }

  logger.info({ siteUrl: base, createdCategories, createdTags }, '[wp-taxonomy] bootstrap complete')
  return { createdCategories, createdTags }
}
