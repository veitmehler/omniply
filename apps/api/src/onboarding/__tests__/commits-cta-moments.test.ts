import { describe, it, expect, vi, beforeEach } from 'vitest'

const brandUpserts: unknown[] = []
vi.mock('@omniply/shared', () => ({
  prisma: {
    brandSettings: {
      upsert: vi.fn(async (args: { create: unknown }) => brandUpserts.push(args)),
    },
    settings: { upsert: vi.fn() },
  },
  encrypt: vi.fn(),
  ghlSettingsForUser: vi.fn(),
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
})

describe('commitCta', () => {
  it('dm_keyword stores the FIXED SPINE preset (no free input — 2026-09-09)', async () => {
    expect(await commitCta(ctx(), { value: 'dm_keyword' })).toBeNull()
    expect(lastUpdate()).toMatchObject({
      socialCallToAction: 'SPINE|our 2-Minute Spine Check',
      socialPrimaryGoal: 'dm_keyword',
    })
  })

  it('booking/newsletter now store their preset', async () => {
    expect(await commitCta(ctx(), { value: 'booking', label: 'Book an appointment' })).toBeNull()
    expect(lastUpdate()).toMatchObject({ socialPrimaryGoal: 'booking' })
  })

  it('custom stores custom text + custom preset', async () => {
    expect(await commitCta(ctx(), { value: 'custom', customText: 'Grab our guide' })).toBeNull()
    expect(lastUpdate()).toMatchObject({ socialCallToAction: 'Grab our guide', socialPrimaryGoal: 'custom' })
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
