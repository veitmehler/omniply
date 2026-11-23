import { describe, it, expect, vi, beforeEach } from 'vitest'

const { upsert, createMany } = vi.hoisted(() => ({ upsert: vi.fn(), createMany: vi.fn() }))
vi.mock('@omniply/shared', () => ({ prisma: { providerCallStat: { upsert }, providerSpend: { createMany } } }))
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { recordCallOutcome, recordProviderSpend, flushCallStats, pendingCallStats, pendingProviderSpend, hourBucket } from '../call-stats'
import { meteredCost, meterGeminiResponse } from '../../../article-pipeline/llm/metered-cost'

beforeEach(async () => {
  upsert.mockReset()
  createMany.mockReset()
  upsert.mockResolvedValue({})
  createMany.mockResolvedValue({ count: 0 })
  pendingCallStats().clear()
  pendingProviderSpend().clear()
})

describe('call outcomes', () => {
  it('counts outcomes per provider and keeps the last error', () => {
    recordCallOutcome('gemini', 'success')
    recordCallOutcome('gemini', 'error', { status: 402, message: 'Your prepayment credits are depleted.' })
    recordCallOutcome('gemini', 'circuit-open')
    const p = pendingCallStats().get('gemini')!
    expect([p.ok, p.failed, p.skipped]).toEqual([1, 1, 1])
    expect(p.lastErrorStatus).toBe(402)
    expect(p.lastErrorMessage).toContain('prepayment credits')
  })
  it('ignores the names unit tests use', () => {
    recordCallOutcome('circuit-test', 'error')
    recordCallOutcome('p', 'success')
    expect(pendingCallStats().size).toBe(0)
  })
  it('writes one row per provider per hour and clears what it wrote', async () => {
    recordCallOutcome('anthropic', 'success')
    recordCallOutcome('anthropic', 'success')
    await flushCallStats()
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.where.provider_bucket.provider).toBe('anthropic')
    expect(arg.create.ok).toBe(2)
    expect(arg.update.ok).toEqual({ increment: 2 })
    expect(pendingCallStats().size).toBe(0)
  })
  it('keeps the counts when the write fails, so nothing is lost', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    recordCallOutcome('gemini', 'error', { status: 503, message: 'overloaded' })
    await flushCallStats()
    expect(pendingCallStats().get('gemini')?.failed).toBe(1)
  })
  it('buckets by UTC hour', () => {
    expect(hourBucket(new Date('2026-11-23T18:47:31Z')).toISOString()).toBe('2026-11-23T18:00:00.000Z')
  })
})

describe('spend measured at the wire', () => {
  it('adds up cost and tokens per provider and model', () => {
    recordProviderSpend('gemini', 'gemini-3.5-flash', 0.01, { input: 1000, output: 200 })
    recordProviderSpend('gemini', 'gemini-3.5-flash', 0.02, { input: 2000, output: 400 })
    recordProviderSpend('anthropic', 'claude-sonnet-5-5', 0.3)
    const g = pendingProviderSpend().get('gemini|gemini-3.5-flash')!
    expect(g.cost).toBeCloseTo(0.03)
    expect([g.calls, g.inputTokens, g.outputTokens]).toEqual([2, 3000, 600])
    expect(pendingProviderSpend().size).toBe(2)
  })
  it('flushes spend as rows and keeps it when the write fails', async () => {
    recordProviderSpend('gemini', 'm', 0.5)
    createMany.mockRejectedValueOnce(new Error('db down'))
    await flushCallStats()
    expect(pendingProviderSpend().get('gemini|m')?.cost).toBeCloseTo(0.5)
    await flushCallStats()
    expect(createMany).toHaveBeenCalledTimes(2)
    expect(createMany.mock.calls[1][0].data[0]).toMatchObject({ provider: 'gemini', model: 'm', cost: 0.5, calls: 1 })
    expect(pendingProviderSpend().size).toBe(0)
  })
  it('rejects nonsense amounts', () => {
    recordProviderSpend('gemini', 'm', Number.NaN)
    recordProviderSpend('gemini', 'm', -1)
    expect(pendingProviderSpend().size).toBe(0)
  })
  it('a priced call is always a counted call', () => {
    const cost = meteredCost('gemini', 'gemini-3.5-flash', 10_000, 2_000, 0.035)
    expect(cost).toBeGreaterThan(0.035)
    expect(pendingProviderSpend().get('gemini|gemini-3.5-flash')?.cost).toBeCloseTo(cost)
  })
  it('reads token counts off a raw Gemini response, thinking tokens included', () => {
    const cost = meterGeminiResponse('gemini-3.5-flash', { usageMetadata: { promptTokenCount: 500, toolUsePromptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 250 } })
    const p = pendingProviderSpend().get('gemini|gemini-3.5-flash')!
    expect(cost).toBeGreaterThan(0)
    expect([p.inputTokens, p.outputTokens]).toEqual([600, 300])
    expect(meterGeminiResponse('gemini-3.5-flash', {})).toBe(0)
  })
})
