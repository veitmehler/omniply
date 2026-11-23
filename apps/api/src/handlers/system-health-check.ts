/**
 * System Health check, every 10 minutes: work out the state of every service,
 * and tell a person when a prepaid balance is running out, a provider is
 * refusing us for lack of credit, or a provider has stopped answering.
 *
 * Built after Gemini's prepaid credit hit zero on 2026-11-14 and production
 * stayed dead for ten days. Google sends no low-balance warning and offers no
 * way to read the balance, so this check is the warning.
 *
 * One condition per service alerts once, then reminds every 24 hours while it
 * lasts (ServiceAccount.alertLevel / alertAt); it goes quiet when it eases.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { flushCallStats } from '../lib/net/call-stats'
import { buildSystemHealth } from '../lib/system-health/service'
import { shouldAlert, needsSms } from '../lib/system-health/rules'
import { deliverAlert } from '../lib/system-health/notify'

export async function systemHealthCheckHandler(): Promise<void> {
  // Write this process's last minute first, so the check sees its own calls.
  await flushCallStats().catch(() => {})
  const now = new Date()
  const health = await buildSystemHealth(now)

  for (const v of health.services) {
    const row = await prisma.serviceAccount.findUnique({ where: { key: v.key }, select: { alertLevel: true, alertAt: true } })
    const decision = shouldAlert(v.alertLevel, row?.alertLevel ?? null, row?.alertAt ?? null, now)
    if (decision === 'quiet') {
      // Eased or cleared: remember the milder state so a later worsening alerts again.
      if ((row?.alertLevel ?? null) !== v.alertLevel) {
        await prisma.serviceAccount.update({ where: { key: v.key }, data: { alertLevel: v.alertLevel, alertAt: v.alertLevel ? row?.alertAt ?? now : null } })
      }
      continue
    }
    const level = v.alertLevel!
    try {
      await deliverAlert(v, level, decision === 'remind', needsSms(level, v.isCore))
      logger.warn({ service: v.key, level, reminder: decision === 'remind' }, '[system-health] alert sent')
    } catch (err) {
      logger.error({ service: v.key, err }, '[system-health] alert delivery failed')
    }
    await prisma.serviceAccount.update({ where: { key: v.key }, data: { alertLevel: level, alertAt: now } })
  }

  await prisma.platformSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', healthCheckAt: now }, update: { healthCheckAt: now } })
}
