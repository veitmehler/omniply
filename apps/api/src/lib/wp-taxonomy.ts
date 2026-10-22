/**
 * WordPress taxonomy helpers (Veit 2026-09-22/23): a freshly-connected clinic
 * site usually has only "Uncategorized" and zero tags, which starves the
 * publish-time category/tag selectors. Category creation is CONSENTED in the
 * onboarding chat (three-way: all-ours-present / partial / bare site); the
 * admin Settings route auto-seeds ONLY bare sites. Deterministic curated
 * names — no LLM, no sprawl.
 */
import { prisma, decrypt } from '@omniply/shared'
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

// Wellness vertical (2026-10-22): same deterministic-names posture, aligned
// with the four Age Check pillars (move/sleep/unwind/fuel) + the vertical's
// recovery frame. Claims-safe: topic areas, never treatment promises.
export const WELLNESS_WP_CATEGORIES = [
  'Recovery & Performance',
  'Strength & Mobility',
  'Sleep & Rest',
  'Stress & Mindset',
  'Nutrition & Hydration',
  'Wellness & Longevity',
]

export const WELLNESS_WP_TAGS = [
  'recovery',
  'wellness',
  'longevity',
  'sleep',
  'mobility',
  'strength',
  'stress relief',
  'breathwork',
  'hydration',
  'energy',
  'healthy habits',
  'active lifestyle',
]

export function wpCategoriesForVertical(vertical: string): string[] {
  return vertical === 'wellness' ? WELLNESS_WP_CATEGORIES : CHIRO_WP_CATEGORIES
}

export function wpTagsForVertical(vertical: string): string[] {
  return vertical === 'wellness' ? WELLNESS_WP_TAGS : CHIRO_WP_TAGS
}

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

export interface WpTaxonomyState {
  /** Category names present on the site, EXCLUDING "Uncategorized". */
  realCategoryNames: string[]
  /** Curated categories the site does not have yet. */
  missingCurated: string[]
  tagCount: number
}

/** Resolve the site URL + Basic auth header for a user's WP connection. */
export async function wpAuthForUser(
  userId: string,
): Promise<{ siteUrl: string; authHeader: string } | null> {
  const conn = await prisma.wordPressConnection.findFirst({
    where: { userId },
    select: { siteUrl: true, username: true, appPassword: true },
  })
  if (!conn) return null
  const authHeader = 'Basic ' + Buffer.from(`${conn.username}:${decrypt(conn.appPassword)}`).toString('base64')
  return { siteUrl: conn.siteUrl.replace(/\/$/, ''), authHeader }
}

export async function getWpTaxonomyState(siteUrl: string, authHeader: string, vertical = 'chiro'): Promise<WpTaxonomyState> {
  const base = siteUrl.replace(/\/$/, '')
  await assertSafeWpUrl(base)
  const [cats, tags] = await Promise.all([
    listTerms(`${base}/wp-json/wp/v2/categories?per_page=100`, authHeader),
    listTerms(`${base}/wp-json/wp/v2/tags?per_page=100`, authHeader),
  ])
  const catNames = new Set(cats.map((c) => norm(c.name)))
  const realCategoryNames = cats.map((c) => c.name).filter((n) => norm(n) !== 'uncategorized')
  const missingCurated = wpCategoriesForVertical(vertical).filter((name) => !catNames.has(norm(name)))
  return { realCategoryNames, missingCurated, tagCount: tags.length }
}

/** Create the given categories (idempotent — existing names tolerated). */
export async function createWpCategories(
  siteUrl: string,
  authHeader: string,
  names: string[],
): Promise<number> {
  const base = siteUrl.replace(/\/$/, '')
  await assertSafeWpUrl(base)
  let created = 0
  for (const name of names) {
    if (await createTerm(`${base}/wp-json/wp/v2/categories`, authHeader, name)) created++
  }
  logger.info({ siteUrl: base, created }, '[wp-taxonomy] categories created')
  return created
}

/** Seed the starter tags ONLY when the site has none (invisible plumbing for the tag selector). */
export async function seedWpTagsIfNone(siteUrl: string, authHeader: string, vertical = 'chiro'): Promise<number> {
  const base = siteUrl.replace(/\/$/, '')
  await assertSafeWpUrl(base)
  const tags = await listTerms(`${base}/wp-json/wp/v2/tags?per_page=100`, authHeader)
  if (tags.length > 0) return 0
  let created = 0
  for (const name of wpTagsForVertical(vertical)) {
    if (await createTerm(`${base}/wp-json/wp/v2/tags`, authHeader, name)) created++
  }
  logger.info({ siteUrl: base, created }, '[wp-taxonomy] starter tags seeded')
  return created
}
