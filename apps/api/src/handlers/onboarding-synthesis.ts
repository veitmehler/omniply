/**
 * Brand-profile synthesis job (onboarding plan Phase 4).
 *
 * Enqueued when the fifth question commits. Needs the crawl corpus; if the
 * crawl is still running it re-enqueues itself (up to ~2 min) rather than
 * blocking a worker slot. Writes brandProfileDraft + synthesisDone
 * into the session so the confirm steps go live.
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { getBoss, QUEUES } from '../queues/index'
import { synthesizeBrandProfile, generateClinicFaqs, type VoiceAnswers } from '../onboarding/synthesis'
import type { SpecializationDraft } from '../onboarding/site-analysis'
import { mergeStepData } from '../onboarding/step-data'

export interface OnboardingSynthesisJobData {
  accountId: string
  attempt?: number
}

const MAX_WAIT_ATTEMPTS = 8 // × 15s = 2 min of crawl patience

function answerText(stepData: Record<string, unknown>, key: string): string | undefined {
  const a = stepData[key] as { text?: string } | undefined
  return a?.text?.trim() || undefined
}

export async function onboardingSynthesisHandler(jobs: PgBoss.Job<OnboardingSynthesisJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { accountId, attempt = 0 } = job.data
    const session = await prisma.onboardingSession.findUnique({ where: { accountId } })
    if (!session) continue
    const stepData = (session.stepData as Record<string, unknown>) ?? {}
    if (stepData.synthesisDone) continue

    if (!stepData.crawlDone && attempt < MAX_WAIT_ATTEMPTS) {
      const boss = await getBoss()
      await boss.send(
        QUEUES.ONBOARDING_SYNTHESIS,
        { accountId, attempt: attempt + 1 },
        { startAfter: 15, singletonKey: `onboarding-synthesis-${accountId}-${attempt + 1}` },
      )
      continue
    }

    const geminiKey = await getSystemApiKey('gemini')
    if (!geminiKey) {
      logger.error({ accountId }, '[onboarding-synthesis] no gemini key — profile stays manual')
      stepData.synthesisDone = true
    } else {
      const answers: VoiceAnswers = {
        declaration: answerText(stepData, 'q_declaration'),
        enemy: answerText(stepData, 'q_enemy'),
        tribe: answerText(stepData, 'q_tribe'),
        line: answerText(stepData, 'q_line'),
        proof: answerText(stepData, 'q_proof'),
      }
      try {
        const profile = await synthesizeBrandProfile(
          geminiKey,
          (stepData.corpus as string) ?? '',
          answers,
          (stepData.specializationDraft as SpecializationDraft) ?? null,
        )
        stepData.brandProfileDraft = profile as unknown as Record<string, unknown>
        // Logistics-only FAQ pairs for FAQPage schema (agent plan 3.1) —
        // persisted to brandSettings at brand-profile commit.
        stepData.clinicFaqsDraft = (await generateClinicFaqs(geminiKey, (stepData.corpus as string) ?? '').catch(
          () => [],
        )) as unknown as Record<string, unknown>[]
      } catch (err) {
        logger.error({ accountId, err }, '[onboarding-synthesis] synthesis failed — manual profile entry')
      }
      stepData.synthesisDone = true
    }

    // Merge ONLY the keys this job owns (lost-update fix: this exact write
    // clobbered q_proof + the logo choice on the 2026-09-14 live E2E).
    const OWN_KEYS = ['synthesisDone', 'brandProfileDraft', 'clinicFaqsDraft'] as const
    const patch: Record<string, unknown> = {}
    for (const k of OWN_KEYS) if (stepData[k] !== undefined) patch[k] = stepData[k]
    await mergeStepData(session.id, patch)
    logger.info({ accountId, hasProfile: !!stepData.brandProfileDraft }, '[onboarding-synthesis] done')
  }
}
