/**
 * Stripe-central billing receiver (2026-07-24).
 *
 * The SaaS-configurator checkout charges through the platform's Stripe account;
 * charge metadata carries the SELLING location (altId) + the buyer's contact —
 * never the purchased sub-account (it doesn't exist yet at charge time). So:
 *
 * Two-phase binding (same pattern as owner promotion):
 *  1. First payment: match the Stripe customer email (or GHL contactId) to a
 *     provisioned account's owner → persist stripeCustomerId/subscriptionId.
 *  2. Renewals: subscriptionId → account directly, no fuzziness.
 *
 * Matched events feed the EXISTING lifecycle machinery (applyBillingEvent:
 * paidThrough + burst-on-payment / paused / cancelled). Unmatched events are
 * held in stripe_events (matched=false) and retried on each later event.
 *
 * Config: STRIPE_WEBHOOK_SECRET (endpoint signing secret) and
 * STRIPE_BILLING_LOCATIONS (comma list of selling-location ids whose
 * subscriptions belong to this platform — other Stripe traffic is ignored).
 *
 * RESOLUTION REWORK 2026-10-27: binding is subscription-id-only (immutable),
 * resolved through the GHL SaaS API to the purchased location. Customer id,
 * contact id and email are never used to match — the configurator shares one
 * Stripe customer across buyers (a second clinic's purchase was credited to
 * the first bound account), and the rest are mutable. Unresolved events are
 * held in stripe_events and re-resolved by the stripe-event-reresolve cron
 * (provisioning can lag the first invoice by seconds).
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { verifyStripeSignature } from '../lib/stripe-webhook'
import { applyBillingEvent, type BillingEventType } from '../lib/account-lifecycle'
import { extractFields, resolveAccount, bindStripeIdentity } from '../lib/stripe-resolve'

interface StripeEventBody {
  id?: string
  type?: string
  data?: { object?: Record<string, unknown> }
}

const EVENT_MAP: Record<string, BillingEventType> = {
  'invoice.payment_succeeded': 'payment_cleared',
  'invoice.payment_failed': 'payment_failed',
  'customer.subscription.deleted': 'cancelled',
  // Pause/resume (configurator or dashboard): paused rides the failed-payment
  // path (account paused, publishing runs out paidThrough naturally); resumed
  // reactivates via payment_cleared — the lifecycle's duplicate window absorbs
  // the invoice event that typically follows a resume.
  'customer.subscription.paused': 'payment_failed',
  'customer.subscription.resumed': 'payment_cleared',
}

export async function stripeBillingRoutes(app: FastifyInstance) {
  // Signature verification needs the EXACT raw payload — scoped parser keeps
  // the body as a string for this plugin only (route plugins are encapsulated).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  app.post<{ Body: string }>(
    '/stripe/events',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET
      if (!secret) {
        logger.error('[stripe-billing] STRIPE_WEBHOOK_SECRET not configured — rejecting event')
        return reply.status(503).send({ error: 'Stripe webhook not configured' })
      }
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      if (!verifyStripeSignature(rawBody, request.headers['stripe-signature'] as string | undefined, secret)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }

      let event: StripeEventBody
      try {
        event = JSON.parse(rawBody) as StripeEventBody
      } catch {
        return reply.status(400).send({ error: 'Malformed payload' })
      }
      const mapped = event.type ? EVENT_MAP[event.type] : undefined
      if (!event.id || !mapped) {
        // Unhandled event types are acknowledged so Stripe stops retrying.
        return reply.status(200).send({ received: true, ignored: true })
      }

      const obj = event.data?.object ?? {}
      const fields = extractFields(obj)

      // Only OUR platform's subscriptions: the selling location rides in the
      // metadata (altId). Other traffic on this Stripe account is not ours.
      const allowed = (process.env.STRIPE_BILLING_LOCATIONS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (allowed.length && fields.metadata.altId && !allowed.includes(fields.metadata.altId)) {
        return reply.status(200).send({ received: true, ignored: true })
      }

      // Idempotency: Stripe retries deliveries; evt id is globally unique.
      try {
        await prisma.stripeEvent.create({
          data: {
            stripeEventId: event.id,
            type: event.type ?? 'unknown',
            email: fields.email,
            contactId: fields.metadata.contactId ?? null,
            subscriptionId: fields.subscriptionId,
            raw: event as object,
          },
        })
      } catch {
        return reply.status(200).send({ received: true, duplicate: true })
      }

      const accountId = await resolveAccount(fields)
      if (!accountId) {
        logger.warn(
          { type: event.type, email: fields.email, contactId: fields.metadata.contactId, subscriptionId: fields.subscriptionId },
          '[stripe-billing] event held — no account match yet',
        )
        return reply.status(202).send({ received: true, held: true })
      }

      // Bind/refresh the Stripe identifiers (phase 2 becomes a direct lookup).
      await prisma.stripeEvent.update({
        where: { stripeEventId: event.id },
        data: { accountId, matched: true },
      })
      await bindStripeIdentity(accountId, fields)

      const result = await applyBillingEvent(accountId, mapped, { stripeEventId: event.id, type: event.type })
      logger.info(
        { accountId, stripeEventId: event.id, type: event.type, mapped, applied: result.applied },
        '[stripe-billing] event applied',
      )
      return reply.status(200).send({
        received: true,
        applied: result.applied,
        duplicate: result.duplicate,
        ...(result.burst ? { burst: result.burst } : {}),
      })
    },
  )
}
