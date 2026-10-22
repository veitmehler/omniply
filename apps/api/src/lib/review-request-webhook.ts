/**
 * omniply_review_request_webhook custom value (AI Employee dashboard):
 * the per-location URL the snapshot's review-request workflow posts to on
 * every send. Reuses ghlReviewToken — same account-scoped workflow-sink
 * posture as the review-received webhook, different path. Written at
 * auto-provision (new accounts) and at the onboarding finale (belt for
 * accounts born before this feature).
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { getGhlCredentials } from './ghl/settings'
import { upsertGhlCustomValue } from './ghl/client'

const API_PUBLIC_BASE = (process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io').replace(/\/$/, '')

export async function writeReviewRequestWebhookValue(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
    if (!user?.accountId) return false
    let account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { ghlReviewToken: true },
    })
    if (!account?.ghlReviewToken) {
      await prisma.account.update({
        where: { id: user.accountId },
        data: { ghlReviewToken: randomBytes(24).toString('base64url') },
      })
      account = await prisma.account.findUnique({ where: { id: user.accountId }, select: { ghlReviewToken: true } })
    }
    if (!account?.ghlReviewToken) return false
    const creds = await getGhlCredentials(userId)
    if (!creds) return false
    await upsertGhlCustomValue(
      creds.apiKey,
      creds.locationId,
      'omniply_review_request_webhook',
      `${API_PUBLIC_BASE}/api/ghl/review-requests/${account.ghlReviewToken}`,
    )
    logger.info({ userId }, '[review-request-webhook] custom value written')
    return true
  } catch (err) {
    logger.warn({ userId, err }, '[review-request-webhook] custom value write failed (non-fatal)')
    return false
  }
}
