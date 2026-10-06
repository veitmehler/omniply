/**
 * PMS contact/appointment poller (PMS framework v2 Phase C/D).
 *
 * Every 5 minutes, for accounts with a direct PMS booking mode (or a stored
 * PMS key): pull patients/appointments changed since the cursor via the
 * PMS's updated_since filtering (Cliniko today; Nookal when its provider is
 * verified) and feed the contact pipe. Appointment completions apply the
 * `appointment-completed` service tag — the trigger for the snapshot's
 * dormant review-request workflow. Demographics only, never clinical data.
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { intakeContacts, type IntakeRow } from '../lib/contacts/intake'
import {
  clinicoApiKeyFor,
  fetchChangedPatients,
  fetchChangedAppointments,
  fetchPatientById,
  fetchPatientsPage,
  upsertPatientIndexRows,
} from '../lib/booking/cliniko'

const BATCH = 100

export async function pmsContactPollHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { agentBookingMode: 'direct-cliniko' },
    select: { id: true, ownerUserId: true },
  })
  for (const account of accounts) {
    if (!account.ownerUserId) continue
    try {
      await pollClinikoAccount(account.id, account.ownerUserId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn({ err, accountId: account.id }, '[pms-poll] cliniko poll failed')
      await prisma.pmsSyncState
        .upsert({
          where: { accountId: account.id },
          create: { accountId: account.id, provider: 'cliniko', lastError: msg.slice(0, 500) },
          update: { lastError: msg.slice(0, 500) },
        })
        .catch(() => {})
    }
  }
}

/** Pages of the full-base backfill processed per 5-min tick (rate-friendly). */
const BACKFILL_PAGES_PER_TICK = 5

async function pollClinikoAccount(accountId: string, ownerUserId: string): Promise<void> {
  const apiKey = await clinicoApiKeyFor(ownerUserId)
  if (!apiKey) return
  const state = await prisma.pmsSyncState.findUnique({ where: { accountId } })

  // Initial full-base backfill: seeds the phone→patient index (booking
  // match) AND the CRM with the clinic's existing patients. Runs in page
  // budgets across ticks; cursor = Cliniko's own links.next URL.
  const indexCount = await prisma.pmsPatientIndex.count({ where: { accountId, provider: 'cliniko' } })
  const backfillDone = state?.patientsCursor != null && state?.backfillCursor == null && indexCount > 0
  if (!backfillDone) {
    let pageUrl = state?.backfillCursor ?? null
    for (let i = 0; i < BACKFILL_PAGES_PER_TICK; i++) {
      const page = await fetchPatientsPage(apiKey, pageUrl)
      if (page.patients.length) {
        await upsertPatientIndexRows(accountId, page.patients)
        await intakeContacts(
          accountId,
          'cliniko',
          page.patients.map((p) => ({
            name: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
            phone: p.phone,
            email: p.email,
          })),
        )
      }
      pageUrl = page.next
      if (!pageUrl) break
    }
    await prisma.pmsSyncState.upsert({
      where: { accountId },
      create: { accountId, provider: 'cliniko', backfillCursor: pageUrl, patientsCursor: pageUrl ? null : new Date(), lastError: null },
      update: { backfillCursor: pageUrl, ...(pageUrl ? {} : { patientsCursor: new Date() }), lastError: null },
    })
    logger.info({ accountId, backfillComplete: !pageUrl, indexCount }, '[pms-poll] cliniko backfill tick')
    if (pageUrl) return // keep backfilling next tick before incremental sync
  }

  // Patients changed since cursor → index + demographics into the pipe.
  const patients = await fetchChangedPatients(apiKey, state?.patientsCursor ?? null, BATCH)
  if (patients.length) {
    await upsertPatientIndexRows(accountId, patients)
    const rows: IntakeRow[] = patients.map((p) => ({
      name: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
      phone: p.phone,
      email: p.email,
    }))
    await intakeContacts(accountId, 'cliniko', rows)
  }
  const patientsCursor = patients.length ? new Date(patients[patients.length - 1].updatedAt) : (state?.patientsCursor ?? new Date())

  // Appointments: completed (past, not cancelled) → appointment-completed tag
  // on the patient's contact, demographics refreshed in the same upsert.
  const appts = await fetchChangedAppointments(apiKey, state?.appointmentsCursor ?? null, BATCH)
  const completed = appts.filter((a) => !a.cancelled && a.startsAt && Date.parse(a.startsAt) < Date.now())
  for (const appt of completed) {
    if (!appt.patientExternalId) continue
    const p = await fetchPatientById(apiKey, appt.patientExternalId)
    if (!p) continue
    await intakeContacts(accountId, 'cliniko', [
      {
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
        phone: p.phone,
        email: p.email,
        tags: ['appointment-completed'],
      },
    ])
  }
  const appointmentsCursor = appts.length ? new Date(appts[appts.length - 1].updatedAt) : (state?.appointmentsCursor ?? new Date())

  await prisma.pmsSyncState.upsert({
    where: { accountId },
    create: { accountId, provider: 'cliniko', patientsCursor, appointmentsCursor, lastError: null },
    update: { provider: 'cliniko', patientsCursor, appointmentsCursor, lastError: null },
  })
  if (patients.length || completed.length) {
    logger.info({ accountId, patients: patients.length, completedAppointments: completed.length }, '[pms-poll] cliniko synced')
  }
}
