/**
 * Direct agent booking — per-clinic MCP server (plan: .plans/mcp-booking-endpoint).
 *
 * POST /mcp/:token speaks the MCP Streamable-HTTP JSON-RPC subset
 * (initialize, tools/list, tools/call, ping) so protocol-speaking assistants
 * (Claude, ChatGPT, Gemini-class) can check availability and book WITHOUT a
 * browser. Every tool is a thin façade over the chat agent's battle-tested
 * executors — no new side-effect code. The trust model is the public
 * widget's (booking is a front-desk capability): per-token auth, tight rate
 * limits, E.164 validation, and server-side slot re-validation (a protocol
 * client can request arbitrary times; the chat UI only ever offered real
 * ones). Legal/identity-bearing operations (reschedule, cancel) are
 * deliberately absent — v1 is book/callback/info only.
 *
 * Kill-switch: AGENT_MCP_ENABLED=0 disables the whole surface.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { bookingInfoFor, type BookingInfo } from '../agent/booking'
import { executeBooking, executeCallback, executeAddEmail } from '../agent/actions'
import type { AgentContext } from '../agent/context'

const PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
function toolText(payload: unknown, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) }
}

/** Tool definitions, gated by booking mode so agents see an honest surface. */
export function toolDefsFor(
  bookable: boolean,
  services?: Array<{ key: string; label: string }> | null,
): Array<Record<string, unknown>> {
  const defs: Array<Record<string, unknown>> = [
    {
      name: 'get_clinic_info',
      description:
        'Basic facts about this practice: name, phone, address, opening hours, website, and how booking works here.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'request_callback',
      description:
        'Ask the practice team to call the patient back. Use when no suitable slot exists, for questions needing a human, or when the practice takes bookings by phone.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Patient's full name" },
          phone: { type: 'string', description: "Patient's phone number (E.164 or local format)" },
          reason: { type: 'string', description: 'Short reason for the call' },
          preferredTime: { type: 'string', description: 'When the patient prefers to be called (free text)' },
        },
        required: ['name', 'phone', 'reason'],
        additionalProperties: false,
      },
    },
  ]
  if (bookable) {
    const serviceKeys = services?.map((s) => s.key) ?? []
    const multi = serviceKeys.length > 0
    const serviceMenu = multi ? services!.map((s) => `${s.key} = ${s.label}`).join(', ') : ''
    defs.splice(
      1,
      0,
      {
        name: 'get_availability',
        description: multi
          ? `Current open appointment slots PER SERVICE (${serviceMenu}). Returns exact ISO start times; book_appointment accepts ONLY these values, each valid ONLY for its own service.`
          : 'Current open appointment slots. Returns exact ISO start times; book_appointment accepts ONLY these values.',
        inputSchema: multi
          ? {
              type: 'object',
              properties: {
                service: { type: 'string', enum: serviceKeys, description: 'Limit the result to one service (optional)' },
              },
              additionalProperties: false,
            }
          : { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'book_appointment',
        description: multi
          ? 'Book an appointment at one of the offered slots. service is REQUIRED and slotStart MUST be an exact startIso that get_availability returned FOR THAT SERVICE in this session.'
          : 'Book an appointment at one of the offered slots. slotStart MUST be an exact startIso value returned by get_availability in this session.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "Patient's full name" },
            phone: { type: 'string', description: "Patient's phone number" },
            slotStart: { type: 'string', description: 'Exact startIso from get_availability' },
            ...(multi
              ? { service: { type: 'string', enum: serviceKeys, description: 'The service to book (from get_availability)' } }
              : {}),
            email: { type: 'string', description: "Patient's email for the confirmation (optional)" },
          },
          required: multi ? ['name', 'phone', 'slotStart', 'service'] : ['name', 'phone', 'slotStart'],
          additionalProperties: false,
        },
      },
    )
  }
  return defs
}

/** In-memory booking throttle: protocol clients get 3 bookings/hour per token+IP. */
const bookingHits = new Map<string, number[]>()
export function bookingAllowed(key: string, now = Date.now()): boolean {
  const hits = (bookingHits.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000)
  if (hits.length >= 3) {
    bookingHits.set(key, hits)
    return false
  }
  hits.push(now)
  bookingHits.set(key, hits)
  return true
}

type McpAccount = {
  id: string
  ownerUserId: string | null
  name: string | null
  vertical: string | null
}

async function accountForToken(token: string): Promise<McpAccount | null> {
  if (!token || token.length < 12) return null
  return prisma.account.findUnique({
    where: { agentMcpToken: token },
    select: { id: true, ownerUserId: true, name: true, vertical: true },
  })
}

async function agentCtxFor(account: McpAccount): Promise<AgentContext> {
  const brand = await prisma.brandSettings.findFirst({
    where: { userId: account.ownerUserId! },
    select: {
      organizationName: true,
      organizationPhone: true,
      organizationCountryCode: true,
      bookingUrl: true,
    },
  })
  // Minimal context: the executors only read accountId/ownerUserId/
  // countryCode (phone normalization) from it.
  return {
    accountId: account.id,
    ownerUserId: account.ownerUserId!,
    vertical: account.vertical ?? 'chiro',
    practiceName: brand?.organizationName ?? account.name ?? 'the practice',
    bookingUrl: brand?.bookingUrl ?? null,
    phone: brand?.organizationPhone ?? null,
    countryCode: brand?.organizationCountryCode ?? 'US',
    knowledge: '',
    guides: [],
    weekdayText: null,
    availabilityPatterns: null,
    theme: {} as AgentContext['theme'],
  } as AgentContext
}

/** Session id ↔ agent_conversations row (channel 'mcp'), created lazily. */
async function conversationFor(accountId: string, sessionId: string | undefined): Promise<string> {
  if (sessionId) {
    const existing = await prisma.agentConversation.findFirst({
      where: { id: sessionId, accountId, channel: 'mcp' },
      select: { id: true },
    })
    if (existing) return existing.id
  }
  const created = await prisma.agentConversation.create({
    data: { accountId, channel: 'mcp', visitorKey: `mcp:${randomUUID()}` },
    select: { id: true },
  })
  return created.id
}

async function logToolCall(conversationId: string, name: string, args: unknown, outcome: string): Promise<void> {
  await prisma.agentMessage
    .create({
      data: {
        conversationId,
        role: 'visitor',
        content: `[mcp] ${name} → ${outcome}`,
        action: (typeof args === 'object' && args !== null ? { type: name, ...args } : { type: name }) as object,
      },
    })
    .catch(() => {})
  // turnCount gates the finalizer (and with it the AI Activity dashboard
  // record) — MCP conversations never bumped it, so protocol bookings were
  // invisible to both (found via Veit's widget count, 2026-10-21).
  await prisma.agentConversation
    .update({ where: { id: conversationId }, data: { turnCount: { increment: 1 } } })
    .catch(() => {})
}

async function getClinicInfo(account: McpAccount): Promise<Record<string, unknown>> {
  const brand = await prisma.brandSettings.findFirst({
    where: { userId: account.ownerUserId! },
    select: {
      organizationName: true,
      organizationPhone: true,
      organizationAddress: true,
      organizationWebsite: true,
      openingHours: true,
      bookingUrl: true,
      availabilityPatterns: true,
    },
  })
  const booking = await bookingInfoFor(account.id, account.ownerUserId!)
  return {
    name: brand?.organizationName ?? account.name,
    phone: brand?.organizationPhone ?? null,
    address: brand?.organizationAddress ?? null,
    website: brand?.organizationWebsite ?? null,
    openingHours: brand?.openingHours ?? null,
    bookingPage: brand?.bookingUrl ?? null,
    directBooking: booking.bookable
      ? booking.services
        ? `This assistant can book directly — call get_availability, then book_appointment with a service. Services: ${booking.services.map((s) => `${s.key} (${s.label})`).join(', ')}.`
        : 'This assistant can book directly — call get_availability, then book_appointment.'
      : 'No direct slot booking here — use request_callback and the team will arrange the appointment.',
    ...(brand?.availabilityPatterns ? { typicalAvailability: brand.availabilityPatterns } : {}),
  }
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post<{ Params: { token: string }; Body: JsonRpcRequest | JsonRpcRequest[] }>(
    '/mcp/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (process.env.AGENT_MCP_ENABLED === '0') return reply.status(404).send({ error: 'Not found' })
      const account = await accountForToken(request.params.token)
      if (!account?.ownerUserId) return reply.status(404).send({ error: 'Not found' })

      const body = request.body
      if (Array.isArray(body)) {
        return reply.status(400).send(rpcError(null, -32600, 'Batch requests are not supported'))
      }
      const { id = null, method, params = {} } = body ?? {}

      // Notifications (no id): acknowledge, no body.
      if (id === null && typeof method === 'string' && method.startsWith('notifications/')) {
        return reply.status(202).send()
      }

      const sessionHeader = (request.headers['mcp-session-id'] as string | undefined)?.trim()

      try {
        switch (method) {
          case 'initialize': {
            const conversationId = await conversationFor(account.id, undefined)
            reply.header('Mcp-Session-Id', conversationId)
            const requested = (params as { protocolVersion?: string }).protocolVersion
            // Patient-facing name, never the internal account label ("<Buyer>'s
            // Account" — the exact bug the friendly-name sync exists to kill).
            const brand = await prisma.brandSettings.findFirst({
              where: { userId: account.ownerUserId! },
              select: { organizationName: true },
            })
            return reply.send(
              rpcResult(id, {
                protocolVersion: requested || PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: `omniply-clinic`, title: brand?.organizationName ?? account.name ?? 'Clinic booking', version: '1.0.0' },
                instructions:
                  'Booking assistant for this practice. Call get_clinic_info first; use get_availability before book_appointment — slotStart must be an exact offered startIso. Where get_availability lists services, book_appointment also requires that service\'s key.',
              }),
            )
          }
          case 'ping':
            return reply.send(rpcResult(id, {}))
          case 'tools/list': {
            const booking = await bookingInfoFor(account.id, account.ownerUserId)
            return reply.send(rpcResult(id, { tools: toolDefsFor(booking.bookable, booking.services) }))
          }
          case 'tools/call': {
            const name = String((params as { name?: unknown }).name ?? '')
            const args = ((params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<
              string,
              string | undefined
            >
            const conversationId = await conversationFor(account.id, sessionHeader)
            reply.header('Mcp-Session-Id', conversationId)
            const result = await handleToolCall(request, account, conversationId, name, args)
            return reply.send(rpcResult(id, result))
          }
          default:
            return reply.send(rpcError(id, -32601, `Method not found: ${method}`))
        }
      } catch (err) {
        logger.error({ err, accountId: account.id, method }, '[mcp] request failed')
        return reply.send(rpcError(id, -32603, 'Internal error'))
      }
    },
  )
}

async function handleToolCall(
  request: FastifyRequest,
  account: McpAccount,
  conversationId: string,
  name: string,
  args: Record<string, string | undefined>,
): Promise<unknown> {
  switch (name) {
    case 'get_clinic_info': {
      const info = await getClinicInfo(account)
      await logToolCall(conversationId, name, {}, 'ok')
      return toolText(info)
    }
    case 'get_availability': {
      const booking = await bookingInfoFor(account.id, account.ownerUserId!)
      await logToolCall(conversationId, name, args.service ? { service: args.service } : {}, `ok (${booking.slots.length} slots)`)
      if (!booking.bookable) {
        return toolText({ bookable: false, note: 'Use request_callback — the team arranges appointments.' })
      }
      if (booking.services) {
        const filter = args.service?.trim().toLowerCase()
        const services = booking.services.filter((s) => !filter || s.key === filter)
        if (filter && !services.length) {
          return toolText(
            { error: `Unknown or unavailable service '${filter}'. Available: ${booking.services.map((s) => s.key).join(', ')}.` },
            true,
          )
        }
        return toolText({
          bookable: true,
          services: services.map((s) => ({
            service: s.key,
            label: s.label,
            slots: s.slots.map((x) => ({ startIso: x.startIso, label: x.label })),
          })),
          note: 'book_appointment requires service + an exact startIso from THAT service\'s list.',
        })
      }
      return toolText({
        bookable: true,
        slots: booking.slots.map((s) => ({ startIso: s.startIso, label: s.label })),
        note: 'book_appointment accepts ONLY these exact startIso values.',
      })
    }
    case 'book_appointment': {
      const { name: patientName, phone, slotStart, email } = args
      if (!patientName?.trim() || !phone?.trim() || !slotStart?.trim()) {
        return toolText({ error: 'name, phone, and slotStart are required.' }, true)
      }
      const booking: BookingInfo = await bookingInfoFor(account.id, account.ownerUserId!)
      if (!booking.bookable) {
        return toolText({ error: 'Direct booking is not available here — use request_callback.' }, true)
      }
      // Protocol clients can send arbitrary times; the chat UI never could.
      // Multi-service: the slot must belong to the NAMED service's own list.
      const serviceKey = args.service?.trim().toLowerCase() || null
      if (booking.services) {
        const svc = serviceKey ? booking.services.find((s) => s.key === serviceKey) : null
        if (!svc) {
          return toolText(
            { error: `service is required here. Available: ${booking.services.map((s) => s.key).join(', ')}.` },
            true,
          )
        }
        if (!svc.slots.some((s) => s.startIso === slotStart)) {
          return toolText(
            { error: `slotStart is not an offered slot for service '${svc.key}'. Call get_availability and use an exact startIso from that service's list.` },
            true,
          )
        }
      } else if (!booking.slots.some((s) => s.startIso === slotStart)) {
        return toolText(
          { error: 'slotStart is not an offered slot. Call get_availability and use an exact startIso.' },
          true,
        )
      }
      const throttleKey = `${account.id}:${request.ip}`
      if (!bookingAllowed(throttleKey)) {
        return toolText({ error: 'Booking rate limit reached for this hour. Use request_callback instead.' }, true)
      }
      const ctx = await agentCtxFor(account)
      try {
        await executeBooking(ctx, conversationId, {
          type: 'book_appointment',
          name: patientName.trim(),
          phone: phone.trim(),
          slotStart: slotStart.trim(),
          service: booking.services ? serviceKey : null,
        })
        // The response must never promise an email the attach didn't deliver
        // (same truthfulness bar as the chat agent, C3 2026-10-08).
        let emailAttached = false
        if (email?.trim()) {
          emailAttached = await executeAddEmail(ctx, conversationId, { type: 'add_contact_email', email: email.trim() })
            .then(() => true)
            .catch((err) => {
              logger.warn({ err, conversationId }, '[mcp] email attach failed (booking landed)')
              return false
            })
        }
        await logToolCall(conversationId, name, { name: patientName, phone, slotStart, ...(serviceKey ? { service: serviceKey } : {}) }, 'booked')
        logger.info({ accountId: account.id, conversationId, slotStart }, '[mcp] appointment booked via MCP')
        return toolText({
          booked: true,
          slotStart,
          ...(serviceKey ? { service: serviceKey } : {}),
          practice: ctx.practiceName,
          confirmation: emailAttached
            ? 'Appointment booked. A confirmation is sent to the provided email.'
            : email?.trim()
              ? 'Appointment booked. The email could NOT be attached (it may belong to another patient here) — the booking stands; the practice will confirm by phone.'
              : 'Appointment booked. Provide an email to receive a written confirmation.',
        })
      } catch (err) {
        await logToolCall(conversationId, name, { name: patientName, phone, slotStart }, 'FAILED')
        logger.error({ err, accountId: account.id, conversationId }, '[mcp] booking failed')
        return toolText({ error: 'Booking failed. Try another slot or use request_callback.' }, true)
      }
    }
    case 'request_callback': {
      const { name: patientName, phone, reason, preferredTime } = args
      if (!patientName?.trim() || !phone?.trim() || !reason?.trim()) {
        return toolText({ error: 'name, phone, and reason are required.' }, true)
      }
      const ctx = await agentCtxFor(account)
      try {
        await executeCallback(ctx, conversationId, {
          type: 'request_callback',
          name: patientName.trim(),
          phone: phone.trim(),
          reason: reason.trim(),
          preferredTime: preferredTime?.trim() || null,
        })
        await logToolCall(conversationId, name, { name: patientName, phone }, 'requested')
        return toolText({ requested: true, note: 'The practice team will call the patient back.' })
      } catch (err) {
        await logToolCall(conversationId, name, { name: patientName, phone }, 'FAILED')
        logger.error({ err, accountId: account.id, conversationId }, '[mcp] callback failed')
        return toolText({ error: 'Could not create the callback request. Call the practice directly.' }, true)
      }
    }
    default:
      return toolText({ error: `Unknown tool: ${name}` }, true)
  }
}
