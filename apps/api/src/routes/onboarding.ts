/**
 * Onboarding flow routes (onboarding plan Phase 1).
 *
 * Works in BOTH auth modes (embed token or Clerk) since requireAuth resolves
 * either to a clerkId. State is per-account and resumable.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, resolveAccountForClerkId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import {
  getOrCreateSession,
  currentStepView,
  commitAndAdvance,
  STEP_ORDER,
  type StepContext,
} from '../onboarding/flow'
import { bootstrapOnboarding } from '../onboarding/bootstrap'
import { generationReadiness } from '../lib/generation-readiness'
import { resolveArticleCalendar, resolveNewsletterCalendar } from '../newsletter/calendar-routing'
import { burstCurrentWindow } from '../lib/account-lifecycle'
import { publishLinktreePage } from '../lib/linktree'
import { publishSpineCheckPage } from '../spine-check/generate'
import { repointSpineCheckTriggerLink } from '../leadgen/compile'
import { publishClinicSchema } from '../lib/clinic-schema'
import { getBoss, QUEUES } from '../queues/index'

export async function onboardingRoutes(app: FastifyInstance) {
  async function ctxFor(clerkId: string) {
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return null
    const session = await getOrCreateSession(account.accountId)
    const ctx: StepContext = {
      accountId: account.accountId,
      // Onboarding writes brand/settings/ghl rows — pin them to the account
      // OWNER so every account has one canonical row regardless of which
      // member (buyer, agency admin) drives the walkthrough. The readiness
      // validator reads the owner row directly.
      userId: account.ownerUserId ?? account.userId,
      stepData: (session.stepData as Record<string, unknown>) ?? {},
    }
    return { account, session, ctx }
  }

  // GET /onboarding/state — current step view + chat history for resume.
  app.get('/onboarding/state', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const r = await ctxFor(clerkId)
    if (!r) return reply.status(404).send({ error: 'No account' })

    const acct = await prisma.account.findUnique({
      where: { id: r.account.accountId },
      select: { onboardingCompletedAt: true },
    })
    if (acct?.onboardingCompletedAt) {
      return reply.send({ completed: true })
    }

    // First entry: pull the GHL Business Profile + start the website crawl
    // (idempotent; runs while the user answers the early questions).
    await bootstrapOnboarding(r.account.accountId, r.account.ownerUserId, r.session.id, r.ctx.stepData).catch(
      (err) => logger.warn({ err }, '[onboarding] bootstrap failed (manual fallbacks apply)'),
    )

    const view = await currentStepView(r.ctx, r.session.currentStep)
    return reply.send({
      completed: false,
      step: view,
      history: (r.ctx.stepData.__history as unknown[]) ?? [],
    })
  })

  // POST /onboarding/answer { step, answer } — commit + advance.
  app.post<{ Body: { step?: string; answer?: unknown } }>('/onboarding/answer', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const r = await ctxFor(clerkId)
    if (!r) return reply.status(404).send({ error: 'No account' })

    const { step, answer } = request.body ?? {}
    if (!step) return reply.status(400).send({ error: 'step required' })
    if (step !== r.session.currentStep) {
      // Stale client (e.g. two tabs) — return the authoritative current view.
      const view = await currentStepView(r.ctx, r.session.currentStep)
      return reply.status(409).send({ error: 'Out of sync', step: view })
    }

    const result = await commitAndAdvance(r.ctx, r.session.id, step, answer)
    if (result.error) return reply.status(400).send({ error: result.error })

    const view = await currentStepView(r.ctx, result.nextStep)
    return reply.send({ step: view })
  })

  // POST /onboarding/back — one step back (edits are cheap, dead ends are not).
  app.post('/onboarding/back', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const r = await ctxFor(clerkId)
    if (!r) return reply.status(404).send({ error: 'No account' })

    const idx = STEP_ORDER.indexOf(r.session.currentStep)
    const prev = STEP_ORDER[Math.max(0, idx - 1)]
    await prisma.onboardingSession.update({ where: { id: r.session.id }, data: { currentStep: prev } })
    const view = await currentStepView(r.ctx, prev)
    return reply.send({ step: view })
  })

  // POST /onboarding/complete — validator-gated finale. Routes the calendars
  // (specialization × hemisphere), re-validates, flips the gate, and starts
  // the first month's burst (payment already cleared — Phase B semantics).
  app.post('/onboarding/complete', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const r = await ctxFor(clerkId)
    if (!r) return reply.status(404).send({ error: 'No account' })

    // Calendars are the two 'final'-step readiness rows — assign them now.
    await resolveArticleCalendar(r.account.ownerUserId).catch((err: unknown) =>
      logger.warn({ err }, '[onboarding] article calendar routing failed'),
    )
    await resolveNewsletterCalendar(r.account.ownerUserId).catch((err: unknown) =>
      logger.warn({ err }, '[onboarding] newsletter calendar routing failed'),
    )

    const readiness = await generationReadiness(r.account.accountId)
    if (!readiness.ready) {
      return reply.status(409).send({ error: 'Onboarding incomplete', readiness })
    }

    await prisma.account.update({
      where: { id: r.account.accountId },
      data: { onboardingCompletedAt: new Date() },
    })
    await prisma.onboardingSession.update({ where: { id: r.session.id }, data: { status: 'completed' } })
    logger.info({ accountId: r.account.accountId }, '[onboarding] completed — starting first burst')

    // Link-in-bio page on the clinic's own WordPress at /linktree (their
    // branded domain); best-effort — never blocks the finale.
    void publishSpineCheckPage(r.account.ownerUserId).finally(() => {
      // After publish the quiz URL is final (WP page or hosted) — point the
      // snapshot's omniply-spine-check trigger link at it.
      void repointSpineCheckTriggerLink(r.account.ownerUserId)
    })
      .catch(() => null)
      .then(() => publishLinktreePage(r.account.ownerUserId))
      .catch(() => {})
    // Clinic entity schema onto their editable WP pages (agent plan 3.1) —
    // env-flagged rollout: verify on the test account before enabling broadly.
    if (process.env.SCHEMA_MARKUP_AUTO === '1') {
      void publishClinicSchema(r.account.ownerUserId).catch(() => {})
    }

    // Starter lead-magnet library (leadgen plan Phase 7): compile every active
    // template for this account — lands review-gated, never blocks generation.
    try {
      const templates = await prisma.leadGenTemplate.findMany({ where: { active: true }, select: { id: true, name: true, slug: true } })
      if (templates.length > 0) {
        const boss = await getBoss()
        for (const t of templates) {
          const doc = await prisma.leadGenDocument.upsert({
            where: { accountId_slug: { accountId: r.account.accountId, slug: t.slug } },
            create: {
              accountId: r.account.accountId,
              userId: r.account.ownerUserId,
              templateId: t.id,
              title: t.name,
              slug: t.slug,
              status: 'compiling',
              ghlTagNames: [`leadgen-${t.slug}`],
            },
            update: {},
          })
          await boss.send(QUEUES.LEADGEN_COMPILE, { documentId: doc.id }, { singletonKey: `leadgen-compile-${doc.id}`, expireInSeconds: 1800 })
        }
        logger.info({ accountId: r.account.accountId, count: templates.length }, '[onboarding] starter lead-magnet library enqueued')
      }
    } catch (err: unknown) {
      logger.warn({ err }, '[onboarding] starter library enqueue failed (non-fatal)')
    }

    const burst = await burstCurrentWindow(r.account.accountId).catch((err: unknown) => {
      logger.error({ err }, '[onboarding] first burst failed (dashboard generate available)')
      return null
    })
    return reply.send({ completed: true, burst })
  })

  // GET /onboarding/readiness — the validator, for the chat + admin surface.
  app.get('/onboarding/readiness', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const r = await ctxFor(clerkId)
    if (!r) return reply.status(404).send({ error: 'No account' })
    return reply.send(await generationReadiness(r.account.accountId))
  })
}
