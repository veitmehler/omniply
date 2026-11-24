/**
 * Admin System Health API (2026-11-23).
 *   GET    /api/admin/system-health                         the whole dashboard
 *   PUT    /api/admin/system-health/services/:key           thresholds, links, monthly amount, notes
 *   POST   /api/admin/system-health/services/:key/ledger    "the account shows $X" or "I added $X"
 *   DELETE /api/admin/system-health/ledger/:id              undo a mistaken entry
 *   PUT    /api/admin/system-health/alerts                  where alert texts go
 *   POST   /api/admin/system-health/alerts/test-sms         send one test text, report delivery
 *   POST   /api/admin/system-health/rerun                   re-queue failed articles and newsletters (all, or one account)
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { requireAdmin } from '../../middleware/admin'
import { buildSystemHealth } from '../../lib/system-health/service'
import { ensureServiceCatalog } from '../../lib/system-health/catalog'
import { sendOpsSms, SMS_OPT_IN_MESSAGE, SMS_TEST_MESSAGE } from '../../lib/system-health/notify'
import { flushCallStats } from '../../lib/net/call-stats'
import { getTwilioMessageStatus } from '../../lib/twilio'
import { rerunFailedWork } from '../../lib/system-health/rerun'

interface ServiceBody {
  warnDays?: number
  criticalDays?: number
  rechargeUrl?: string | null
  monthlyAmount?: number | null
  renewsOn?: string | null
  notes?: string | null
}

interface LedgerBody {
  kind?: string
  amount?: number
  at?: string
  note?: string | null
}

const E164 = /^\+[1-9]\d{7,14}$/

function httpUrlOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

export async function systemHealthAdminRoutes(app: FastifyInstance) {
  app.get('/system-health', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    await flushCallStats().catch(() => {}) // this process's last minute, so the page is current
    return reply.send(await buildSystemHealth())
  })

  app.put<{ Params: { key: string }; Body: ServiceBody }>('/system-health/services/:key', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    await ensureServiceCatalog()
    const { key } = request.params
    const b = request.body ?? {}
    const existing = await prisma.serviceAccount.findUnique({ where: { key }, select: { warnDays: true, criticalDays: true } })
    if (!existing) return reply.status(404).send({ error: 'Unknown service' })

    const data: Record<string, unknown> = {}
    const warn = b.warnDays ?? existing.warnDays
    const crit = b.criticalDays ?? existing.criticalDays
    if (!Number.isInteger(warn) || !Number.isInteger(crit) || warn < 1 || crit < 0 || warn > 365) return reply.status(400).send({ error: 'Thresholds must be whole days' })
    if (crit >= warn) return reply.status(400).send({ error: 'The critical threshold must be lower than the warning threshold' })
    data.warnDays = warn
    data.criticalDays = crit
    const url = httpUrlOrNull(b.rechargeUrl)
    if (b.rechargeUrl !== undefined && url === undefined) return reply.status(400).send({ error: 'The recharge page must be a web address' })
    if (url !== undefined) data.rechargeUrl = url
    if (b.monthlyAmount !== undefined) {
      if (b.monthlyAmount !== null && (!Number.isFinite(b.monthlyAmount) || b.monthlyAmount < 0)) return reply.status(400).send({ error: 'The monthly amount must be zero or more' })
      data.monthlyAmount = b.monthlyAmount
    }
    if (b.renewsOn !== undefined) {
      const d = b.renewsOn ? new Date(b.renewsOn) : null
      if (d && Number.isNaN(d.getTime())) return reply.status(400).send({ error: 'The renewal date is not a date' })
      data.renewsOn = d
    }
    if (b.notes !== undefined) data.notes = b.notes?.toString().slice(0, 2000) || null

    await prisma.serviceAccount.update({ where: { key }, data })
    return reply.send({ ok: true })
  })

  app.post<{ Params: { key: string }; Body: LedgerBody }>('/system-health/services/:key/ledger', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    await ensureServiceCatalog()
    const { key } = request.params
    const b = request.body ?? {}
    if (b.kind !== 'set' && b.kind !== 'topup') return reply.status(400).send({ error: 'kind must be "set" or "topup"' })
    if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 100_000) return reply.status(400).send({ error: 'The amount must be a number of dollars' })
    const at = b.at ? new Date(b.at) : new Date()
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) return reply.status(400).send({ error: 'The date cannot be in the future' })
    const svc = await prisma.serviceAccount.findUnique({ where: { key }, select: { balanceMode: true } })
    if (!svc) return reply.status(404).send({ error: 'Unknown service' })
    if (svc.balanceMode !== 'tracked') return reply.status(400).send({ error: 'This balance is not tracked by hand' })
    const entry = await prisma.serviceLedgerEntry.create({ data: { serviceKey: key, kind: b.kind, amount: b.amount, at, note: b.note?.toString().slice(0, 300) || null } })
    // A new balance or top-up ends any open low-credit alert for this service.
    await prisma.serviceAccount.update({ where: { key }, data: { alertLevel: null, alertAt: null } })
    request.log.info({ service: key, kind: b.kind, amount: b.amount }, '[system-health] ledger entry recorded')
    return reply.send({ ok: true, id: entry.id })
  })

  app.delete<{ Params: { id: string } }>('/system-health/ledger/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    await prisma.serviceLedgerEntry.deleteMany({ where: { id: request.params.id } })
    return reply.send({ ok: true })
  })

  app.put<{ Body: { smsTo?: string | null; smsFrom?: string | null; consent?: boolean } }>('/system-health/alerts', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    const norm = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.replace(/[\s().-]/g, ''))
    const smsTo = norm(request.body?.smsTo)
    const smsFrom = norm(request.body?.smsFrom)
    if (smsTo && !E164.test(smsTo)) return reply.status(400).send({ error: 'Use the international format, for example +18295550100' })
    if (smsFrom && !E164.test(smsFrom)) return reply.status(400).send({ error: 'The sending number must be in international format' })
    // A mobile number is saved only with the stated consent: this field is the
    // opt-in for the alert texts (A2P 10DLC campaign, 2026-11-24).
    const before = await prisma.platformSettings.findUnique({ where: { id: 'singleton' }, select: { opsAlertSmsTo: true } })
    const isNewNumber = Boolean(smsTo) && smsTo !== before?.opsAlertSmsTo
    if (isNewNumber && request.body?.consent !== true) return reply.status(400).send({ error: 'Tick the box to agree to receive alert texts on this number' })
    const data = { ...(smsTo !== undefined ? { opsAlertSmsTo: smsTo } : {}), ...(smsFrom !== undefined ? { opsAlertSmsFrom: smsFrom } : {}) }
    await prisma.platformSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data })
    if (isNewNumber) {
      request.log.info({ adminId: admin.id }, '[system-health] alert-text consent recorded for a new mobile number')
      const confirmed = await sendOpsSms(SMS_OPT_IN_MESSAGE)
      return reply.send({ ok: true, confirmation: confirmed.ok ? 'sent' : confirmed.reason })
    }
    return reply.send({ ok: true })
  })

  app.post('/system-health/alerts/test-sms', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    const sent = await sendOpsSms(SMS_TEST_MESSAGE)
    if (!sent.ok) {
      // Twilio error 21408. The raw text names an account id and helps nobody fix it.
      const geo = /has not been enabled for the region/i.test(sent.reason)
      return reply.status(400).send({
        error: geo
          ? 'Twilio refuses to text this country. In the Twilio console, with the account "Azavea Inc" selected (not a sub-account), open Messaging, Settings, Geo permissions, tick the country, and press Save at the bottom of the page. It can take a few minutes to apply.'
          : sent.reason.replace(/AC[0-9a-f]{32}/g, 'the account'),
      })
    }
    // Twilio accepts first and delivers after; give it a moment and report what the carrier said.
    await new Promise((r) => setTimeout(r, 6_000))
    const status = await getTwilioMessageStatus(sent.sid).catch(() => null)
    return reply.send({ ok: true, from: sent.from, to: sent.to, status: status?.status ?? sent.status, errorCode: status?.errorCode ?? null, errorMessage: status?.errorMessage ?? null })
  })
  app.post<{ Body: { userId?: string } }>('/system-health/rerun', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    await flushCallStats().catch(() => {})
    const health = await buildSystemHealth()
    if (!health.rerun.allowed) return reply.status(409).send({ error: health.rerun.reason ?? 'Nothing to re-run' })
    const userId = typeof request.body?.userId === 'string' && request.body.userId ? request.body.userId : undefined
    if (userId && !health.failedWork.some((f) => f.userId === userId)) return reply.status(404).send({ error: 'That account has no failed work waiting' })
    const result = await rerunFailedWork({ userId })
    request.log.info({ adminId: admin.id, ...result }, '[system-health] re-run requested')
    return reply.send({ ok: true, ...result })
  })
}
