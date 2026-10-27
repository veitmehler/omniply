/**
 * Re-resolve held Stripe billing events (every 10 minutes).
 *
 * A subscription_create invoice can arrive seconds BEFORE provisioning
 * finishes creating the purchased location's account (measured: 5s on a real
 * purchase), so first events legitimately miss. They are held in
 * stripe_events (matched=false) and re-resolved here through the immutable
 * chain (subscription id → GHL SaaS API → location → account).
 *
 * On a late match the event is applied to the lifecycle only while it is
 * still fresh (≤48h): applying an old payment_cleared would re-anchor
 * paidThrough to "now + cycle" and gift unpaid days. Older matches bind the
 * identity only and say so in the log.
 *
 * Events still unmatched after 24h raise ONE ops alert (window-based: the
 * alert fires in the cron pass where the event crosses 24h of age).
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { sendFailureAlert } from '../lib/alerts'
import { applyBillingEvent, type BillingEventType } from '../lib/account-lifecycle'
import { extractFields, resolveAccount, bindStripeIdentity } from '../lib/stripe-resolve'

const RERESOLVE_WINDOW_DAYS = 30
const APPLY_FRESH_HOURS = 48
const ALERT_AGE_MS = 24 * 60 * 60 * 1000
const CRON_INTERVAL_MS = 10 * 60 * 1000

const EVENT_MAP: Record<string, BillingEventType> = {
  'invoice.payment_succeeded': 'payment_cleared',
  'invoice.payment_failed': 'payment_failed',
  'customer.subscription.deleted': 'cancelled',
  'customer.subscription.paused': 'payment_failed',
  'customer.subscription.resumed': 'payment_cleared',
}

export async function stripeEventReresolveHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
  const now = Date.now()
  const held = await prisma.stripeEvent.findMany({
    where: {
      matched: false,
      createdAt: { gte: new Date(now - RERESOLVE_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!held.length) return

  for (const ev of held) {
    const raw = (ev.raw ?? {}) as { type?: string; data?: { object?: Record<string, unknown> } }
    const fields = extractFields(raw.data?.object ?? {})
    const accountId = await resolveAccount(fields).catch((err) => {
      logger.warn({ err, stripeEventId: ev.stripeEventId }, '[stripe-reresolve] resolution error')
      return null
    })

    if (accountId) {
      await prisma.stripeEvent.update({
        where: { id: ev.id },
        data: { accountId, matched: true, ...(fields.subscriptionId ? { subscriptionId: fields.subscriptionId } : {}) },
      })
      await bindStripeIdentity(accountId, fields)

      const mapped = raw.type ? EVENT_MAP[raw.type] : undefined
      const ageMs = now - ev.createdAt.getTime()
      if (mapped && ageMs <= APPLY_FRESH_HOURS * 60 * 60 * 1000) {
        const result = await applyBillingEvent(accountId, mapped, { stripeEventId: ev.stripeEventId, type: raw.type })
        logger.info(
          { accountId, stripeEventId: ev.stripeEventId, mapped, applied: result.applied },
          '[stripe-reresolve] late match applied',
        )
      } else {
        logger.warn(
          { accountId, stripeEventId: ev.stripeEventId, type: raw.type, ageHours: Math.round(ageMs / 3600000) },
          '[stripe-reresolve] late match BOUND ONLY — event too old to apply, verify lifecycle dates by hand',
        )
      }
      continue
    }

    // Still unmatched: alert exactly once, in the pass where it crosses 24h.
    const age = now - ev.createdAt.getTime()
    if (age >= ALERT_AGE_MS && age < ALERT_AGE_MS + CRON_INTERVAL_MS) {
      await sendFailureAlert({
        errorType: 'stripe_event_unmatched',
        message: `Stripe billing event ${ev.stripeEventId} (${ev.type}) is still unmatched after 24h — a paying client may not be getting billing credit.`,
        context: { stripeEventId: ev.stripeEventId, type: ev.type, subscriptionId: fields.subscriptionId, email: ev.email },
      })
    }
  }
}
