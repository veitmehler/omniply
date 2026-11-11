/**
 * The restyle escalation ladder (Veit 2026-09-18) as ONE shared function so
 * the enrichment pipeline and any targeted re-run use identical logic:
 *
 *   attempt 1 — flash (inventory prompt)
 *   attempt 2 — flash + verify-feedback rescue
 *   attempt 3 — Nano Banana Pro (+ accumulated feedback)
 *
 * Every attempt is fidelity-verified against the mermaid-derived label
 * inventory; rejected images are persisted for forensics; refusals consume
 * an attempt. Returns the winning PNG or null (→ Mermaid fallback).
 */
import { uploadBufferWithKey } from '@omniply/shared'
import { logger } from '../../lib/logger'
import {
  restyleDiagram,
  buildInventoryBlock,
  buildRetryFeedbackBlock,
  LADDER_MODELS,
  contentOccupancy,
  OCCUPANCY_MIN,
} from './diagram-restyle'
import { verifyRestyledDiagram } from './diagram-verify'
import { extractLabelInventory } from './mermaid-label-lint'

export interface LadderInput {
  squarePng: Buffer
  basePrompt: string
  mermaidSyntax: string
  geminiKey: string
  userId: string
  jobId: string
  position: number
}

export async function runRestyleLadder(input: LadderInput): Promise<Buffer | null> {
  const inventory = extractLabelInventory(input.mermaidSyntax)
  const inventoryBlock = buildInventoryBlock(inventory)
  let lastIssues: string[] = []
  // Fidelity-correct but floating in empty canvas: kept as the fallback winner so a
  // small-but-right image never loses to the Mermaid render (soft gate).
  let soft: { png: Buffer; score: number } | null = null

  for (let attempt = 1; attempt <= LADDER_MODELS.length; attempt++) {
    const model = LADDER_MODELS[attempt - 1]
    const restyled = await restyleDiagram({
      squarePng: input.squarePng,
      prompt: input.basePrompt + inventoryBlock + buildRetryFeedbackBlock(lastIssues),
      geminiKey: input.geminiKey,
      userId: input.userId,
      jobId: input.jobId,
      model,
    })
    if (!restyled) continue // refusal/error — logged inside; burn the attempt

    const check = await verifyRestyledDiagram({
      geminiKey: input.geminiKey,
      sourcePng: input.squarePng,
      restyledPng: restyled.png,
      jobId: input.jobId,
      expectedLabels: inventory.length ? inventory : undefined,
    })
    if (check.verdict === 'fail') {
      lastIssues = check.issues
      let rejectedUrl: string | null = null
      try {
        const rejKey = `articles/${input.userId}/${input.jobId}/diagrams/${input.position}-rejected-a${attempt}.png`
        await uploadBufferWithKey(rejKey, restyled.png, 'image/png')
        rejectedUrl = rejKey
      } catch {
        /* forensics never block the pipeline */
      }
      logger.warn(
        { jobId: input.jobId, position: input.position, attempt, model, issues: check.issues, rejectedUrl },
        attempt < LADDER_MODELS.length
          ? '[enrichment] restyle failed fidelity verify — escalating'
          : '[enrichment] restyle failed fidelity verify on final ladder rung — keeping Mermaid render',
      )
      continue
    }

    const occ = await contentOccupancy(restyled.png)
    if (occ && (occ.width < OCCUPANCY_MIN || occ.height < OCCUPANCY_MIN)) {
      const score = Math.min(occ.width, occ.height)
      if (!soft || score > soft.score) soft = { png: restyled.png, score }
      lastIssues = [
        `The diagram occupies only ${Math.round(occ.width * 100)}% of the canvas width and ${Math.round(occ.height * 100)}% of its height. Enlarge the whole composition (bigger nodes, larger type, wider spacing) so it spans at least 85% of both, with margins under 8% per side. Keep every node, label and connection exactly as they are.`,
      ]
      logger.warn(
        { jobId: input.jobId, position: input.position, attempt, model, occupancy: occ },
        attempt < LADDER_MODELS.length ? '[enrichment] restyle floats in empty canvas — re-rendering larger' : '[enrichment] restyle still small on final rung — keeping best attempt',
      )
      continue
    }

    logger.info(
      { jobId: input.jobId, position: input.position, attempt, model, occupancy: occ },
      '[enrichment] restyle passed fidelity verify',
    )
    return restyled.png
  }
  return soft ? soft.png : null
}
