import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const accountFindUnique = vi.fn()
const accountUpdate = vi.fn()
const accountFindFirst = vi.fn()
const userFindFirst = vi.fn()
const stripeEventCreate = vi.fn()
const stripeEventUpdate = vi.fn()
const ghlSettingsFindFirst = vi.fn()
vi.mock('@omniply/shared', () => ({
  prisma: {
    account: {
      findUnique: (...a: unknown[]) => accountFindUnique(...a),
      findFirst: (...a: unknown[]) => accountFindFirst(...a),
      update: (...a: unknown[]) => accountUpdate(...a),
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    ghlSettings: { findFirst: (...a: unknown[]) => ghlSettingsFindFirst(...a) },
    stripeEvent: {
      create: (...a: unknown[]) => stripeEventCreate(...a),
      update: (...a: unknown[]) => stripeEventUpdate(...a),
    },
  },
}))
const getAgencyToken = vi.fn()
vi.mock('../../lib/ghl/app-oauth', () => ({
  getAgencyToken: (...a: unknown[]) => getAgencyToken(...a),
}))
// The SaaS locations lookup goes through global fetch.
const saasLocations = vi.fn<() => string[]>(() => [])
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => saasLocations() })))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const applyBillingEvent = vi.fn()
vi.mock('../../lib/account-lifecycle', () => ({
  applyBillingEvent: (...a: unknown[]) => applyBillingEvent(...a),
}))

import { stripeBillingRoutes } from '../stripe-billing'
import { signStripePayloadForTest, verifyStripeSignature } from '../../lib/stripe-webhook'

const SECRET = 'whsec_test'

async function build() {
  const app = Fastify()
  await app.register(stripeBillingRoutes)
  await app.ready()
  return app
}

function invoiceEvent(over: Record<string, unknown> = {}, meta: Record<string, string> = {}) {
  return {
    id: 'evt_1',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        object: 'invoice',
        subscription: 'sub_1',
        customer: 'cus_1',
        customer_email: 'buyer@clinic.com',
        metadata: { altId: 'SELLLOC', altType: 'location', contactId: 'contact_1', ...meta },
        ...over,
      },
    },
  }
}

async function post(app: Awaited<ReturnType<typeof build>>, event: object, sign = true) {
  const payload = JSON.stringify(event)
  return app.inject({
    method: 'POST',
    url: '/stripe/events',
    payload,
    headers: {
      'content-type': 'application/json',
      ...(sign ? { 'stripe-signature': signStripePayloadForTest(payload, SECRET) } : {}),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = SECRET
  process.env.STRIPE_BILLING_LOCATIONS = 'SELLLOC'
  accountFindUnique.mockResolvedValue(null)
  accountFindFirst.mockResolvedValue(null)
  userFindFirst.mockResolvedValue(null)
  stripeEventCreate.mockResolvedValue({})
  stripeEventUpdate.mockResolvedValue({})
  accountUpdate.mockResolvedValue({})
  ghlSettingsFindFirst.mockResolvedValue(null)
  getAgencyToken.mockResolvedValue(null)
  saasLocations.mockReturnValue([])
  applyBillingEvent.mockResolvedValue({ applied: true, duplicate: false })
})

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_BILLING_LOCATIONS
})

describe('verifyStripeSignature', () => {
  it('accepts a valid signature and rejects tampered payloads', () => {
    const body = '{"a":1}'
    const sig = signStripePayloadForTest(body, SECRET)
    expect(verifyStripeSignature(body, sig, SECRET)).toBe(true)
    expect(verifyStripeSignature('{"a":2}', sig, SECRET)).toBe(false)
    expect(verifyStripeSignature(body, sig, 'wrong')).toBe(false)
  })

  it('rejects stale timestamps', () => {
    const body = '{"a":1}'
    const sig = signStripePayloadForTest(body, SECRET, Date.now() - 10 * 60 * 1000)
    expect(verifyStripeSignature(body, sig, SECRET)).toBe(false)
  })
})

describe('POST /stripe/events', () => {
  it('401s without a valid signature', async () => {
    const app = await build()
    const res = await post(app, invoiceEvent(), false)
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('renewal: maps by subscriptionId and applies payment_cleared', async () => {
    accountFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.stripeSubscriptionId === 'sub_1') return { id: 'acct_1' }
      return null
    })
    const app = await build()
    const res = await post(app, invoiceEvent())
    expect(res.statusCode).toBe(200)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_1', 'payment_cleared', expect.anything())
    await app.close()
  })

  it('first payment: resolves subscription -> GHL location -> account and binds the subscription id', async () => {
    getAgencyToken.mockResolvedValue({ token: 't', companyId: 'comp_1' })
    saasLocations.mockReturnValue(['LOC_1'])
    ghlSettingsFindFirst.mockResolvedValue({ userId: 'user_1' })
    accountFindFirst.mockResolvedValue({ id: 'acct_9' })
    const app = await build()
    const res = await post(app, invoiceEvent())
    expect(res.statusCode).toBe(200)
    expect(accountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct_9' }, data: { stripeSubscriptionId: 'sub_1' } }),
    )
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_9', 'payment_cleared', expect.anything())
    await app.close()
  })

  it('reads the subscription id from parent.subscription_details (newer Stripe shape)', async () => {
    accountFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.stripeSubscriptionId === 'sub_nested') return { id: 'acct_n' }
      return null
    })
    const app = await build()
    const res = await post(
      app,
      invoiceEvent({ subscription: undefined, parent: { subscription_details: { subscription: 'sub_nested', metadata: { altId: 'SELLLOC' } } } }),
    )
    expect(res.statusCode).toBe(200)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_n', 'payment_cleared', expect.anything())
    await app.close()
  })

  it('never binds by customer id, email or contact id — unknown subscription is held', async () => {
    // cus_1 is "already bound" to another account; buyer email and contactId
    // match nothing relevant. The configurator shares customers across
    // buyers, so none of these may resolve the account.
    accountFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.stripeCustomerId === 'cus_1') return { id: 'acct_OTHER' }
      return null
    })
    userFindFirst.mockResolvedValue({ accountId: 'acct_wrong' })
    const app = await build()
    const res = await post(app, invoiceEvent())
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ held: true })
    expect(applyBillingEvent).not.toHaveBeenCalled()
    expect(accountUpdate).not.toHaveBeenCalled()
    await app.close()
  })

  it('holds unmatched events (202) without applying anything', async () => {
    const app = await build()
    const res = await post(app, invoiceEvent())
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ held: true })
    expect(applyBillingEvent).not.toHaveBeenCalled()
    await app.close()
  })

  it('ignores subscriptions from other selling locations', async () => {
    const app = await build()
    const res = await post(app, invoiceEvent({}, { altId: 'SOMEONE_ELSE' }))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ignored: true })
    expect(stripeEventCreate).not.toHaveBeenCalled()
    await app.close()
  })

  it('deduplicates on Stripe event id', async () => {
    stripeEventCreate.mockRejectedValue(new Error('unique constraint'))
    const app = await build()
    const res = await post(app, invoiceEvent())
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ duplicate: true })
    expect(applyBillingEvent).not.toHaveBeenCalled()
    await app.close()
  })

  it('maps failure and cancellation events to the lifecycle machine', async () => {
    accountFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.stripeSubscriptionId === 'sub_1') return { id: 'acct_1' }
      return null
    })
    const app = await build()
    const failed = { ...invoiceEvent(), id: 'evt_2', type: 'invoice.payment_failed' }
    await post(app, failed)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_1', 'payment_failed', expect.anything())
    const cancelled = {
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', metadata: { altId: 'SELLLOC' } } },
    }
    await post(app, cancelled)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_1', 'cancelled', expect.anything())
    await app.close()
  })

  it('maps pause and resume to the lifecycle machine', async () => {
    accountFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.stripeSubscriptionId === 'sub_1') return { id: 'acct_1' }
      return null
    })
    const app = await build()
    const paused = {
      id: 'evt_5',
      type: 'customer.subscription.paused',
      data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', metadata: { altId: 'SELLLOC' } } },
    }
    await post(app, paused)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_1', 'payment_failed', expect.anything())
    const resumed = {
      id: 'evt_6',
      type: 'customer.subscription.resumed',
      data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', metadata: { altId: 'SELLLOC' } } },
    }
    await post(app, resumed)
    expect(applyBillingEvent).toHaveBeenCalledWith('acct_1', 'payment_cleared', expect.anything())
    await app.close()
  })

  it('acknowledges unhandled event types without processing', async () => {
    const app = await build()
    const res = await post(app, { id: 'evt_4', type: 'charge.refunded', data: { object: {} } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ignored: true })
    await app.close()
  })
})
