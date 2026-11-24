/**
 * System API key resolution.
 *
 * Resolution order for each provider:
 *   1. Environment variable (e.g. GEMINI_API_KEY) — fastest, no DB round-trip.
 *   2. SystemApiKey DB row (encrypted) — set via admin UI without redeploy.
 *
 * This allows managing keys via the admin panel after initial deploy.
 */

import { prisma } from '@omniply/shared'
import { decrypt, encrypt } from '@omniply/shared'

const ENV_VAR_MAP: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'fal-ai': 'FAL_KEY',
  // Transactional email (Resend) — not an LLM, but managed in the same admin key
  // store. Env var wins, else the DB SystemApiKey row.
  resend: 'RESEND_API_KEY',
  // Oxylabs credentials (web research). Two product pairs, admin-managed; each
  // value falls back to its specific env var, then the legacy shared
  // OXYLABS_USERNAME/PASSWORD (handled in lib/oxylabs-auth.ts).
  oxylabs_serp_username: 'OXYLABS_SERP_USERNAME',
  oxylabs_serp_password: 'OXYLABS_SERP_PASSWORD',
  oxylabs_proxy_username: 'OXYLABS_PROXY_USERNAME',
  oxylabs_proxy_password: 'OXYLABS_PROXY_PASSWORD',
  // System Health (2026-11-23): a READ-ONLY DigitalOcean token (billing read) so
  // the dashboard can show month-to-date usage. Never used for anything else.
  digitalocean: 'DIGITALOCEAN_TOKEN',
}

export async function getSystemApiKey(provider: string): Promise<string | null> {
  const envVar = ENV_VAR_MAP[provider]
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!
  }

  const row = await prisma.systemApiKey.findUnique({ where: { provider } })
  if (!row) return null
  return decrypt(row.encryptedKey)
}

export async function setSystemApiKey(provider: string, plainKey: string): Promise<void> {
  const encryptedKey = encrypt(plainKey)
  await prisma.systemApiKey.upsert({
    where: { provider },
    create: { provider, encryptedKey },
    update: { encryptedKey },
  })
}

export async function listSystemApiKeys(): Promise<
  Array<{ provider: string; hasEnvKey: boolean; hasDbKey: boolean; hasUserKey: boolean }>
> {
  const providers = Object.keys(ENV_VAR_MAP)
  const dbRows = await prisma.systemApiKey.findMany({ select: { provider: true } })
  const dbProviders = new Set(dbRows.map((r) => r.provider))

  // Also surface which providers have keys in the per-user ApiKey table
  // so the admin UI can offer a "migrate" action.
  const userKeyRows = await prisma.apiKey.findMany({ select: { provider: true } })
  const userProviders = new Set(userKeyRows.map((r) => r.provider.toLowerCase()))

  return providers.map((p) => ({
    provider: p,
    hasEnvKey: !!(ENV_VAR_MAP[p] && process.env[ENV_VAR_MAP[p] as string]),
    hasDbKey: dbProviders.has(p),
    // true if at least one user has this provider's key in the old ApiKey table
    hasUserKey: userProviders.has(p) || userProviders.has(p === 'fal-ai' ? 'fal' : p),
  }))
}

/** Copy all per-user ApiKey rows into the SystemApiKey table. */
export async function migrateUserKeysToSystem(): Promise<{
  migrated: string[]
  skipped: string[]
  failed: string[]
}> {
  const pipelineProviders = new Set(Object.keys(ENV_VAR_MAP))
  const ALIAS: Record<string, string> = { fal: 'fal-ai' }

  const userKeys = await prisma.apiKey.findMany({ select: { provider: true, encryptedKey: true } })

  const migrated: string[] = []
  const skipped: string[] = []
  const failed: string[] = []

  for (const row of userKeys) {
    const canonical = ALIAS[row.provider.toLowerCase()] ?? row.provider.toLowerCase()
    if (!pipelineProviders.has(canonical)) { skipped.push(row.provider); continue }

    try {
      const plainKey = decrypt(row.encryptedKey)
      if (!plainKey) { failed.push(canonical); continue }
      await setSystemApiKey(canonical, plainKey)
      migrated.push(canonical)
    } catch {
      failed.push(canonical)
    }
  }

  return { migrated, skipped, failed }
}
