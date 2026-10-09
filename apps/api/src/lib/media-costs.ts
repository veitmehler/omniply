/**
 * Flat per-unit costs for image/video generation (cost audit 2026-10-09).
 *
 * These providers bill per unit, not per token, so the token cost table
 * can't price them. ALL estimates live HERE — correct a price once and
 * every recorder follows. Recording mirrors the carousel.ts pattern the
 * audit found (the one image site that was already tracked).
 */
import { recordLLMUsage } from './llm-usage'

export const MEDIA_COST_USD = {
  // Gemini image (Nano-Banana family) — matches the established constant
  // in social/compositors/carousel.ts.
  'gemini-image': 0.039,
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
