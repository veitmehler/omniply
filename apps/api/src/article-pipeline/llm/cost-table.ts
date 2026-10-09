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
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.1-pro': { input: 2.00, output: 12.00 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-pro': { input: 0.50, output: 1.50 },

  // Anthropic
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

export function getCostPerToken(model: string, type: 'input' | 'output'): number {
  const entry = COST_TABLE[model]
  if (!entry) return type === 'input' ? 0.50 : 1.50  // conservative unknown fallback per 1M
  return entry[type]
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * getCostPerToken(model, 'input')
  const outputCost = (outputTokens / 1_000_000) * getCostPerToken(model, 'output')
  return Number((inputCost + outputCost).toFixed(8))
}

/**
 * Gemini "Grounding with Google Search" bills a PER-REQUEST fee on top of
 * tokens ($35 per 1,000 grounded requests on the paid tier) — invisible to
 * token math, so every grounded call adds it explicitly (cost audit
 * 2026-10-09: 11 grounded call sites across articles + newsletters).
 */
export const GROUNDED_SEARCH_FEE_USD = 0.035
