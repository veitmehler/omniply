import { describe, it, expect, vi, beforeEach } from 'vitest'

const brandUpserts: unknown[] = []
let mockBrand: Record<string, unknown> | null = null
vi.mock('@omniply/shared', () => ({
  prisma: {
    brandSettings: {
      upsert: vi.fn(async (args: { create: unknown }) => brandUpserts.push(args)),
    },
    settings: { upsert: vi.fn() },
  },
  encrypt: vi.fn(),
  ghlSettingsForUser: vi.fn(),
  brandSettingsForUser: vi.fn(async () => mockBrand),
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../queues/index', () => ({ getBoss: vi.fn(), QUEUES: {} }))
vi.mock('../../lib/system-keys', () => ({ getSystemApiKey: vi.fn() }))
vi.mock('../../lib/ghl/settings', () => ({ getGhlCredentials: vi.fn() }))
vi.mock('../../lib/ghl/client', () => ({ listGhlAccounts: vi.fn() }))
vi.mock('../../newsletter/logo-process', () => ({ processLogo: vi.fn() }))
vi.mock('../../newsletter/calendar-routing', () => ({ effectiveHemisphere: vi.fn() }))
vi.mock('../synthesis', () => ({ generateWritingStyle: vi.fn(), generateOfferDrafts: vi.fn(), buildTemplatePreviewHtml: vi.fn() }))

import { commitCta, commitStoryMoments } from '../commits'
import type { StepContext } from '../flow'

function ctx(): StepContext {
  return { accountId: 'acc', userId: 'user', stepData: {} }
}
function lastUpdate(): Record<string, unknown> {
  return (brandUpserts[brandUpserts.length - 1] as { update: Record<string, unknown> }).update
}

beforeEach(() => {
  brandUpserts.length = 0
  mockBrand = null
})

describe('commitCta (social lead-gen consent, §4b-3)', () => {
  it('yes → fixed SPINE preset + dm_keyword goal + quiz consent', async () => {
    expect(await commitCta(ctx(), { value: 'yes' })).toBeNull()
    expect(lastUpdate()).toMatchObject({
      socialCallToAction: 'SPINE|our 2-Minute Spine Check',
      socialPrimaryGoal: 'dm_keyword',
      installConsents: { quiz: true },
    })
  })

  it('no → phone-first call CTA, null goal, quiz consent declined', async () => {
    mockBrand = { organizationPhone: '+1 809 555 5555' }
    expect(await commitCta(ctx(), { value: 'no' })).toBeNull()
    expect(lastUpdate()).toMatchObject({
      socialCallToAction: 'Call us at +1 809 555 5555 to book your appointment.',
      socialPrimaryGoal: null,
      installConsents: { quiz: false },
    })
  })

  it('no without a phone falls back to the booking-link CTA', async () => {
    mockBrand = { bookingUrl: 'https://x.test/book' }
    expect(await commitCta(ctx(), { value: 'no' })).toBeNull()
    expect(lastUpdate()).toMatchObject({
      socialCallToAction: 'Book your appointment through the link in our bio.',
    })
  })

  it('rejects anything but yes/no', async () => {
    expect(await commitCta(ctx(), { value: 'dm_keyword' })).toMatch(/options/i)
  })
})

describe('commitStoryMoments', () => {
  it('stores the transcript as storyBeats', async () => {
    expect(await commitStoryMoments(ctx(), { text: 'I once rebuilt my intake process over a weekend.' })).toBeNull()
    expect(lastUpdate()).toMatchObject({ storyBeats: 'I once rebuilt my intake process over a weekend.' })
  })

  it('rejects an empty answer', async () => {
    expect(await commitStoryMoments(ctx(), { text: '  ' })).toMatch(/moment/i)
  })
})
