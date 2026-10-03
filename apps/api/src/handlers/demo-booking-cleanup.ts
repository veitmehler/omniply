/**
 * Demo booking cleanup (missed-call sweep Part 4a).
 *
 * The public demo line books REAL GHL appointments on the demo calendar.
 * Nightly, delete the demo account's agent-created calendar events (older
 * than one hour, so a just-made demo booking survives long enough to show)
 * and drop the audit rows. Contacts are deliberately LEFT ALONE: phone-first
 * convergence means a booking contact can be an existing row (even a staff
 * contact), and deleting those would be destructive — demo contacts get
 * cleaned in the periodic manual demo reset instead.
 *
 * Scope: ONLY the accounts listed in DEMO_BOOKING_CLEANUP_ACCOUNT_IDS
 * (comma-separated). Unset → the cron is a no-op; real clients' agent
 * bookings are never touched.
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { getGhlCredentials } from '../lib/ghl/settings'
import { deleteGhlCalendarEvent } from '../lib/ghl/client'
import { logger } from '../lib/logger'

export async function demoBookingCleanupHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
  const accountIds = (process.env.DEMO_BOOKING_CLEANUP_ACCOUNT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!accountIds.length) return

  const cutoff = new Date(Date.now() - 60 * 60 * 1000)
  const rows = await prisma.agentAppointment.findMany({
    where: { accountId: { in: accountIds }, createdAt: { lt: cutoff } },
    select: { id: true, accountId: true, ghlEventId: true },
    take: 200,
  })
  if (!rows.length) return

  const credsByAccount = new Map<string, Awaited<ReturnType<typeof getGhlCredentials>>>()
  let deleted = 0
  for (const row of rows) {
    if (!credsByAccount.has(row.accountId)) {
      const owner = await prisma.account.findUnique({ where: { id: row.accountId }, select: { ownerUserId: true } })
      credsByAccount.set(row.accountId, owner?.ownerUserId ? await getGhlCredentials(owner.ownerUserId) : null)
    }
    const creds = credsByAccount.get(row.accountId)
    if (!creds) continue
    try {
      await deleteGhlCalendarEvent(creds.apiKey, row.ghlEventId)
    } catch (err) {
      // Already deleted in GHL (404-class) is fine — still drop the row.
      logger.warn({ err, eventId: row.ghlEventId }, '[demo-cleanup] event delete failed — dropping row anyway')
    }
    await prisma.agentAppointment.delete({ where: { id: row.id } }).catch(() => {})
    deleted++
  }
  logger.info({ deleted, accounts: accountIds.length }, '[demo-cleanup] demo bookings cleaned')
}
