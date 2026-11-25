// USD per 1 million tokens
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Gemini
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-3-flash': { input: 0.50, output: 3.00 },
  // Preview alias of 3-flash — the most-used hardcoded model in the repo;
  // without this row it silently hit the $0.50/$1.50 fallback (cost audit
  // 2026-10-09).
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  // Google serves and bills this id as Gemini 3.6 Flash (its SKU report of 2026-11-24 names it so, at $3.75
  // per 1M output tokens). The rate below is the one from 2027-01-01; the introductory rate until then is
  // in GEMINI_36_FLASH_INTRO.
  'gemini-3.5-flash': { input: 1.50, output: 7.50 },
  'gemini-3.6-flash': { input: 1.50, output: 7.50 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.1-pro': { input: 2.00, output: 12.00 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-pro': { input: 0.50, output: 1.50 },

  // Anthropic
  'claude-sonnet-5-5': { input: 2.00, output: 10.00 },
  // Haiku 5.5 base tier (prompts ≤100K tokens); the >100K tier is handled in
  // calculateCost because the whole request re-rates when it crosses 100K.
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },

  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.5': { input: 5.00, output: 30.00 },
}

/** Gemini 3.6 Flash, pricing page read 2026-11-25: "$0.75 through December 31, 2026. $1.50 starting January 1, 2027" (input), "$3.75 ... $7.50" (output). */
const GEMINI_36_FLASH_INTRO = { input: 0.75, output: 3.75, until: Date.UTC(2027, 0, 1) }

/** Share of the input price Google charges for input tokens it served from its cache (all Gemini 3.x text models: a tenth). */
export const GEMINI_CACHED_INPUT_SHARE = 0.1

export function getCostPerToken(model: string, type: 'input' | 'output', at: number = Date.now()): number {
  if ((model === 'gemini-3.5-flash' || model === 'gemini-3.6-flash') && at < GEMINI_36_FLASH_INTRO.until) return GEMINI_36_FLASH_INTRO[type]
  const entry = COST_TABLE[model]
  if (!entry) return type === 'input' ? 0.50 : 1.50  // conservative unknown fallback per 1M
  return entry[type]
}

// Haiku 5.5 bills the ENTIRE request at a 5x rate once the prompt exceeds
// 100K tokens — a per-request tier, invisible to flat per-model rates.
const HAIKU_55_LONG_PROMPT = { input: 0.50, output: 2.50 }

/**
 * `cachedInputTokens` are the input tokens the provider reports as served from its cache; they are part of
 * `inputTokens` and, for Gemini, billed at a tenth of the input rate (Google's report of 2026-11-24 showed
 * Pro input at $0.33 where full-rate tokens came to $0.37).
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
  if (model.startsWith('claude-haiku-5-5') && inputTokens > 100_000) {
    return Number((
      (inputTokens / 1_000_000) * HAIKU_55_LONG_PROMPT.input +
      (outputTokens / 1_000_000) * HAIKU_55_LONG_PROMPT.output
    ).toFixed(8))
  }
  const cached = model.startsWith('gemini') ? Math.min(Math.max(0, cachedInputTokens), inputTokens) : 0
  const inputCost = ((inputTokens - cached * (1 - GEMINI_CACHED_INPUT_SHARE)) / 1_000_000) * getCostPerToken(model, 'input')
  const outputCost = (outputTokens / 1_000_000) * getCostPerToken(model, 'output')
  return Number((inputCost + outputCost).toFixed(8))
}

// Gemini's web-search charge is counted per search query in ./search-fee.ts (free up to 5,000 a month).
