/**
 * AI Activity custom object (snapshot-optimization dashboard, Veit
 * 2026-10-21): one GHL custom-object record per finished agent conversation,
 * so native Custom Object Widgets chart the AI's work next to GHL's own
 * call/appointment widgets.
 *
 * Record shape (the four approved dashboard decisions):
 *   channel       voice | webchat | facebook | instagram | whatsapp | agent-protocol
 *   outcome       booked | booking_link_sent | callback | guide_sent | human_handoff | answered
 *   booked_system ghl | cliniko | none        ("appointments AI booked, GHL or Cliniko")
 *   new_contact   yes | no                    ("new patients AI captured")
 *   coverage      after_hours | overflow | in_hours | unknown
 *   duration_seconds (voice depth, approximated first→last message)
 *
 * Schema creation is a provisioning-time ENSURE (idempotent, like staff
 * contacts / trigger links) rather than a snapshot bet. Requires the
 * objects/* scopes on the marketplace app — until the grant carries them,
 * every call 401s and the warn-log is the signal (customValues precedent).
 */
import { prisma } from '@omniply/shared'
import { logger } from '../logger'
import { getGhlCredentials } from './settings'

const OBJECT_KEY = 'custom_objects.ai_activity'
const BASE = 'https://services.leadconnectorhq.com'

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

async function ghl(apiKey: string, path: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, json }
}

/** Per-process ensure cache: schema existence is checked once per location. */
const ensured = new Set<string>()

const FIELDS: Array<{ key: string; name: string; dataType: string; options?: string[] }> = [
  { key: 'channel', name: 'Channel', dataType: 'SINGLE_OPTIONS', options: ['voice', 'webchat', 'facebook', 'instagram', 'whatsapp', 'agent-protocol'] },
  { key: 'outcome', name: 'Outcome', dataType: 'SINGLE_OPTIONS', options: ['booked', 'booking_link_sent', 'callback', 'guide_sent', 'human_handoff', 'answered'] },
  { key: 'booked_system', name: 'Booked System', dataType: 'SINGLE_OPTIONS', options: ['ghl', 'cliniko', 'none'] },
  { key: 'new_contact', name: 'New Contact', dataType: 'SINGLE_OPTIONS', options: ['yes', 'no'] },
  { key: 'coverage', name: 'Coverage', dataType: 'SINGLE_OPTIONS', options: ['after_hours', 'overflow', 'in_hours', 'unknown'] },
  { key: 'duration_seconds', name: 'Duration Seconds', dataType: 'NUMERICAL' },
]

/** Idempotent schema ensure (provisioning + first finalize per process).
 *  Learned live 2026-10-21: schema creation auto-creates a default field
 *  FOLDER, and field creation REQUIRES its id as parentId — so fields are
 *  reconciled on every first-per-process ensure, not only at schema create
 *  (also heals partially-created schemas). */
export async function ensureAiActivityObject(apiKey: string, locationId: string): Promise<boolean> {
  if (ensured.has(locationId)) return true
  const get = await ghl(apiKey, `/objects/${OBJECT_KEY}?locationId=${locationId}`)
  if (get.status === 401 || get.status === 403) {
    logger.warn({ locationId, status: get.status }, '[ai-activity] objects scope missing — records skipped until the app grant carries it')
    return false
  }
  if (get.status !== 200) {
    const create = await ghl(apiKey, '/objects/', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        labels: { singular: 'AI Activity', plural: 'AI Activities' },
        key: OBJECT_KEY,
        description: 'One record per Omniply AI agent conversation (dashboard data)',
        primaryDisplayPropertyDetails: { key: `${OBJECT_KEY}.interaction`, name: 'Interaction', dataType: 'TEXT' },
      }),
    })
    if (create.status >= 300) {
      logger.warn({ locationId, status: create.status, body: JSON.stringify(create.json).slice(0, 300) }, '[ai-activity] schema create failed')
      return false
    }
    logger.info({ locationId }, '[ai-activity] custom object created')
  }

  // Field reconcile: find the object's folder + existing fields, create the missing ones.
  const fieldsRes = await ghl(apiKey, `/custom-fields/object-key/${OBJECT_KEY}?locationId=${locationId}`)
  if (fieldsRes.status !== 200) {
    logger.warn({ locationId, status: fieldsRes.status }, '[ai-activity] field listing failed')
    return false
  }
  const listing = fieldsRes.json as { fields?: { fieldKey?: string }[]; folders?: { id?: string }[] }
  const parentId = listing.folders?.[0]?.id
  if (!parentId) {
    logger.warn({ locationId }, '[ai-activity] no field folder on object — fields skipped')
    return false
  }
  const existing = new Set((listing.fields ?? []).map((f) => f.fieldKey))
  let createdAny = false
  for (const f of FIELDS) {
    if (existing.has(`${OBJECT_KEY}.${f.key}`)) continue
    createdAny = true
    const r = await ghl(apiKey, '/custom-fields/', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        objectKey: OBJECT_KEY,
        parentId,
        name: f.name,
        fieldKey: `${OBJECT_KEY}.${f.key}`,
        dataType: f.dataType,
        showInForms: false,
        ...(f.options ? { options: f.options.map((o) => ({ key: o, label: o })) } : {}),
      }),
    })
    if (r.status >= 300) {
      logger.warn({ locationId, field: f.key, status: r.status, body: JSON.stringify(r.json).slice(0, 200) }, '[ai-activity] field create failed')
      return false
    }
  }
  // Freshly created fields need a moment before record validation sees them
  // (observed live 2026-10-21: immediate writes 400 "couldn't validate the
  // mapped field", the same write passes seconds later).
  if (createdAny) await new Promise((resolve) => setTimeout(resolve, 5000))
  ensured.add(locationId)
  return true
}

/** Write one record; best-effort (dashboards are nice-to-have, never load-bearing). */
export async function writeAiActivityRecord(apiKey: string, locationId: string, rec: AiActivityRecord): Promise<boolean> {
  const ok = await ensureAiActivityObject(apiKey, locationId)
  if (!ok) return false
  const label = `${rec.channel} · ${rec.outcome} · ${rec.startedAt.toISOString().slice(0, 10)}`
  const r = await ghl(apiKey, `/objects/${OBJECT_KEY}/records`, {
    method: 'POST',
    body: JSON.stringify({
      locationId,
      properties: {
        interaction: label,
        channel: rec.channel,
        outcome: rec.outcome,
        booked_system: rec.bookedSystem,
        new_contact: rec.newContact ? 'yes' : 'no',
        coverage: rec.coverage,
        ...(rec.durationSeconds !== null ? { duration_seconds: rec.durationSeconds } : {}),
      },
    }),
  })
  if (r.status >= 300) {
    logger.warn({ locationId, status: r.status, body: JSON.stringify(r.json).slice(0, 200) }, '[ai-activity] record write failed')
    return false
  }
  return true
}

/** Finalize-time entry: load the rollup inputs and write the record. */
export async function recordConversationActivity(conversationId: string, ownerUserId: string): Promise<boolean> {
  try {
    const convo = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, dmPlatform: true, contactWasCreated: true, startedAfterHours: true },
    })
    if (!convo) return false
    const creds = await getGhlCredentials(ownerUserId)
    if (!creds) return false
    const [messages, appts] = await Promise.all([
      prisma.agentMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: { action: true, createdAt: true },
      }),
      prisma.agentAppointment.findMany({ where: { conversationId }, select: { provider: true } }),
    ])
    const rec = rollupConversation({
      channel: convo.channel,
      dmPlatform: convo.dmPlatform,
      contactWasCreated: convo.contactWasCreated,
      startedAfterHours: convo.startedAfterHours,
      actions: messages.map((m) => m.action as { type?: unknown } | null),
      appointmentProviders: appts.map((a) => a.provider),
      firstMessageAt: messages[0]?.createdAt ?? null,
      lastMessageAt: messages[messages.length - 1]?.createdAt ?? null,
    })
    return await writeAiActivityRecord(creds.apiKey, creds.locationId, rec)
  } catch (err) {
    logger.warn({ err, conversationId }, '[ai-activity] record failed (non-fatal)')
    return false
  }
}

/** Backfill: roll up every finalized historical conversation for an account.
 *  Run via droplet node -e after the objects scope lands. */
export async function backfillAiActivity(accountId: string, limit = 2000): Promise<{ written: number; skipped: number }> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  if (!account?.ownerUserId) return { written: 0, skipped: 0 }
  const convos = await prisma.agentConversation.findMany({
    where: { accountId, turnCount: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  let written = 0
  let skipped = 0
  for (const c of convos) {
    const ok = await recordConversationActivity(c.id, account.ownerUserId)
    if (ok) written++
    else skipped++
  }
  return { written, skipped }
}
