/**
 * System Health: the services Omniply depends on or pays for.
 *
 * This list only CREATES missing ServiceAccount rows (ensureServiceCatalog);
 * everything an admin edits afterwards (thresholds, recharge link, monthly
 * amount, notes) lives in the database and is never overwritten from here.
 *
 * Facts per service were checked against each provider's own documentation on
 * 2026-11-23 (which balances can be read by API, status feed addresses, the
 * billing page). Gemini, Anthropic and OpenAI expose NO balance endpoint, so
 * theirs is tracked: the admin states the balance or a top-up, and we subtract
 * our own metered spend (LLMUsage) since then.
 */
import { prisma } from '@omniply/shared'

export type Billing = 'prepaid' | 'quota' | 'postpaid' | 'fixed' | 'fee' | 'domain'
export type BalanceMode = 'tracked' | 'live' | 'none'

export interface CatalogEntry {
  key: string
  label: string
  usedFor: string
  billing: Billing
  balanceMode: BalanceMode
  meteredProvider?: string
  callProvider?: string
  rechargeUrl?: string
  statusFeedUrl?: string
  statusPageUrl?: string
  sortOrder: number
}

/** A stop here stops production: critical alerts for these also go out by SMS. */
export const CORE_SERVICES = new Set(['gemini', 'anthropic', 'domain:omniply.io'])

export const SERVICE_CATALOG: CatalogEntry[] = [
  {
    key: 'gemini',
    label: 'Gemini API',
    usedFor: 'Research, outlines, fact finding, newsletters, glosses',
    billing: 'prepaid',
    balanceMode: 'tracked',
    meteredProvider: 'gemini',
    callProvider: 'gemini',
    rechargeUrl: 'https://aistudio.google.com/billing',
    sortOrder: 10,
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    usedFor: 'Writing, editing, social captions, the AI receptionist',
    billing: 'prepaid',
    balanceMode: 'tracked',
    meteredProvider: 'anthropic',
    callProvider: 'anthropic',
    rechargeUrl: 'https://platform.claude.com/settings/billing',
    statusFeedUrl: 'https://status.claude.com/api/v2/status.json',
    statusPageUrl: 'https://status.claude.com',
    sortOrder: 20,
  },
  {
    key: 'openai',
    label: 'OpenAI',
    usedFor: 'Embeddings and small helper calls',
    billing: 'prepaid',
    balanceMode: 'tracked',
    meteredProvider: 'openai',
    callProvider: 'openai',
    rechargeUrl: 'https://platform.openai.com/account/billing',
    statusFeedUrl: 'https://status.openai.com/api/v2/status.json',
    statusPageUrl: 'https://status.openai.com',
    sortOrder: 30,
  },
  {
    key: 'fal-ai',
    label: 'fal.ai',
    usedFor: 'Images and video clips',
    billing: 'prepaid',
    balanceMode: 'live',
    meteredProvider: 'fal-ai',
    callProvider: 'fal-ai',
    rechargeUrl: 'https://fal.ai/dashboard/billing',
    statusPageUrl: 'https://status.fal.ai',
    sortOrder: 40,
  },
  {
    key: 'twilio',
    label: 'Twilio',
    usedFor: 'Clinic phone numbers, alert text messages, the SMS self-test',
    billing: 'prepaid',
    balanceMode: 'live',
    callProvider: 'twilio',
    rechargeUrl: 'https://console.twilio.com',
    statusFeedUrl: 'https://status.twilio.com/api/v2/status.json',
    statusPageUrl: 'https://status.twilio.com',
    sortOrder: 50,
  },
  {
    key: 'highlevel-wallet',
    label: 'CRM platform wallet',
    usedFor: 'Phone calls, texts and email sending for every clinic',
    billing: 'prepaid',
    balanceMode: 'live',
    statusPageUrl: 'https://status.gohighlevel.com',
    sortOrder: 55,
  },
  {
    key: 'elevenlabs',
    label: 'ElevenLabs',
    usedFor: 'Voice agent and narration',
    billing: 'quota',
    balanceMode: 'none',
    callProvider: 'elevenlabs',
    rechargeUrl: 'https://elevenlabs.io/app/developers',
    statusFeedUrl: 'https://status.elevenlabs.io/api/v2/status.json',
    statusPageUrl: 'https://status.elevenlabs.io',
    sortOrder: 60,
  },
  {
    key: 'oxylabs',
    label: 'Oxylabs',
    usedFor: 'Web research and source pages',
    billing: 'quota',
    balanceMode: 'none',
    callProvider: 'oxylabs',
    rechargeUrl: 'https://dashboard.oxylabs.io',
    statusFeedUrl: 'https://uptime.oxylabs.io/api/v2/status.json',
    statusPageUrl: 'https://uptime.oxylabs.io',
    sortOrder: 70,
  },
  {
    key: 'resend',
    label: 'Resend',
    usedFor: 'Alert emails and client emails',
    billing: 'quota',
    balanceMode: 'none',
    callProvider: 'resend',
    rechargeUrl: 'https://resend.com/settings/billing',
    statusFeedUrl: 'https://resend-status.com/api/v2/status.json',
    statusPageUrl: 'https://resend-status.com',
    sortOrder: 80,
  },
  {
    key: 'highlevel',
    label: 'CRM platform (HighLevel)',
    usedFor: 'Client accounts, booking, phone system, text and email sending',
    billing: 'fixed',
    balanceMode: 'none',
    callProvider: 'ghl',
    statusPageUrl: 'https://status.gohighlevel.com',
    sortOrder: 110,
  },
  {
    key: 'digitalocean',
    label: 'DigitalOcean',
    usedFor: 'Servers, database, file storage',
    billing: 'postpaid',
    balanceMode: 'none',
    rechargeUrl: 'https://cloud.digitalocean.com/account/billing',
    statusFeedUrl: 'https://status.digitalocean.com/api/v2/status.json',
    statusPageUrl: 'https://status.digitalocean.com',
    sortOrder: 120,
  },
  {
    key: 'vercel',
    label: 'Vercel',
    usedFor: 'The web app and marketing site',
    billing: 'postpaid',
    balanceMode: 'none',
    rechargeUrl: 'https://vercel.com/account/billing',
    statusFeedUrl: 'https://www.vercel-status.com/api/v2/status.json',
    statusPageUrl: 'https://www.vercel-status.com',
    sortOrder: 130,
  },
  {
    key: 'google-maps',
    label: 'Google Maps and Places',
    usedFor: 'Clinic listings, reviews, opening hours',
    billing: 'postpaid',
    balanceMode: 'none',
    callProvider: 'google-maps',
    rechargeUrl: 'https://console.cloud.google.com/billing',
    sortOrder: 140,
  },
  {
    key: 'clerk',
    label: 'Clerk',
    usedFor: 'Sign-in',
    billing: 'fixed',
    balanceMode: 'none',
    rechargeUrl: 'https://dashboard.clerk.com',
    statusFeedUrl: 'https://status.clerk.com/api/v2/status.json',
    statusPageUrl: 'https://status.clerk.com',
    sortOrder: 150,
  },
  {
    key: 'stripe',
    label: 'Stripe',
    usedFor: 'Taking client payments',
    billing: 'fee',
    balanceMode: 'none',
    rechargeUrl: 'https://dashboard.stripe.com',
    statusFeedUrl: 'https://www.stripestatus.com/api/v2/status.json',
    statusPageUrl: 'https://www.stripestatus.com',
    sortOrder: 160,
  },
  {
    key: 'sentry',
    label: 'Sentry',
    usedFor: 'Error tracking',
    billing: 'fixed',
    balanceMode: 'none',
    rechargeUrl: 'https://sentry.io/settings/billing/',
    statusFeedUrl: 'https://status.sentry.io/api/v2/status.json',
    statusPageUrl: 'https://status.sentry.io',
    sortOrder: 170,
  },
  {
    key: 'betterstack',
    label: 'Better Stack',
    usedFor: 'Logs',
    billing: 'fixed',
    balanceMode: 'none',
    rechargeUrl: 'https://betterstack.com/settings/billing',
    statusPageUrl: 'https://status.betterstack.com',
    sortOrder: 180,
  },
  {
    key: 'domain:omniply.io',
    label: 'omniply.io',
    usedFor: 'The product, the API, email sending, client sites',
    billing: 'domain',
    balanceMode: 'none',
    sortOrder: 200,
  },
  {
    key: 'domain:socioply.com',
    label: 'socioply.com',
    usedFor: 'Old name: social sign-in redirects still point here',
    billing: 'domain',
    balanceMode: 'none',
    sortOrder: 210,
  },
]

let ensured = false

/**
 * Create the catalog rows that do not exist yet, and bring the STRUCTURAL
 * fields of existing rows in line with this file (how a balance is read, which
 * provider its calls are logged under, its status feed). What an admin edits on
 * the page (thresholds, recharge link, monthly amount, renewal, notes) is never
 * touched.
 */
export async function ensureServiceCatalog(force = false): Promise<void> {
  if (ensured && !force) return
  const existing = new Map((await prisma.serviceAccount.findMany()).map((r) => [r.key, r]))
  const missing = SERVICE_CATALOG.filter((e) => !existing.has(e.key))
  if (missing.length > 0) {
    await prisma.serviceAccount.createMany({
      data: missing.map((e) => ({
        key: e.key,
        label: e.label,
        usedFor: e.usedFor,
        billing: e.billing,
        balanceMode: e.balanceMode,
        meteredProvider: e.meteredProvider ?? null,
        callProvider: e.callProvider ?? null,
        rechargeUrl: e.rechargeUrl ?? null,
        statusFeedUrl: e.statusFeedUrl ?? null,
        statusPageUrl: e.statusPageUrl ?? null,
        sortOrder: e.sortOrder,
      })),
      skipDuplicates: true,
    })
  }
  for (const e of SERVICE_CATALOG) {
    const row = existing.get(e.key)
    if (!row) continue
    const want = {
      label: e.label,
      usedFor: e.usedFor,
      billing: e.billing,
      balanceMode: e.balanceMode,
      meteredProvider: e.meteredProvider ?? null,
      callProvider: e.callProvider ?? null,
      statusFeedUrl: e.statusFeedUrl ?? null,
      statusPageUrl: e.statusPageUrl ?? null,
      sortOrder: e.sortOrder,
    }
    const changed = (Object.keys(want) as Array<keyof typeof want>).some((k) => row[k] !== want[k])
    if (changed) await prisma.serviceAccount.update({ where: { key: e.key }, data: want })
  }
  ensured = true
}
