/**
 * Flat per-unit costs for image/video generation (cost audit 2026-10-09).
 *
 * These providers bill per unit, not per token, so the token cost table
 * can't price them. ALL estimates live HERE — correct a price once and
 * every recorder follows. Recording mirrors the carousel.ts pattern the
 * audit found (the one image site that was already tracked).
 */
import { recordLLMUsage } from './llm-usage'
import { recordProviderSpend } from './net/call-stats'

export const MEDIA_COST_USD = {
  // Gemini 3.1 Flash Image, one 1K image. Google's pricing page (read 2026-11-25): "$0.067 per 1K image";
  // its own report for 2026-11-24 billed six images at $0.40. The earlier $0.039 was the retired 2.5 rate.
  'gemini-image': 0.067,
  // fal.ai models (estimates from fal pricing pages; adjust here).
  'fal-flux-pro': 0.05,
  'fal-flux-schnell': 0.003,
  'fal-recraft': 0.04,
  'fal-seedance-video': 0.186,
} as const

export type MediaKind = keyof typeof MEDIA_COST_USD

/** One llm_usage row per generated asset; never throws. */
export async function recordMediaCost(
  userId: string | null | undefined,
  source: string,
  kind: MediaKind,
  model: string,
): Promise<void> {
  await recordLLMUsage(userId, source, {
    content: '',
    tokens: { input: 0, output: 0, total: 0 },
    cost: MEDIA_COST_USD[kind],
    model,
    provider: kind.startsWith('fal') ? 'fal-ai' : 'gemini',
    finishReason: 'stop',
  })
}

/** Flat estimate for one generated asset, by provider and model id. */
export function mediaCostFor(provider: 'gemini' | 'fal-ai', model: string): number {
  if (provider === 'gemini') return MEDIA_COST_USD['gemini-image']
  const m = model.toLowerCase()
  if (m.includes('seedance')) return MEDIA_COST_USD['fal-seedance-video']
  if (m.includes('schnell')) return MEDIA_COST_USD['fal-flux-schnell']
  if (m.includes('recraft')) return MEDIA_COST_USD['fal-recraft']
  if (m.includes('birefnet')) return 0.002 // background removal, priced per megapixel; small
  return MEDIA_COST_USD['fal-flux-pro']
}

/**
 * Count one generated asset in the spend ledger (ProviderSpend). Registered as
 * the shared image helpers' listener at boot, and called directly by the three
 * sites that talk to fal without the helper.
 */
export function recordMediaSpend(provider: 'gemini' | 'fal-ai', model: string): void {
  recordProviderSpend(provider, model, mediaCostFor(provider, model))
}
