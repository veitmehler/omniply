// Sentry must be initialised before any other imports that might throw
import { initSentry, Sentry } from './lib/sentry'
initSentry('worker')

import PgBoss from 'pg-boss'
import { logger } from './lib/logger'
import { getBoss, stopBoss, QUEUES } from './queues/index'
import { assertEncryptionConfigured } from '@omniply/shared'
import {
  publishHandler,
  publishScheduledHandler,
  PublishJobData,
  PublishScheduledJobData,
} from './handlers/publish'
import { analyticsSyncHandler, AnalyticsSyncJobData } from './handlers/analytics'
import { agentRetentionCleanupHandler } from './handlers/agent-retention'
import { agentFinalizeHandler } from './handlers/agent-finalize'
import { processDmTurn, type DmJobData } from './agent/dm'
import { voiceTransferWatchdogHandler, type VoiceTransferWatchdogJobData } from './handlers/voice-transfer-watchdog'
import { azaveaCadenceHandler } from './handlers/azavea-cadence'
import { oauthStateCleanupHandler, OAuthCleanupJobData } from './handlers/oauth'
import { dbBackupHandler, DbBackupJobData } from './handlers/backup'
import { pgMonitorHandler } from './handlers/pg-monitor'
import { articlePipelineHandler, ArticlePipelineJobData } from './handlers/article-pipeline'
import { articleEnrichmentHandler, ArticleEnrichmentJobData } from './handlers/article-enrichment'
import { qualityGateHandler, QualityGateJobData } from './handlers/quality-gate'
import { contentBatchMonitorHandler } from './handlers/content-batch-monitor'
import { articleOutputHandler, ArticleOutputJobData } from './handlers/article-output'
import { generateSocialFromArticleHandler, GenerateSocialFromArticleJobData } from './handlers/generate-social-from-article'
import { socialGenerateHandler, SocialGenerateJobData } from './handlers/social-generate'
import { socialDispatchHandler, SocialDispatchJobData } from './handlers/social-dispatch'
import { socialVideoGenerateHandler, SocialVideoGenerateJobData } from './handlers/social-video-generate'
import { socialAutomationSafetyHandler } from './handlers/social-automation-safety'
import { socialGenerationHealthHandler } from './handlers/social-generation-health'
import { syndicationGenerateHandler, SyndicationGenerateJobData } from './handlers/syndication-generate'
import { syndicationSafetyHandler } from './handlers/syndication-safety'
import { promoEmailGenerateHandler, PromoEmailGenerateJobData } from './handlers/promo-email-generate'
import { promoEmailSafetyHandler } from './handlers/promo-email-safety'
import { newsletterGenerateHandler } from './handlers/newsletter-generate'
import { newsletterSafetyHandler } from './handlers/newsletter-safety'
import { newsletterNotifyHandler, NewsletterNotifyJobData } from './handlers/newsletter-notify'
import type { NewsletterGenerateJobData } from './newsletter/enqueue'
import { clientStorySpiderHandler, ClientStorySpiderJobData } from './handlers/client-story-spider'
import { clientStoryAutoGenerateCheckHandler } from './handlers/client-story-auto-generate-check'
import { accountLifecycleClockHandler } from './handlers/account-lifecycle-clock'
import { accountDeleteHandler } from './handlers/account-delete'
import { onboardingCrawlHandler } from './handlers/onboarding-crawl'
import { onboardingSynthesisHandler } from './handlers/onboarding-synthesis'
import { leadgenPollHandler } from './handlers/leadgen-poll'
import { leadgenCompileHandler } from './handlers/leadgen-compile'
import { placesReviewPollHandler, googleReviewsBackfillHandler } from './handlers/google-reviews'

/**
 * Number of concurrent social-generation runs across ALL clients. Bounded to
 * respect droplet CPU/memory during ffmpeg-heavy video encoding — see the
 * SOCIAL_GENERATE registration below for why this can't just be `batchSize`.
 */
const SOCIAL_GENERATE_CONCURRENCY = 3

/** Wrap a pg-boss handler so uncaught errors are captured by Sentry. */
function withSentry<T>(
  name: string,
  fn: (jobs: PgBoss.Job<T>[]) => Promise<void>,
): (jobs: PgBoss.Job<T>[]) => Promise<void> {
  return async (jobs) => {
    try {
      await fn(jobs)
    } catch (err) {
      logger.error({ err, queue: name }, 'worker handler error')
      Sentry.captureException(err, { tags: { queue: name } })
      throw err
    }
  }
}

async function main() {
  logger.info('[worker] starting…')

  // Fail fast if encryption isn't configured (never boot prod on the dev key).
  assertEncryptionConfigured()

  const boss = await getBoss()

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`[worker] received ${signal}, shutting down…`)
    await stopBoss()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // ── Create queues (pg-boss v10 requires explicit createQueue before use) ────
  for (const queueName of Object.values(QUEUES)) {
    await boss.createQueue(queueName)
  }

  // ── Cron schedules ──────────────────────────────────────────────────────────
  await boss.schedule(QUEUES.PUBLISH_SCHEDULED, '* * * * *', {})      // every minute
  await boss.schedule(QUEUES.ANALYTICS_SYNC, '0 2 * * *', {})         // daily 02:00 UTC
  await boss.schedule(QUEUES.OAUTH_STATE_CLEANUP, '0 * * * *', {})    // hourly
  await boss.schedule(QUEUES.DB_BACKUP, '0 3 * * 0', {})              // Sunday 03:00 UTC
  await boss.schedule(QUEUES.PG_CONN_MONITOR, '*/15 * * * *', {})     // every 15 min
  await boss.schedule(QUEUES.SOCIAL_AUTOMATION_SAFETY, '*/5 * * * *', {}) // every 5 min
  await boss.schedule(QUEUES.SOCIAL_GENERATION_HEALTH, '*/10 * * * *', {}) // every 10 min
  await boss.schedule(QUEUES.SYNDICATION_SAFETY, '*/10 * * * *', {})      // every 10 min
  await boss.schedule(QUEUES.PROMO_EMAIL_SAFETY, '*/10 * * * *', {})      // every 10 min
  await boss.schedule(QUEUES.NEWSLETTER_SAFETY, '*/10 * * * *', {})       // every 10 min
  await boss.schedule(QUEUES.CONTENT_BATCH_MONITOR, '* * * * *', {})      // every minute
  await boss.schedule(QUEUES.CLIENT_STORY_AUTO_GENERATE_CHECK, '*/15 * * * *', {}) // every 15 min
  await boss.schedule(QUEUES.ACCOUNT_LIFECYCLE_CLOCK, '30 4 * * *', {}) // daily 04:30 UTC — 60/90d billing clocks
  await boss.schedule(QUEUES.LEADGEN_PROPOSAL_POLL, '*/2 * * * *', {}) // every 2 min — Drive access-proposal capture
  await boss.schedule(QUEUES.PLACES_REVIEW_POLL, '0 4 * * 1', {}) // Monday 04:00 UTC — weekly dual-sort review harvest
  await boss.schedule(QUEUES.AGENT_RETENTION_CLEANUP, '15 3 * * *', {}) // daily 03:15 UTC — 180d chat-transcript retention (decision D)
  await boss.schedule(QUEUES.AGENT_FINALIZE, '*/10 * * * *', {}) // every 10 min — idle-chat contact reconcile + summary note
  await boss.schedule(QUEUES.AZAVEA_CADENCE, '0 8 * * *', {}) // daily 08:00 UTC — azavea vertical MWF article cadence (no-op on non-slot days)

  // ── Social publishing ───────────────────────────────────────────────────────
  await boss.work<PublishJobData>(
    QUEUES.PUBLISH,
    { batchSize: 5 },
    withSentry('publish', publishHandler),
  )

  await boss.work<PublishScheduledJobData>(
    QUEUES.PUBLISH_SCHEDULED,
    { batchSize: 1 },
    withSentry('publish-scheduled', publishScheduledHandler),
  )

  // ── Analytics ───────────────────────────────────────────────────────────────
  await boss.work<AnalyticsSyncJobData>(
    QUEUES.ANALYTICS_SYNC,
    { batchSize: 1 },
    withSentry('analytics-sync', analyticsSyncHandler),
  )

  // ── Maintenance ─────────────────────────────────────────────────────────────
  await boss.work<OAuthCleanupJobData>(
    QUEUES.OAUTH_STATE_CLEANUP,
    { batchSize: 1 },
    withSentry('oauth-state-cleanup', oauthStateCleanupHandler),
  )

  await boss.work(
    QUEUES.AGENT_RETENTION_CLEANUP,
    { batchSize: 1 },
    withSentry('agent-retention-cleanup', agentRetentionCleanupHandler),
  )

  await boss.work(
    QUEUES.AGENT_FINALIZE,
    { batchSize: 1 },
    withSentry('agent-finalize', agentFinalizeHandler),
  )

  await boss.work<DmJobData>(
    QUEUES.AGENT_DM_TURN,
    { batchSize: 1 },
    withSentry('agent-dm-turn', async (jobs) => {
      for (const job of jobs) await processDmTurn(job.data)
    }),
  )

  await boss.work<VoiceTransferWatchdogJobData>(
    QUEUES.VOICE_TRANSFER_WATCHDOG,
    { batchSize: 1 },
    withSentry('voice-transfer-watchdog', voiceTransferWatchdogHandler),
  )

  await boss.work(
    QUEUES.AZAVEA_CADENCE,
    { batchSize: 1 },
    withSentry('azavea-cadence', azaveaCadenceHandler),
  )

  await boss.work<DbBackupJobData>(
    QUEUES.DB_BACKUP,
    { batchSize: 1 },
    withSentry('db-backup', dbBackupHandler),
  )

  // ── PG connection monitor ────────────────────────────────────────────────────
  await boss.work(
    QUEUES.PG_CONN_MONITOR,
    { batchSize: 1 },
    withSentry('pg-conn-monitor', async () => { await pgMonitorHandler() }),
  )

  // ── Image generation ────────────────────────────────────────────────────────
  await boss.work(
    QUEUES.IMAGE_GENERATE,
    { batchSize: 3 },
    withSentry('image-generate', async (jobs) => {
      for (const job of jobs) {
        logger.info({ jobId: job.id }, '[image-generate] TODO Phase 9')
      }
    }),
  )

  // ── Article pipeline ────────────────────────────────────────────────────────
  await boss.work<ArticlePipelineJobData>(
    QUEUES.ARTICLE_PIPELINE,
    { batchSize: 2 },
    withSentry('article-pipeline', articlePipelineHandler),
  )

  await boss.work<QualityGateJobData>(
    QUEUES.ARTICLE_QUALITY_GATE,
    { batchSize: 1 },
    withSentry('article-quality-gate', qualityGateHandler),
  )

  await boss.work(
    QUEUES.CONTENT_BATCH_MONITOR,
    { batchSize: 1 },
    withSentry('content-batch-monitor', async () => { await contentBatchMonitorHandler() }),
  )

  await boss.work<ArticleEnrichmentJobData>(
    QUEUES.ARTICLE_ENRICHMENT,
    { batchSize: 1 },
    withSentry('article-enrichment', articleEnrichmentHandler),
  )

  await boss.work<ArticleOutputJobData>(
    QUEUES.ARTICLE_OUTPUT,
    { batchSize: 3 },
    withSentry('article-output', articleOutputHandler),
  )

  await boss.work<GenerateSocialFromArticleJobData>(
    QUEUES.GENERATE_SOCIAL_FROM_ARTICLE,
    { batchSize: 3 },
    withSentry('generate-social-from-article', generateSocialFromArticleHandler),
  )

  // Concurrency, not batchSize: socialGenerateHandler processes its jobs array
  // sequentially (for...of), so raising batchSize here would NOT let two runs
  // process in parallel — pg-boss v10 has no teamSize/teamConcurrency option;
  // the documented way to get N concurrent handler invocations for one queue
  // is N independent `.work()` registrations (each spawns its own polling
  // Worker). This is the fix for the 2026-07-08 incident: with batchSize:1 and
  // a single registration, one client's hung/slow run held the only slot and
  // blocked every other client's run. Bounded (not unbounded) so a burst of
  // heavy video runs can't exhaust droplet CPU/memory.
  for (let i = 0; i < SOCIAL_GENERATE_CONCURRENCY; i++) {
    await boss.work<SocialGenerateJobData>(
      QUEUES.SOCIAL_GENERATE,
      { batchSize: 1 },
      withSentry('social-generate', socialGenerateHandler),
    )
  }

  await boss.work<SocialDispatchJobData>(
    QUEUES.SOCIAL_DISPATCH,
    { batchSize: 1 },
    withSentry('social-dispatch', socialDispatchHandler),
  )

  // One-off dashboard video generation (video reel / hook / quote video). Heavy
  // and slow, so one at a time.
  await boss.work<SocialVideoGenerateJobData>(
    QUEUES.SOCIAL_VIDEO_GENERATE,
    { batchSize: 1 },
    withSentry('social-video-generate', socialVideoGenerateHandler),
  )

  await boss.work(
    QUEUES.SOCIAL_AUTOMATION_SAFETY,
    { batchSize: 1 },
    withSentry('social-automation-safety', async () => {
      await socialAutomationSafetyHandler()
    }),
  )

  await boss.work(
    QUEUES.SOCIAL_GENERATION_HEALTH,
    { batchSize: 1 },
    withSentry('social-generation-health', async () => {
      await socialGenerationHealthHandler()
    }),
  )

  // ── Syndication ─────────────────────────────────────────────────────────────
  await boss.work<SyndicationGenerateJobData>(
    QUEUES.SYNDICATION_GENERATE,
    { batchSize: 2 },
    withSentry('syndication-generate', syndicationGenerateHandler),
  )

  await boss.work(
    QUEUES.SYNDICATION_SAFETY,
    { batchSize: 1 },
    withSentry('syndication-safety', async () => {
      await syndicationSafetyHandler()
    }),
  )

  // ── Promotional email ─────────────────────────────────────────────────────────
  await boss.work<PromoEmailGenerateJobData>(
    QUEUES.PROMO_EMAIL_GENERATE,
    { batchSize: 2 },
    withSentry('promo-email-generate', promoEmailGenerateHandler),
  )

  await boss.work(
    QUEUES.PROMO_EMAIL_SAFETY,
    { batchSize: 1 },
    withSentry('promo-email-safety', async () => {
      await promoEmailSafetyHandler()
    }),
  )

  // ── Newsletter ────────────────────────────────────────────────────────────────
  await boss.work<NewsletterGenerateJobData>(
    QUEUES.NEWSLETTER_GENERATE,
    { batchSize: 1 },
    withSentry('newsletter-generate', newsletterGenerateHandler),
  )

  await boss.work(
    QUEUES.NEWSLETTER_SAFETY,
    { batchSize: 1 },
    withSentry('newsletter-safety', async () => {
      await newsletterSafetyHandler()
    }),
  )

  await boss.work<NewsletterNotifyJobData>(
    QUEUES.NEWSLETTER_NOTIFY,
    { batchSize: 1 },
    withSentry('newsletter-notify', newsletterNotifyHandler),
  )

  // ── Client-story review mining ─────────────────────────────────────────────────
  await boss.work<ClientStorySpiderJobData>(
    QUEUES.CLIENT_STORY_SPIDER,
    { batchSize: 1 },
    withSentry('client-story-spider', clientStorySpiderHandler),
  )

  await boss.work(
    QUEUES.CLIENT_STORY_AUTO_GENERATE_CHECK,
    { batchSize: 1 },
    withSentry('client-story-auto-generate-check', async () => {
      await clientStoryAutoGenerateCheckHandler()
    }),
  )

  // Account lifecycle clocks + deletion (multi-tenancy plan Phase C).
  await boss.work(
    QUEUES.ACCOUNT_LIFECYCLE_CLOCK,
    { batchSize: 1 },
    withSentry('account-lifecycle-clock', accountLifecycleClockHandler),
  )
  await boss.work(
    QUEUES.ACCOUNT_DELETE,
    { batchSize: 1 },
    withSentry('account-delete', accountDeleteHandler),
  )

  // Onboarding background website analysis (onboarding plan Phase 2).
  await boss.work(
    QUEUES.ONBOARDING_CRAWL,
    { batchSize: 1 },
    withSentry('onboarding-crawl', onboardingCrawlHandler),
  )
  await boss.work(
    QUEUES.ONBOARDING_SYNTHESIS,
    { batchSize: 1 },
    withSentry('onboarding-synthesis', onboardingSynthesisHandler),
  )

  // Lead-gen documents (leadgen plan Phases 3-4).
  await boss.work(
    QUEUES.LEADGEN_PROPOSAL_POLL,
    { batchSize: 1 },
    withSentry('leadgen-proposal-poll', leadgenPollHandler),
  )
  await boss.work(
    QUEUES.PLACES_REVIEW_POLL,
    { batchSize: 1 },
    withSentry('places-review-poll', placesReviewPollHandler),
  )
  await boss.work(
    QUEUES.GOOGLE_REVIEWS_BACKFILL,
    { batchSize: 1 },
    withSentry('google-reviews-backfill', googleReviewsBackfillHandler),
  )
  await boss.work(
    QUEUES.LEADGEN_COMPILE,
    { batchSize: 1 },
    withSentry('leadgen-compile', leadgenCompileHandler),
  )

  logger.info('[worker] all queues registered, crons scheduled — ready')
}

main().catch((err) => {
  logger.error({ err }, '[worker] fatal error')
  Sentry.captureException(err)
  process.exit(1)
})
