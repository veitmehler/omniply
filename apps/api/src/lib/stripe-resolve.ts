/**
 * Stripe event → account resolution (rework 2026-10-27).
 *
 * The configurator reuses one Stripe CUSTOMER across purchases through the
 * same funnel (proven: two different clinics' invoices carried the same
 * cus_…), buyer emails are mutable, and metadata.contactId is the buyer's
 * contact in the SELLING location — which collides when one person checks
 * out for several clinics. None of those may bind an account.
 *
 * The only immutable chain is the Stripe subscription id
 * (parent.subscription_details.subscription) matched against GHL's own
 * record of it on the purchased location: GET /locations/{id} exposes
 * settings.saasSettings.planDetails.subscriptionId (verified live
 * 2026-10-27 — works with both our agency and location tokens; the
 * dedicated SaaS API rejects every token type a sub-account app or agency
 * PIT can produce, so it is deliberately NOT used).
 *
 * Binding happens from both directions: provisioning stores the new
 * location's subscription id on the account the moment it exists, and
 * resolution scans recent unbound accounts' location records for a held
 * event's subscription id. Either path alone is deterministic at any
 * signup volume; after first binding, renewals match directly.
 */
import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { getAgencyToken } from './ghl/app-oauth'

const LOCATIONS_URL = 'https://services.leadconnectorhq.com/locations'
const API_VERSION = '2021-07-28'
/** How far back an unbound account is still a candidate for event matching. */
const CANDIDATE_WINDOW_DAYS = 30
const CANDIDATE_CAP = 25

export interface StripeEventFields {
  subscriptionId: string | null
  customerId: string | null
  email: string | null
  metadata: Record<string, string>
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/**
 * Pull identifying fields from invoice or subscription objects. Newer Stripe
 * API versions removed invoice.subscription from the root: it now lives at
 * parent.subscription_details.subscription (and per line item under
 * parent.subscription_item_details.subscription) — the old root read made
 * every configurator invoice look subscription-less.
 */
export function extractFields(obj: Record<string, unknown>): StripeEventFields {
  const parent = obj.parent as
    | { subscription_details?: { subscription?: unknown; metadata?: Record<string, unknown> } }
    | undefined
  const lines = (obj.lines as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? []
  const lineSub = lines
    .map((l) => (l.parent as { subscription_item_details?: { subscription?: unknown } } | undefined)?.subscription_item_details?.subscription)
    .map(str)
    .find(Boolean)

  const metaRaw =
    (obj.metadata as Record<string, unknown> | undefined) ??
    parent?.subscription_details?.metadata ??
    ((obj.subscription_details as { metadata?: Record<string, unknown> } | undefined)?.metadata as
      | Record<string, unknown>
      | undefined) ??
    {}
  const metadata: Record<string, string> = {}
  for (const [k, v] of Object.entries(metaRaw)) if (typeof v === 'string') metadata[k] = v
  // Root metadata can be empty on subscription_create invoices while the
  // subscription_details metadata is populated — merge, root wins.
  const parentMeta = parent?.subscription_details?.metadata ?? {}
  for (const [k, v] of Object.entries(parentMeta)) if (typeof v === 'string' && !(k in metadata)) metadata[k] = v

  return {
    subscriptionId:
      str(obj.subscription) ??
      str(parent?.subscription_details?.subscription) ??
      lineSub ??
      (str(obj.object) === 'subscription' ? str(obj.id) : null),
    customerId: str(obj.customer),
    email: str(obj.customer_email) ?? str((obj as { customer_details?: { email?: unknown } }).customer_details?.email),
    metadata,
  }
}

export interface LocationSaasSubscription {
  subscriptionId: string | null
  customerId: string | null
  subscriptionStatus: string | null
}

/** GHL's own billing linkage, straight off the location record. */
export async function fetchLocationSaasSubscription(locationId: string): Promise<LocationSaasSubscription | null> {
  const agency = await getAgencyToken()
  if (!agency) {
    logger.warn('[stripe-resolve] no agency token — location lookup unavailable')
    return null
  }
  const res = await fetch(`${LOCATIONS_URL}/${encodeURIComponent(locationId)}`, {
    headers: { Authorization: `Bearer ${agency.token}`, Version: API_VERSION, Accept: 'application/json' },
  })
  if (!res.ok) {
    logger.warn({ status: res.status, locationId }, '[stripe-resolve] location lookup failed')
    return null
  }
  const body = (await res.json().catch(() => null)) as {
    location?: { settings?: { saasSettings?: Record<string, unknown> } }
    settings?: { saasSettings?: Record<string, unknown> }
  } | null
  const saas = (body?.location?.settings?.saasSettings ?? body?.settings?.saasSettings) as
    | { customerId?: unknown; subscriptionStatus?: unknown; planDetails?: { subscriptionId?: unknown } }
    | undefined
  if (!saas) return null
  return {
    subscriptionId: str(saas.planDetails?.subscriptionId),
    customerId: str(saas.customerId),
    subscriptionStatus: str(saas.subscriptionStatus),
  }
}

/**
 * Resolve the owning account for a Stripe event. Immutable identifiers only:
 * a bound subscription id matches directly; otherwise recent unbound
 * accounts' location records are checked for GHL's own copy of the
 * subscription id. Returns null for events that cannot be resolved yet
 * (held + retried by the reresolve cron).
 */
export async function resolveAccount(fields: StripeEventFields): Promise<string | null> {
  const { subscriptionId } = fields
  if (!subscriptionId) return null

  const bound = await prisma.account.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  })
  if (bound) return bound.id

  const candidates = await prisma.account.findMany({
    where: {
      stripeSubscriptionId: null,
      createdAt: { gte: new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    take: CANDIDATE_CAP,
    select: { id: true, ownerUserId: true },
  })
  for (const cand of candidates) {
    if (!cand.ownerUserId) continue
    const gs = await prisma.ghlSettings.findFirst({
      where: { userId: cand.ownerUserId },
      select: { ghlLocationId: true },
    })
    if (!gs?.ghlLocationId) continue
    const saas = await fetchLocationSaasSubscription(gs.ghlLocationId)
    if (saas?.subscriptionId && saas.subscriptionId === subscriptionId) return cand.id
  }
  return null
}

/** Persist the subscription binding (and the customer id only when it is not already claimed — the configurator shares customers across buyers). */
export async function bindStripeIdentity(accountId: string, fields: StripeEventFields): Promise<void> {
  if (fields.subscriptionId) {
    await prisma.account.update({ where: { id: accountId }, data: { stripeSubscriptionId: fields.subscriptionId } })
  }
  if (fields.customerId) {
    const holder = await prisma.account.findUnique({
      where: { stripeCustomerId: fields.customerId },
      select: { id: true },
    })
    if (!holder) {
      await prisma.account
        .update({ where: { id: accountId }, data: { stripeCustomerId: fields.customerId } })
        .catch(() => undefined)
    } else if (holder.id !== accountId) {
      logger.info(
        { accountId, holder: holder.id, customerId: fields.customerId },
        '[stripe-resolve] shared Stripe customer — customer id left on first holder',
      )
    }
  }
}
