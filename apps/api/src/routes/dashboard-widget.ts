/**
 * GHL dashboard "AI Employee" embed (snapshot-optimization 2026-10-21).
 *
 * The snapshot dashboard carries a URL widget pointed at
 * {{custom_values.omniply_ai_dashboard_url}}; onboarding writes that value to
 * /api/dashboard-widget/<token> (lib/dashboard-widget-token.ts). The token is
 * read-only stats auth — its own secret, never the chat-widget or MCP token.
 *
 * GET /api/dashboard-widget/sample        — generated data (design review)
 * GET /api/dashboard-widget/pending       — pre-onboarding placeholder
 *                                           (the custom value's neutral default)
 * GET /api/dashboard-widget/:token        — the live panel page
 * GET /api/dashboard-widget/:token/data   — stats JSON (?days=7|30|90)
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { aggregateAiActivity, type AiActivityStats } from '../lib/ai-activity-stats'
import { buildDashboardWidgetHtml, buildDashboardPendingHtml } from '../dashboard-widget/template'

const TOKEN_RE = /^[A-Za-z0-9_-]{20,60}$/
const DAYS_ALLOWED = new Set([7, 30, 90])

// The dashboard refreshes freely; one aggregation per account+range per
// minute is plenty live and keeps repeated widget loads off the DB.
const STATS_CACHE_MS = 60_000
const statsCache = new Map<string, { at: number; stats: AiActivityStats }>()

async function accountIdForToken(token: string): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null
  const account = await prisma.account.findUnique({
    where: { dashboardWidgetToken: token },
    select: { id: true },
  })
  return account?.id ?? null
}

export async function dashboardWidgetRoutes(app: FastifyInstance): Promise<void> {
  const sendHtml = (reply: { header: (k: string, v: string) => unknown; send: (b: string) => unknown }, html: string) => {
    // Embeddable from the GHL dashboard (app.gohighlevel.com + white-label
    // domains we don't enumerate) — same posture as the other embed pages.
    reply.header('Content-Security-Policy', 'frame-ancestors *')
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  }

  app.get('/dashboard-widget/sample', async (_request, reply) => {
    return sendHtml(reply, buildDashboardWidgetHtml('sample'))
  })

  app.get('/dashboard-widget/pending', async (_request, reply) => {
    return sendHtml(reply, buildDashboardPendingHtml())
  })

  app.get<{ Params: { token: string } }>('/dashboard-widget/:token', async (request, reply) => {
    const accountId = await accountIdForToken(request.params.token)
    if (!accountId) return reply.code(404).send({ error: 'not found' })
    return sendHtml(reply, buildDashboardWidgetHtml('live'))
  })

  app.get<{ Params: { token: string }; Querystring: { days?: string } }>(
    '/dashboard-widget/:token/data',
    async (request, reply) => {
      const accountId = await accountIdForToken(request.params.token)
      if (!accountId) return reply.code(404).send({ error: 'not found' })
      const days = Number(request.query.days ?? 30)
      if (!DAYS_ALLOWED.has(days)) return reply.code(400).send({ error: 'days must be 7, 30 or 90' })

      const key = `${accountId}:${days}`
      const hit = statsCache.get(key)
      if (hit && Date.now() - hit.at < STATS_CACHE_MS) return reply.send(hit.stats)

      const stats = await aggregateAiActivity(accountId, days)
      statsCache.set(key, { at: Date.now(), stats })
      if (statsCache.size > 500) {
        const oldest = statsCache.keys().next().value
        if (oldest) statsCache.delete(oldest)
      }
      return reply.send(stats)
    },
  )
}
