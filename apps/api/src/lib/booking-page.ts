/**
 * "Book Online" page, published onto the clinic's own WordPress site at
 * /book-online (Veit decision 2026-11-03: multi-calendar clinics get one
 * overview page listing every bookable service, linking each to its CRM
 * calendar widget — the same curated list the AI receptionist books from, so
 * the page and the agent can never disagree).
 *
 * Links are built as `${widgetDomain}/widget/booking/${calendarId}` where
 * `widgetDomain` lives on the account's agentBookingConfig JSON (admin-set:
 * the location's connected white-label booking domain; NEVER a leadconnector
 * default — white-label rule). Without it, or with fewer than two GHL
 * services, publishing is skipped: a single-calendar clinic links its one
 * calendar directly and needs no chooser page.
 *
 * On success, brandSettings.bookingUrl is filled ONLY if empty (fill-if-empty,
 * like GBP hours/address): a hand-set booking link always wins. The linktree
 * page's "Book an Appointment" button reads bookingUrl, so it follows along.
 *
 * Mirrors lib/linktree.ts: best-effort, idempotent upsert by slug, English-only
 * (platform-pushed WP pages carry no Polylang language — same as /linktree).
 */
import { prisma, decrypt, brandSettingsForUser, accountMemberIdsForUser } from '@omniply/shared'
import { logger } from './logger'
import { assertSafeWpUrl } from './ssrf'
import { withTimeout } from './net/with-timeout'
import { parseBookingServices } from './booking/services'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface BookingPageService {
  label: string
  url: string
}

export function buildBookingPageHtml(opts: {
  organizationName: string
  logoUrl: string | null
  headerBg: string
  buttonColor: string
  buttonTextColor: string
  accent: string
  services: BookingPageService[]
  phone?: string | null
}): string {
  const { organizationName, logoUrl, headerBg, buttonColor, buttonTextColor, accent, services, phone } = opts
  const buttons = services
    .map(
      (s) =>
        `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="display:block;background:${buttonColor};color:${buttonTextColor};text-decoration:none;text-align:center;font-size:17px;font-weight:600;padding:15px 20px;border-radius:10px;margin:0 0 14px;">${esc(s.label)}</a>`,
    )
    .join('\n')
  const phoneRow = phone
    ? `<div style="text-align:center;color:${accent};font-size:15px;padding-top:14px;">Prefer to talk? Call us at <a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}" style="color:${accent};font-weight:600;">${esc(phone)}</a></div>`
    : ''
  return `<div style="margin:0 auto;max-width:520px;padding:0 0 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="background:${headerBg};border-radius:0 0 18px 18px;padding:36px 24px 30px;text-align:center;">
${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(organizationName)}" style="max-height:72px;max-width:70%;height:auto;" />` : `<div style="color:#ffffff;font-size:24px;font-weight:700;">${esc(organizationName)}</div>`}
</div>
<div style="padding:24px 24px 0;">
<p style="text-align:center;color:${accent};font-size:16px;margin:0 0 22px;">Pick a session to see available times and book online.</p>
${buttons}
</div>
${phoneRow}
</div>`
}

/** The widget domain stored on the booking config JSON (admin-set, optional). */
export function bookingWidgetDomain(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as { widgetDomain?: unknown }).widgetDomain
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(trimmed)) return null
  // White-label rule: never expose the CRM vendor's default domains.
  if (/leadconnector|gohighlevel|msgsndr/i.test(trimmed)) return null
  return trimmed
}

/**
 * Publish (create or update) the /book-online page on the clinic's WordPress
 * site. Returns the page URL, or null when skipped/failed (never throws).
 */
export async function publishBookingPage(userId: string): Promise<string | null> {
  try {
    const brand = await brandSettingsForUser(userId)
    if (!brand) return null
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { account: { select: { id: true, agentBookingMode: true, agentBookingConfig: true } } },
    })
    const account = user?.account
    if (!account || account.agentBookingMode !== 'direct-ghl') {
      logger.info({ userId }, '[booking-page] not in direct-ghl mode — skipping')
      return null
    }
    const domain = bookingWidgetDomain(account.agentBookingConfig)
    if (!domain) {
      logger.info({ userId }, '[booking-page] no widgetDomain on booking config — skipping')
      return null
    }
    const services = (parseBookingServices(account.agentBookingConfig) ?? []).filter((s) => s.calendarId)
    if (services.length < 2) {
      logger.info({ userId, count: services.length }, '[booking-page] fewer than 2 GHL services — skipping (direct link suffices)')
      return null
    }

    const memberIds = await accountMemberIdsForUser(userId)
    const conn = await prisma.wordPressConnection.findFirst({
      where: { userId: { in: memberIds } },
      select: { username: true, appPassword: true, siteUrl: true },
    })
    if (!conn) {
      logger.info({ userId }, '[booking-page] no WordPress connection — skipping')
      return null
    }
    await assertSafeWpUrl(conn.siteUrl)
    const auth = `Basic ${Buffer.from(`${conn.username}:${decrypt(conn.appPassword) ?? ''}`).toString('base64')}`
    const siteBase = conn.siteUrl.replace(/\/+$/, '')

    const html = buildBookingPageHtml({
      organizationName: brand.organizationName ?? 'Our Practice',
      logoUrl: brand.nlLogoLightUrl ?? brand.nlLogoUrl ?? null,
      headerBg: brand.nlHeaderBgColor ?? '#0b2545',
      buttonColor: brand.nlButtonColor ?? brand.nlLinkColor ?? '#2a6f97',
      buttonTextColor: brand.nlButtonTextColor ?? '#ffffff',
      accent: brand.nlLinkColor ?? '#2a6f97',
      services: services.map((s) => ({ label: s.label, url: `${domain}/widget/booking/${s.calendarId}` })),
      phone: brand.organizationPhone ?? null,
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
        `booking-page wp ${path}`,
      )

    const existingRes = await wp('/pages?slug=book-online&status=publish,draft,private,pending')
    const existing = existingRes.ok ? ((await existingRes.json()) as { id: number }[]) : []
    const body = JSON.stringify({ title: 'Book Online', slug: 'book-online', status: 'publish', content: html })
    const res = existing[0]
      ? await wp(`/pages/${existing[0].id}`, { method: 'POST', body })
      : await wp('/pages', { method: 'POST', body })
    if (!res.ok) {
      logger.warn({ userId, status: res.status }, '[booking-page] WP page upsert failed')
      return null
    }
    const page = (await res.json()) as { link?: string }
    const url = page.link ?? `${siteBase}/book-online/`

    if (!brand.bookingUrl?.trim()) {
      await prisma.brandSettings.update({ where: { userId: brand.userId }, data: { bookingUrl: url } })
      logger.info({ userId, url }, '[booking-page] published + bookingUrl filled (was empty)')
    } else {
      logger.info({ userId, url }, '[booking-page] published (bookingUrl hand-set — untouched)')
    }
    return url
  } catch (err) {
    logger.warn({ userId, err }, '[booking-page] publish failed (non-fatal)')
    return null
  }
}
