/**
 * AI Employee dashboard widget stats (snapshot-optimization, 2026-10-21):
 * aggregates for the embedded GHL dashboard panel, computed straight from
 * agent_conversations (NOT the GHL custom object — Postgres is the source
 * of truth, always live, no backfill/settle semantics to fight).
 *
 * Reuses the finalize rollup (rollupConversation) so the widget and the
 * custom-object records can never disagree about what a conversation was.
 */
import { prisma } from '@omniply/shared'
import { rollupConversation, type AiActivityRecord } from './ghl/ai-activity'

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
