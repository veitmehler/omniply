/**
 * GHL dashboard "AI Employee" embed token (snapshot-optimization 2026-10-21).
 *
 * The dashboard's URL widget reads {{custom_values.omniply_ai_dashboard_url}},
 * which we point at /api/dashboard-widget/<token>. The token is read-only and
 * deliberately its OWN secret: agentWidgetToken ships in public website HTML
 * and agentMcpToken can book appointments — neither may double as stats auth.
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { getGhlCredentials } from './ghl/settings'
import { upsertGhlCustomValue } from './ghl/client'

const API_PUBLIC_BASE = (process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io').replace(/\/$/, '')

export const DASHBOARD_URL_CUSTOM_VALUE = 'omniply_ai_dashboard_url'

export async function ensureDashboardWidgetToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { dashboardWidgetToken: true },
  })
  if (account?.dashboardWidgetToken) return account.dashboardWidgetToken
  const token = randomBytes(24).toString('base64url')
  await prisma.account.update({ where: { id: accountId }, data: { dashboardWidgetToken: token } })
  return token
}

export function dashboardWidgetUrl(token: string): string {
  return `${API_PUBLIC_BASE}/api/dashboard-widget/${token}`
}

/** Mint (if needed) and publish the per-location URL custom value. Best-effort. */
export async function writeDashboardWidgetUrlValue(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
    if (!user?.accountId) return false
    const creds = await getGhlCredentials(userId)
    if (!creds) return false
    const token = await ensureDashboardWidgetToken(user.accountId)
    await upsertGhlCustomValue(creds.apiKey, creds.locationId, DASHBOARD_URL_CUSTOM_VALUE, dashboardWidgetUrl(token))
    logger.info({ userId, accountId: user.accountId }, '[dashboard-widget] url custom value written')
    return true
  } catch (err) {
    logger.warn({ userId, err }, '[dashboard-widget] url custom value write failed (non-fatal)')
    return false
  }
}
