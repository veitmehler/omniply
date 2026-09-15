/**
 * GHL billing event → account lifecycle transitions (multi-tenancy plan Phase B).
 *
 * - payment_cleared: status → active, RE-ANCHOR subscriptionStartedAt to the
 *   payment date (a reactivation after a gap is just a payment — the new cycle
 *   starts now), paidThrough → +cycleDays (+grace), re-date stale preplanned
 *   topics after a gap, then auto-burst the current window's planned content.
 * - payment_failed: status → paused (GHL's `Overdue` fires on the FIRST failed
 *   attempt; the cost door closes immediately, in step with GHL's own
 *   subaccount suspension).
 * - cancelled: status → cancelled. paidThrough is left untouched — publishing
 *   runs out the paid period naturally (paidThrough governs publishing).
 */
import { prisma } from '@omniply/shared'
import type { ResolvedAccount } from '@omniply/shared'
import { logger } from './logger'
import { billingWindows } from '../article-pipeline/billing-window'
import { createBatchFromDates, advanceBatch } from '../article-pipeline/content-batch'
import { hasArticleCadenceDate, checkArticleGenerationGate } from '../article-pipeline/client-stories/gate'

const MS_PER_DAY = 86_400_000
export const CYCLE_DAYS = 30
/** Slack on paidThrough so a slow renewal never parks scheduled posts. */
export const PAID_THROUGH_GRACE_DAYS = 3

export type BillingEventType = 'payment_cleared' | 'payment_failed' | 'cancelled'

export const BILLING_EVENT_TYPES: readonly BillingEventType[] = [
  'payment_cleared',
  'payment_failed',
  'cancelled',
]

/** Same-type events inside this window are treated as webhook retries. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

export interface ApplyResult {
  applied: boolean
  duplicate: boolean
  burst?: { batchId: string; itemCount: number } | null
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * After a payment gap of more than one cycle, preplanned-but-never-generated
 * topics carry stale (past) dates. Re-date them into the new window, keeping
 * each topic's day-offset within its cycle. Collisions with an existing topic
 * on the target date are skipped (the fresher plan wins).
 */
async function redateStaleTopics(
  account: { id: string },
  ownerUserId: string,
  oldAnchor: Date,
  newAnchor: Date,
): Promise<void> {
  const gapMs = newAnchor.getTime() - oldAnchor.getTime()
  if (gapMs <= (CYCLE_DAYS + PAID_THROUGH_GRACE_DAYS) * MS_PER_DAY) return // normal renewal — dates already line up

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Account-owned article topics: past-dated, never generated.
  const staleTopics = await prisma.topic.findMany({
    where: {
      userId: ownerUserId, // account-scoped extension → all members
      scheduledDate: { lt: today, gte: oldAnchor },
      status: { not: 'idea' },
      articleJobs: { none: { status: { not: 'failed' } } },
    },
    select: { id: true, scheduledDate: true },
  })

  let moved = 0
  for (const t of staleTopics) {
    if (!t.scheduledDate) continue
    const offsetDays =
      Math.floor((t.scheduledDate.getTime() - oldAnchor.getTime()) / MS_PER_DAY) % CYCLE_DAYS
    const newDate = new Date(newAnchor.getTime() + offsetDays * MS_PER_DAY)
    newDate.setUTCHours(0, 0, 0, 0)
    const clash = await prisma.topic.findFirst({
      where: {
        userId: ownerUserId,
        scheduledDate: { gte: newDate, lt: new Date(newDate.getTime() + MS_PER_DAY) },
        status: { not: 'idea' },
        id: { not: t.id },
      },
      select: { id: true },
    })
    if (clash) continue
    await prisma.topic.update({
      where: { id: t.id },
      data: { scheduledDate: newDate, publishingDate: newDate },
    })
    moved++
  }

  // Account newsletter-topic overrides: past-dated, no non-failed newsletter.
  const staleOverrides = await prisma.newsletterTopic.findMany({
    where: {
      accountId: account.id,
      date: { lt: today, gte: oldAnchor },
      newsletters: { none: { status: { notIn: ['failed', 'pending'] } } },
    },
    select: { id: true, date: true },
  })
  let movedNl = 0
  for (const nt of staleOverrides) {
    const offsetDays = Math.floor((nt.date.getTime() - oldAnchor.getTime()) / MS_PER_DAY) % CYCLE_DAYS
    const newDate = new Date(newAnchor.getTime() + offsetDays * MS_PER_DAY)
    newDate.setUTCHours(0, 0, 0, 0)
    try {
      await prisma.newsletterTopic.update({ where: { id: nt.id }, data: { date: newDate } })
      movedNl++
    } catch {
      // @@unique(accountId, date) collision — the fresher override wins.
    }
  }

  if (moved || movedNl) {
    logger.info(
      { accountId: account.id, topicsMoved: moved, overridesMoved: movedNl },
      '[account-lifecycle] re-dated stale preplanned topics into the new cycle',
    )
  }
}

/**
 * Auto-burst the (re-anchored) current window: every future day through
 * executableUntil is offered to createBatchFromDates, which resolves which
 * days actually have planned content and skips the rest. Implements the
 * "generate when a cycle's payment clears" behavior.
 */
export async function burstCurrentWindow(
  accountId: string,
  opts?: { skipStoryGate?: boolean },
): Promise<{ batchId: string; itemCount: number } | null> {
  const acct = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, ownerUserId: true, subscriptionStartedAt: true },
  })
  if (!acct?.ownerUserId || !acct.subscriptionStartedAt) return null

  const members = await prisma.user.findMany({ where: { accountId }, select: { id: true } })
  const resolved: ResolvedAccount = {
    userId: acct.ownerUserId,
    ownerUserId: acct.ownerUserId,
    accountId,
    memberUserIds: members.map((m) => m.id),
  }

  const w = billingWindows(acct.subscriptionStartedAt)
  const start = new Date(Math.max(Date.now(), w.from.getTime()))
  start.setUTCHours(0, 0, 0, 0)
  const dates: string[] = []
  for (let d = start.getTime(); d <= w.executableUntil.getTime(); d += MS_PER_DAY) {
    dates.push(dateKey(new Date(d)))
  }
  if (dates.length === 0) return null

  // Client-story gate parity with the dashboard generate route: if the account
  // has a GBP configured and this cycle's review spidering hasn't finished,
  // skip the auto-burst (the check itself starts the spider run; the dashboard
  // button remains available once it completes).
  // The FIRST burst (onboarding finale) skips the client-story gate (Veit
  // decision 2026-09-15): a brand-new clinic has no mined stories either way,
  // the deferral has no auto-retry, and a GHL-embedded client has no button
  // to re-trigger — the live E2E dead-ended exactly here. Billing-cycle
  // bursts keep the gate (its actual purpose).
  if (!opts?.skipStoryGate && hasArticleCadenceDate(dates)) {
    const brand = await prisma.brandSettings.findFirst({
      where: { user: { accountId } },
      select: { googleBusinessProfileUrl: true },
    })
    if (brand?.googleBusinessProfileUrl?.trim()) {
      const waitMessage = await checkArticleGenerationGate(accountId, w.from)
      if (waitMessage) {
        logger.info({ accountId, waitMessage }, '[account-lifecycle] burst deferred by client-story gate')
        return null
      }
    }
  }

  const created = await createBatchFromDates(resolved, dates)
  if (!created) return null
  await advanceBatch(created.batchId)
  logger.info(
    { accountId, batchId: created.batchId, itemCount: created.itemCount },
    '[account-lifecycle] payment-cleared burst started',
  )
  return created
}

/** Apply one billing event to an account. Records the event row (always) and
 *  suppresses same-type retries inside DUPLICATE_WINDOW_MS. */
export async function applyBillingEvent(
  accountId: string,
  type: BillingEventType,
  raw?: unknown,
): Promise<ApplyResult> {
  const recent = await prisma.ghlBillingEvent.findFirst({
    where: { accountId, type, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }, duplicate: false },
    select: { id: true },
  })
  const duplicate = !!recent
  await prisma.ghlBillingEvent.create({
    data: { accountId, type, duplicate, raw: raw === undefined ? undefined : (raw as object) },
  })
  if (duplicate) {
    logger.info({ accountId, type }, '[account-lifecycle] duplicate event suppressed')
    return { applied: false, duplicate: true }
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, ownerUserId: true, subscriptionStartedAt: true, status: true },
  })
  if (!account) return { applied: false, duplicate: false }

  const now = new Date()

  if (type === 'payment_failed') {
    await prisma.account.update({
      where: { id: accountId },
      data: { status: 'paused', statusChangedAt: now },
    })
    logger.warn({ accountId }, '[account-lifecycle] payment failed — account paused')
    return { applied: true, duplicate: false }
  }

  if (type === 'cancelled') {
    await prisma.account.update({
      where: { id: accountId },
      data: { status: 'cancelled', statusChangedAt: now },
    })
    logger.warn({ accountId }, '[account-lifecycle] subscription cancelled — paidThrough runs out naturally')
    return { applied: true, duplicate: false }
  }

  // payment_cleared
  const oldAnchor = account.subscriptionStartedAt
  await prisma.account.update({
    where: { id: accountId },
    data: {
      status: 'active',
      statusChangedAt: now,
      subscriptionStartedAt: now, // re-anchor: the paid cycle starts at the payment
      paidThrough: new Date(now.getTime() + (CYCLE_DAYS + PAID_THROUGH_GRACE_DAYS) * MS_PER_DAY),
    },
  })
  logger.info({ accountId, reAnchoredFrom: oldAnchor }, '[account-lifecycle] payment cleared — account active, cycle re-anchored')

  if (oldAnchor && account.ownerUserId) {
    await redateStaleTopics(account, account.ownerUserId, oldAnchor, now).catch((err) =>
      logger.error({ accountId, err }, '[account-lifecycle] re-dating failed (non-fatal)'),
    )
  }

  const burst = await burstCurrentWindow(accountId).catch((err) => {
    logger.error({ accountId, err }, '[account-lifecycle] payment burst failed (non-fatal — dashboard generate still works)')
    return null
  })

  return { applied: true, duplicate: false, burst }
}
