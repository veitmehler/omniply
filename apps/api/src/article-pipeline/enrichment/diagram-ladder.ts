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

    logger.info(
      { jobId: input.jobId, position: input.position, attempt, model },
      '[enrichment] restyle passed fidelity verify',
    )
    return restyled.png
  }
  return null
}
