/**
 * Central Anthropic model resolution (Sonnet 4.5 → 5.5 migration, Nov 2026).
 *
 * claude-sonnet-4-5-20250929 retires 2026-11-30; claude-haiku-4-5's
 * protection floor has passed. Model ids reach the AnthropicAdapter from two
 * places: hardcoded literals across the pipeline/generators, and
 * PromptTemplate.defaultModel rows seeded into the DB. Rather than chase both,
 * every id is mapped HERE, at the adapter chokepoint:
 *
 *   ANTHROPIC_SONNET_MODEL / ANTHROPIC_HAIKU_MODEL (env) override the whole
 *   4.5 family per environment — staging benches 5.5 while prod stays on 4.5,
 *   and the production flip (and any rollback) is an env change, not a deploy.
 *
 * Unset env = exact current behavior.
 */

export const SONNET_45 = 'claude-sonnet-4-5-20250929'
export const HAIKU_45 = 'claude-haiku-4-5-20251001'

const sonnetOverride = process.env.ANTHROPIC_SONNET_MODEL?.trim() || null
const haikuOverride = process.env.ANTHROPIC_HAIKU_MODEL?.trim() || null

/** The current default Sonnet-class model (env override or 4.5). */
export const ANTHROPIC_SONNET = sonnetOverride ?? SONNET_45

/** Map any stored/hardcoded 4.5-family id through the env overrides. */
export function resolveAnthropicModel(model: string): string {
  if (sonnetOverride && model.startsWith('claude-sonnet-4-5')) return sonnetOverride
  if (haikuOverride && model.startsWith('claude-haiku-4-5')) return haikuOverride
  return model
}

/**
 * `temperature` (with top_p/top_k) is removed in Anthropic API version
 * 2026-10-21 and warned-on for Claude 4.7+ even on older API versions. Our SDK
 * pin keeps 4.5 calls working as-is; for newer models we simply omit the
 * parameter (prompting carries the register instead).
 */
export function supportsTemperature(model: string): boolean {
  return (
    model.startsWith('claude-sonnet-4-5') ||
    model.startsWith('claude-haiku-4-5') ||
    model.startsWith('claude-3')
  )
}

/**
 * 5.x models think adaptively by default, and thinking tokens bill as output
 * AND share the max_tokens window with the text. On small-budget calls
 * (glosses, captions, subject lines) the model can spend the entire window
 * thinking and return no text at all — observed as "Anthropic returned empty
 * response" across the whole plain-language pass (bench 2026-11-04). The API
 * offers no numeric budget on these models: only adaptive vs between_tools
 * (= off for plain text calls). So: small calls get thinking off; large calls
 * keep adaptive (brevity is steered via prompts, verified via usage logs).
 */
export const SMALL_CALL_THINKING_OFF_BELOW = Number(process.env.ANTHROPIC_THINKING_OFF_BELOW_TOKENS ?? 2048)

export function supportsThinkingControl(model: string): boolean {
  return model.startsWith('claude-sonnet-5') || model.startsWith('claude-haiku-5') || model.startsWith('claude-opus-5')
}

export function thinkingConfigFor(model: string, maxTokens: number): { type: 'adaptive' } | { type: 'between_tools' } | null {
  if (!supportsThinkingControl(model)) return null
  return maxTokens < SMALL_CALL_THINKING_OFF_BELOW ? { type: 'between_tools' } : { type: 'adaptive' }
}
