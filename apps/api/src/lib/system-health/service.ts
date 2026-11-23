/**
 * System Health: assembles everything the admin dashboard shows, and the same
 * numbers the alert check decides on. Reads only; the rules live in rules.ts.
 */
import { prisma } from '@omniply/shared'
import { ensureServiceCatalog, CORE_SERVICES } from './catalog'
import {
  trackedBalanceStart,
  dailySpend,
  runwayDays,
  creditLevel,
  serviceState,
  alertLevelFor,
  type CallWindow,
  type CreditLevel,
  type ServiceState,
  type AlertLevel,
} from './rules'
import { fetchStatusFeed, fetchDomainExpiry, fetchLiveBalance, type ProviderStatus } from './external'
import { hourBucket } from '../net/call-stats'

const DAY = 24 * 60 * 60 * 1000

export interface SpendPair {
  /** Measured where the call leaves for the provider (ProviderSpend). */
  wire: number
  /** Attributed to accounts and jobs by call sites (LLMUsage). */
  attributed: number
}

export interface ServiceView {
  key: string
  label: string
  usedFor: string
  billing: string
  balanceMode: string
  isCore: boolean
  rechargeUrl: string | null
  statusPageUrl: string | null
  warnDays: number
  criticalDays: number
  monthlyAmount: number | null
  renewsOn: string | null
  notes: string | null
  credit: {
    balance: number | null
    source: 'tracked' | 'live'
    since: string | null
    base: number
    toppedUp: number
    spent: SpendPair
    perDay: number
    /** null with noSpend = nothing is being spent, so there is no end date. */
    runwayDays: number | null
    noSpend: boolean
    level: CreditLevel
    error: string | null
  } | null
  spend: { last7d: SpendPair; last30d: SpendPair; monthToDate: SpendPair } | null
  calls: {
    state: ServiceState
    week: { ok: number; failed: number; skipped: number }
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastErrorStatus: number | null
    lastErrorMessage: string | null
  }
  providerStatus: ProviderStatus | null
  domain: { expiresAt: string | null; daysLeft: number | null; status: string[]; nameservers: string[]; parked: boolean; error: string | null } | null
  ledger: Array<{ id: string; kind: string; amount: number; at: string; note: string | null }>
  alertLevel: AlertLevel | null
}

export interface SystemHealth {
  generatedAt: string
  services: ServiceView[]
  kpis: {
    needsAction: Array<{ key: string; label: string; why: string }>
    degraded: Array<{ key: string; label: string; why: string }>
    shortestRunway: { key: string; label: string; days: number; perDay: number } | null
    failedJobs: number
  }
  totals: {
    monthToDate: SpendPair
    last30d: SpendPair
    fixedMonthly: number
    /** Metered spend this month plus the fixed plans. */
    systemMonth: number
    activeAccounts: number
  }
  failedWork: Array<{ account: string; articles: number; newsletters: number; firstDue: string | null }>
  own: { apiUptimeSec: number; workerCheckAt: string | null; dbConnections: number | null; lastArticleOkAt: string | null }
  alerts: { emailTo: string | null; smsTo: string | null; smsFrom: string | null }
}

const emptyWindow = (): CallWindow => ({ ok: 0, failed: 0, skipped: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorStatus: null, lastErrorMessage: null })

function addRow(w: CallWindow, r: { ok: number; failed: number; skipped: number; lastSuccessAt: Date | null; lastErrorAt: Date | null; lastErrorStatus: number | null; lastErrorMessage: string | null }): void {
  w.ok += r.ok
  w.failed += r.failed
  w.skipped += r.skipped
  if (r.lastSuccessAt && (!w.lastSuccessAt || r.lastSuccessAt > w.lastSuccessAt)) w.lastSuccessAt = r.lastSuccessAt
  if (r.lastErrorAt && (!w.lastErrorAt || r.lastErrorAt > w.lastErrorAt)) {
    w.lastErrorAt = r.lastErrorAt
    w.lastErrorStatus = r.lastErrorStatus
    w.lastErrorMessage = r.lastErrorMessage
  }
}

/** Spend per provider since a moment, from both sources. */
async function spendSince(since: Date): Promise<Map<string, SpendPair>> {
  const [wire, attributed] = await Promise.all([
    prisma.providerSpend.groupBy({ by: ['provider'], where: { at: { gt: since } }, _sum: { cost: true } }),
    prisma.lLMUsage.groupBy({ by: ['provider'], where: { createdAt: { gt: since } }, _sum: { cost: true } }),
  ])
  const out = new Map<string, SpendPair>()
  const slot = (p: string) => {
    let s = out.get(p)
    if (!s) {
      s = { wire: 0, attributed: 0 }
      out.set(p, s)
    }
    return s
  }
  for (const r of wire) slot(r.provider).wire = r._sum.cost ?? 0
  for (const r of attributed) slot(r.provider).attributed = r._sum.cost ?? 0
  return out
}

/** The higher of the two sources: neither can overstate what a provider billed, either can miss some. */
export const metered = (s: SpendPair | undefined): number => Math.max(s?.wire ?? 0, s?.attributed ?? 0)
const pair = (s: SpendPair | undefined): SpendPair => ({ wire: s?.wire ?? 0, attributed: s?.attributed ?? 0 })
const sumPairs = (m: Map<string, SpendPair>): SpendPair => {
  let wire = 0
  let attributed = 0
  for (const s of m.values()) {
    wire += s.wire
    attributed += s.attributed
  }
  return { wire, attributed }
}

async function failedWork(): Promise<{ rows: SystemHealth['failedWork']; total: number }> {
  const since = new Date(Date.now() - 45 * DAY)
  const failed = await prisma.articleJob.findMany({
    where: { status: 'failed', createdAt: { gte: since } },
    select: { topicId: true, userId: true, createdAt: true, topic: { select: { scheduledDate: true } } },
  })
  const topicIds = [...new Set(failed.map((f) => f.topicId))]
  const recovered = new Set(
    topicIds.length
      ? (await prisma.articleJob.findMany({ where: { topicId: { in: topicIds }, status: { not: 'failed' } }, select: { topicId: true } })).map((r) => r.topicId)
      : [],
  )
  const perUser = new Map<string, { topics: Map<string, Date | null>; newsletters: number }>()
  const slot = (userId: string) => {
    let s = perUser.get(userId)
    if (!s) {
      s = { topics: new Map(), newsletters: 0 }
      perUser.set(userId, s)
    }
    return s
  }
  for (const f of failed) if (!recovered.has(f.topicId)) slot(f.userId).topics.set(f.topicId, f.topic?.scheduledDate ?? null)
  const nl = await prisma.newsletter.groupBy({ by: ['userId'], where: { status: 'failed', createdAt: { gte: since } }, _count: true })
  for (const n of nl) slot(n.userId).newsletters = n._count
  const users = perUser.size
    ? await prisma.user.findMany({ where: { id: { in: [...perUser.keys()] } }, select: { id: true, email: true, brandSettings: { select: { organizationName: true } } } })
    : []
  const name = new Map(users.map((u) => [u.id, u.brandSettings?.organizationName || u.email]))
  const rows = [...perUser.entries()]
    .map(([userId, s]) => {
      const due = [...s.topics.values()].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
      return { account: name.get(userId) ?? userId, articles: s.topics.size, newsletters: s.newsletters, firstDue: due ? due.toISOString() : null }
    })
    .filter((r) => r.articles + r.newsletters > 0)
    .sort((a, b) => b.articles + b.newsletters - (a.articles + a.newsletters))
  return { rows, total: rows.reduce((acc, r) => acc + r.articles + r.newsletters, 0) }
}

export function domainAlertLevel(daysLeft: number): AlertLevel | null {
  if (daysLeft < 0) return 'down'
  if (daysLeft < 14) return 'critical'
  if (daysLeft < 30) return 'warn'
  return null
}

function maskEmail(e: string | undefined): string | null {
  if (!e) return null
  const [name, host] = e.split('@')
  return host ? `${name.slice(0, 2)}…@${host}` : e
}

export async function buildSystemHealth(now: Date = new Date()): Promise<SystemHealth> {
  await ensureServiceCatalog()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [services, s7, s30, sMonth, statRows, settings, work, lastOk, activeAccounts, dbConn] = await Promise.all([
    prisma.serviceAccount.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' }, include: { ledger: { orderBy: { at: 'desc' } } } }),
    spendSince(new Date(now.getTime() - 7 * DAY)),
    spendSince(new Date(now.getTime() - 30 * DAY)),
    spendSince(monthStart),
    prisma.providerCallStat.findMany({ where: { bucket: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.platformSettings.findUnique({ where: { id: 'singleton' }, select: { opsAlertSmsTo: true, opsAlertSmsFrom: true, healthCheckAt: true } }),
    failedWork(),
    prisma.articleJob.findFirst({ where: { status: { notIn: ['failed', 'pending', 'processing', 'cancelled'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.account.count({ where: { status: 'active' } }).catch(() => 0),
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database()`.then((r) => Number(r[0]?.n ?? 0)).catch(() => null),
  ])

  const dayCut = new Date(now.getTime() - DAY)
  const hourCut = hourBucket(new Date(now.getTime() - 60 * 60 * 1000))
  const windows = new Map<string, { week: CallWindow; day: CallWindow; hour: CallWindow }>()
  for (const r of statRows) {
    let w = windows.get(r.provider)
    if (!w) {
      w = { week: emptyWindow(), day: emptyWindow(), hour: emptyWindow() }
      windows.set(r.provider, w)
    }
    addRow(w.week, r)
    if (r.bucket >= dayCut) addRow(w.day, r)
    if (r.bucket >= hourCut) addRow(w.hour, r)
  }

  const views: ServiceView[] = await Promise.all(
    services.map(async (svc): Promise<ServiceView> => {
      const w = svc.callProvider ? windows.get(svc.callProvider) : undefined
      const week = w?.week ?? emptyWindow()
      const state = serviceState(Boolean(svc.callProvider), week, w?.day ?? emptyWindow(), w?.hour ?? emptyWindow())

      let credit: ServiceView['credit'] = null
      const mp = svc.meteredProvider
      const perDay = mp ? dailySpend(metered(s7.get(mp)), metered(s30.get(mp))) : 0
      if (svc.balanceMode === 'tracked') {
        const start = trackedBalanceStart(svc.ledger.map((l) => ({ kind: l.kind, amount: l.amount, at: l.at })))
        const spent = start && mp ? pair((await spendSince(start.since)).get(mp)) : { wire: 0, attributed: 0 }
        const balance = start ? start.base + start.toppedUp - metered(spent) : null
        const runway = runwayDays(balance, perDay)
        credit = {
          balance,
          source: 'tracked',
          since: start ? start.since.toISOString() : null,
          base: start?.base ?? 0,
          toppedUp: start?.toppedUp ?? 0,
          spent,
          perDay,
          runwayDays: runway === null || !Number.isFinite(runway) ? null : runway,
          noSpend: runway !== null && !Number.isFinite(runway),
          level: creditLevel(balance, runway, svc.warnDays, svc.criticalDays),
          error: null,
        }
      } else if (svc.balanceMode === 'live') {
        const live = await fetchLiveBalance(svc.key)
        const runway = runwayDays(live.balance, perDay)
        credit = {
          balance: live.balance,
          source: 'live',
          since: null,
          base: 0,
          toppedUp: 0,
          spent: { wire: 0, attributed: 0 },
          perDay,
          runwayDays: runway === null || !Number.isFinite(runway) ? null : runway,
          noSpend: runway !== null && !Number.isFinite(runway),
          // A live balance with no metered spend has no runway; it is only ever "ok" or "depleted".
          level: live.balance === null ? 'unknown' : live.balance <= 0 ? 'depleted' : creditLevel(live.balance, runway, svc.warnDays, svc.criticalDays),
          error: live.error,
        }
      }

      const isDomain = svc.billing === 'domain'
      const [providerStatus, expiry] = await Promise.all([
        svc.statusFeedUrl ? fetchStatusFeed(svc.statusFeedUrl) : Promise.resolve(null),
        isDomain ? fetchDomainExpiry(svc.key.replace(/^domain:/, '')) : Promise.resolve(null),
      ])

      return {
        key: svc.key,
        label: svc.label,
        usedFor: svc.usedFor,
        billing: svc.billing,
        balanceMode: svc.balanceMode,
        isCore: CORE_SERVICES.has(svc.key),
        rechargeUrl: svc.rechargeUrl,
        statusPageUrl: svc.statusPageUrl,
        warnDays: svc.warnDays,
        criticalDays: svc.criticalDays,
        monthlyAmount: svc.monthlyAmount,
        renewsOn: svc.renewsOn ? svc.renewsOn.toISOString() : null,
        notes: svc.notes,
        credit,
        spend: mp ? { last7d: pair(s7.get(mp)), last30d: pair(s30.get(mp)), monthToDate: pair(sMonth.get(mp)) } : null,
        calls: {
          state,
          week: { ok: week.ok, failed: week.failed, skipped: week.skipped },
          lastSuccessAt: week.lastSuccessAt ? week.lastSuccessAt.toISOString() : null,
          lastErrorAt: week.lastErrorAt ? week.lastErrorAt.toISOString() : null,
          lastErrorStatus: week.lastErrorStatus,
          lastErrorMessage: week.lastErrorMessage,
        },
        providerStatus,
        domain: expiry
          ? {
              expiresAt: expiry.expiresAt,
              daysLeft: expiry.expiresAt ? Math.floor((new Date(expiry.expiresAt).getTime() - now.getTime()) / DAY) : null,
              status: expiry.status,
              nameservers: expiry.nameservers,
              parked: expiry.parked,
              error: expiry.error,
            }
          : null,
        ledger: svc.ledger.slice(0, 12).map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, at: l.at.toISOString(), note: l.note })),
        // A domain alerts on its registration: parked or past due is an outage, the last two weeks are urgent, the last month a warning.
        alertLevel:
          alertLevelFor(credit?.level ?? 'unknown', state) ??
          (expiry?.parked ? 'down' : expiry?.expiresAt ? domainAlertLevel(Math.floor((new Date(expiry.expiresAt).getTime() - now.getTime()) / DAY)) : null),
      }
    }),
  )

  const needsAction: SystemHealth['kpis']['needsAction'] = []
  const degraded: SystemHealth['kpis']['degraded'] = []
  for (const v of views) {
    if (v.calls.state === 'blocked') needsAction.push({ key: v.key, label: v.label, why: 'no credit' })
    else if (v.credit?.level === 'depleted') needsAction.push({ key: v.key, label: v.label, why: 'balance at zero' })
    else if (v.calls.state === 'down') needsAction.push({ key: v.key, label: v.label, why: 'not answering' })
    else if (v.credit?.level === 'critical') needsAction.push({ key: v.key, label: v.label, why: `under ${v.criticalDays} days of credit` })
    else if (v.domain?.parked) needsAction.push({ key: v.key, label: v.label, why: 'registration lapsed, the domain is parked' })
    else if (v.domain && v.domain.daysLeft !== null && v.domain.daysLeft < 14) needsAction.push({ key: v.key, label: v.label, why: v.domain.daysLeft < 0 ? 'registration lapsed' : `expires in ${v.domain.daysLeft} days` })
    else if (v.calls.state === 'degraded') degraded.push({ key: v.key, label: v.label, why: `${v.calls.week.failed + v.calls.week.skipped} failed calls this week` })
    else if (v.credit?.level === 'warn') degraded.push({ key: v.key, label: v.label, why: `under ${v.warnDays} days of credit` })
    else if (v.providerStatus && !['none', 'unreachable'].includes(v.providerStatus.indicator)) degraded.push({ key: v.key, label: v.label, why: v.providerStatus.description })
  }

  const runways = views
    .filter((v) => v.credit && v.credit.balance !== null && !v.credit.noSpend && v.credit.runwayDays !== null)
    .map((v) => ({ key: v.key, label: v.label, days: v.credit!.runwayDays!, perDay: v.credit!.perDay }))
    .sort((a, b) => a.days - b.days)

  const monthToDate = sumPairs(sMonth)
  const fixedMonthly = views.reduce((acc, v) => acc + (v.monthlyAmount ?? 0), 0)

  return {
    generatedAt: now.toISOString(),
    services: views,
    kpis: { needsAction, degraded, shortestRunway: runways[0] ?? null, failedJobs: work.total },
    totals: { monthToDate, last30d: sumPairs(s30), fixedMonthly, systemMonth: metered(monthToDate) + fixedMonthly, activeAccounts },
    failedWork: work.rows,
    own: {
      apiUptimeSec: Math.round(process.uptime()),
      workerCheckAt: settings?.healthCheckAt ? settings.healthCheckAt.toISOString() : null,
      dbConnections: dbConn,
      lastArticleOkAt: lastOk ? lastOk.createdAt.toISOString() : null,
    },
    alerts: { emailTo: maskEmail(process.env.ALERT_EMAIL_TO), smsTo: settings?.opsAlertSmsTo ?? null, smsFrom: settings?.opsAlertSmsFrom ?? null },
  }
}
