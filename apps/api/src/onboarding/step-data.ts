/**
 * Atomic per-key merges into OnboardingSession.stepData.
 *
 * The session JSON has multiple concurrent writers: step commits (request
 * path) and the crawl/synthesis background jobs. A read-modify-write of the
 * whole object loses every key another writer lands in between (observed
 * live 2026-09-14: the synthesis job clobbered q_proof + the logo choice).
 * Postgres `jsonb || jsonb` merges top-level keys in one statement, so each
 * writer only ever asserts its OWN keys.
 */
import { prisma } from '@omniply/shared'

export async function mergeStepData(sessionId: string, patch: Record<string, unknown>): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await prisma.$executeRaw`
    UPDATE onboarding_sessions
    SET "stepData" = "stepData" || ${JSON.stringify(patch)}::jsonb
    WHERE id = ${sessionId}`
}

/** Merge stepData atomically AND move the flow pointer in the same statement. */
export async function mergeStepDataAndStep(
  sessionId: string,
  patch: Record<string, unknown>,
  currentStep: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE onboarding_sessions
    SET "stepData" = "stepData" || ${JSON.stringify(patch)}::jsonb,
        "currentStep" = ${currentStep}
    WHERE id = ${sessionId}`
}
