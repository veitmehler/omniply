/**
 * Triage pending RawReviews: is this a specific client story, or generic
 * praise? Real stories are rewritten de-identified and promoted to
 * ClientStory. See .plans/client-story-review-mining.implementation-plan.md
 * Phase 4.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { runNewsletterJsonPrompt } from '../../newsletter/llm'
import { syncProofPool } from './beats'

interface TriageJson {
  isStory?: boolean
  storyText?: string
  topicTags?: string[]
}

/** Triage every `pending` RawReview for an account, promoting real stories to ClientStory. */
export async function triagePendingReviews(accountId: string, reviewIds: string[]): Promise<void> {
  if (reviewIds.length === 0) return

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  const brand = account?.ownerUserId ? await brandSettingsForUser(account.ownerUserId) : null
  const industry = brand?.industry ?? ''

  const reviews = await prisma.rawReview.findMany({
    where: { id: { in: reviewIds }, triageStatus: 'pending' },
  })

  for (const review of reviews) {
    try {
      const { data } = await runNewsletterJsonPrompt<TriageJson>('cs_story_triage', {
        reviewText: review.reviewText,
        industry,
      })

      if (data.isStory && data.storyText?.trim()) {
        await prisma.$transaction([
          prisma.clientStory.create({
            data: {
              accountId,
              storyText: data.storyText.trim(),
              topicTags: Array.isArray(data.topicTags)
                ? data.topicTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                : [],
              sourceReviewId: review.id,
              source: 'review',
              kind: 'client_case',
              originalText: review.reviewText,
              sourceHash: review.fingerprint,
            },
          }),
          prisma.rawReview.update({ where: { id: review.id }, data: { triageStatus: 'story' } }),
        ])
      } else {
        await prisma.rawReview.update({ where: { id: review.id }, data: { triageStatus: 'not_story' } })
      }
    } catch (err) {
      logger.warn({ accountId, reviewId: review.id, err }, '[client-stories/triage] triage failed for one review — left pending')
    }
  }
  await syncProofPool(accountId).catch((err) => logger.warn({ accountId, err }, '[client-stories/triage] proof pool sync failed'))
}
