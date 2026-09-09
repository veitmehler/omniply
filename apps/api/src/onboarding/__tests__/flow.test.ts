import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionUpsert = vi.fn()
const sessionUpdate = vi.fn()
vi.mock('@omniply/shared', () => ({
  prisma: {
    onboardingSession: {
      upsert: (...a: unknown[]) => sessionUpsert(...a),
      update: (...a: unknown[]) => sessionUpdate(...a),
    },
  },
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { STEP_ORDER, currentStepView, commitAndAdvance, type StepContext } from '../flow'

function ctx(stepData: Record<string, unknown> = {}): StepContext {
  return { accountId: 'acct_1', userId: 'u_1', stepData }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionUpdate.mockResolvedValue({})
})

describe('onboarding flow', () => {
  it('declares the full step order, welcome first and final last', () => {
    expect(STEP_ORDER[0]).toBe('welcome')
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe('final')
    // The six voice questions are all present (q_moments added P3 2026-09-09).
    for (const q of ['q_declaration', 'q_enemy', 'q_tribe', 'q_line', 'q_moments', 'q_proof']) {
      expect(STEP_ORDER).toContain(q)
    }
    // Every required setup surface is a step; elevenlabs REMOVED (P3: no client voice).
    for (const s of ['business_confirm', 'logo_confirm', 'brand_profile_confirm', 'writing_sample', 'template_reveal', 'offers', 'cta', 'booking_url', 'pms', 'wordpress', 'socials', 'gbp', 'google_reviews', 'toggles']) {
      expect(STEP_ORDER).toContain(s)
    }
    expect(STEP_ORDER).not.toContain('elevenlabs')
  })

  it('renders a step view with progress', async () => {
    const view = await currentStepView(ctx(), 'welcome')
    expect(view.id).toBe('welcome')
    expect(view.kind).toBe('info')
    expect(view.messages.length).toBeGreaterThan(0)
    expect(view.progress).toEqual({ index: 1, total: STEP_ORDER.length })
  })

  it('marks dependent confirm steps pending until their background data exists', async () => {
    const notReady = await currentStepView(ctx(), 'logo_confirm')
    expect(notReady.pending).toBe(true)
    const ready = await currentStepView(ctx({ crawlDone: true, logoCandidates: ['x'] }), 'logo_confirm')
    expect(ready.pending).toBe(false)
  })

  it('commits an answer, appends history, persists, and advances', async () => {
    const c = ctx()
    const result = await commitAndAdvance(c, 'sess_1', 'welcome', { acknowledged: true })
    expect(result.error).toBeUndefined()
    expect(result.nextStep).toBe(STEP_ORDER[1])
    expect((c.stepData.__history as unknown[]).length).toBe(1)
    const update = sessionUpdate.mock.calls[0][0] as { data: { currentStep: string } }
    expect(update.data.currentStep).toBe(STEP_ORDER[1])
  })

  it('the last step does not advance past itself', async () => {
    const c = ctx()
    const result = await commitAndAdvance(c, 'sess_1', 'final', {})
    expect(result.nextStep).toBe('final')
  })

  it('rejects unknown steps', async () => {
    const result = await commitAndAdvance(ctx(), 'sess_1', 'nope', {})
    expect(result.error).toBe('Unknown step')
  })
})
