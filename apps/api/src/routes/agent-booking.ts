/**
 * Calendar discovery card (the "rollout surface" the PMS section waited for).
 *
 *   GET /agent-booking/discovery — provider availability + discovered
 *       bookable targets (GHL calendars / Cliniko appointment types), the
 *       current services config, and LLM-proposed labels/synonyms for
 *       unconfigured targets (heuristic fallback when no model key).
 *   PUT /agent-booking/services  — owner-confirmed services map →
 *       agentBookingConfig.services (+ agentBookingMode), validated against
 *       the live target list; {enabled:false} switches the agent to 'off'.
 *
 * Clerk-authed like the other Settings surfaces; works in both shells.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, canonicalAccountUserId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { getGhlCredentials } from '../lib/ghl/settings'
import { listGhlCalendars } from '../lib/ghl/client'
import { clinikoAccountOverview, clinicoApiKeyFor } from '../lib/booking/cliniko'
import { parseBookingServices, type BookingService } from '../lib/booking/services'
import { clearBookingCacheFor } from '../agent/booking'
import { getSystemApiKey } from '../lib/system-keys'
import { getLLMAdapter } from '../article-pipeline/llm/factory'
import { instrumentCall } from '../lib/net/instrument'

const KEY_RX = /^[a-z0-9][a-z0-9_-]{0,39}$/
const MAX_SERVICES = 12

interface DiscoveredTarget {
  id: string
  name: string
  durationMinutes: number | null
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return KEY_RX.test(slug) ? slug : `service-${Math.random().toString(36).slice(2, 8)}`
}

/** LLM proposal: keys/labels/synonyms per target. Falls back to slugs. */
async function proposeServices(
  targets: DiscoveredTarget[],
  clinicName: string | null,
): Promise<Record<string, { key: string; label: string; synonyms: string[] }>> {
  const fallback = Object.fromEntries(
    targets.map((t) => [t.id, { key: slugify(t.name), label: t.name.trim().slice(0, 60), synonyms: [] as string[] }]),
  )
  const apiKey = await getSystemApiKey('anthropic')
  if (!apiKey || !targets.length) return fallback
  try {
    const res = await instrumentCall({ provider: 'anthropic', op: 'agent-booking.suggest' }, () =>
      getLLMAdapter('anthropic').call({
        model: 'claude-haiku-4-5',
        systemPrompt:
          'You prepare booking-service config for a clinic AI receptionist. Return STRICT JSON only.',
        userPrompt: `For each calendar/service of ${clinicName ?? 'a clinic'}, propose: a short stable key (lowercase slug, max 20 chars), a guest-facing label (max 40 chars, clean up trailing spaces and parentheses clutter), and up to 6 synonyms a caller might use (include common Spanish terms where natural; never invent services).

INPUT (id: name):
${targets.map((t) => `${t.id}: ${t.name}`).join('\n')}

Return STRICT JSON: {"<id>": {"key": "...", "label": "...", "synonyms": ["..."]}} for every id.`,
        temperature: 0.2,
        maxTokens: 1500,
      }),
    )
    const parsed = JSON.parse(res.content.trim().replace(/^```json?\s*|```\s*$/g, '')) as Record<
      string,
      { key?: string; label?: string; synonyms?: string[] }
    >
    const seen = new Set<string>()
    for (const t of targets) {
      const p = parsed[t.id]
      if (!p) continue
      const key = typeof p.key === 'string' && KEY_RX.test(p.key.trim().toLowerCase()) ? p.key.trim().toLowerCase() : fallback[t.id].key
      const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 60) : fallback[t.id].label
      const synonyms = Array.isArray(p.synonyms)
        ? p.synonyms.filter((x): x is string => typeof x === 'string' && !!x.trim() && x.length <= 40).slice(0, 10)
        : []
      fallback[t.id] = { key: seen.has(key) ? `${key}-2` : key, label, synonyms }
      seen.add(key)
    }
  } catch (err) {
    logger.warn({ err }, '[agent-booking] suggestion LLM failed — slug fallback')
  }
  return fallback
}

async function resolveOwner(request: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1]) {
  const clerkId = await requireAuth(request, reply)
  if (!clerkId) return null
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true, accountId: true } })
  if (!user?.accountId) {
    void reply.status(404).send({ error: 'No account' })
    return null
  }
  const ownerUserId = await canonicalAccountUserId(user.id)
  return { accountId: user.accountId, ownerUserId }
}

export async function agentBookingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { provider?: string } }>('/agent-booking/discovery', async (request, reply) => {
    const who = await resolveOwner(request, reply)
    if (!who) return

    const account = await prisma.account.findUnique({
      where: { id: who.accountId },
      select: { agentBookingMode: true, agentBookingConfig: true, name: true },
    })
    const creds = await getGhlCredentials(who.ownerUserId)
    const clinikoKey = await clinicoApiKeyFor(who.ownerUserId)
    const providers = { ghl: !!creds, cliniko: !!clinikoKey }
    const requested = request.query.provider
    const provider =
      requested === 'cliniko' || requested === 'ghl'
        ? requested
        : account?.agentBookingMode === 'direct-cliniko'
          ? 'cliniko'
          : providers.ghl
            ? 'ghl'
            : providers.cliniko
              ? 'cliniko'
              : null

    let targets: DiscoveredTarget[] = []
    let cliniko: { businesses: { id: string; name: string }[]; practitioners: { id: string; name: string }[] } | null = null
    try {
      if (provider === 'ghl' && creds) {
        const calendars = await listGhlCalendars(creds.apiKey, creds.locationId)
        targets = calendars
          .filter((c) => c.isActive !== false)
          .map((c) => ({
            id: c.id,
            name: c.name ?? c.id,
            durationMinutes: typeof (c as { slotDuration?: number }).slotDuration === 'number' ? (c as { slotDuration?: number }).slotDuration! : null,
          }))
      } else if (provider === 'cliniko' && clinikoKey) {
        const overview = await clinikoAccountOverview(clinikoKey)
        targets = overview.appointmentTypes.map((t) => ({ id: t.id, name: t.name, durationMinutes: t.durationMinutes }))
        cliniko = { businesses: overview.businesses, practitioners: overview.practitioners }
      }
    } catch (err) {
      logger.warn({ err, accountId: who.accountId, provider }, '[agent-booking] discovery fetch failed')
      return reply.status(502).send({ error: 'Could not load calendars from the booking system. Try again in a minute.' })
    }

    const current = parseBookingServices(account?.agentBookingConfig) ?? []
    const configuredTargetIds = new Set(current.map((s) => (provider === 'cliniko' ? s.cliniko?.appointmentTypeId : s.calendarId)).filter(Boolean))
    const unconfigured = targets.filter((t) => !configuredTargetIds.has(t.id))
    const suggestions = await proposeServices(unconfigured, account?.name ?? null)

    return {
      provider,
      providers,
      mode: account?.agentBookingMode ?? 'off',
      targets,
      cliniko,
      current,
      suggestions,
    }
  })

  app.put<{
    Body: {
      enabled?: boolean
      provider?: string
      clinikoBusinessId?: string
      services?: Array<{
        key?: string
        label?: string
        targetId?: string
        synonyms?: string[]
        exclusiveWith?: string[]
        durationMinutes?: number
        practitionerIds?: string[]
      }>
    }
  }>('/agent-booking/services', async (request, reply) => {
    const who = await resolveOwner(request, reply)
    if (!who) return
    const body = request.body ?? {}

    if (body.enabled === false) {
      await prisma.account.update({ where: { id: who.accountId }, data: { agentBookingMode: 'off' } })
      clearBookingCacheFor(who.accountId)
      return { ok: true, mode: 'off' }
    }

    const provider = body.provider === 'cliniko' ? 'cliniko' : body.provider === 'ghl' ? 'ghl' : null
    if (!provider) return reply.status(400).send({ error: 'provider must be ghl or cliniko' })
    const entries = Array.isArray(body.services) ? body.services : []
    if (!entries.length || entries.length > MAX_SERVICES) {
      return reply.status(400).send({ error: `Choose between 1 and ${MAX_SERVICES} services` })
    }

    // Validate every target against the LIVE system so a stale UI can never
    // write a dangling calendar/appointment-type id.
    let liveTargets: Map<string, DiscoveredTarget>
    let clinikoRoot: Record<string, unknown> = {}
    if (provider === 'ghl') {
      const creds = await getGhlCredentials(who.ownerUserId)
      if (!creds) return reply.status(400).send({ error: 'No CRM connection' })
      const calendars = await listGhlCalendars(creds.apiKey, creds.locationId)
      liveTargets = new Map(
        calendars.filter((c) => c.isActive !== false).map((c) => [c.id, { id: c.id, name: c.name ?? c.id, durationMinutes: (c as { slotDuration?: number }).slotDuration ?? null }]),
      )
    } else {
      const clinikoKey = await clinicoApiKeyFor(who.ownerUserId)
      if (!clinikoKey) return reply.status(400).send({ error: 'Cliniko is not connected' })
      const overview = await clinikoAccountOverview(clinikoKey)
      liveTargets = new Map(overview.appointmentTypes.map((t) => [t.id, { id: t.id, name: t.name, durationMinutes: t.durationMinutes }]))
      const businessId = body.clinikoBusinessId ?? overview.businesses[0]?.id
      if (!businessId) return reply.status(400).send({ error: 'No Cliniko business found' })
      const allPracs = overview.practitioners.map((p) => p.id)
      if (!allPracs.length) return reply.status(400).send({ error: 'No Cliniko practitioners found' })
      clinikoRoot = { businessId, practitionerIds: allPracs }
    }

    const seen = new Set<string>()
    const services: Record<string, unknown>[] = []
    for (const e of entries) {
      const key = typeof e.key === 'string' ? e.key.trim().toLowerCase() : ''
      const label = typeof e.label === 'string' ? e.label.trim() : ''
      const targetId = typeof e.targetId === 'string' ? e.targetId.trim() : ''
      if (!KEY_RX.test(key) || seen.has(key)) return reply.status(400).send({ error: `Invalid or duplicate service key "${e.key ?? ''}"` })
      if (!label || label.length > 60) return reply.status(400).send({ error: `Invalid label for "${key}"` })
      const live = liveTargets.get(targetId)
      if (!live) return reply.status(400).send({ error: `"${label}": its calendar no longer exists — reload and try again` })
      seen.add(key)
      const synonyms = Array.isArray(e.synonyms)
        ? e.synonyms.filter((x): x is string => typeof x === 'string' && !!x.trim() && x.length <= 40).map((x) => x.trim()).slice(0, 10)
        : []
      const durationMinutes =
        typeof e.durationMinutes === 'number' && e.durationMinutes >= 5 && e.durationMinutes <= 480
          ? Math.round(e.durationMinutes)
          : (live.durationMinutes ?? undefined)
      services.push({
        key,
        label,
        synonyms,
        ...(durationMinutes ? { durationMinutes } : {}),
        ...(Array.isArray(e.exclusiveWith) && e.exclusiveWith.length ? { exclusiveWith: e.exclusiveWith } : {}),
        ...(provider === 'ghl'
          ? { calendarId: targetId }
          : {
              cliniko: {
                appointmentTypeId: targetId,
                ...(Array.isArray(e.practitionerIds) && e.practitionerIds.length ? { practitionerIds: e.practitionerIds.map(String) } : {}),
              },
            }),
      })
    }

    const config = { ...clinikoRoot, services }
    const parsed = parseBookingServices(config as never)
    if (!parsed || parsed.length !== services.length) {
      return reply.status(400).send({ error: 'Config failed validation — nothing was saved' })
    }

    await prisma.account.update({
      where: { id: who.accountId },
      data: {
        agentBookingMode: provider === 'ghl' ? 'direct-ghl' : 'direct-cliniko',
        agentBookingConfig: config as never,
      },
    })
    clearBookingCacheFor(who.accountId)
    logger.info({ accountId: who.accountId, provider, services: parsed.map((s: BookingService) => s.key) }, '[agent-booking] services saved')
    return { ok: true, mode: provider === 'ghl' ? 'direct-ghl' : 'direct-cliniko', services: parsed }
  })
}
