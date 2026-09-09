// Sentry must be initialised before any other imports that might throw
import { initSentry, Sentry } from './lib/sentry'
initSentry('api')

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { logger } from './lib/logger'
import { aiRoutes } from './routes/ai'
import { imageRoutes } from './routes/images'
import { mediaRoutes } from './routes/media'
import { ghlRoutes } from './routes/ghl'
import { ghlBillingRoutes } from './routes/ghl-billing'
import { stripeBillingRoutes } from './routes/stripe-billing'
import { xrayReportRoutes } from './routes/xray-report'
import { spineCheckRoutes } from './routes/spine-check'
import { agentRoutes } from './routes/agent'
import { voiceAgentRoutes } from './routes/voice-agent'
import { voiceAssistantRoutes } from './routes/voice-assistant'
import { marketingRoutes } from './routes/marketing'
import { articlesPublicRoutes } from './routes/articles-public'
import { ghlReviewRoutes } from './routes/ghl-reviews'
import { ghlAppEventRoutes } from './routes/ghl-app-events'
import { googleOauthRoutes } from './routes/google-oauth'
import { embedRoutes } from './routes/embed'
import { onboardingRoutes } from './routes/onboarding'
import { onboardingVoiceRoutes } from './routes/onboarding-voice'
import { onboardingPhotoRoutes } from './routes/onboarding-photo'
import { leadgenRoutes } from './routes/leadgen'
import { socialRoutes } from './routes/social'
import { socialAutomationRoutes } from './routes/social-automation'
import { voiceRoutes } from './routes/voice'
import { healthRoutes } from './routes/health'
import { adminRoutes } from './routes/admin'
import { topicRoutes } from './routes/topics'
import { contentPlanRoutes } from './routes/content-plan'
import { newsletterTopicOverrideRoutes } from './routes/newsletter-topic-override'
import { brandSettingsDiscoveryRoutes } from './routes/brand-settings'
import { editRequestRoutes } from './routes/edit-requests'
import multipart from '@fastify/multipart'
import { articleRoutes } from './routes/articles'
import { wpConnectionRoutes } from './routes/wp-connections'
import { newsletterRoutes } from './routes/newsletters'
import { adminApiRoutes } from './routes/admin-api/index'
import { populateClerkId } from './middleware/clerk-context'
import { handleError } from './lib/error-handler'
import { assertEncryptionConfigured } from '@omniply/shared'

async function main() {
  // Fail fast if encryption isn't configured (never boot prod on the dev key).
  assertEncryptionConfigured()

  // Fastify 5 requires a plain config object for `logger`, not a pino instance.
  // We pass our shared logger as the child logger used by request handlers.
  const app = Fastify({
    loggerInstance: logger,
  })

  // ── CORS ───────────────────────────────────────────────────────────────────
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 /* 25 MB for voice samples */ } })
  // WEB_ORIGINS env (comma list) overrides; defaults cover the omniply hosts
  // plus the legacy socioply hosts during the rename transition window.
  const webOrigins = process.env.WEB_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [
    'https://chiro.omniply.io',
    'https://staging.chiro.omniply.io',
    'https://app.socioply.com',
    'https://www.socioply.com',
    // Marketing hosts: the static funnels (x-ray, walkthrough) and the
    // React marketing pages call svc directly (waitlist join, x-ray publish).
    'https://omniply.io',
    'https://www.omniply.io',
    'https://azavea.omniply.io',
    'https://staging.omniply.io',
  ]
  await app.register(cors, {
    origin: [...webOrigins, ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [])],
    credentials: true,
  })

  // ── Populate req.clerkId before rate limiting ──────────────────────────────
  // Best-effort token decode so per-route rate limits key on the user, not the
  // shared egress IP. Must run before the rate-limit plugin registers its hook.
  app.addHook('onRequest', populateClerkId)

  // ── Global IP-level rate limit (unauthenticated flood protection) ──────────
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${ctx.after}.`,
    }),
  })

  // ── Global error handler (generic 5xx messages, full server-side logging) ──
  app.setErrorHandler(handleError)

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)
  await app.register(aiRoutes, { prefix: '/api/ai' })
  await app.register(imageRoutes, { prefix: '/api/images' })
  await app.register(mediaRoutes, { prefix: '/api' })
  await app.register(ghlRoutes, { prefix: '/api' })
  await app.register(ghlBillingRoutes, { prefix: '/api' })
  await app.register(stripeBillingRoutes, { prefix: '/api' })
  await app.register(xrayReportRoutes, { prefix: '/api' })
  await app.register(spineCheckRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(voiceAgentRoutes, { prefix: '/api' })
  await app.register(voiceAssistantRoutes, { prefix: '/api' })
  await app.register(marketingRoutes, { prefix: '/api' })
  await app.register(articlesPublicRoutes, { prefix: '/api' })
  await app.register(ghlReviewRoutes, { prefix: '/api' })
  await app.register(ghlAppEventRoutes, { prefix: '/api' })
  await app.register(googleOauthRoutes, { prefix: '/api' })
  await app.register(embedRoutes, { prefix: '/api' })
  await app.register(onboardingRoutes, { prefix: '/api' })
  await app.register(onboardingVoiceRoutes, { prefix: '/api' })
  await app.register(onboardingPhotoRoutes, { prefix: '/api' })
  await app.register(leadgenRoutes, { prefix: '/api' })
  await app.register(socialRoutes, { prefix: '/api' })
  await app.register(socialAutomationRoutes, { prefix: '/api' })
  await app.register(voiceRoutes, { prefix: '/api' })
  await app.register(topicRoutes, { prefix: '/api' })
  await app.register(contentPlanRoutes, { prefix: '/api' })
  await app.register(newsletterTopicOverrideRoutes, { prefix: '/api' })
  await app.register(brandSettingsDiscoveryRoutes, { prefix: '/api' })
  await app.register(editRequestRoutes, { prefix: '/api' })
  await app.register(articleRoutes, { prefix: '/api' })
  await app.register(wpConnectionRoutes, { prefix: '/api' })
  await app.register(newsletterRoutes, { prefix: '/api' })
  await app.register(adminApiRoutes, { prefix: '/api/admin' })

  // Admin UI — only registered when explicitly enabled; blocked externally by Caddy
  if (process.env.ADMIN_ENABLED === 'true') {
    await app.register(adminRoutes, { prefix: '/admin' })
  }

  // ── Listen ─────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3001)
  try {
    await app.listen({ port, host: '0.0.0.0' })
    app.log.info(`API listening on 0.0.0.0:${port}`)
  } catch (err) {
    app.log.error(err)
    Sentry.captureException(err)
    process.exit(1)
  }
}

main().catch((err) => {
  logger.error({ err }, '[api] fatal error')
  Sentry.captureException(err)
  process.exit(1)
})

