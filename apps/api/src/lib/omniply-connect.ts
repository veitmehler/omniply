/**
 * Omniply Connect auto-installer (plugin v1.1).
 *
 * When a clinic's WordPress is connected (admin Application Password), the
 * platform can install its own wordpress.org plugin and configure it without
 * any manual step:
 *   1. Install + activate `omniply-connect` via the WP core plugins REST API
 *      (POST /wp/v2/plugins pulls the latest release from wordpress.org).
 *   2. Mint (or reuse) the account's chat-widget token and write it to the
 *      plugin's /omniply/v1/widget route — the plugin then prints the
 *      fixed-domain loader script in wp_footer on every page.
 *   3. Push the clinic entity (+ FAQ) JSON-LD to /omniply/v1/head — the true
 *      theme-<head> placement the body-fenced ladder (clinic-schema.ts)
 *      cannot reach.
 *
 * Everything is best-effort and loud: the plugins endpoint requires a real
 * administrator (an editor-level Application Password can publish articles
 * but cannot install plugins), and a pre-1.1 plugin has no /widget route —
 * both degrade to a logged warning, never a thrown error.
 *
 * Plugin-route calls use the ?rest_route= form so they survive sites with
 * plain (non-pretty) permalinks; core /wp/v2 calls keep the /wp-json form
 * used everywhere else in this codebase.
 */
import { randomBytes } from 'node:crypto'
import { prisma, decrypt, brandSettingsForUser, accountMemberIdsForUser } from '@omniply/shared'
import { logger } from './logger'
import { assertSafeWpUrl } from './ssrf'
import { withTimeout } from './net/with-timeout'
import { buildClinicEntity, buildFaqSchema, type ClinicFaq } from './clinic-schema'

const PLUGIN_SLUG = 'omniply-connect'

/**
 * Return the account's widget token, minting one on first use (same token the
 * dashboard's Chat Assistant panel provisions). Concurrency-safe: the guarded
 * updateMany means two racing callers both read back the single winner.
 */
export async function ensureAgentWidgetToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { agentWidgetToken: true } })
  if (!account) throw new Error(`ensureAgentWidgetToken: no account ${accountId}`)
  if (account.agentWidgetToken) return account.agentWidgetToken
  const minted = randomBytes(24).toString('base64url')
  const claimed = await prisma.account.updateMany({
    where: { id: accountId, agentWidgetToken: null },
    data: { agentWidgetToken: minted },
  })
  if (claimed.count > 0) {
    logger.info({ accountId }, '[agent] widget token minted')
    return minted
  }
  const after = await prisma.account.findUnique({ where: { id: accountId }, select: { agentWidgetToken: true } })
  if (!after?.agentWidgetToken) throw new Error(`ensureAgentWidgetToken: claim lost and token still null (${accountId})`)
  return after.agentWidgetToken
}

export interface OmniplyConnectResult {
  pluginActive: boolean
  widgetConfigured: boolean
  headPushed: boolean
}

/**
 * Install/activate the Omniply Connect plugin on the user's connected
 * WordPress and configure both of its options. Idempotent — safe to re-run on
 * every reconnect or onboarding finale.
 */
export async function installOmniplyConnect(userId: string): Promise<OmniplyConnectResult | null> {
  const result: OmniplyConnectResult = { pluginActive: false, widgetConfigured: false, headPushed: false }
  try {
    const memberIds = await accountMemberIdsForUser(userId)
    const conn = await prisma.wordPressConnection.findFirst({
      where: { userId: { in: memberIds } },
      select: { username: true, appPassword: true, siteUrl: true },
    })
    if (!conn) {
      logger.info({ userId }, '[omniply-connect] no WordPress connection — skipping install')
      return null
    }
    await assertSafeWpUrl(conn.siteUrl)
    const auth = `Basic ${Buffer.from(`${conn.username}:${decrypt(conn.appPassword) ?? ''}`).toString('base64')}`
    const siteBase = conn.siteUrl.replace(/\/+$/, '')
    const call = (url: string, init?: RequestInit) =>
      withTimeout(
        (signal) =>
          fetch(url, {
            ...init,
            headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
            signal,
          }),
        // Install downloads the plugin from wordpress.org on the site's side —
        // give it more headroom than a normal REST write.
        90_000,
        `omniply-connect ${url.slice(siteBase.length)}`,
      )

    // ── 1. Install or activate ──────────────────────────────────────────────
    const listRes = await call(`${siteBase}/wp-json/wp/v2/plugins?search=${PLUGIN_SLUG}`)
    if (!listRes.ok) {
      // 401/403 = the Application Password user is not a full administrator.
      logger.warn(
        { userId, status: listRes.status },
        '[omniply-connect] plugins endpoint refused — admin credentials required, plugin NOT installed',
      )
      return result
    }
    const plugins = (await listRes.json()) as Array<{ plugin: string; status: string }>
    const existing = plugins.find((p) => p.plugin === `${PLUGIN_SLUG}/${PLUGIN_SLUG}` || p.plugin.startsWith(`${PLUGIN_SLUG}/`))
    if (!existing) {
      const installRes = await call(`${siteBase}/wp-json/wp/v2/plugins`, {
        method: 'POST',
        body: JSON.stringify({ slug: PLUGIN_SLUG, status: 'active' }),
      })
      if (!installRes.ok) {
        const err = (await installRes.json().catch(() => ({}))) as { message?: string }
        logger.warn({ userId, status: installRes.status, message: err.message }, '[omniply-connect] plugin install failed')
        return result
      }
      logger.info({ userId }, '[omniply-connect] plugin installed + activated')
      result.pluginActive = true
    } else if (existing.status !== 'active') {
      const activateRes = await call(`${siteBase}/wp-json/wp/v2/plugins/${existing.plugin}`, {
        method: 'POST',
        body: JSON.stringify({ status: 'active' }),
      })
      if (!activateRes.ok) {
        logger.warn({ userId, status: activateRes.status }, '[omniply-connect] plugin activate failed')
        return result
      }
      logger.info({ userId }, '[omniply-connect] plugin activated')
      result.pluginActive = true
    } else {
      result.pluginActive = true
    }

    // ── 2. Widget token ─────────────────────────────────────────────────────
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
    if (user?.accountId) {
      const token = await ensureAgentWidgetToken(user.accountId)
      const widgetRes = await call(`${siteBase}/?rest_route=/omniply/v1/widget`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
      if (widgetRes.ok) {
        result.widgetConfigured = true
        logger.info({ userId }, '[omniply-connect] widget token configured')
      } else {
        // 404 = plugin predates v1.1 (no /widget route yet).
        logger.warn({ userId, status: widgetRes.status }, '[omniply-connect] widget token write failed')
      }
    } else {
      logger.warn({ userId }, '[omniply-connect] no accountId — widget token skipped')
    }

    // ── 3. Head JSON-LD ─────────────────────────────────────────────────────
    const brand = await brandSettingsForUser(userId)
    if (brand?.organizationName) {
      const schemas: Record<string, unknown>[] = [buildClinicEntity(brand)]
      const faqSchema = buildFaqSchema(((brand.clinicFaqs as unknown as ClinicFaq[] | null) ?? []))
      if (faqSchema) schemas.push(faqSchema)
      const headRes = await call(`${siteBase}/?rest_route=/omniply/v1/head`, {
        method: 'POST',
        body: JSON.stringify({ jsonld: schemas }),
      })
      if (headRes.ok) {
        result.headPushed = true
        logger.info({ userId, schemas: schemas.length }, '[omniply-connect] head JSON-LD pushed')
      } else {
        logger.warn({ userId, status: headRes.status }, '[omniply-connect] head JSON-LD push failed')
      }
    }

    return result
  } catch (err) {
    logger.warn({ userId, err }, '[omniply-connect] install failed (non-fatal)')
    return result
  }
}
