'use client'

/**
 * Admin › System Health (2026-11-23).
 *
 * One screen for every service Omniply depends on or pays for: is it answering,
 * how much prepaid credit is left and for how many days, where to add more, and
 * what the whole system costs. Built after Gemini's prepaid credit ran out
 * unnoticed for ten days. All numbers come from GET /api/admin/system-health.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, ExternalLink, Loader2, OctagonX, RefreshCw, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/admin/KpiCard'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SpendPair {
  wire: number
  attributed: number
}
interface ServiceView {
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
    runwayDays: number | null
    noSpend: boolean
    level: 'unknown' | 'ok' | 'warn' | 'critical' | 'depleted'
    error: string | null
  } | null
  spend: { last7d: SpendPair; last30d: SpendPair; monthToDate: SpendPair } | null
  calls: {
    state: 'unknown' | 'idle' | 'ok' | 'degraded' | 'down' | 'blocked'
    week: { ok: number; failed: number; skipped: number }
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastErrorStatus: number | null
    lastErrorMessage: string | null
  }
  providerStatus: { indicator: string; description: string } | null
  domain: { expiresAt: string | null; daysLeft: number | null; status: string[]; nameservers: string[]; parked: boolean; error: string | null } | null
  ledger: Array<{ id: string; kind: string; amount: number; at: string; note: string | null }>
  alertLevel: string | null
}
interface SystemHealth {
  generatedAt: string
  services: ServiceView[]
  kpis: {
    needsAction: Array<{ key: string; label: string; why: string }>
    degraded: Array<{ key: string; label: string; why: string }>
    shortestRunway: { key: string; label: string; days: number; perDay: number } | null
    failedJobs: number
  }
  totals: { monthToDate: SpendPair; last30d: SpendPair; fixedMonthly: number; systemMonth: number; activeAccounts: number }
  failedWork: Array<{ account: string; articles: number; newsletters: number; firstDue: string | null }>
  own: { apiUptimeSec: number; workerCheckAt: string | null; dbConnections: number | null; lastArticleOkAt: string | null }
  alerts: { emailTo: string | null; smsTo: string | null; smsFrom: string | null }
}

type Tone = 'red' | 'amber' | 'green' | 'grey'

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const metered = (s: SpendPair) => Math.max(s.wire, s.attributed)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—')
const stamp = (iso: string | null) =>
  iso ? `${new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC` : '—'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} days ago`
}

/** The single worst thing to say about a service, from its credit and from our own calls. */
function verdict(s: ServiceView): { tone: Tone; text: string } {
  if (s.calls.state === 'blocked') return { tone: 'red', text: 'Out of credit' }
  if (s.credit?.level === 'depleted') return { tone: 'red', text: 'Depleted' }
  if (s.calls.state === 'down') return { tone: 'red', text: 'Not answering' }
  if (s.credit?.level === 'critical') return { tone: 'red', text: 'Nearly empty' }
  if (s.domain?.parked) return { tone: 'red', text: 'Lapsed, parked' }
  if (s.domain && s.domain.daysLeft !== null && s.domain.daysLeft < 0) return { tone: 'red', text: 'Lapsed' }
  if (s.domain && s.domain.daysLeft !== null && s.domain.daysLeft < 30) return { tone: 'amber', text: 'Expires soon' }
  if (s.credit?.level === 'warn') return { tone: 'amber', text: 'Running low' }
  if (s.calls.state === 'degraded') return { tone: 'amber', text: 'Degraded' }
  if (s.providerStatus && !['none', 'unreachable'].includes(s.providerStatus.indicator)) return { tone: 'amber', text: 'Provider incident' }
  if (s.balanceMode === 'tracked' && s.credit?.balance === null) return { tone: 'grey', text: 'No balance recorded' }
  if (s.calls.state === 'ok' || s.credit?.level === 'ok') return { tone: 'green', text: 'Healthy' }
  if (s.domain?.expiresAt) return { tone: 'green', text: 'Registered' }
  if (s.calls.state === 'idle') return { tone: 'grey', text: 'Idle 7 days' }
  if (s.providerStatus?.indicator === 'none') return { tone: 'green', text: 'Provider reports normal' }
  return { tone: 'grey', text: 'No check yet' }
}

const TONE: Record<Tone, { chip: string; text: string; bar: string; border: string }> = {
  red: { chip: 'bg-red-500/15 text-red-300', text: 'text-red-400', bar: 'bg-red-400', border: 'border-red-500/40' },
  amber: { chip: 'bg-yellow-500/15 text-yellow-300', text: 'text-yellow-400', bar: 'bg-yellow-400', border: 'border-yellow-500/40' },
  green: { chip: 'bg-primary/15 text-primary', text: 'text-primary', bar: 'bg-primary', border: 'border-border' },
  grey: { chip: 'bg-muted text-muted-foreground', text: 'text-muted-foreground', bar: 'bg-muted-foreground/40', border: 'border-border' },
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = tone === 'red' ? OctagonX : tone === 'amber' ? AlertTriangle : tone === 'green' ? CheckCircle2 : CircleDashed
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone].chip)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  )
}

const inputCls = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50'

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServiceView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/system-health')
      if (!res.ok) throw new Error(`The health service answered ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">System Health</h1>
        {error ? (
          <p className="text-sm text-red-400">{error}. <button className="underline" onClick={load}>Try again</button></p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking every service…</p>
        )}
      </div>
    )
  }

  const byKey = new Map(data.services.map((s) => [s.key, s]))
  const credit = data.services
    .filter((s) => s.billing === 'prepaid' || s.billing === 'quota')
    .sort((a, b) => (a.credit?.runwayDays ?? (a.credit?.balance === null ? 9998 : 9999)) - (b.credit?.runwayDays ?? (b.credit?.balance === null ? 9998 : 9999)))
  const bills = data.services.filter((s) => !['prepaid', 'quota'].includes(s.billing))
  const worst = data.kpis.needsAction[0] ? byKey.get(data.kpis.needsAction[0].key) : undefined
  const perClinic = data.totals.activeAccounts > 0 ? data.totals.systemMonth / data.totals.activeAccounts : null

  return (
    <div className="space-y-8 max-w-[1180px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every service Omniply depends on, the credit left on each, and where to add more. Checked {ago(data.generatedAt)}, refreshes every 5 minutes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
          Check now
        </Button>
      </div>

      {data.kpis.needsAction.length > 0 && (
        <section aria-label="Needs action" className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-red-500/40 bg-red-500/10 p-5">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-300">
              <OctagonX className="h-4 w-4" aria-hidden="true" /> Needs action now
            </p>
            <ul className="space-y-1">
              {data.kpis.needsAction.map((n) => (
                <li key={n.key} className="text-lg font-semibold text-foreground">
                  {n.label}: {n.why}
                </li>
              ))}
            </ul>
            {data.kpis.failedJobs > 0 && <p className="font-mono text-sm text-foreground">{data.kpis.failedJobs} failed jobs are waiting on a fix</p>}
          </div>
          {worst?.rechargeUrl && (
            <a href={worst.rechargeUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Add credit for {worst.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard title="Needs action now" value={data.kpis.needsAction.length} accent={data.kpis.needsAction.length ? 'red' : 'green'} sub={data.kpis.needsAction.map((n) => n.label).join(', ') || 'Nothing'} />
        <KpiCard title="Degraded" value={data.kpis.degraded.length} accent={data.kpis.degraded.length ? 'yellow' : 'green'} sub={data.kpis.degraded.map((n) => n.label).join(', ') || 'Nothing'} />
        <KpiCard
          title="Shortest runway"
          value={data.kpis.shortestRunway ? `${Math.floor(data.kpis.shortestRunway.days)} days` : '—'}
          accent={!data.kpis.shortestRunway ? 'default' : data.kpis.shortestRunway.days < 3 ? 'red' : data.kpis.shortestRunway.days < 14 ? 'yellow' : 'green'}
          sub={data.kpis.shortestRunway ? `${data.kpis.shortestRunway.label}, at ${money(data.kpis.shortestRunway.perDay)} a day` : 'Record a balance to see it'}
        />
        <KpiCard title="Failed jobs waiting" value={data.kpis.failedJobs} accent={data.kpis.failedJobs ? 'red' : 'green'} sub={data.failedWork.map((f) => f.account).join(', ') || 'None'} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Prepaid credit and quotas</h2>
          <p className="text-xs text-muted-foreground">Sorted by days of runway left. Spend is measured where each call leaves for the provider.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {credit.map((s) => (
            <CreditCard key={s.key} s={s} onEdit={() => setEditing(s)} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Monthly bills and what the system is using</h2>
          <p className="text-xs text-muted-foreground">Services billed after the fact or on a fixed plan. Nothing here can run dry, but it all costs money.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard title="Whole system, this month" value={money(data.totals.systemMonth)} sub="Metered AI spend plus the plans entered below" />
          <KpiCard
            title="AI spend, last 30 days"
            value={money(metered(data.totals.last30d))}
            sub={`Measured ${money(data.totals.last30d.wire)}, attributed ${money(data.totals.last30d.attributed)}`}
          />
          <KpiCard title="Fixed plans, per month" value={money(data.totals.fixedMonthly)} sub="Entered once per service" />
          <KpiCard title="Cost per active clinic" value={perClinic === null ? '—' : money(perClinic)} sub={`${data.totals.activeAccounts} active accounts`} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Service</th>
                <th scope="col" className="px-4 py-3 font-medium">Pays for</th>
                <th scope="col" className="px-4 py-3 font-medium">Billed</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Per month</th>
                <th scope="col" className="px-4 py-3 font-medium">Renews or expires</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((s) => {
                const v = verdict(s)
                const renew = s.domain ? (s.domain.expiresAt ? `${day(s.domain.expiresAt)}${s.domain.daysLeft !== null ? `, ${s.domain.daysLeft < 0 ? `${-s.domain.daysLeft} days ago` : `in ${s.domain.daysLeft} days`}` : ''}` : s.domain.error ?? '—') : day(s.renewsOn)
                return (
                  <tr key={s.key} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-semibold text-foreground">{s.label}</th>
                    <td className="px-4 py-3 text-muted-foreground">{s.usedFor}</td>
                    <td className="px-4 py-3 text-muted-foreground">{BILLING_LABEL[s.billing] ?? s.billing}</td>
                    <td className="px-4 py-3 text-right font-mono">{s.monthlyAmount === null ? <span className="text-muted-foreground">not entered</span> : money(s.monthlyAmount)}</td>
                    <td className={cn('px-4 py-3 font-mono text-xs', s.domain && s.domain.daysLeft !== null && s.domain.daysLeft < 30 ? 'text-red-400' : 'text-foreground')}>{renew}</td>
                    <td className="px-4 py-3"><Chip tone={v.tone}>{v.text}</Chip></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {s.rechargeUrl && (
                        <a href={s.rechargeUrl} target="_blank" rel="noreferrer" className="mr-3 inline-flex items-center gap-1 text-primary hover:underline">
                          Billing <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                      <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Settings for ${s.label}`} onClick={() => setEditing(s)}>
                        <Settings2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Service status</h2>
          <p className="text-xs text-muted-foreground">Our own calls in the last 7 days, next to what each provider reports about itself.</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Service</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Last success</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Our calls, 7 days</th>
                <th scope="col" className="px-4 py-3 font-medium">Last error</th>
                <th scope="col" className="px-4 py-3 font-medium">Provider says</th>
              </tr>
            </thead>
            <tbody>
              {data.services
                .filter((s) => s.billing !== 'domain')
                .map((s) => {
                  const st = STATE[s.calls.state]
                  const c = s.calls.week
                  return (
                    <tr key={s.key} className="border-b border-border last:border-0 align-top">
                      <th scope="row" className="px-4 py-3 text-left font-semibold text-foreground">
                        {s.label}
                        <span className="block text-xs font-normal text-muted-foreground">{s.usedFor}</span>
                      </th>
                      <td className="px-4 py-3"><Chip tone={st.tone}>{st.text}</Chip></td>
                      <td className="px-4 py-3 font-mono text-xs">{s.calls.state === 'unknown' ? '—' : stamp(s.calls.lastSuccessAt)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {s.calls.state === 'unknown' ? '—' : `${c.ok} ok · ${c.failed} failed${c.skipped ? ` · ${c.skipped} skipped` : ''}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                        {s.calls.lastErrorAt ? (
                          <>
                            <span className="font-mono text-foreground">{stamp(s.calls.lastErrorAt)}{s.calls.lastErrorStatus ? ` · ${s.calls.lastErrorStatus}` : ''}</span>
                            <span className="block truncate" title={s.calls.lastErrorMessage ?? ''}>{s.calls.lastErrorMessage}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.providerStatus ? (
                          <span className={s.providerStatus.indicator === 'none' ? 'text-primary' : s.providerStatus.indicator === 'unreachable' ? 'text-muted-foreground' : 'text-yellow-400'}>{s.providerStatus.description}</span>
                        ) : (
                          <span className="text-muted-foreground">No status feed</span>
                        )}
                        {s.statusPageUrl && (
                          <a href={s.statusPageUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                            page <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Our own systems</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">API</dt>
            <dd className="font-semibold text-primary">Up {Math.floor(data.own.apiUptimeSec / 3600)} h</dd>
            <dt className="text-muted-foreground">Worker, last health check</dt>
            <dd className={cn('font-semibold', data.own.workerCheckAt && Date.now() - new Date(data.own.workerCheckAt).getTime() < 25 * 60 * 1000 ? 'text-primary' : 'text-red-400')}>{ago(data.own.workerCheckAt)}</dd>
            <dt className="text-muted-foreground">Database connections</dt>
            <dd className="font-mono">{data.own.dbConnections ?? '—'}</dd>
            <dt className="text-muted-foreground">Last successful article</dt>
            <dd className="font-mono text-xs">{stamp(data.own.lastArticleOkAt)}</dd>
          </dl>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Failed work waiting for the fix</h2>
          {data.failedWork.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting.</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-sm">
              {data.failedWork.map((f) => (
                <div key={f.account} className="contents">
                  <dt>
                    {f.account}
                    <span className="block text-xs text-muted-foreground">
                      {f.articles} articles, {f.newsletters} newsletters{f.firstDue ? `, first due ${day(f.firstDue)}` : ''}
                    </span>
                  </dt>
                  <dd className="font-mono">{f.articles + f.newsletters}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <AlertsPanel alerts={data.alerts} onSaved={load} />
      </div>

      {editing && <ServiceDialog s={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

const BILLING_LABEL: Record<string, string> = {
  postpaid: 'By usage, after the month',
  fixed: 'Fixed plan',
  fee: 'A fee on each payment',
  domain: 'Yearly registration',
}

const STATE: Record<ServiceView['calls']['state'], { tone: Tone; text: string }> = {
  blocked: { tone: 'red', text: 'Refusing us: no credit' },
  down: { tone: 'red', text: 'Not answering' },
  degraded: { tone: 'amber', text: 'Some calls failing' },
  ok: { tone: 'green', text: 'Operational' },
  idle: { tone: 'grey', text: 'Idle, no calls' },
  unknown: { tone: 'grey', text: 'No check yet' },
}

function CreditCard({ s, onEdit }: { s: ServiceView; onEdit: () => void }) {
  const v = verdict(s)
  const c = s.credit
  const pct = c && c.balance !== null && c.runwayDays !== null ? Math.max(2, Math.min(100, (c.runwayDays / 30) * 100)) : c?.noSpend ? 100 : 0
  return (
    <article className={cn('flex flex-col gap-3 rounded-lg border bg-card p-5', TONE[v.tone].border)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">{s.label}</h3>
        <Chip tone={v.tone}>{v.text}</Chip>
      </div>
      <div>
        <p className="font-mono text-3xl font-bold text-foreground">{c ? (c.balance === null ? '—' : money(c.balance)) : s.billing === 'quota' ? 'Plan' : '—'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {!c && 'Reading this balance from the provider is the next step'}
          {c?.source === 'live' && (c.error ? c.error : 'Live from the provider')}
          {c?.source === 'tracked' && (c.balance === null ? 'Tell us what the account shows to start tracking' : `Tracked by us since ${stamp(c.since)}`)}
        </p>
      </div>
      <div role="img" aria-label={c?.runwayDays !== null && c?.runwayDays !== undefined ? `${Math.floor(c.runwayDays)} days of runway` : 'No runway figure'} className="h-1.5 rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full', TONE[v.tone].bar)} style={{ width: `${pct}%` }} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {c && s.spend && (
          <>
            <dt className="text-muted-foreground">Spend</dt>
            <dd className="text-right font-mono">{money(c.perDay)} / day</dd>
            <dt className="text-muted-foreground">Runway</dt>
            <dd className={cn('text-right font-mono', TONE[v.tone].text)}>
              {c.balance === null ? '—' : c.noSpend ? 'no spend' : `${Math.floor(c.runwayDays ?? 0)} days`}
            </dd>
            <dt className="text-muted-foreground">$100 lasts</dt>
            <dd className="text-right font-mono">{c.perDay > 0 ? `about ${Math.round(100 / c.perDay)} days` : '—'}</dd>
          </>
        )}
        {c?.source === 'tracked' && c.balance !== null && (
          <>
            <dt className="text-muted-foreground">Since then</dt>
            <dd className="text-right font-mono text-xs">
              {money(c.base)}{c.toppedUp ? ` + ${money(c.toppedUp)}` : ''} − {money(metered(c.spent))}
            </dd>
            <dt className="text-muted-foreground">Measured / attributed</dt>
            <dd className="text-right font-mono text-xs">{money(c.spent.wire)} / {money(c.spent.attributed)}</dd>
          </>
        )}
        {s.calls.state !== 'unknown' && (
          <>
            <dt className="text-muted-foreground">Calls, 7 days</dt>
            <dd className="text-right font-mono text-xs">{s.calls.week.ok} ok · {s.calls.week.failed} failed</dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex gap-2">
        {s.rechargeUrl && (
          <a
            href={s.rechargeUrl}
            target="_blank"
            rel="noreferrer"
            className={cn('inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold', v.tone === 'red' ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:bg-muted')}
          >
            {s.billing === 'quota' ? 'Manage plan' : 'Add credit'} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <button className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted" onClick={onEdit}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          {s.balanceMode === 'tracked' ? 'Record' : 'Settings'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{s.rechargeUrl ? `${new URL(s.rechargeUrl).host} · ` : ''}{s.usedFor}</p>
    </article>
  )
}

function ServiceDialog({ s, onClose, onSaved }: { s: ServiceView; onClose: () => void; onSaved: () => void }) {
  const tracked = s.balanceMode === 'tracked'
  const [kind, setKind] = useState<'set' | 'topup'>(s.credit?.balance === null || s.credit?.balance === undefined ? 'set' : 'topup')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [warnDays, setWarnDays] = useState(String(s.warnDays))
  const [criticalDays, setCriticalDays] = useState(String(s.criticalDays))
  const [rechargeUrl, setRechargeUrl] = useState(s.rechargeUrl ?? '')
  const [monthly, setMonthly] = useState(s.monthlyAmount === null ? '' : String(s.monthlyAmount))
  const [renewsOn, setRenewsOn] = useState(s.renewsOn ? s.renewsOn.slice(0, 10) : '')
  const [busy, setBusy] = useState(false)
  const base = `/api/admin/system-health/services/${encodeURIComponent(s.key)}`

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? `Could not save (${res.status})`)
      return false
    }
    return true
  }

  async function record() {
    const n = Number(amount)
    if (!amount.trim() || !Number.isFinite(n) || n < 0) return toast.error('Enter the amount in dollars')
    setBusy(true)
    const ok = await call(`${base}/ledger`, 'POST', { kind, amount: n, note: note.trim() || null })
    setBusy(false)
    if (ok) {
      toast.success(kind === 'set' ? `Balance set to ${money(n)}` : `Top-up of ${money(n)} recorded`)
      onSaved()
    }
  }

  async function saveSettings() {
    setBusy(true)
    const ok = await call(base, 'PUT', {
      warnDays: Number(warnDays),
      criticalDays: Number(criticalDays),
      rechargeUrl: rechargeUrl.trim() || null,
      monthlyAmount: monthly.trim() === '' ? null : Number(monthly),
      renewsOn: renewsOn || null,
    })
    setBusy(false)
    if (ok) {
      toast.success('Saved')
      onSaved()
    }
  }

  async function undo(id: string) {
    setBusy(true)
    const ok = await call(`/api/admin/system-health/ledger/${encodeURIComponent(id)}`, 'DELETE')
    setBusy(false)
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`${s.label} settings`}>
      <div className="my-8 w-full max-w-xl space-y-6 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Service settings</p>
            <h2 className="text-xl font-bold text-foreground">{s.label}</h2>
          </div>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {tracked && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-foreground">Record what the account shows</legend>
            <p className="text-xs text-muted-foreground">
              This provider offers no way to read the balance, so we track it: the balance you state, plus later top-ups, minus what we measure ourselves spending.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm', kind === 'set' ? 'border-primary bg-primary/10' : 'border-border')}>
                <input type="radio" name="kind" className="mt-1 accent-[var(--primary)]" checked={kind === 'set'} onChange={() => setKind('set')} />
                <span>
                  <span className="font-semibold text-foreground">The account shows</span>
                  <span className="block text-xs text-muted-foreground">Resets tracking to this balance, as of now</span>
                </span>
              </label>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm', kind === 'topup' ? 'border-primary bg-primary/10' : 'border-border')}>
                <input type="radio" name="kind" className="mt-1 accent-[var(--primary)]" checked={kind === 'topup'} onChange={() => setKind('topup')} />
                <span>
                  <span className="font-semibold text-foreground">I added credit</span>
                  <span className="block text-xs text-muted-foreground">Adds to the tracked balance</span>
                </span>
              </label>
            </div>
            <div className="grid grid-cols-[140px_1fr_auto] items-end gap-2">
              <div className="space-y-1">
                <label htmlFor="sh-amount" className="text-xs font-medium text-foreground">Amount, USD</label>
                <input id="sh-amount" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <label htmlFor="sh-note" className="text-xs font-medium text-foreground">Note, optional</label>
                <input id="sh-note" className={cn(inputCls, 'font-sans')} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <Button onClick={record} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record'}</Button>
            </div>
            {s.ledger.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                {s.ledger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="font-mono text-foreground">{stamp(l.at)}</span>
                    <span className="flex-1 text-muted-foreground">{l.kind === 'set' ? 'Account showed' : 'Added'} {money(l.amount)}{l.note ? ` · ${l.note}` : ''}</span>
                    <button className="text-muted-foreground underline hover:text-foreground" onClick={() => undo(l.id)} disabled={busy}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">{tracked || s.balanceMode === 'live' ? 'When to warn' : 'Billing'}</legend>
          {(tracked || s.balanceMode === 'live') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="sh-warn" className="text-xs font-medium text-foreground">Warn below, days of runway</label>
                <input id="sh-warn" type="number" min={1} className={inputCls} value={warnDays} onChange={(e) => setWarnDays(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="sh-crit" className="text-xs font-medium text-foreground">Critical below, days of runway</label>
                <input id="sh-crit" type="number" min={0} className={inputCls} value={criticalDays} onChange={(e) => setCriticalDays(e.target.value)} />
              </div>
            </div>
          )}
          {s.billing !== 'domain' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="sh-monthly" className="text-xs font-medium text-foreground">Fixed cost per month, USD</label>
                <input id="sh-monthly" inputMode="decimal" className={inputCls} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="not entered" />
              </div>
              <div className="space-y-1">
                <label htmlFor="sh-renew" className="text-xs font-medium text-foreground">Next renewal</label>
                <input id="sh-renew" type="date" className={inputCls} value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="sh-url" className="text-xs font-medium text-foreground">Recharge or billing page</label>
            <input id="sh-url" type="url" className={inputCls} value={rechargeUrl} onChange={(e) => setRechargeUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">The button on the card and in every alert opens this page.</p>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={saveSettings} disabled={busy}>Save settings</Button>
        </div>
      </div>
    </div>
  )
}

function AlertsPanel({ alerts, onSaved }: { alerts: SystemHealth['alerts']; onSaved: () => void }) {
  const [smsTo, setSmsTo] = useState(alerts.smsTo ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const res = await fetch('/api/admin/system-health/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ smsTo: smsTo.trim() || null }) })
    setBusy(false)
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? 'Could not save')
    toast.success('Saved')
    onSaved()
  }

  async function test() {
    setBusy(true)
    const res = await fetch('/api/admin/system-health/alerts/test-sms', { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return toast.error(j.error ?? 'The test text could not be sent')
    if (j.status === 'failed' || j.status === 'undelivered') return toast.error(`The carrier refused it: ${j.errorMessage ?? j.errorCode ?? j.status}`)
    toast.success(`Test text ${j.status} from ${j.from}`)
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Who gets told</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-sm">
        <dt>
          System alerts
          <span className="block text-xs text-muted-foreground">Service down, credit low, jobs failing</span>
        </dt>
        <dd className="font-mono text-xs">{alerts.emailTo ?? 'no inbox set'}</dd>
        <dt>
          Clients
          <span className="block text-xs text-muted-foreground">Only product emails, never a system alert</span>
        </dt>
        <dd className="flex items-center gap-1 font-semibold text-primary"><Circle className="h-2.5 w-2.5 fill-current" aria-hidden="true" /> Never</dd>
        <dt>
          Repeats of one failure
          <span className="block text-xs text-muted-foreground">One email when it starts, one reminder a day</span>
        </dt>
        <dd className="font-semibold">Grouped</dd>
      </dl>
      <div className="space-y-1 border-t border-border pt-3">
        <label htmlFor="sh-sms" className="text-sm text-foreground">
          When production stops, also text
          <span className="block text-xs text-muted-foreground">An SMS to this mobile, so it cannot sit unread in an inbox</span>
        </label>
        <div className="flex gap-2">
          <input id="sh-sms" type="tel" className={inputCls} value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+1 829 555 0100" />
          <Button variant="outline" onClick={save} disabled={busy}>Save</Button>
        </div>
        <button className="text-xs text-primary underline disabled:opacity-50" onClick={test} disabled={busy || !alerts.smsTo}>Send a test text</button>
      </div>
    </section>
  )
}
