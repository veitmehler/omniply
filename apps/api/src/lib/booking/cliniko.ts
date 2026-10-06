/**
 * Cliniko API client + booking provider (PMS framework v2 Phase D).
 *
 * Auth: per-clinic API key (ApiKey table, provider 'cliniko'), HTTP Basic
 * with the key as username. The key's shard suffix ("…-au2") selects the
 * API host. Cliniko REQUIRES a descriptive User-Agent with a contact email.
 *
 * Booking config (account.agentBookingConfig):
 *   { businessId, practitionerIds: string[], appointmentTypeId }
 *
 * Slot → practitioner mapping: free slots are fetched per practitioner and
 * merged; at book time the chosen slot is RE-VERIFIED against each
 * practitioner's live availability (doubles as a freshness check — a slot
 * taken between offer and booking throws loudly instead of double-booking).
 *
 * Contact sync (Phase C poller): fetchChangedPatients / Appointments use
 * Cliniko's q[]=updated_at:> filtering — no webhooks needed.
 */
import { prisma, decrypt } from '@omniply/shared'
import { logger } from '../logger'
import { instrumentCall } from '../net/instrument'
import type { BookingProvider, ProviderCtx, BookArgs } from './providers'

const USER_AGENT = 'Omniply (support@omniply.io)'
const TIMEOUT_MS = 20_000

export function clinikoBaseUrl(apiKey: string): string {
  const shard = apiKey.trim().split('-').pop() || 'au1'
  return `https://api.${shard}.cliniko.com/v1`
}

async function clinikoFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${clinikoBaseUrl(apiKey)}${path}`
  return instrumentCall({ provider: 'cliniko', op: `${init?.method ?? 'GET'} ${path.split('?')[0]}` }, async () => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Cliniko ${path.split('?')[0]} failed (${res.status}): ${body.slice(0, 300)}`)
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  })
}

export async function clinicoApiKeyFor(ownerUserId: string): Promise<string | null> {
  const row = await prisma.apiKey.findFirst({ where: { userId: ownerUserId, provider: 'cliniko' } })
  return row ? decrypt(row.encryptedKey) : null
}

/** Key validation + the config pickers' data (Settings/admin use). */
export async function clinikoAccountOverview(apiKey: string): Promise<{
  businesses: { id: string; name: string }[]
  practitioners: { id: string; name: string }[]
  appointmentTypes: { id: string; name: string; durationMinutes: number }[]
}> {
  const [biz, prac, types] = await Promise.all([
    clinikoFetch<{ businesses?: { id: number | string; business_name?: string; label?: string }[] }>(apiKey, '/businesses'),
    clinikoFetch<{ practitioners?: { id: number | string; first_name?: string; last_name?: string; label?: string }[] }>(apiKey, '/practitioners'),
    clinikoFetch<{ appointment_types?: { id: number | string; name?: string; duration_in_minutes?: number }[] }>(apiKey, '/appointment_types'),
  ])
  return {
    businesses: (biz.businesses ?? []).map((b) => ({ id: String(b.id), name: b.business_name ?? b.label ?? String(b.id) })),
    practitioners: (prac.practitioners ?? []).map((p) => ({
      id: String(p.id),
      name: p.label ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? String(p.id),
    })),
    appointmentTypes: (types.appointment_types ?? []).map((t) => ({
      id: String(t.id),
      name: t.name ?? String(t.id),
      durationMinutes: t.duration_in_minutes ?? 30,
    })),
  }
}

interface ClinikoConfig {
  businessId: string
  practitionerIds: string[]
  appointmentTypeId: string
}

function configOf(ctx: ProviderCtx): ClinikoConfig {
  const c = (ctx.config ?? {}) as Partial<ClinikoConfig>
  if (!c.businessId || !c.appointmentTypeId || !c.practitionerIds?.length) {
    throw new Error('Cliniko booking config incomplete (businessId, practitionerIds, appointmentTypeId)')
  }
  return { businessId: String(c.businessId), practitionerIds: c.practitionerIds.map(String), appointmentTypeId: String(c.appointmentTypeId) }
}

async function availableTimes(
  apiKey: string,
  cfg: ClinikoConfig,
  practitionerId: string,
  fromIsoDate: string,
  toIsoDate: string,
): Promise<string[]> {
  const data = await clinikoFetch<{ available_times?: { appointment_start?: string }[] }>(
    apiKey,
    `/businesses/${cfg.businessId}/practitioners/${practitionerId}/appointment_types/${cfg.appointmentTypeId}/available_times?from=${fromIsoDate}&to=${toIsoDate}`,
  )
  return (data.available_times ?? []).map((t) => t.appointment_start).filter((s): s is string => Boolean(s))
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export const clinikoProvider: BookingProvider = {
  async freeSlots(ctx, startMs, endMs) {
    const apiKey = await clinicoApiKeyFor(ctx.ownerUserId)
    if (!apiKey) throw new Error('No Cliniko API key on file')
    const cfg = configOf(ctx)
    const from = isoDate(startMs)
    const to = isoDate(endMs)
    const perPractitioner = await Promise.all(
      cfg.practitionerIds.map((pid) =>
        availableTimes(apiKey, cfg, pid, from, to).catch((err) => {
          logger.warn({ err, pid, accountId: ctx.accountId }, '[cliniko] available_times failed for practitioner')
          return [] as string[]
        }),
      ),
    )
    return [...new Set(perPractitioner.flat())].sort()
  },

  async book(ctx, args: BookArgs) {
    const apiKey = await clinicoApiKeyFor(ctx.ownerUserId)
    if (!apiKey) throw new Error('No Cliniko API key on file')
    const cfg = configOf(ctx)

    // Re-verify the slot + resolve which practitioner owns it (freshness
    // check: offered-then-taken slots throw here instead of double-booking).
    const day = args.slotStart.slice(0, 10)
    let practitionerId: string | null = null
    for (const pid of cfg.practitionerIds) {
      const times = await availableTimes(apiKey, cfg, pid, day, day)
      if (times.includes(args.slotStart)) {
        practitionerId = pid
        break
      }
    }
    if (!practitionerId) throw new Error(`Cliniko slot no longer available: ${args.slotStart}`)

    // Patient matching, phone-FIRST (the voice agent identifies callers by
    // caller-ID; Cliniko can't filter by phone, so we use our own index,
    // fed by the poller/backfill). Shared family numbers disambiguate by
    // the caller's name; email is the fallback; else create-if-new.
    let patientId = await matchPatientByPhone(ctx.accountId, args.phone, args.name)
    if (!patientId && args.email) {
      const found = await clinikoFetch<{ patients?: { id: number | string }[] }>(
        apiKey,
        `/patients?q[]=${encodeURIComponent(`email:=${args.email}`)}`,
      ).catch(() => ({ patients: [] }))
      if (found.patients?.length === 1) patientId = String(found.patients[0].id)
    }
    if (!patientId) {
      const [firstName, ...rest] = args.name.trim().split(/\s+/)
      const created = await clinikoFetch<{ id?: number | string }>(apiKey, '/patients', {
        method: 'POST',
        body: JSON.stringify({
          first_name: firstName || 'Caller',
          last_name: rest.join(' ') || '(via phone)',
          ...(args.email ? { email: args.email } : {}),
          patient_phone_numbers: [{ number: args.phone, phone_type: 'Mobile' }],
        }),
      })
      if (!created.id) throw new Error('Cliniko patient creation returned no id')
      patientId = String(created.id)
      // Index immediately — a repeat caller must never create a duplicate.
      await upsertPatientIndexRows(ctx.accountId, [
        { externalId: patientId, firstName: args.name.split(/\s+/)[0] ?? null, lastName: args.name.split(/\s+/).slice(1).join(' ') || null, email: args.email, phone: args.phone, updatedAt: new Date().toISOString() },
      ]).catch(() => {})
    }

    const type = await clinikoFetch<{ duration_in_minutes?: number }>(apiKey, `/appointment_types/${cfg.appointmentTypeId}`)
    const durationMin = type.duration_in_minutes ?? 30
    const endsAt = new Date(Date.parse(args.slotStart) + durationMin * 60_000).toISOString()

    const appt = await clinikoFetch<{ id?: number | string }>(apiKey, '/individual_appointments', {
      method: 'POST',
      body: JSON.stringify({
        business_id: cfg.businessId,
        practitioner_id: practitionerId,
        appointment_type_id: cfg.appointmentTypeId,
        patient_id: patientId,
        starts_at: args.slotStart,
        ends_at: endsAt,
        notes: 'Booked by the Omniply AI assistant on a live call.',
      }),
    })
    if (!appt.id) throw new Error('Cliniko appointment creation returned no id')
    return { externalId: String(appt.id) }
  },

  async cancel(ctx, externalId) {
    const apiKey = await clinicoApiKeyFor(ctx.ownerUserId)
    if (!apiKey) throw new Error('No Cliniko API key on file')
    await clinikoFetch<void>(apiKey, `/individual_appointments/${externalId}`, { method: 'DELETE' })
  },
}

// ── Contact-pipe feeder (Phase C poller) ─────────────────────────────────────

export interface ChangedPatient {
  externalId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  updatedAt: string
}

interface RawPatient {
  id: number | string
  first_name?: string
  last_name?: string
  email?: string
  updated_at?: string
  patient_phone_numbers?: { number?: string }[]
}

function toChangedPatient(p: RawPatient): ChangedPatient {
  return {
    externalId: String(p.id),
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    email: p.email ?? null,
    phone: p.patient_phone_numbers?.[0]?.number ?? null,
    updatedAt: p.updated_at ?? new Date().toISOString(),
  }
}

export async function fetchChangedPatients(apiKey: string, since: Date | null, limit = 100): Promise<ChangedPatient[]> {
  const q = since ? `&q[]=${encodeURIComponent(`updated_at:>${since.toISOString()}`)}` : ''
  const data = await clinikoFetch<{ patients?: RawPatient[] }>(apiKey, `/patients?per_page=${limit}&sort=updated_at${q}`)
  return (data.patients ?? []).map(toChangedPatient)
}

/**
 * One page of the full patient-base backfill (seeds the phone index).
 * `pageUrl` null starts at page 1; the returned `next` is Cliniko's own
 * links.next URL (null when the backfill is complete). The poller budgets
 * a few pages per 5-minute tick and stores `next` as its cursor.
 */
export async function fetchPatientsPage(
  apiKey: string,
  pageUrl: string | null,
): Promise<{ patients: ChangedPatient[]; next: string | null }> {
  const data = await clinikoFetch<{ patients?: RawPatient[]; links?: { next?: string } }>(
    apiKey,
    pageUrl ?? '/patients?per_page=100&sort=id',
  )
  return { patients: (data.patients ?? []).map(toChangedPatient), next: data.links?.next ?? null }
}

export interface ChangedAppointment {
  externalId: string
  patientExternalId: string | null
  startsAt: string | null
  updatedAt: string
  cancelled: boolean
}

export async function fetchChangedAppointments(apiKey: string, since: Date | null, limit = 100): Promise<ChangedAppointment[]> {
  const q = since ? `&q[]=${encodeURIComponent(`updated_at:>${since.toISOString()}`)}` : ''
  const data = await clinikoFetch<{
    individual_appointments?: {
      id: number | string
      starts_at?: string
      updated_at?: string
      cancelled_at?: string | null
      patient?: { links?: { self?: string } }
    }[]
  }>(apiKey, `/individual_appointments?per_page=${limit}&sort=updated_at${q}`)
  return (data.individual_appointments ?? []).map((a) => ({
    externalId: String(a.id),
    patientExternalId: a.patient?.links?.self?.split('/').pop() ?? null,
    startsAt: a.starts_at ?? null,
    updatedAt: a.updated_at ?? new Date().toISOString(),
    cancelled: Boolean(a.cancelled_at),
  }))
}

export async function fetchPatientById(apiKey: string, id: string): Promise<ChangedPatient | null> {
  try {
    const p = await clinikoFetch<{
      id: number | string
      first_name?: string
      last_name?: string
      email?: string
      updated_at?: string
      patient_phone_numbers?: { number?: string }[]
    }>(apiKey, `/patients/${id}`)
    return {
      externalId: String(p.id),
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      email: p.email ?? null,
      phone: p.patient_phone_numbers?.[0]?.number ?? null,
      updatedAt: p.updated_at ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── Phone → patient index (fed by the poller/backfill; used by book()) ──────

/** Digits-only tail for tolerant phone comparison (last 9 digits). */
export function phoneIndexKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-9) : null
}

export async function upsertPatientIndexRows(accountId: string, patients: ChangedPatient[]): Promise<void> {
  for (const p of patients) {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || null
    await prisma.pmsPatientIndex.upsert({
      where: { accountId_provider_externalPatientId: { accountId, provider: 'cliniko', externalPatientId: p.externalId } },
      create: {
        accountId,
        provider: 'cliniko',
        externalPatientId: p.externalId,
        phoneNormalized: phoneIndexKey(p.phone),
        name,
        email: p.email?.toLowerCase() ?? null,
      },
      update: { phoneNormalized: phoneIndexKey(p.phone), name, email: p.email?.toLowerCase() ?? null },
    })
  }
}

/**
 * Pure disambiguation: candidates sharing the caller's phone → the one whose
 * indexed name matches the caller's stated name (token overlap on first OR
 * exact last name). Null when nothing matches confidently.
 */
export function pickPatientByName(
  candidates: { externalPatientId: string; name: string | null }[],
  callerName: string,
): string | null {
  if (candidates.length === 1) return candidates[0].externalPatientId
  const tokens = callerName.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const matches = candidates.filter((c) => {
    const n = (c.name ?? '').toLowerCase()
    return n && tokens.every((t) => n.includes(t))
  })
  if (matches.length === 1) return matches[0].externalPatientId
  const firstOnly = candidates.filter((c) => (c.name ?? '').toLowerCase().startsWith(tokens[0]))
  return firstOnly.length === 1 ? firstOnly[0].externalPatientId : null
}

async function matchPatientByPhone(accountId: string, phone: string, callerName: string): Promise<string | null> {
  const key = phoneIndexKey(phone)
  if (!key) return null
  const rows = await prisma.pmsPatientIndex.findMany({
    where: { accountId, provider: 'cliniko', phoneNormalized: key },
    select: { externalPatientId: true, name: true },
    take: 10,
  })
  if (!rows.length) return null
  return pickPatientByName(rows, callerName)
}
