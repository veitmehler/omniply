import { describe, it, expect, vi, beforeEach } from 'vitest'

const settingsUpsertCalls: unknown[] = []
vi.mock('@omniply/shared', () => ({
  prisma: {
    settings: { upsert: vi.fn(async (args: unknown) => settingsUpsertCalls.push(args)) },
  },
  encrypt: vi.fn(),
  ghlSettingsForUser: vi.fn(),
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../queues/index', () => ({ getBoss: vi.fn(), QUEUES: {} }))
vi.mock('../../lib/system-keys', () => ({ getSystemApiKey: vi.fn(async () => 'test-key') }))
vi.mock('../../lib/ghl/settings', () => ({ getGhlCredentials: vi.fn() }))
vi.mock('../../lib/ghl/client', () => ({ listGhlAccounts: vi.fn() }))
vi.mock('../../newsletter/logo-process', () => ({ processLogo: vi.fn() }))
vi.mock('../../newsletter/calendar-routing', () => ({ effectiveHemisphere: vi.fn() }))
const generateWritingStyle = vi.fn(async (..._args: unknown[]) => 'the synthesized style')
vi.mock('../synthesis', () => ({
  generateWritingStyle: (...args: unknown[]) => generateWritingStyle(...args),
  generateOfferDrafts: vi.fn(),
  buildTemplatePreviewHtml: vi.fn(),
}))

import { commitWritingSample } from '../commits'
import type { StepContext } from '../flow'

const SAMPLE = { url: 'https://clinic.test/blog/p', title: 'P', text: 'scraped article body '.repeat(50), wordCount: 500 }
const TRANSCRIPTS = Object.fromEntries(
  ['q_declaration', 'q_enemy', 'q_tribe', 'q_line', 'q_proof'].map((k) => [k, { text: `${k} answer` }]),
)

function ctx(stepData: Record<string, unknown> = {}): StepContext {
  return { accountId: 'acc', userId: 'user', stepData: { ...TRANSCRIPTS, ...stepData } }
}

beforeEach(() => {
  vi.clearAllMocks()
  settingsUpsertCalls.length = 0
})

describe('commitWritingSample', () => {
  it('ingests the scraped article ONLY on explicit "I wrote this"', async () => {
    const c = ctx({ blogSample: SAMPLE })
    const err = await commitWritingSample(c, { text: 'I wrote this' })
    expect(err).toBeNull()
    expect(generateWritingStyle).toHaveBeenCalledWith('test-key', expect.any(String), SAMPLE.text)
    expect(c.stepData.writingSampleSource).toBe('scraped_confirmed')
  })

  it('accepts "i wrote it." case-insensitively', async () => {
    const c = ctx({ blogSample: SAMPLE })
    expect(await commitWritingSample(c, { text: 'i wrote it.' })).toBeNull()
    expect(c.stepData.writingSampleSource).toBe('scraped_confirmed')
  })

  it('treats "I wrote this" as short garbage when there is no scraped candidate', async () => {
    const c = ctx()
    const err = await commitWritingSample(c, { text: 'I wrote this' })
    expect(err).toMatch(/too short/i)
    expect(generateWritingStyle).not.toHaveBeenCalled()
  })

  it('pasted article (200+ chars) is used verbatim', async () => {
    const pasted = 'my own words '.repeat(30)
    const c = ctx({ blogSample: SAMPLE })
    expect(await commitWritingSample(c, { text: pasted })).toBeNull()
    expect(generateWritingStyle).toHaveBeenCalledWith('test-key', expect.any(String), pasted.trim())
    expect(c.stepData.writingSampleSource).toBe('pasted')
  })

  it('skip works with and without a candidate', async () => {
    const c = ctx({ blogSample: SAMPLE })
    expect(await commitWritingSample(c, { text: 'skip' })).toBeNull()
    expect(generateWritingStyle).toHaveBeenCalledWith('test-key', expect.any(String), null)
    expect(c.stepData.writingSampleSource).toBe('skipped')
  })

  it('short garbage with a candidate re-explains the three options', async () => {
    const c = ctx({ blogSample: SAMPLE })
    const err = await commitWritingSample(c, { text: 'ok sure' })
    expect(err).toMatch(/I wrote this/i)
    expect(generateWritingStyle).not.toHaveBeenCalled()
  })

  it('errors when no transcripts AND no article', async () => {
    const c: StepContext = { accountId: 'acc', userId: 'user', stepData: {} }
    const err = await commitWritingSample(c, { text: 'skip' })
    expect(err).toMatch(/spoken answers|writing sample/i)
  })
})
