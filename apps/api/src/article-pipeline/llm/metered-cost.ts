/**
 * Cost of one provider call, computed AND reported to the spend ledger in the
 * same breath (lib/net/call-stats.ts → ProviderSpend).
 *
 * Every place that turns a provider response into a cost calls this instead of
 * calculateCost() directly, so no paid call can be priced without also being
 * counted. Before 2026-11-23 the counting was left to call sites (LLMUsage),
 * and about twenty of them never did it.
 */
import { calculateCost } from './cost-table'
import { recordProviderSpend } from '../../lib/net/call-stats'

export function meteredCost(provider: string, model: string, inputTokens: number, outputTokens: number, extraUsd = 0, cachedInputTokens = 0): number {
  const cost = calculateCost(model, inputTokens, outputTokens, cachedInputTokens) + extraUsd
  recordProviderSpend(provider, model, cost, { input: inputTokens, output: outputTokens })
  return cost
}

interface GeminiUsage {
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number; cachedContentTokenCount?: number }
}

/**
 * For the raw Gemini fetches that never computed a cost at all (onboarding,
 * diagram verify): read the token counts off the response and report them.
 * Returns the cost so a caller that wants it can use it.
 */
export function meterGeminiResponse(model: string, json: unknown): number {
  const um = (json as GeminiUsage | null)?.usageMetadata ?? {}
  const input = (um.promptTokenCount ?? 0) + (um.toolUsePromptTokenCount ?? 0)
  const output = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0)
  if (input + output === 0) return 0
  return meteredCost('gemini', model, input, output, 0, um.cachedContentTokenCount ?? 0)
}
