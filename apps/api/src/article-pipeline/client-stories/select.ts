/**
 * Select + inject a client story into an article topic's `realCaseStudies`
 * field, if it doesn't already have one. See
 * .plans/client-story-review-mining.implementation-plan.md Phase 7. Called at
 * the very start of the article pipeline (executor.ts), before step 0 —
 * mirrors how the newsletter override plan's ensureTopicDraft hooks in before
 * ensureTopicResearch.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'

const ONCE_A_MONTH_MS = 30 * 24 * 60 * 60 * 1000

function scoreOverlap(topicTags: string[], topicText: string): number {
  const haystack = topicText.toLowerCase()
  return topicTags.reduce((score, tag) => (haystack.includes(tag.toLowerCase()) ? score + 1 : score), 0)
}

export interface StoryCandidate {
  id: string
  storyText: string
  topicTags: string[]
  kind: string
  source: string
  lastUsedAt: Date | null
  useCount: number
}

/**
 * One story per article (Veit 2026-11-11). Order: the best-matching client case,
 * then the best-matching owner moment, then — so an article never goes without a
 * real story while the bank has one — the least-used onboarding beat. Review
 * stories with no topic overlap are still skipped: a mismatched review case reads
 * worse than none.
 */
export function pickStory(candidates: StoryCandidate[], topicText: string): StoryCandidate | null {
  const scored = candidates.map((c) => ({ c, score: scoreOverlap(c.topicTags, topicText) }))
  const byScore = (a: { score: number; c: StoryCandidate }, b: { score: number; c: StoryCandidate }) =>
    b.score - a.score || a.c.useCount - b.c.useCount || (a.c.lastUsedAt?.getTime() ?? 0) - (b.c.lastUsedAt?.getTime() ?? 0)
  const cases = scored.filter((x) => x.c.kind === 'client_case' && x.score > 0).sort(byScore)
  if (cases[0]) return cases[0].c
  const moments = scored.filter((x) => x.c.kind === 'owner_moment' && x.score > 0).sort(byScore)
  if (moments[0]) return moments[0].c
  const onboarding = scored.filter((x) => x.c.source === 'onboarding').sort(byScore)
  return onboarding[0]?.c ?? null
}

/**
 * If `topic.realCaseStudies` is empty, pick the best-matching unused-this-month
 * ClientStory for the account and write it in. Never overwrites a user-provided
 * value. No-op if the bank has nothing usable — the article prompts' existing
 * empty-fallback ("write a generalised illustrative example") handles that.
 */
export async function injectClientStory(topicId: string): Promise<void> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, topic: true, realCaseStudies: true, userId: true },
  })
  if (!topic || topic.realCaseStudies?.trim()) return // user already has one — never overwrite

  const accountId = await prisma.user.findUnique({ where: { id: topic.userId }, select: { accountId: true } })
  if (!accountId?.accountId) return

  const candidates = await prisma.clientStory.findMany({
    where: {
      accountId: accountId.accountId,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - ONCE_A_MONTH_MS) } }],
    },
    select: { id: true, storyText: true, topicTags: true, kind: true, source: true, lastUsedAt: true, useCount: true },
  })
  if (candidates.length === 0) return

  const best = pickStory(candidates, topic.topic)
  if (!best) return

  await prisma.$transaction([
    prisma.topic.update({ where: { id: topicId }, data: { realCaseStudies: best.storyText } }),
    prisma.clientStory.update({
      where: { id: best.id },
      data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
    }),
  ])
  logger.info({ topicId, clientStoryId: best.id }, '[client-stories/select] injected client story into topic')
}
