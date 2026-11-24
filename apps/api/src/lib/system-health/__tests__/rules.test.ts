import { describe, it, expect } from 'vitest'
import {
  trackedBalanceStart,
  trackedBalance,
  dailySpend,
  billedSpend,
  runwayDays,
  creditLevel,
  isBillingError,
  serviceState,
  alertLevelFor,
  shouldAlert,
  needsSms,
  type CallWindow,
} from '../rules'

const at = (iso: string) => new Date(iso)
const win = (o: Partial<CallWindow> = {}): CallWindow => ({ ok: 0, failed: 0, skipped: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorStatus: null, lastErrorMessage: null, ...o })

describe('tracked balance', () => {
  it('is unknown until something is recorded', () => {
    expect(trackedBalanceStart([])).toBeNull()
    expect(trackedBalance([], 5).balance).toBeNull()
  })
  it('starts at the stated balance and subtracts our spend since then', () => {
    const b = trackedBalance([{ kind: 'set', amount: 100, at: at('2026-11-23T18:00:00Z') }], 12.5)
    expect(b.balance).toBeCloseTo(87.5)
    expect(b.since?.toISOString()).toBe('2026-11-23T18:00:00.000Z')
  })
  it('adds top-ups made after the stated balance and ignores earlier entries', () => {
    const b = trackedBalance(
      [
        { kind: 'topup', amount: 500, at: at('2026-10-01T00:00:00Z') }, // before the stated balance: already inside it
        { kind: 'set', amount: 40, at: at('2026-11-23T18:00:00Z') },
        { kind: 'topup', amount: 100, at: at('2026-11-25T09:00:00Z') },
      ],
      30,
    )
    expect(b.base).toBe(40)
    expect(b.toppedUp).toBe(100)
    expect(b.balance).toBeCloseTo(110)
  })
  it('uses the latest stated balance when there are several', () => {
    const start = trackedBalanceStart([
      { kind: 'set', amount: 100, at: at('2026-11-01T00:00:00Z') },
      { kind: 'set', amount: 62.4, at: at('2026-11-20T00:00:00Z') },
    ])
    expect(start?.base).toBe(62.4)
  })
  it('starts at the first top-up when no balance was ever stated', () => {
    const b = trackedBalance(
      [
        { kind: 'topup', amount: 50, at: at('2026-11-23T18:00:00Z') },
        { kind: 'topup', amount: 25, at: at('2026-11-24T18:00:00Z') },
      ],
      10,
    )
    expect(b.balance).toBeCloseTo(65)
  })
})

describe('runway', () => {
  it('takes the higher of the 7-day and 30-day average, so an outage week does not hide the real rate', () => {
    // Gemini, Nov 2026: $1.54 in the outage week, $91.11 over the 30 days before.
    expect(dailySpend(1.54, 91.11)).toBeCloseTo(91.11 / 30)
    expect(dailySpend(23.73, 60)).toBeCloseTo(23.73 / 7)
  })
  it('computes days left, zero when empty, endless when nothing is spent', () => {
    expect(runwayDays(100, 3.39)).toBeCloseTo(29.5, 1)
    expect(runwayDays(0, 3)).toBe(0)
    expect(runwayDays(-0.4, 3)).toBe(0) // Google lets the balance dip below zero for about ten minutes
    expect(runwayDays(50, 0)).toBe(Infinity)
    expect(runwayDays(null, 3)).toBeNull()
  })
  it('grades the balance against the thresholds', () => {
    expect(creditLevel(null, null, 14, 3)).toBe('unknown')
    expect(creditLevel(0, 0, 14, 3)).toBe('depleted')
    expect(creditLevel(5, 1.5, 14, 3)).toBe('critical')
    expect(creditLevel(30, 9, 14, 3)).toBe('warn')
    expect(creditLevel(100, 29, 14, 3)).toBe('ok')
    expect(creditLevel(100, Infinity, 14, 3)).toBe('ok')
  })
})

describe('billing errors', () => {
  it('recognises "add money" by code and by wording', () => {
    expect(isBillingError(402, 'anything')).toBe(true)
    expect(isBillingError(429, '[GoogleGenerativeAI Error]: Your prepayment credits are depleted. Please go to AI Studio')).toBe(true)
    expect(isBillingError(400, 'Your credit balance is too low to access the Anthropic API')).toBe(true)
    expect(isBillingError(429, 'You exceeded your current quota, please check your plan and billing details')).toBe(true)
  })
  it('does not mistake ordinary failures for billing', () => {
    expect(isBillingError(429, 'Rate limit reached for requests')).toBe(false)
    expect(isBillingError(503, 'The model is overloaded')).toBe(false)
    expect(isBillingError(undefined, undefined)).toBe(false)
  })
})

describe('service state from our own calls', () => {
  const t0 = at('2026-11-23T16:00:00Z')
  const t1 = at('2026-11-23T16:50:00Z')
  it('is blocked when the latest failure is a billing error and nothing succeeded since', () => {
    const week = win({ ok: 1, failed: 829, skipped: 5869, lastSuccessAt: at('2026-11-14T00:02:00Z'), lastErrorAt: t1, lastErrorStatus: 402, lastErrorMessage: 'prepayment credits are depleted' })
    expect(serviceState(true, week, win({ failed: 120 }), win({ failed: 6 }))).toBe('blocked')
  })
  it('recovers as soon as a call succeeds after the last error', () => {
    const week = win({ ok: 40, failed: 829, lastSuccessAt: t1, lastErrorAt: t0, lastErrorStatus: 402, lastErrorMessage: 'prepayment credits are depleted' })
    expect(serviceState(true, week, win({ ok: 40, failed: 3 }), win({ ok: 40 }))).toBe('degraded')
  })
  it('is down on a run of failures in the last hour with no success since', () => {
    const week = win({ ok: 500, failed: 9, lastSuccessAt: t0, lastErrorAt: t1, lastErrorStatus: 503, lastErrorMessage: 'overloaded' })
    expect(serviceState(true, week, win({ failed: 9 }), win({ failed: 4, skipped: 3 }))).toBe('down')
  })
  it('is degraded on a few failures, ok on none, idle with no calls, unknown when not instrumented', () => {
    const week = win({ ok: 500, failed: 2, lastSuccessAt: t1, lastErrorAt: t0 })
    expect(serviceState(true, week, win({ ok: 80, failed: 2 }), win({ ok: 9 }))).toBe('degraded')
    expect(serviceState(true, win({ ok: 8, lastSuccessAt: t1 }), win({ ok: 8 }), win())).toBe('ok')
    expect(serviceState(true, win(), win(), win())).toBe('idle')
    expect(serviceState(false, win({ ok: 8 }), win(), win())).toBe('unknown')
  })
})

describe('alert decisions', () => {
  const now = at('2026-11-23T18:00:00Z')
  it('picks the worst condition for a service', () => {
    expect(alertLevelFor('ok', 'blocked')).toBe('blocked')
    expect(alertLevelFor('depleted', 'ok')).toBe('depleted')
    expect(alertLevelFor('critical', 'down')).toBe('down')
    expect(alertLevelFor('critical', 'degraded')).toBe('critical')
    expect(alertLevelFor('warn', 'ok')).toBe('warn')
    expect(alertLevelFor('ok', 'degraded')).toBeNull()
    expect(alertLevelFor('unknown', 'idle')).toBeNull()
  })
  it('sends when a condition appears or worsens', () => {
    expect(shouldAlert('warn', null, null, now)).toBe('send')
    expect(shouldAlert('critical', 'warn', at('2026-11-23T17:00:00Z'), now)).toBe('send')
    expect(shouldAlert('blocked', 'critical', at('2026-11-23T17:50:00Z'), now)).toBe('send')
  })
  it('stays quiet for the same condition, then reminds after a day', () => {
    expect(shouldAlert('blocked', 'blocked', at('2026-11-23T17:50:00Z'), now)).toBe('quiet')
    expect(shouldAlert('blocked', 'blocked', at('2026-11-22T17:59:00Z'), now)).toBe('remind')
  })
  it('stays quiet when it eases or clears', () => {
    expect(shouldAlert('warn', 'critical', at('2026-11-23T17:00:00Z'), now)).toBe('quiet')
    expect(shouldAlert(null, 'blocked', at('2026-11-23T17:00:00Z'), now)).toBe('quiet')
  })
  it('texts only for core services and never for a mere warning', () => {
    expect(needsSms('blocked', true)).toBe(true)
    expect(needsSms('critical', true)).toBe(true)
    expect(needsSms('warn', true)).toBe(false)
    expect(needsSms('blocked', false)).toBe(false)
  })
})

import { readDomainRecords } from '../external'

describe('domain registration', () => {
  const registry = (ns: string[], exp = '2027-11-21T10:03:46Z', status = ['client transfer prohibited']) => ({
    events: [{ eventAction: 'registration', eventDate: '2025-11-21T10:03:46Z' }, { eventAction: 'expiration', eventDate: exp }],
    status,
    nameservers: ns.map((n) => ({ ldhName: n })),
  })
  it('reads a healthy domain', () => {
    const d = readDomainRecords(registry(['NICOLE.NS.CLOUDFLARE.COM', 'ROAN.NS.CLOUDFLARE.COM']), { events: [{ eventAction: 'registrar expiration', eventDate: '2027-11-21T10:03:46Z' }] })
    expect(d.expiresAt).toBe('2027-11-21T10:03:46Z')
    expect(d.parked).toBe(false)
    expect(d.nameservers).toEqual(['nicole.ns.cloudflare.com', 'roan.ns.cloudflare.com'])
  })
  it('catches the socioply.com lapse: registry date a year out, nameservers parked, registrar date passed', () => {
    const d = readDomainRecords(registry(['ns1.lander.d.parity.domains', 'ns2.lander.d.parity.domains']), { events: [{ eventAction: 'registrar expiration', eventDate: '2026-11-21T10:03:46Z' }] })
    expect(d.parked).toBe(true)
    expect(d.expiresAt).toBe('2026-11-21T10:03:46Z') // the earlier, registrar-side date wins
  })
  it('treats a hold or redemption status as lapsed even on our own nameservers', () => {
    expect(readDomainRecords(registry(['roan.ns.cloudflare.com'], '2027-01-01T00:00:00Z', ['client hold']), null).parked).toBe(true)
    expect(readDomainRecords(registry(['roan.ns.cloudflare.com'], '2027-01-01T00:00:00Z', ['redemption period']), null).parked).toBe(true)
  })
  it('says so when the registry has no record', () => {
    expect(readDomainRecords(null, null).error).toMatch(/no record/)
  })
})

import { domainAlertLevel } from '../service'
import { alertText } from '../notify'

describe('domain alerts', () => {
  it('warns a month out, turns urgent two weeks out, and treats a passed date as an outage', () => {
    expect(domainAlertLevel(200)).toBeNull()
    expect(domainAlertLevel(29)).toBe('warn')
    expect(domainAlertLevel(13)).toBe('critical')
    expect(domainAlertLevel(-2)).toBe('down')
  })
  it('words a lapse plainly, with the nameservers that gave it away', () => {
    const t = alertText(
      { label: 'socioply.com', usedFor: 'Old name', rechargeUrl: null, statusPageUrl: null, warnDays: 14, criticalDays: 3, credit: null, calls: {}, providerStatus: null, domain: { expiresAt: '2026-11-21T10:03:46Z', daysLeft: -2, status: [], nameservers: ['ns1.lander.d.parity.domains'], parked: true, error: null } } as never,
      'down',
      false,
    )
    expect(t.subject).toBe('The domain socioply.com has lapsed')
    expect(t.body).toContain('ns1.lander.d.parity.domains')
    expect(t.sms).toBe('Azavea Inc alert: the domain socioply.com has lapsed and must be renewed today. Details: https://chiro.omniply.io/admin/health Reply STOP to opt out, HELP for help.')
  })
})

describe('billing wording from Google Maps', () => {
  it('reads "billing not enabled" as an add-money problem', () => {
    expect(isBillingError(undefined, 'REQUEST_DENIED: You must enable Billing on the Google Cloud Project')).toBe(true)
    expect(isBillingError(undefined, 'REQUEST_DENIED: This IP is not authorized to use this API key')).toBe(false)
  })
})

import { SMS_OPT_IN_MESSAGE, SMS_TEST_MESSAGE } from '../notify'

describe('alert texts match the registered A2P campaign', () => {
  const svc = (over: Record<string, unknown>) => ({ label: 'Gemini API', usedFor: '', rechargeUrl: 'https://aistudio.google.com/billing', statusPageUrl: null, warnDays: 14, criticalDays: 3, domain: null, providerStatus: null, calls: { lastErrorMessage: 'prepayment credits are depleted', lastSuccessAt: null, lastErrorStatus: 402 }, credit: { balance: 3.4, perDay: 1.1, runwayDays: 3.1 }, ...over }) as never
  it('names the brand, links only to our own page, and carries the opt-out line', () => {
    for (const level of ['blocked', 'depleted', 'down', 'critical', 'warn'] as const) {
      const t = alertText(svc({}), level, false).sms
      expect(t.startsWith('Azavea Inc alert: '), level).toBe(true)
      expect(t, level).toContain('https://chiro.omniply.io/admin/health')
      expect(t, level).not.toContain('aistudio.google.com') // the provider link stays in the email
      expect(t.endsWith('Reply STOP to opt out, HELP for help.'), level).toBe(true)
      expect(t.length, level).toBeLessThanOrEqual(320)
    }
  })
  it('reads like the registered samples', () => {
    expect(alertText(svc({}), 'blocked', false).sms).toBe('Azavea Inc alert: Gemini API is out of credit and content production has stopped. Details: https://chiro.omniply.io/admin/health Reply STOP to opt out, HELP for help.')
    expect(alertText(svc({ label: 'Twilio' }), 'critical', false).sms).toBe('Azavea Inc alert: your Twilio balance is down to about 3 days of use. Details: https://chiro.omniply.io/admin/health Reply STOP to opt out, HELP for help.')
  })
  it('keeps the recharge link in the email, where it is useful', () => {
    expect(alertText(svc({}), 'blocked', false).body).toContain('https://aistudio.google.com/billing')
  })
  it('has an opt-in confirmation and a test text that follow the same rules', () => {
    expect(SMS_OPT_IN_MESSAGE).toBe('Azavea Inc: you are now subscribed to system alerts for your account. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.')
    expect(SMS_TEST_MESSAGE.startsWith('Azavea Inc test: ')).toBe(true)
  })
})

describe('billedSpend', () => {
  it('is the wire figure alone once wire metering covers the window', () => {
    // Bench of 2026-11-24: the cost log showed $5.08 for gemini because aggregate
    // rows filed Anthropic spend there; $4.43 went over the wire.
    expect(billedSpend(4.43, 0)).toBeCloseTo(4.43)
  })
  it('adds the cost log only for the time before wire metering began', () => {
    expect(billedSpend(4.43, 12.5)).toBeCloseTo(16.93)
    expect(billedSpend(0, 12.5)).toBeCloseTo(12.5)
  })
})
