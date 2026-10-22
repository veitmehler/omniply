/**
 * AI Receptionist dashboard widget stats (snapshot-optimization,
 * 2026-10-21): aggregates for the embedded GHL dashboard panel, computed
 * straight from agent_conversations — Postgres is the source of truth,
 * always live. (The GHL "AI Activity" custom-object layer this rollup
 * originally fed was removed 2026-10-22: the embed panel replaced native
 * widgets entirely and clients can't edit dashboards, so nothing read it.)
 */
import { prisma } from '@omniply/shared'

export interface AiActivityRecord {
  channel: 'voice' | 'webchat' | 'facebook' | 'instagram' | 'whatsapp' | 'agent-protocol'
  outcome: 'booked' | 'booking_link_sent' | 'callback' | 'guide_sent' | 'human_handoff' | 'answered'
  bookedSystem: 'ghl' | 'cliniko' | 'none'
  newContact: boolean
  coverage: 'after_hours' | 'overflow' | 'in_hours' | 'unknown'
  durationSeconds: number | null
  startedAt: Date
}

export interface RollupInput {
  channel: string // agent_conversations.channel: web | voice | ghl-dm | mcp
  dmPlatform: string | null // FB | IG | WhatsApp (resolved send type)
  contactWasCreated: boolean
  startedAfterHours: boolean | null
  actions: Array<{ type?: unknown } | null> // AgentMessage.action payloads
  appointmentProviders: string[] // agent_appointments.provider for the convo
  firstMessageAt: Date | null
  lastMessageAt: Date | null
}

/** Pure rollup: one conversation → one record. Exported for tests. */
export function rollupConversation(input: RollupInput): AiActivityRecord {
  const channel: AiActivityRecord['channel'] =
    input.channel === 'voice'
      ? 'voice'
      : input.channel === 'mcp'
        ? 'agent-protocol'
        : input.channel === 'ghl-dm'
          ? input.dmPlatform === 'FB'
            ? 'facebook'
            : input.dmPlatform === 'IG'
              ? 'instagram'
              : input.dmPlatform === 'WhatsApp'
                ? 'whatsapp'
                : 'facebook' // unresolved legacy DMs: FB is the dominant channel
          : 'webchat'

  const types = new Set(
    input.actions
      .map((a) => (a && typeof a === 'object' && typeof (a as { type?: unknown }).type === 'string' ? ((a as { type: string }).type) : null))
      .filter((t): t is string => Boolean(t)),
  )
  const outcome: AiActivityRecord['outcome'] = input.appointmentProviders.length
    ? 'booked'
    : types.has('request_callback')
      ? 'callback'
      : types.has('send_guide_link')
        ? 'guide_sent'
        : types.has('send_booking_link')
          ? 'booking_link_sent'
          : types.has('request_human')
            ? 'human_handoff'
            : 'answered'

  const bookedSystem: AiActivityRecord['bookedSystem'] = input.appointmentProviders.length
    ? input.appointmentProviders.includes('cliniko')
      ? 'cliniko'
      : 'ghl'
    : 'none'

  // Coverage semantics (Veit): after-hours answers prove the night shift;
  // in-hours VOICE answers are by definition front-desk overflow (the AI
  // only receives the call when the desk did not).
  const coverage: AiActivityRecord['coverage'] =
    input.startedAfterHours === null
      ? 'unknown'
      : input.startedAfterHours
        ? 'after_hours'
        : channel === 'voice'
          ? 'overflow'
          : 'in_hours'

  const durationSeconds =
    channel === 'voice' && input.firstMessageAt && input.lastMessageAt
      ? Math.max(0, Math.round((input.lastMessageAt.getTime() - input.firstMessageAt.getTime()) / 1000))
      : null

  return {
    channel,
    outcome,
    bookedSystem,
    newContact: input.contactWasCreated,
    coverage,
    durationSeconds,
    startedAt: input.firstMessageAt ?? new Date(),
  }
}

export interface AiActivityStats {
  days: number
  since: string // ISO
  totals: {
    conversations: number
    booked: number
    bookedGhl: number
    bookedCliniko: number
    bookingLinksSent: number
    newContacts: number
    afterHours: number
    overflow: number
    guidesSent: number
    callbacks: number
    handoffs: number
    voiceMinutes: number
  }
  byChannel: Record<AiActivityRecord['channel'], number>
  byDay: Array<{ date: string; count: number }> // clinic-tz calendar days, zero-filled
}

/** Pure aggregation over rolled-up records. Exported for tests. */
export function aggregateRecords(records: AiActivityRecord[], days: number, tz: string, now: Date = new Date()): AiActivityStats {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const totals: AiActivityStats['totals'] = {
    conversations: records.length,
    booked: 0,
    bookedGhl: 0,
    bookedCliniko: 0,
    bookingLinksSent: 0,
    newContacts: 0,
    afterHours: 0,
    overflow: 0,
    guidesSent: 0,
    callbacks: 0,
    handoffs: 0,
    voiceMinutes: 0,
  }
  const byChannel: AiActivityStats['byChannel'] = {
    voice: 0,
    webchat: 0,
    facebook: 0,
    instagram: 0,
    whatsapp: 0,
    'agent-protocol': 0,
  }

  let dayKey: (d: Date) => string
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayKey = (d) => fmt.format(d)
  } catch {
    dayKey = (d) => d.toISOString().slice(0, 10)
  }

  const dayCounts = new Map<string, number>()
  for (const rec of records) {
    byChannel[rec.channel]++
    if (rec.outcome === 'booked') {
      totals.booked++
      if (rec.bookedSystem === 'cliniko') totals.bookedCliniko++
      else totals.bookedGhl++
    }
    if (rec.outcome === 'booking_link_sent') totals.bookingLinksSent++
    if (rec.outcome === 'guide_sent') totals.guidesSent++
    if (rec.outcome === 'callback') totals.callbacks++
    if (rec.outcome === 'human_handoff') totals.handoffs++
    if (rec.newContact) totals.newContacts++
    if (rec.coverage === 'after_hours') totals.afterHours++
    if (rec.coverage === 'overflow') totals.overflow++
    if (rec.durationSeconds) totals.voiceMinutes += rec.durationSeconds / 60
    const key = dayKey(rec.startedAt)
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }
  totals.voiceMinutes = Math.round(totals.voiceMinutes)

  // Zero-filled day axis, oldest → today, in the clinic's calendar.
  const byDay: AiActivityStats['byDay'] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000))
    byDay.push({ date: key, count: dayCounts.get(key) ?? 0 })
  }

  return { days, since: since.toISOString(), totals, byChannel, byDay }
}

/** Load + roll up every counted conversation in the window for an account. */
export async function aggregateAiActivity(accountId: string, days: number): Promise<AiActivityStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const [convos, brand] = await Promise.all([
    prisma.agentConversation.findMany({
      where: { accountId, turnCount: { gt: 0 }, createdAt: { gte: since } },
      select: {
        id: true,
        channel: true,
        dmPlatform: true,
        contactWasCreated: true,
        startedAfterHours: true,
        createdAt: true,
      },
    }),
    prisma.account
      .findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
      .then((a) =>
        a?.ownerUserId
          ? prisma.settings.findUnique({ where: { userId: a.ownerUserId }, select: { socialTimezone: true } })
          : null,
      ),
  ])
  const tz = brand?.socialTimezone ?? 'America/New_York'
  if (!convos.length) return aggregateRecords([], days, tz)

  const ids = convos.map((c) => c.id)
  const [messages, appts] = await Promise.all([
    prisma.agentMessage.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { conversationId: true, action: true, createdAt: true },
    }),
    prisma.agentAppointment.findMany({
      where: { conversationId: { in: ids } },
      select: { conversationId: true, provider: true },
    }),
  ])
  const msgsByConvo = new Map<string, Array<{ action: unknown; createdAt: Date }>>()
  for (const m of messages) {
    const list = msgsByConvo.get(m.conversationId) ?? []
    list.push(m)
    msgsByConvo.set(m.conversationId, list)
  }
  const apptsByConvo = new Map<string, string[]>()
  for (const a of appts) {
    if (!a.conversationId) continue
    const list = apptsByConvo.get(a.conversationId) ?? []
    list.push(a.provider)
    apptsByConvo.set(a.conversationId, list)
  }

  const records = convos.map((c) => {
    const msgs = msgsByConvo.get(c.id) ?? []
    return rollupConversation({
      channel: c.channel,
      dmPlatform: c.dmPlatform,
      contactWasCreated: c.contactWasCreated,
      startedAfterHours: c.startedAfterHours,
      actions: msgs.map((m) => m.action as { type?: unknown } | null),
      appointmentProviders: apptsByConvo.get(c.id) ?? [],
      firstMessageAt: msgs[0]?.createdAt ?? c.createdAt,
      lastMessageAt: msgs[msgs.length - 1]?.createdAt ?? null,
    })
  })
  return aggregateRecords(records, days, tz)
}
