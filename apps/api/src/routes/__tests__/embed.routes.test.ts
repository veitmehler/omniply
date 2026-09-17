import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const ghlSettingsFindFirst = vi.fn()
const userFindUnique = vi.fn()
const userFindFirst = vi.fn()
const userCreate = vi.fn()
// Roster gate (no silent auto-join): default = the SSO user HAS a seat.
const accountMemberFindFirst = vi.fn().mockResolvedValue({ id: 'am_1', email: 'dr@clinic.com', name: null })
const userUpdate = vi.fn()
const accountFindUnique = vi.fn()
vi.mock('@omniply/shared', () => ({
  prisma: {
    ghlSettings: { findFirst: (...a: unknown[]) => ghlSettingsFindFirst(...a) },
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      create: (...a: unknown[]) => userCreate(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    account: { findUnique: (...a: unknown[]) => accountFindUnique(...a) },
    accountMember: { findFirst: (...a: unknown[]) => accountMemberFindFirst(...a) },
  },
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { embedRoutes } from '../embed'
import { encryptGhlSsoForTest, verifyEmbedToken } from '../../lib/embed-auth'

const SECRET = 'sso-secret'

async function build() {
  const app = Fastify()
  await app.register(embedRoutes)
  await app.ready()
  return app
}

function payload(over: Record<string, unknown> = {}) {
  return encryptGhlSsoForTest(
    { userId: 'ghluser_1', companyId: 'co_1', activeLocation: 'loc_1', email: 'dr@clinic.com', userName: 'Dr. Who', ...over },
    SECRET,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GHL_SSO_SECRET = SECRET
  ghlSettingsFindFirst.mockResolvedValue({ userId: 'owner_1' })
  // user.findUnique: owner lookup + clerkId/email availability checks
  userFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    if (args?.where?.id === 'owner_1') return { accountId: 'acct_1' }
    return null // clerkId/email free
  })
  userFindFirst.mockResolvedValue(null) // no row in this account
  userCreate.mockResolvedValue({ id: 'u_new', clerkId: 'ghl:ghluser_1', email: 'dr@clinic.com', name: 'Dr. Who', accountId: 'acct_1', ghlUserId: 'ghluser_1' })
  accountFindUnique.mockResolvedValue({ onboardingCompletedAt: null, status: 'active' })
})

afterEach(() => {
  delete process.env.GHL_SSO_SECRET
})

describe('POST /embed/session', () => {
  it('503s when the SSO secret is unset', async () => {
    delete process.env.GHL_SSO_SECRET
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: 'x' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('401s on an undecryptable payload', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST', url: '/embed/session',
      payload: { encryptedData: Buffer.from('junk').toString('base64') },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns provisioningPending for an unknown location without creating anything', async () => {
    ghlSettingsFindFirst.mockResolvedValue(null)
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: payload() } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ provisioningPending: true })
    expect(userCreate).not.toHaveBeenCalled()
    await app.close()
  })

  it('creates a user with a synthetic clerkId and returns a verifiable token', async () => {
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: payload() } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkId: 'ghl:ghluser_1', ghlUserId: 'ghluser_1', accountId: 'acct_1' }) }),
    )
    expect(body.onboardingCompleted).toBe(false)
    const verified = verifyEmbedToken(body.token)
    expect(verified).toMatchObject({ sub: 'ghl:ghluser_1', accountId: 'acct_1' })
    await app.close()
  })

  it('creates a second per-account row for a user already known in another account', async () => {
    // Same GHL human exists in acct_OTHER: base clerkId and real email are taken.
    userFindUnique.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.id === 'owner_1') return { accountId: 'acct_1' }
      if (args?.where?.clerkId === 'ghl:ghluser_1') return { id: 'u_x' }
      if (args?.where?.email === 'dr@clinic.com') return { id: 'u_x' }
      return null
    })
    userCreate.mockResolvedValue({ id: 'u_2', clerkId: 'ghl:ghluser_1:acct_1', email: 'ghluser_1.acct_1@ghl.local', name: 'Dr. Who', accountId: 'acct_1', ghlUserId: 'ghluser_1' })
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: payload() } })
    expect(res.statusCode).toBe(200)
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clerkId: 'ghl:ghluser_1:acct_1',
          email: 'ghluser_1.acct_1@ghl.local',
          accountId: 'acct_1',
        }),
      }),
    )
    expect(verifyEmbedToken(res.json().token)).toMatchObject({ sub: 'ghl:ghluser_1:acct_1', accountId: 'acct_1' })
    await app.close()
  })

  it('denies a seat to an SSO user with no roster membership (no auto-join)', async () => {
    accountMemberFindFirst.mockResolvedValueOnce(null)
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: payload() } })
    expect(res.statusCode).toBe(200)
    expect(res.json().seatRequired).toBe(true)
    expect(userCreate).not.toHaveBeenCalled()
    await app.close()
  })

  it('lets the buyer claim the placeholder owner row via email match', async () => {
    userFindFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.email === 'dr@clinic.com') {
        return { id: 'owner_1', clerkId: 'ghlowner:loc_1', ghlUserId: null, email: 'dr@clinic.com', name: null, accountId: 'acct_1' }
      }
      return null
    })
    userUpdate.mockResolvedValue({ id: 'owner_1', clerkId: 'ghl:ghluser_1', ghlUserId: 'ghluser_1', email: 'dr@clinic.com', name: 'Dr. Who', accountId: 'acct_1' })
    accountFindUnique.mockResolvedValue({ onboardingCompletedAt: null, status: 'active', ownerUserId: 'owner_1' })
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/embed/session', payload: { encryptedData: payload() } })
    expect(res.statusCode).toBe(200)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'owner_1' },
        data: expect.objectContaining({ clerkId: 'ghl:ghluser_1', ghlUserId: 'ghluser_1' }),
      }),
    )
    expect(userCreate).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects agency-context payloads (no activeLocation)', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST', url: '/embed/session',
      payload: { encryptedData: payload({ activeLocation: undefined }) },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
