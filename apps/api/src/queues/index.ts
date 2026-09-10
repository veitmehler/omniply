import PgBoss from 'pg-boss'
import { Sentry } from '../lib/sentry'

let boss: PgBoss | null = null

/**
 * Force `sslmode=no-verify` on a Postgres connection string so node-postgres
 * connects with TLS but without CA verification. node-postgres treats
 * `sslmode=require` (the DO default) as verify-on, which rejects DO's self-signed
 * chain; `no-verify` is its encrypt-but-don't-verify mode. Returns the string
 * unchanged if it can't be parsed as a URL.
 */
export function withNoVerifySsl(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    url.searchParams.set('sslmode', 'no-verify')
    return url.toString()
  } catch {
    return connectionString
  }
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss

  const rawConnectionString = process.env.PGBOSS_DATABASE_URL || process.env.DIRECT_URL
  if (!rawConnectionString) {
    throw new Error('PGBOSS_DATABASE_URL or DIRECT_URL must be set (pg-boss needs a direct connection, not PgBouncer)')
  }

  // DO managed Postgres requires TLS but presents a cert chain whose root isn't in
  // the system trust store. We connect over the private VPC endpoint, so the link
  // is encrypted; we just don't CA-verify it. This must be scoped to the pg-boss
  // (node-postgres) connection ONLY — never process-wide (H1 removed the global
  // NODE_TLS_REJECT_UNAUTHORIZED override so outbound calls verify properly).
  //
  // node-postgres reads `sslmode` from the connection string and treats
  // `sslmode=require` as "verify the cert" — which overrides a passed
  // `ssl: { rejectUnauthorized: false }` object and rejects the self-signed chain.
  // Forcing `sslmode=no-verify` (node-postgres's encrypt-but-don't-verify mode) is
  // the reliable way to express this. (Prisma's engine interprets `require` as
  // no-verify already, which is why migrations worked but pg-boss did not.)
  const connectionString = withNoVerifySsl(rawConnectionString)

  // Cap the pg-boss connection pool. pg-boss defaults to 10 connections PER
  // process; with api + worker across prod + staging all hitting one small
  // managed cluster (~22 slots), that exhausts it ("remaining connection slots
  // are reserved for roles with the SUPERUSER attribute"). 5 is ample for this
  // low-volume queue; override per-environment via PGBOSS_MAX_CONNECTIONS (B4).
  const max = Number(process.env.PGBOSS_MAX_CONNECTIONS ?? 5)

  boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    max,
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
    deleteAfterSeconds: 60 * 60 * 24 * 30,
    monitorStateIntervalSeconds: 2,
    ssl: { rejectUnauthorized: false },
  })

  boss.on('error', (err) => {
    console.error('[pg-boss] error:', err)
    Sentry.captureException(err)
  })

  await boss.start()
  return boss
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop()
    boss = null
  }
}

export const QUEUES = {
  PUBLISH: 'publish',
  PUBLISH_SCHEDULED: 'publish-scheduled',
  ANALYTICS_SYNC: 'analytics-sync',
  IMAGE_GENERATE: 'image-generate',
  OAUTH_STATE_CLEANUP: 'oauth-state-cleanup',
  AGENT_RETENTION_CLEANUP: 'agent-retention-cleanup',
  AGENT_FINALIZE: 'agent-finalize',
  AGENT_DM_TURN: 'agent-dm-turn',
  VOICE_TRANSFER_WATCHDOG: 'voice-transfer-watchdog',
  AZAVEA_CADENCE: 'azavea-cadence',
  DB_BACKUP: 'db-backup',
  PG_CONN_MONITOR: 'pg-conn-monitor',
  ARTICLE_PIPELINE: 'article-pipeline',
  ARTICLE_QUALITY_GATE: 'article-quality-gate',
  ARTICLE_ENRICHMENT: 'article-enrichment',
  ARTICLE_OUTPUT: 'article-output',
  GENERATE_SOCIAL_FROM_ARTICLE: 'generate-social-from-article',
  SOCIAL_GENERATE: 'social-generate',
  SOCIAL_VIDEO_GENERATE: 'social-video-generate',
  SOCIAL_DISPATCH: 'social-dispatch',
  SOCIAL_AUTOMATION_SAFETY: 'social-automation-safety',
  SOCIAL_GENERATION_HEALTH: 'social-generation-health',
  SYNDICATION_GENERATE: 'syndication-generate',
  SYNDICATION_SAFETY: 'syndication-safety',
  PROMO_EMAIL_GENERATE: 'promo-email-generate',
  PROMO_EMAIL_SAFETY: 'promo-email-safety',
  NEWSLETTER_GENERATE: 'newsletter-generate',
  NEWSLETTER_SAFETY: 'newsletter-safety',
  NEWSLETTER_NOTIFY: 'newsletter-notify',
  CONTENT_BATCH_MONITOR: 'content-batch-monitor',
  CLIENT_STORY_SPIDER: 'client-story-spider',
  CLIENT_STORY_AUTO_GENERATE_CHECK: 'client-story-auto-generate-check',
  ACCOUNT_LIFECYCLE_CLOCK: 'account-lifecycle-clock',
  ACCOUNT_DELETE: 'account-delete',
  ONBOARDING_CRAWL: 'onboarding-crawl',
  ONBOARDING_SYNTHESIS: 'onboarding-synthesis',
  LEADGEN_PROPOSAL_POLL: 'leadgen-proposal-poll',
  LEADGEN_COMPILE: 'leadgen-compile',
  PLACES_REVIEW_POLL: 'places-review-poll',
  GOOGLE_REVIEWS_BACKFILL: 'google-reviews-backfill',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]
