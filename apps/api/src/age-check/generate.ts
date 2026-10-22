/**
 * Biological Age Check generation + publishing (wellness vertical — the
 * Spine Check's sibling; see spine-check/generate.ts for the pattern).
 *
 * Same machinery: data from BrandSettings + LeadGenDocuments, WP page
 * idempotently upserted at /age-check (iframe embed of the hosted quiz),
 * standalone document for non-WordPress studios + the hosted route.
 * Best-effort by design — onboarding's finale never breaks on this.
 */
import { prisma, decrypt, brandSettingsForUser, accountMemberIdsForUser } from '@omniply/shared'
import { pickBrandLogoForBackground } from '../newsletter/logo-process'
import { logger } from '../lib/logger'
import { assertSafeWpUrl } from '../lib/ssrf'
import { withTimeout } from '../lib/net/with-timeout'
import { buildAgeCheckHtml, type AgeCheckStudio } from './template'

/** Pillar → guide slug. These are the wellness guide slugs future LeadGen
 * documents should adopt; until a studio has live Drive-backed guides the
 * quiz makes no delivery promises (guidesAvailable gates it). */
export const GUIDE_SLUG_BY_PILLAR = {
  move: 'everyday-strength-guide',
  sleep: 'better-sleep-guide',
  unwind: 'switch-off-guide',
  fuel: 'everyday-fuel-guide',
} as const

/** Not quiz-matched (chiro FIRST_VISIT_SLUG mirror): offered as the results
 * page's one-line extra when live. */
export const FIRST_VISIT_SLUG = 'first-wellness-visit'

const DEFAULT_TITLES = {
  move: 'Everyday Strength',
  sleep: 'Better Sleep, Night After Night',
  unwind: 'The Art of Switching Off',
  fuel: 'Everyday Fuel',
} as const

function publicApiBase(): string {
  return (process.env.XRAY_PUBLIC_API_BASE ?? 'https://svc.omniply.io').replace(/\/$/, '')
}

export async function ageCheckStudioForUser(userId: string): Promise<AgeCheckStudio | null> {
  const brand = await brandSettingsForUser(userId)
  if (!brand) return null
  const user = await prisma.user.findUnique({ where: { id: brand.userId }, select: { accountId: true } })
  if (!user?.accountId) return null

  const docs = await prisma.leadGenDocument.findMany({
    where: { accountId: user.accountId, status: 'live' },
    select: { slug: true, title: true, driveFileId: true },
  })
  const titleBySlug = new Map(docs.map((d) => [d.slug, d.title]))
  const deliverableSlugs = new Set(docs.filter((d) => d.driveFileId).map((d) => d.slug))
  const guidesAvailable = Object.values(GUIDE_SLUG_BY_PILLAR).some((slug) => deliverableSlugs.has(slug))
  const guideTitles = {
    move: titleBySlug.get(GUIDE_SLUG_BY_PILLAR.move) ?? DEFAULT_TITLES.move,
    sleep: titleBySlug.get(GUIDE_SLUG_BY_PILLAR.sleep) ?? DEFAULT_TITLES.sleep,
    unwind: titleBySlug.get(GUIDE_SLUG_BY_PILLAR.unwind) ?? DEFAULT_TITLES.unwind,
    fuel: titleBySlug.get(GUIDE_SLUG_BY_PILLAR.fuel) ?? DEFAULT_TITLES.fuel,
  }

  return {
    accountId: user.accountId,
    practiceName: brand.organizationName ?? 'Our Studio',
    logoUrl: pickBrandLogoForBackground(brand, brand.nlHeaderBgColor ?? '#0b2545'),
    headerBg: brand.nlHeaderBgColor ?? '#0b2545',
    buttonColor: brand.nlButtonColor ?? brand.nlLinkColor ?? '#2a6f97',
    buttonTextColor: brand.nlButtonTextColor ?? '#ffffff',
    accent: brand.nlLinkColor ?? '#2a6f97',
    bookingUrl: brand.bookingUrl ?? null,
    phone: brand.organizationPhone ?? null,
    captureUrl: `${publicApiBase()}/api/age-check/capture`,
    guideTitles,
    guidesAvailable,
    firstVisitGuideTitle: guidesAvailable ? (titleBySlug.get(FIRST_VISIT_SLUG) ?? null) : null,
  }
}

/** Inline the logo as a data URI so the single file works anywhere. */
async function inlineLogo(studio: AgeCheckStudio): Promise<AgeCheckStudio> {
  if (!studio.logoUrl) return studio
  try {
    const res = await withTimeout((signal) => fetch(studio.logoUrl!, { signal }), 15_000, 'age-check logo inline')
    if (res.ok) {
      const mime = res.headers.get('content-type') ?? 'image/png'
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length <= 2_000_000) return { ...studio, logoUrl: `data:${mime};base64,${buf.toString('base64')}` }
    }
  } catch {
    /* remote URL fallback is fine */
  }
  return studio
}

/** Standalone document (hosted route + Settings download). */
export async function buildStandaloneAgeCheckHtml(userId: string): Promise<string | null> {
  const studio = await ageCheckStudioForUser(userId)
  if (!studio) return null
  return buildAgeCheckHtml(await inlineLogo(studio))
}

/** The URL the linktree (and anything else) should point at. */
export async function ageCheckUrlForUser(userId: string): Promise<string | null> {
  const memberIds = await accountMemberIdsForUser(userId)
  const conn = await prisma.wordPressConnection.findFirst({
    where: { userId: { in: memberIds } },
    select: { siteUrl: true },
  })
  if (conn) return `${conn.siteUrl.replace(/\/+$/, '')}/age-check/`
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
  if (!user?.accountId) return null
  return `${publicApiBase()}/api/age-check/p/${user.accountId}`
}

/** WP page content: crawlable intro + IFRAME embed of the hosted quiz (same
 * iframe-publishing decision as the spine check, 2026-08-07). */
export function buildAgeCheckEmbed(studio: AgeCheckStudio): string {
  const hostedUrl = `${publicApiBase()}/api/age-check/p/${studio.accountId}`
  const name = studio.practiceName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<p>Is your body living younger or older than your birthday says? Take the free Biological Age Check from ${name}... twelve quick questions about how you move, sleep, unwind and fuel up, your estimated biological age at the end, and where to start reclaiming years.</p>
<iframe id="ac-frame" src="${hostedUrl}?embed=1" title="The Biological Age Check — ${name}" style="width:100%;border:0;min-height:980px;display:block;" loading="lazy"></iframe>
<noscript><p><a href="${hostedUrl}">Take the Biological Age Check</a></p></noscript>
<script>(function(){window.addEventListener('message',function(e){if(!e.data||e.data.type!=='ac-height')return;var f=document.getElementById('ac-frame');if(f&&e.source===f.contentWindow&&e.data.height>200){f.style.height=e.data.height+'px';f.style.minHeight='0';}});})();</script>`
}

/**
 * Publish (create or update) the /age-check page on the studio's WordPress
 * site. Best-effort: failures log and return null (hosted route remains).
 */
export async function publishAgeCheckPage(userId: string): Promise<string | null> {
  try {
    const studio = await ageCheckStudioForUser(userId)
    if (!studio) return null
    const memberIds = await accountMemberIdsForUser(userId)
    const conn = await prisma.wordPressConnection.findFirst({
      where: { userId: { in: memberIds } },
      select: { username: true, appPassword: true, siteUrl: true },
    })
    if (!conn) {
      logger.info({ userId }, '[age-check] no WordPress connection — hosted route only')
      return null
    }
    await assertSafeWpUrl(conn.siteUrl)
    const auth = `Basic ${Buffer.from(`${conn.username}:${decrypt(conn.appPassword) ?? ''}`).toString('base64')}`
    const siteBase = conn.siteUrl.replace(/\/+$/, '')

    const content = buildAgeCheckEmbed(studio)

    const wp = (path: string, init?: RequestInit) =>
      withTimeout(
        (signal) =>
          fetch(`${siteBase}/wp-json/wp/v2${path}`, {
            ...init,
            headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
            signal,
          }),
        30_000,
        `age-check wp ${path}`,
      )

    const existingRes = await wp('/pages?slug=age-check&status=publish,draft,private,pending')
    const existing = existingRes.ok ? ((await existingRes.json()) as { id: number }[]) : []
    const body = JSON.stringify({
      title: 'The Biological Age Check',
      slug: 'age-check',
      status: 'publish',
      content,
    })
    const res = existing[0]
      ? await wp(`/pages/${existing[0].id}`, { method: 'POST', body })
      : await wp('/pages', { method: 'POST', body })
    if (!res.ok) {
      logger.warn({ userId, status: res.status }, '[age-check] WP page upsert failed')
      return null
    }
    const page = (await res.json()) as { link?: string }
    const url = page.link ?? `${siteBase}/age-check/`
    logger.info({ userId, url }, '[age-check] published to WordPress')
    return url
  } catch (err) {
    logger.warn({ userId, err }, '[age-check] publish failed (non-fatal)')
    return null
  }
}
