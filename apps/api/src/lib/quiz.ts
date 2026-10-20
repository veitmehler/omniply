/**
 * Vertical-aware quiz dispatch (wellness plan Phase 3): clinics get the
 * 2-Minute Spine Check, wellness studios get the Biological Age Check.
 * One lookup point so onboarding, linktree and trigger-link repoints all
 * agree on which quiz an account owns.
 */
import { prisma } from '@omniply/shared'
import { publishSpineCheckPage, spineCheckUrlForUser } from '../spine-check/generate'
import { publishAgeCheckPage, ageCheckUrlForUser } from '../age-check/generate'

async function verticalForOwner(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { account: { select: { vertical: true } } },
  })
  return user?.account?.vertical ?? 'chiro'
}

export async function quizUrlForUser(userId: string): Promise<string | null> {
  return (await verticalForOwner(userId)) === 'wellness' ? ageCheckUrlForUser(userId) : spineCheckUrlForUser(userId)
}

export async function publishQuizPage(userId: string): Promise<string | null> {
  return (await verticalForOwner(userId)) === 'wellness' ? publishAgeCheckPage(userId) : publishSpineCheckPage(userId)
}

export function quizLinkLabel(vertical: string): string {
  return vertical === 'wellness' ? 'Take the Biological Age Check' : 'Take the 2-Minute Spine Check'
}

/** Label + URL in one call (linktree's shape). */
export async function quizLinkForUser(userId: string): Promise<{ label: string; url: string } | null> {
  const vertical = await verticalForOwner(userId)
  const url = vertical === 'wellness' ? await ageCheckUrlForUser(userId) : await spineCheckUrlForUser(userId)
  return url ? { label: quizLinkLabel(vertical), url } : null
}
