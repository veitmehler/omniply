import { describe, it, expect } from 'vitest'
import { resolveAnthropicModel, supportsTemperature, SONNET_45, HAIKU_45 } from '../anthropic-models'
import { calculateCost } from '../cost-table'

describe('resolveAnthropicModel (no env overrides in tests)', () => {
  it('passes 4.5 ids through unchanged when no override is set', () => {
    expect(resolveAnthropicModel(SONNET_45)).toBe(SONNET_45)
    expect(resolveAnthropicModel(HAIKU_45)).toBe(HAIKU_45)
    expect(resolveAnthropicModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })
  it('never touches non-4.5 ids', () => {
    expect(resolveAnthropicModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(resolveAnthropicModel('gemini-3.5-flash')).toBe('gemini-3.5-flash')
  })
})

describe('supportsTemperature', () => {
  it('keeps temperature for the 4.5 family and Claude 3', () => {
    expect(supportsTemperature(SONNET_45)).toBe(true)
    expect(supportsTemperature('claude-haiku-4-5')).toBe(true)
    expect(supportsTemperature('claude-3-5-sonnet-20241022')).toBe(true)
  })
  it('omits temperature for 5.x models (param removed in API 2026-10-21)', () => {
    expect(supportsTemperature('claude-sonnet-5-5')).toBe(false)
    expect(supportsTemperature('claude-haiku-5-5')).toBe(false)
  })
})

describe('cost table 5.5 rows', () => {
  it('prices Sonnet 5.5 at $2/$10 per MTok', () => {
    expect(calculateCost('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBeCloseTo(12.0, 6)
  })
  it('prices Haiku 5.5 base tier at $0.10/$0.50 for prompts under 100K', () => {
    expect(calculateCost('claude-haiku-5-5', 50_000, 10_000)).toBeCloseTo(0.005 + 0.005, 6)
  })
  it('re-rates the whole request on the >100K-prompt tier', () => {
    // 100K input exactly stays on base tier; 100K+1 flips everything to 5x
    expect(calculateCost('claude-haiku-5-5', 100_000, 10_000)).toBeCloseTo(0.01 + 0.005, 6)
    expect(calculateCost('claude-haiku-5-5', 100_001, 10_000)).toBeCloseTo((100_001 / 1e6) * 0.5 + 0.025, 6)
  })
})

import { thinkingConfigFor as thinkingConfigForced } from '../anthropic-models'

describe('thinkingConfigFor forced mode (step-runner length retry, 2026-11-12)', () => {
  it("'off' wins over the size rule on 5.x models and is a no-op on 4.5", () => {
    expect(thinkingConfigForced('claude-sonnet-5-5', 16384, 'off')).toEqual({ type: 'between_tools' })
    expect(thinkingConfigForced('claude-haiku-5-5', 16384, 'off')).toEqual({ type: 'disabled' })
    expect(thinkingConfigForced('claude-sonnet-5-5', 1024, 'adaptive')).toEqual({ type: 'adaptive' })
    expect(thinkingConfigForced('claude-sonnet-4-5-20250929', 16384, 'off')).toBeNull()
    expect(thinkingConfigForced('claude-sonnet-5-5', 16384)).toEqual({ type: 'adaptive' })
  })
})
