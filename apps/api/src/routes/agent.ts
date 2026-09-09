/**
 * Chat-agent endpoints (.plans/chat-agent-v1.implementation-plan.md §4).
 *
 * Public (widget-token addressed, same-origin from the svc-hosted iframe):
 *   GET  /api/agent/boot?token=…   — greeting + theme + chips (no LLM call)
 *   POST /api/agent/chat           — one visitor turn through the engine
 *
 * Authed:
 *   POST /api/agent/provision      — mint (or return) the account's widget
 *                                    token; Settings/C1 uses this for the
 *                                    embed snippet.
 *
 * Rate limits: chat is 15/min per IP on top of the global limiter — a chat
 * turn is the only LLM-spending public route in the API.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, canonicalAccountUserId, brandSettingsForUser } from '@omniply/shared'
import { resolvePromptByKey } from '../lib/prompt-resolver'
import { logger } from '../lib/logger'
import { acceptDmWebhook, type DmJobData } from '../agent/dm'
import { getBoss, QUEUES } from '../queues/index'
import { requireAuth } from '../middleware/auth'
import { fillPrompt } from '../newsletter/llm'
import { agentContextForAccount, clearAgentContextFor } from '../agent/context'
import { emergencyNumberFor, MAX_MESSAGE_CHARS } from '../agent/guardrails'
import { AgentTurnError, runAgentTurn } from '../agent/engine'
import { AGENT_LOADER_JS, buildAgentPanelHtml } from '../agent/widget'
import { ensureAgentWidgetToken } from '../lib/omniply-connect'

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/
const VISITOR_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/
const CONVERSATION_ID_RE = /^[a-z0-9]{10,40}$/i

const CHIPS = ['Book an appointment', 'Hours & location', 'Your first visit', 'Ask something']

async function accountForToken(token: unknown): Promise<{ id: string } | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  return prisma.account.findUnique({ where: { agentWidgetToken: token }, select: { id: true } })
}

export async function agentRoutes(app: FastifyInstance) {
  // One-line-install loader: <script async src=".../api/agent/widget.js"
  // data-omniply="TOKEN"></script>. Static for every clinic — cacheable.
  app.get('/agent/widget.js', async (_request, reply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8')
    reply.header('Cache-Control', 'public, max-age=3600')
    return AGENT_LOADER_JS
  })

  // Social DM transport webhook (snapshot workflow "AI DM Responder").
  // Token-addressed per account (custom value omniply_dm_webhook). Enqueues
  // and returns fast — GHL webhook timeouts never wait on the LLM.
  app.post<{ Params: { token: string } }>(
    '/agent/ghl-dm/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const status = await acceptDmWebhook(
        request.params.token,
        (request.body ?? {}) as Record<string, unknown>,
        async (data: DmJobData) => {
          const boss = await getBoss()
          await boss.send(QUEUES.AGENT_DM_TURN, data, { expireInSeconds: 300 })
        },
      )
      if (status === 'unknown-token') return reply.status(404).send({ error: 'unknown token' })
      logger.info({ status }, '[agent-dm] webhook')
      return reply.send({ ok: true, status })
    },
  )

  // The chat panel the loader iframes (same-origin /boot + /chat calls).
  app.get('/agent/w/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const account = await accountForToken(token)
    if (!account) return reply.status(404).send('Not found')
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Content-Security-Policy', 'frame-ancestors *')
    reply.header('Cache-Control', 'public, max-age=300')
    return buildAgentPanelHtml(token)
  })

  app.get('/agent/boot', async (request, reply) => {
    const { token } = request.query as { token?: string }
    const account = await accountForToken(token)
    if (!account) return reply.status(404).send({ error: 'Unknown widget' })

    const ctx = await agentContextForAccount(account.id)
    if (!ctx) return reply.status(404).send({ error: 'Widget not ready' })

    const greetingRow = await resolvePromptByKey('agent_greeting', { vertical: ctx.vertical })
    const greeting = greetingRow
      ? fillPrompt(greetingRow.userPrompt, { practiceName: ctx.practiceName })
      : `Hi! I'm ${ctx.practiceName}'s AI assistant. I can help with appointments, hours and general questions — I'm not able to give medical advice.`
    const emergency = emergencyNumberFor(ctx.countryCode)

    reply.header('Cache-Control', 'no-store')
    return {
      practiceName: ctx.practiceName,
      greeting,
      chips: CHIPS,
      theme: ctx.theme,
      disclosure: `AI assistant · Can't give medical advice · Emergencies: call ${emergency ?? 'your local emergency number'}`,
      maxMessageChars: MAX_MESSAGE_CHARS,
    }
  })

  app.post(
    '/agent/chat',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>
      const account = await accountForToken(body.token)
      if (!account) return reply.status(404).send({ error: 'Unknown widget' })

      const visitorKey = typeof body.visitorKey === 'string' && VISITOR_KEY_RE.test(body.visitorKey) ? body.visitorKey : null
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      const conversationId =
        typeof body.conversationId === 'string' && CONVERSATION_ID_RE.test(body.conversationId) ? body.conversationId : null
      if (!visitorKey || !message) return reply.status(400).send({ error: 'Bad request' })

      try {
        const result = await runAgentTurn({
          accountId: account.id,
          conversationId,
          visitorKey,
          message: message.slice(0, MAX_MESSAGE_CHARS),
        })
        return result
      } catch (err) {
        if (err instanceof AgentTurnError) {
          return reply.status(err.code === 'bad-conversation' ? 409 : 404).send({ error: err.code })
        }
        logger.error({ err, accountId: account.id }, '[agent] chat turn failed')
        return reply.status(500).send({ error: 'Something went wrong' })
      }
    },
  )

  // ── Chat knowledge base (chat-kb plan F2): read + edit + instant rebuild ──
  app.get('/agent/kb', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    const brand = await brandSettingsForUser(user.id)
    if (!brand) return reply.status(404).send({ error: 'Brand not set up yet' })
    return {
      faqs: Array.isArray(brand.clinicFaqs) ? brand.clinicFaqs : [],
      openingHours: brand.openingHours ?? '',
      organizationPhone: brand.organizationPhone ?? '',
      bookingUrl: brand.bookingUrl ?? '',
      extraKnowledge: brand.agentExtraKnowledge ?? '',
    }
  })

  app.put<{ Body: { faqs?: { q?: string; a?: string }[]; openingHours?: string; organizationPhone?: string; bookingUrl?: string; extraKnowledge?: string } }>(
    '/agent/kb',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true, accountId: true } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const body = request.body ?? {}
      const faqs = (body.faqs ?? [])
        .map((f) => ({ q: (f.q ?? '').trim().slice(0, 300), a: (f.a ?? '').trim().slice(0, 1500) }))
        .filter((f) => f.q && f.a)
        .slice(0, 60)
      if (faqs.length === 0) return reply.status(400).send({ error: 'At least one question and answer is required.' })

      const ownerId = await canonicalAccountUserId(user.id)
      await prisma.brandSettings.update({
        where: { userId: ownerId },
        data: {
          clinicFaqs: faqs,
          ...(body.openingHours !== undefined ? { openingHours: body.openingHours.trim() || null } : {}),
          ...(body.organizationPhone !== undefined ? { organizationPhone: body.organizationPhone.trim() || null } : {}),
          ...(body.bookingUrl !== undefined ? { bookingUrl: body.bookingUrl.trim() || null } : {}),
          ...(body.extraKnowledge !== undefined
            ? { agentExtraKnowledge: body.extraKnowledge.trim().slice(0, 5000) || null }
            : {}),
        },
      })
      if (user.accountId) clearAgentContextFor(user.accountId)
      return { ok: true, faqCount: faqs.length }
    },
  )

  app.post('/agent/provision', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId }, select: { accountId: true } })
    if (!user?.accountId) return reply.status(404).send({ error: 'No account' })

    try {
      const token = await ensureAgentWidgetToken(user.accountId)
      return { token }
    } catch {
      return reply.status(404).send({ error: 'No account' })
    }
  })
}
