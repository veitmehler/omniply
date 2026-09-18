/**
 * AI diagram restyle ("Nano Banana") — Phase 1
 *
 * Turns a rendered (square) Mermaid diagram PNG into a polished, on-brand image
 * via Gemini image-to-image. Pure prompt assembly + a single image call with a
 * defensive validation step; on ANY failure it returns null so the caller falls
 * back to the plain Mermaid render. No diagram is ever lost to this step.
 */

import sharp from 'sharp'
import type { LabelCount } from './mermaid-label-lint'
import { generateWithGeminiImage, prisma, buildDiagramStyleGuide } from '@omniply/shared'
import { logger } from '../../lib/logger'

export const RESTYLE_MODEL = 'gemini-3.1-flash-image'

// Gemini image models bill per generated image (~1290 output tokens). We log a
// flat per-image estimate to LLMUsage so diagram restyling shows up in cost
// rollups; it is an estimate, not a metered token count.
export const RESTYLE_COST_USD = 0.039

export interface RestyleContext {
  industry?: string | null
  /** Resolved specialization *label* (e.g. "Family Care"), not the key. */
  specialization?: string | null
  /** Per-business override; falls back to DEFAULT_DIAGRAM_STYLE_GUIDE when empty. */
  styleGuide?: string | null
  /** Brand diagram palette — injected as the mandatory hue set when the
   *  DEFAULT style guide is used (custom guides define their own colors). */
  primaryColor?: string | null
  secondaryColor?: string | null
}

/**
 * Assemble the redesign prompt. `{industry}`/`{specialization}` are interpolated
 * into the task line; a missing specialization simply drops that clause, and a
 * missing industry falls back to a generic "business".
 */
export function buildRestylePrompt(ctx: RestyleContext): string {
  const industry = ctx.industry?.trim()
  const specialization = ctx.specialization?.trim()
  // A custom guide is the author's complete word on style AND color. Otherwise
  // the brand palette is baked directly into the default guide's PALETTE
  // section — an appended "override" paragraph lost against the guide's own
  // gold/violet vocabulary (2026-09-17 finding; the run-5 override attempt
  // still produced gold+purple diagrams).
  const styleGuide = ctx.styleGuide?.trim() || buildDiagramStyleGuide(ctx.primaryColor, ctx.secondaryColor)

  const audience = industry ? `${industry} business` : 'business'
  const specClause = specialization ? ` specializing in: ${specialization}` : ''

  return `# TASK:
please redesign this diagram more stylish for a ${audience}${specClause}. Design appropriately for that audience WITHOUT any branding. Keep it professional, NOT cartoonish.

Output a clean 1:1 SQUARE composition. You MAY rearrange the spatial layout — reflow long horizontal or vertical chains into a balanced arrangement (e.g. grid or radial) that fills the entire square canvas edge-to-edge, with generous, even use of space. For a long linear sequence (many steps in a row), do NOT leave it as one narrow column or row — wrap it into multiple side-by-side columns in reading order (a snake / serpentine flow, top-to-bottom then continuing in the next column) so the steps are large and legible and fill the square. But preserve the EXACT informational flow: every node, every label, every connection, the direction of each arrow, and the overall hierarchy/sequence must remain identical and clearly readable. Never add, remove, rename, or merge anything; reproduce all text verbatim.

${styleGuide}`
}

/**
 * Per-diagram EXACT TEXT INVENTORY block (Veit 2026-09-18): the labels are
 * parsed deterministically from the mermaid source, so the image model gets
 * an authoritative checklist instead of only reading text off the pixels.
 * Count-anchored phrasing — the form this model obeys best.
 */
export function buildInventoryBlock(inventory: LabelCount[]): string {
  if (!inventory.length) return ''
  const lines = inventory
    .map((i) => `- "${i.label}"${i.count > 1 ? ` (appears exactly ${i.count} times)` : ' (appears exactly once)'}`)
    .join('\n')
  return `\n\n## EXACT TEXT INVENTORY (mandatory)
The image contains EXACTLY the following text labels — each appearing exactly the number of times stated, no more, no fewer, spelled exactly as written. The image contains NO other text of any kind.
${lines}`
}

/**
 * Retry feedback, phrased as positive exactly-once assertions — never as
 * negations (image models raise the salience of concretely-named content in
 * negative prompts).
 */
export function buildRetryFeedbackBlock(issues: string[]): string {
  if (!issues.length) return ''
  const lines = issues.map((i) => `- ${i}`).join('\n')
  return `\n\n## PREVIOUS ATTEMPT CORRECTION
A previous attempt violated the text inventory in these ways:
${lines}
Follow the EXACT TEXT INVENTORY above precisely — every label appears exactly the stated number of times, and nothing else is written.`
}

export interface RestyleDiagramInput {
  /** The square, padded diagram PNG (Gemini input + canvas reference). */
  squarePng: Buffer
  prompt: string
  geminiKey: string
  model?: string
  /** For LLMUsage attribution. */
  userId: string
  jobId?: string
}

/**
 * Restyle one diagram. Returns the stylized PNG buffer, or null when the model
 * refuses / errors / returns something undecodable — caller then keeps the
 * Mermaid render.
 */
export async function restyleDiagram(input: RestyleDiagramInput): Promise<{ png: Buffer } | null> {
  const model = input.model ?? RESTYLE_MODEL
  try {
    const raw = await generateWithGeminiImage(
      input.geminiKey,
      input.prompt,
      model,
      '1:1',
      { mimeType: 'image/png', data: input.squarePng.toString('base64') },
    )

    // Defensive: ensure it's a real, decodable raster before we trust it.
    if (!raw || raw.length === 0) {
      logger.warn({ jobId: input.jobId }, '[diagram-restyle] empty buffer — falling back to Mermaid')
      return null
    }
    const meta = await sharp(raw).metadata()
    if (!meta.width || !meta.height) {
      logger.warn({ jobId: input.jobId }, '[diagram-restyle] undecodable image — falling back to Mermaid')
      return null
    }

    // Log cost (best-effort; never block the diagram on a usage-write failure).
    try {
      await prisma.lLMUsage.create({
        data: {
          userId: input.userId,
          source: 'article_diagram_restyle',
          provider: 'gemini',
          model,
          inputTokens: 0,
          outputTokens: 0,
          cost: RESTYLE_COST_USD,
        },
      })
    } catch (usageErr) {
      logger.warn({ jobId: input.jobId, usageErr }, '[diagram-restyle] LLMUsage write failed (non-fatal)')
    }

    return { png: raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ jobId: input.jobId, msg }, '[diagram-restyle] generation failed — falling back to Mermaid')
    return null
  }
}
