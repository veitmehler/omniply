/**
 * Outline framework auto-assignment.
 *
 * When a topic is created without an explicit outlineFrameworkNumber the
 * pipeline calls `assignOutlineFramework`, which makes a lightweight GPT-4o-mini
 * call to pick the best-matching framework from the active list.
 *
 * The result is persisted on the Topic row with source='llm_assigned'.
 * If the LLM call fails for any reason we fall back to framework #1 silently.
 */

import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getLLMAdapter } from './llm/factory'
import { recordLLMUsage } from '../lib/llm-usage'
import { getSystemApiKey } from '../lib/system-keys'

const ASSIGNMENT_PROVIDER = 'openai' as const
const ASSIGNMENT_MODEL = 'gpt-4o-mini'

// Build a compact framework menu for the LLM prompt
function buildFrameworkMenu(
  frameworks: Array<{ number: number; label: string; description: string | null }>,
): string {
  return frameworks
    .map((f) => `${f.number}. ${f.label}${f.description ? ` — ${f.description}` : ''}`)
    .join('\n')
}

/**
 * Ensures the given topic has an outline framework assigned.
 * - If `outlineFrameworkNumber` is already set, does nothing.
 * - Otherwise runs an LLM pre-flight and persists the result.
 *
 * Safe to call from `POST /api/topics` and the CSV importer.
 */
export async function assignOutlineFramework(topicId: string): Promise<void> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { topic: true, outlineFrameworkNumber: true },
  })

  if (!topic) {
    logger.warn({ topicId }, '[outline-assignment] topic not found')
    return
  }

  // Already assigned — nothing to do
  if (topic.outlineFrameworkNumber != null) return

  const frameworks = await prisma.outlineFramework.findMany({
    where: { isActive: true },
    orderBy: { number: 'asc' },
    select: { number: true, label: true, description: true },
  })

  if (frameworks.length === 0) {
    logger.warn({ topicId }, '[outline-assignment] no active frameworks — skipping assignment')
    return
  }

  // If there is only one framework, assign it directly without an LLM call
  if (frameworks.length === 1) {
    await prisma.topic.update({
      where: { id: topicId },
      data: { outlineFrameworkNumber: frameworks[0].number, outlineFrameworkSource: 'llm_assigned' },
    })
    return
  }

  // Guard: skip LLM call if no key is available to avoid a hard failure
  const hasKey = !!(await getSystemApiKey(ASSIGNMENT_PROVIDER))
  if (!hasKey) {
    logger.warn({ topicId }, '[outline-assignment] no OpenAI key — falling back to framework #1')
    await prisma.topic.update({
      where: { id: topicId },
      data: { outlineFrameworkNumber: frameworks[0].number, outlineFrameworkSource: 'llm_assigned' },
    })
    return
  }

  const menu = buildFrameworkMenu(frameworks)
  const userPrompt = `You are an expert content strategist. Select the SINGLE best outline framework number for the following article topic.

TOPIC:
${topic.topic}

AVAILABLE FRAMEWORKS:
${menu}

Rules:
- Reply with ONLY the integer number of the chosen framework (e.g. "3").
- Do not explain your choice.
- Choose the framework that best matches the topic's intent, audience, and format.`

  try {
    const adapter = getLLMAdapter(ASSIGNMENT_PROVIDER)
    const response = await adapter.call({
      userPrompt,
      model: ASSIGNMENT_MODEL,
      temperature: 0,
      maxTokens: 10,
    })

    const owner = await prisma.topic.findUnique({ where: { id: topicId }, select: { userId: true } })
    await recordLLMUsage(owner?.userId, 'outline_assignment', response)

    const rawNumber = parseInt(response.content.trim(), 10)
    const chosen = isNaN(rawNumber) ? null : frameworks.find((f) => f.number === rawNumber)

    if (chosen) {
      await prisma.topic.update({
        where: { id: topicId },
        data: {
          outlineFrameworkNumber: chosen.number,
          outlineFrameworkSource: 'llm_assigned',
        },
      })
      logger.info(
        { topicId, frameworkNumber: chosen.number, rawResponse: response.content.trim() },
        '[outline-assignment] LLM assigned framework',
      )
    } else {
      logger.warn(
        { topicId, rawResponse: response.content.trim() },
        '[outline-assignment] LLM returned unrecognised number — falling back to first framework',
      )
      await prisma.topic.update({
        where: { id: topicId },
        data: { outlineFrameworkNumber: frameworks[0].number, outlineFrameworkSource: 'llm_assigned' },
      })
    }
  } catch (err) {
    logger.warn(
      { topicId, err },
      '[outline-assignment] LLM call failed — falling back to framework #1',
    )
    await prisma.topic.update({
      where: { id: topicId },
      data: { outlineFrameworkNumber: frameworks[0].number, outlineFrameworkSource: 'llm_assigned' },
    })
  }
}
