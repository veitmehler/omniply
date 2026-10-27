/**
 * Stripe event → account resolution (rework 2026-10-27).
 *
 * The configurator reuses one Stripe CUSTOMER across purchases through the
 * same funnel (proven: two different clinics' invoices carried the same
 * cus_…), buyer emails are mutable, and metadata.contactId is the buyer's
 * contact in the SELLING location — which collides when one person checks
 * out for several clinics. None of those may bind an account.
 *
 * The only immutable chain is:
 *   Stripe subscription id (parent.subscription_details.subscription)
 *     → GHL SaaS API /saas-api/public-api/locations?subscriptionId=…
 *     → GHL locationId (created once at provisioning)
 *     → account (ghlSettings.ghlLocationId → owner → account).
 *
 * After the first resolution the subscription id is persisted on the
 * account, so renewals match directly without the GHL call.
 */
import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { getAgencyToken } from './ghl/app-oauth'

const SAAS_LOCATIONS_URL = 'https://services.leadconnectorhq.com/saas-api/public-api/locations'
const SAAS_API_VERSION = '2021-04-15'

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

/** GHL SaaS API: which location(s) does this Stripe subscription belong to? */
export async function saasLocationsForSubscription(subscriptionId: string): Promise<string[]> {
  const agency = await getAgencyToken()
  if (!agency) {
    logger.warn('[stripe-resolve] no agency token — SaaS lookup unavailable')
    return []
  }
  const url = `${SAAS_LOCATIONS_URL}?subscriptionId=${encodeURIComponent(subscriptionId)}&companyId=${encodeURIComponent(agency.companyId)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${agency.token}`, Version: SAAS_API_VERSION, Accept: 'application/json' },
  })
  if (!res.ok) {
    logger.warn({ status: res.status, subscriptionId }, '[stripe-resolve] SaaS locations lookup failed')
    return []
  }
  const body = (await res.json().catch(() => null)) as unknown
  const arr = Array.isArray(body) ? body : ((body as { locations?: unknown })?.locations ?? [])
  return (Array.isArray(arr) ? arr : []).filter((x): x is string => typeof x === 'string' && !!x)
}

async function accountIdForLocation(locationId: string): Promise<string | null> {
  const gs = await prisma.ghlSettings.findFirst({
    where: { ghlLocationId: locationId },
    select: { userId: true },
  })
  if (!gs) return null
  const acct = await prisma.account.findFirst({ where: { ownerUserId: gs.userId }, select: { id: true } })
  return acct?.id ?? null
}

/**
 * Resolve the owning account for a Stripe event. Immutable identifiers only:
 * bound subscription id, else subscription id → GHL location → account.
 * Returns null for events that cannot be resolved yet (held + retried).
 */
export async function resolveAccount(fields: StripeEventFields): Promise<string | null> {
  const { subscriptionId } = fields
  if (!subscriptionId) return null

  const bound = await prisma.account.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  })
  if (bound) return bound.id

  const locations = await saasLocationsForSubscription(subscriptionId)
  for (const loc of locations) {
    const accountId = await accountIdForLocation(loc)
    if (accountId) return accountId
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
