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
