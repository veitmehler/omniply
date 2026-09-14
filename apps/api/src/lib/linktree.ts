/**
 * Link-in-bio ("linktree") page, published ONTO the clinic's own WordPress
 * site at /linktree (user decision 2026-07-27: their branded domain; the path
 * avoids colliding with an existing /links page). Fully derived from data we
 * already hold — palette, logo variants, bookingUrl, GBP link, phone — and
 * idempotently upserted via the WP pages API. On success, socialBioUrl points
 * at it, so every social profile's "link in bio" lands on their own domain.
 *
 * Non-WordPress clinics keep the bookingUrl fallback (hosted version = later).
 */
import { prisma, decrypt, brandSettingsForUser, accountMemberIdsForUser } from '@omniply/shared'
import { logger } from './logger'
import { assertSafeWpUrl } from './ssrf'
import { withTimeout } from './net/with-timeout'
import { buildClinicEntity, buildFaqSchema, buildFencedBlock, type ClinicFaq } from './clinic-schema'
import { spineCheckUrlForUser } from '../spine-check/generate'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface LinkEntry {
  label: string
  url: string
}

// Same CDN icon set the newsletter footer uses (dark monochrome on white).
const SOCIAL_ICON_BASE = 'https://cdn.omniply.io/newsletter/social'
const SOCIAL_ICONS = new Set(['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'pinterest', 'threads'])
const SOCIAL_ALIASES: Record<string, string> = {
  fb: 'facebook', ig: 'instagram', insta: 'instagram', twitter: 'x', 'twitter/x': 'x',
  yt: 'youtube', 'youtube.com': 'youtube', 'linked-in': 'linkedin',
}
function socialSlug(platform?: string | null): string | null {
  const p = (platform ?? '').trim().toLowerCase()
  const slug = SOCIAL_ALIASES[p] ?? p
  return SOCIAL_ICONS.has(slug) ? slug : null
}

export function buildLinktreeHtml(opts: {
  organizationName: string
  logoUrl: string | null
  headerBg: string
  buttonColor: string
  buttonTextColor: string
  bodyBg: string
  accent: string
  links: LinkEntry[]
  socials?: { slug: string; url: string }[]
}): string {
  const { organizationName, logoUrl, headerBg, buttonColor, buttonTextColor, bodyBg, accent, links } = opts
  // Icon row BELOW the CTA buttons — the page's job is conversion first,
  // follow second (design decision 2026-09-14).
  const socialRow = (opts.socials ?? []).length
    ? `<div style="text-align:center;padding:18px 24px 0;">${(opts.socials ?? [])
        .map(
          (s) =>
            `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="display:inline-block;margin:0 9px;"><img src="${SOCIAL_ICON_BASE}/${s.slug}-dark.png" width="30" height="30" alt="${s.slug}" style="display:inline-block;width:30px;height:30px;border:0;" /></a>`,
        )
        .join('')}</div>`
    : ''
  const buttons = links
    .map(
      (l) =>
        `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="display:block;background:${buttonColor};color:${buttonTextColor};text-decoration:none;text-align:center;font-size:17px;font-weight:600;padding:15px 20px;border-radius:10px;margin:0 0 14px;">${esc(l.label)}</a>`,
    )
    .join('\n')
  return `<div style="background:${bodyBg};margin:0 auto;max-width:520px;padding:0 0 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="background:${headerBg};border-radius:0 0 18px 18px;padding:36px 24px 30px;text-align:center;">
${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(organizationName)}" style="max-height:72px;max-width:70%;height:auto;" />` : `<div style="color:#ffffff;font-size:24px;font-weight:700;">${esc(organizationName)}</div>`}
</div>
<div style="padding:28px 24px 0;">
${buttons}
</div>
${socialRow}
<div style="text-align:center;color:${accent};font-size:13px;padding-top:10px;">${esc(organizationName)}</div>
</div>`
}

/** Gather the link entries + visual tokens for a user's linktree. */
async function linktreeDataForUser(userId: string) {
  const brand = await brandSettingsForUser(userId)
  if (!brand) return null
  const links: LinkEntry[] = []
  // Spine Check on top (user decision 2026-08-06: the most valuable opt-in).
  const spineCheckUrl = await spineCheckUrlForUser(userId).catch(() => null)
  if (spineCheckUrl) links.push({ label: 'Take the 2-Minute Spine Check', url: spineCheckUrl })
  if (brand.bookingUrl) links.push({ label: 'Book an Appointment', url: brand.bookingUrl })
  if (brand.organizationPhone) links.push({ label: 'Call Us', url: `tel:${brand.organizationPhone.replace(/[^+\d]/g, '')}` })
  if (brand.googleBusinessProfileUrl) links.push({ label: 'Review Us on Google', url: brand.googleBusinessProfileUrl })
  if (brand.organizationWebsite) links.push({ label: 'Visit Our Website', url: brand.organizationWebsite })
  const raw = Array.isArray(brand.socialMediaLinks) ? (brand.socialMediaLinks as { platform?: string; url?: string }[]) : []
  const socials = raw
    .map((l) => ({ slug: socialSlug(l.platform), url: (l.url ?? '').trim() }))
    .filter((l): l is { slug: string; url: string } => !!l.slug && !!l.url)
  return { brand, links, socials }
}

/**
 * Self-contained downloadable linktree (non-WordPress clinics, user request
 * 2026-07-27): a full HTML document with the logo inlined as a data URI so the
 * single file works uploaded to any hosting. Returns null when nothing to link.
 */
export async function buildStandaloneLinktreeHtml(userId: string): Promise<string | null> {
  const data = await linktreeDataForUser(userId)
  if (!data || data.links.length === 0) return null
  const { brand, links, socials } = data

  let logoUrl = brand.nlLogoLightUrl ?? brand.nlLogoUrl ?? null
  if (logoUrl) {
    try {
      const res = await withTimeout((signal) => fetch(logoUrl!, { signal }), 15_000, 'linktree logo inline')
      if (res.ok) {
        const mime = res.headers.get('content-type') ?? 'image/png'
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length <= 2_000_000) logoUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch {
      /* remote URL fallback is fine */
    }
  }

  const inner = buildLinktreeHtml({
    organizationName: brand.organizationName ?? 'Our Practice',
    logoUrl,
    headerBg: brand.nlHeaderBgColor ?? '#0b2545',
    buttonColor: brand.nlButtonColor ?? brand.nlLinkColor ?? '#2a6f97',
    buttonTextColor: brand.nlButtonTextColor ?? '#ffffff',
    bodyBg: '#ffffff',
    accent: brand.nlLinkColor ?? '#2a6f97',
    links,
    socials,
  })
  const name = esc(brand.organizationName ?? 'Links')
  const entitySchemas = [buildClinicEntity(brand)]
  const faqSchema = buildFaqSchema(((brand.clinicFaqs as unknown as ClinicFaq[] | null) ?? []))
  const schemaBlock = buildFencedBlock(faqSchema ? [...entitySchemas, faqSchema] : entitySchemas)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} — Links</title>
</head>
<body style="margin:0;background:#ffffff;">
${inner}
${schemaBlock}
</body>
</html>`
}

/**
 * Publish (create or update) the /linktree page on the clinic's WordPress site
 * and point socialBioUrl at it. Best-effort by design: any failure logs and
 * returns null without throwing — the finale must never break on this.
 */
export async function publishLinktreePage(userId: string): Promise<string | null> {
  try {
    const data = await linktreeDataForUser(userId)
    if (!data) return null
    const { brand, links, socials } = data
    const memberIds = await accountMemberIdsForUser(userId)
    const conn = await prisma.wordPressConnection.findFirst({
      where: { userId: { in: memberIds } },
      select: { username: true, appPassword: true, siteUrl: true },
    })
    if (!conn) {
      logger.info({ userId }, '[linktree] no WordPress connection — skipping (bookingUrl fallback stays)')
      return null
    }
    await assertSafeWpUrl(conn.siteUrl)
    const auth = `Basic ${Buffer.from(`${conn.username}:${decrypt(conn.appPassword) ?? ''}`).toString('base64')}`
    const siteBase = conn.siteUrl.replace(/\/+$/, '')

    if (links.length === 0) {
      logger.info({ userId }, '[linktree] no links available — skipping')
      return null
    }

    const html = buildLinktreeHtml({
      organizationName: brand.organizationName ?? 'Our Practice',
      logoUrl: brand.nlLogoLightUrl ?? brand.nlLogoUrl ?? null,
      headerBg: brand.nlHeaderBgColor ?? '#0b2545',
      buttonColor: brand.nlButtonColor ?? brand.nlLinkColor ?? '#2a6f97',
      buttonTextColor: brand.nlButtonTextColor ?? '#ffffff',
      bodyBg: '#ffffff',
      accent: brand.nlLinkColor ?? '#2a6f97',
      links,
      socials,
    })

    const wp = (path: string, init?: RequestInit) =>
      withTimeout(
        (signal) =>
          fetch(`${siteBase}/wp-json/wp/v2${path}`, {
            ...init,
            headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
            signal,
          }),
        30_000,
        `linktree wp ${path}`,
      )

    // Entity (+FAQ) schema rides on the linktree page — the coverage floor
    // every WP clinic gets regardless of the page ladder (agent plan 3.1).
    const entitySchemas = [buildClinicEntity(brand)]
    const faqSchema = buildFaqSchema(((brand.clinicFaqs as unknown as ClinicFaq[] | null) ?? []))
    const contentWithSchema = `${html}\n${buildFencedBlock(faqSchema ? [...entitySchemas, faqSchema] : entitySchemas)}`

    // Idempotent upsert by slug.
    const existingRes = await wp('/pages?slug=linktree&status=publish,draft,private,pending')
    const existing = existingRes.ok ? ((await existingRes.json()) as { id: number }[]) : []
    const body = JSON.stringify({ title: 'Links', slug: 'linktree', status: 'publish', content: contentWithSchema })
    const res = existing[0]
      ? await wp(`/pages/${existing[0].id}`, { method: 'POST', body })
      : await wp('/pages', { method: 'POST', body })
    if (!res.ok) {
      logger.warn({ userId, status: res.status }, '[linktree] WP page upsert failed')
      return null
    }
    const page = (await res.json()) as { link?: string }
    const url = page.link ?? `${siteBase}/linktree/`

    await prisma.brandSettings.update({ where: { userId: brand.userId }, data: { socialBioUrl: url } })
    logger.info({ userId, url }, '[linktree] published to WordPress + socialBioUrl updated')
    return url
  } catch (err) {
    logger.warn({ userId, err }, '[linktree] publish failed (non-fatal)')
    return null
  }
}
