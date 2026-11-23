import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { findFirst, create, findUnique, getSystemApiKey } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  getSystemApiKey: vi.fn(),
}))

vi.mock('@omniply/shared', () => ({
  prisma: { errorLog: { findFirst, create }, user: { findUnique } },
}))
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../system-keys', () => ({ getSystemApiKey }))

import { sendFailureAlert, alertEmailDecision, ALERT_INCIDENT_WINDOW_MS } from '../alerts'

const OPS = 'ops@omniply.test'
const CLIENT = 'owner@clinic.test'
const fetchMock = vi.fn()

beforeEach(() => {
  findFirst.mockReset()
  create.mockReset()
  findUnique.mockReset()
  getSystemApiKey.mockReset()
  fetchMock.mockReset()
  create.mockResolvedValue({})
  findFirst.mockResolvedValue(null)
  findUnique.mockResolvedValue({ email: CLIENT, brandSettings: { organizationName: 'Clinic One' } })
  getSystemApiKey.mockResolvedValue('re_test')
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal('fetch', fetchMock)
  process.env.ALERT_EMAIL_TO = OPS
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ALERT_EMAIL_TO
})

const sentTo = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).to as string)
const sentBody = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as { body: string }).body) as { subject: string; text: string }

// Gemini credit outage, 2026-11-14 to 23: one client received 405 raw
// `newsletter_generate_failed` emails in two days.
describe('sendFailureAlert', () => {
  it('mails the operations inbox only, never the account owner', async () => {
    await sendFailureAlert({ userId: 'u1', errorType: 'newsletter_generate_failed', message: 'gemini circuit is open' })
    expect(sentTo()).toEqual([OPS])
    expect(sentTo()).not.toContain(CLIENT)
  })

  it('names the account in the body so operations know whose failure it is', async () => {
    await sendFailureAlert({ userId: 'u1', errorType: 'newsletter_generate_failed', message: 'boom' })
    expect(sentBody().text).toContain('Account: Clinic One · owner@clinic.test')
  })

  it('logs every failure but mails a repeat of the same incident only once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T19:24:00Z'))
    try {
      findFirst.mockResolvedValue({ createdAt: new Date('2026-11-21T19:04:00Z') })
      await sendFailureAlert({ userId: 'u1', errorType: 'newsletter_generate_failed', message: 'again' })
      expect(create).toHaveBeenCalledTimes(1)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('mails one reminder, marked as still failing, on the first repeat of a new day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T00:10:00Z'))
    try {
      findFirst.mockResolvedValue({ createdAt: new Date('2026-11-21T23:50:00Z') })
      await sendFailureAlert({ userId: 'u1', errorType: 'newsletter_generate_failed', message: 'again' })
      expect(sentTo()).toEqual([OPS])
      expect(sentBody().subject).toContain('newsletter_generate_failed (still failing)')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends nothing to anyone when no operations inbox is configured', async () => {
    delete process.env.ALERT_EMAIL_TO
    await sendFailureAlert({ userId: 'u1', errorType: 'x', message: 'y' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('looks up the previous failure by type and account before writing the new row', async () => {
    await sendFailureAlert({ userId: 'u1', errorType: 'publish_failed', message: 'm' })
    expect(findFirst.mock.calls[0][0].where).toEqual({ errorType: 'publish_failed', userId: 'u1' })
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })
})

describe('alertEmailDecision', () => {
  const at = (iso: string) => new Date(iso)
  it('mails the first failure of an incident', () => {
    expect(alertEmailDecision(null, at('2026-11-21T19:04:00Z'))).toBe('first')
    expect(alertEmailDecision(at('2026-11-21T10:00:00Z'), at('2026-11-21T19:04:00Z'))).toBe('first') // quiet for longer than the window
  })
  it('only logs repeats inside the window on the same day', () => {
    expect(alertEmailDecision(at('2026-11-21T19:04:00Z'), at('2026-11-21T19:24:00Z'))).toBe('repeat')
    expect(alertEmailDecision(at('2026-11-21T14:00:00Z'), at('2026-11-21T19:59:00Z'))).toBe('repeat')
  })
  it('sends one reminder on the first repeat of each new UTC day while it lasts', () => {
    expect(alertEmailDecision(at('2026-11-21T23:50:00Z'), at('2026-11-22T00:10:00Z'))).toBe('reminder')
    expect(alertEmailDecision(at('2026-11-22T00:10:00Z'), at('2026-11-22T00:30:00Z'))).toBe('repeat')
  })
  it('uses a six-hour incident window', () => {
    expect(ALERT_INCIDENT_WINDOW_MS).toBe(6 * 60 * 60 * 1000)
  })
})
