import type { FastifyInstance } from 'fastify'
import { recomposeStorySlot } from '../social/recompose'
import { requireAccount } from '../middleware/account'
import { prisma } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { retryAutomationSpec } from '../social/automation/run'
import { enqueueSocialDispatch, enqueueSocialRegenerate } from '../social/automation/enqueue-dispatch'

export async function socialAutomationRoutes(app: FastifyInstance) {
  // POST /social-automation/spec-results/:id/recompose — client slide edits:
  // story: { textMode?, slides?: { [i]: { text? } }, regenerateImage?: i }
  // carousel: { slides?: { [i]: { headline?, body? } }, regenerateImage?: i }
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/social-automation/spec-results/:id/recompose',
    async (request, reply) => {
      const account = await requireAccount(request, reply)
      if (!account) return
      const body = request.body ?? {}
      const patch: Parameters<typeof recomposeStorySlot>[2] = {}
      if (body.textMode === 'light' || body.textMode === 'dark' || body.textMode === null) patch.textMode = body.textMode as never
      if (body.slides && typeof body.slides === 'object') {
        patch.slides = {}
        for (const [i, o] of Object.entries(
          body.slides as Record<string, { text?: unknown; headline?: unknown; body?: unknown; imageUrl?: unknown }>,
        )) {
          if (!/^\d+$/.test(i)) continue
          patch.slides[i] = {
            ...(typeof o?.text === 'string' ? { text: o.text.slice(0, 600) } : {}),
            ...(typeof o?.headline === 'string' ? { headline: o.headline.slice(0, 200) } : {}),
            ...(typeof o?.body === 'string' ? { body: o.body.slice(0, 600) } : {}),
            ...(typeof o?.imageUrl === 'string' || o?.imageUrl === null ? { imageUrl: o.imageUrl as never } : {}),
          }
        }
      }
      if (typeof body.regenerateImage === 'number') patch.regenerateImage = body.regenerateImage
      const result = await recomposeStorySlot(request.params.id, account.memberUserIds, patch)
      if ('error' in result) return reply.status(result.status).send({ error: result.error })
      return reply.send(result)
    },
  )

  // POST /social-automation/spec-results/:id/caption — client caption edits
  // (review UX, Veit 2026-09-17): { platform, caption, applyToAll? }. Updates
  // the ready Post rows AND the preview payload together; no LLM, no media.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/social-automation/spec-results/:id/caption',
    async (request, reply) => {
      const account = await requireAccount(request, reply)
      if (!account) return
      const body = request.body ?? {}
      const platform = typeof body.platform === 'string' ? body.platform : null
      const rawCaption = typeof body.caption === 'string' ? body.caption : null
      const applyToAll = body.applyToAll === true
      if (!platform || rawCaption === null || !rawCaption.trim()) {
        return reply.status(400).send({ error: 'platform and a non-empty caption are required' })
      }
      // Same dash-free scrub the caption generator applies — client edits
      // must not reintroduce the banned em-dash tell.
      const caption = rawCaption.slice(0, 5000).replace(/\s*—\s*/g, ', ')

      // Nested run.userId is NOT broadened by the account extension (it only
      // rewrites top-level where.userId) — scope members explicitly.
      const spec = await prisma.socialAutomationSpecResult.findFirst({
        where: { id: request.params.id, run: { userId: { in: account.memberUserIds } } },
        include: { run: { select: { userId: true } } },
      })
      if (!spec) return reply.status(404).send({ error: 'Post not found' })
      if (spec.approvedAt) return reply.status(400).send({ error: 'Approved posts can no longer be edited' })

      const preview = (spec.previewJson ?? null) as {
        platforms?: { platform: string; caption?: string; postId?: string }[]
      } | null
      if (!preview?.platforms?.length) return reply.status(400).send({ error: 'No platform posts to edit' })

      const targets = preview.platforms.filter((p) => applyToAll || p.platform === platform)
      if (!targets.length) return reply.status(400).send({ error: `No ${platform} post on this slot` })

      let updated = 0
      for (const t of targets) {
        if (t.postId) {
          // Only rows still awaiting dispatch — a scheduled/sent post is immutable.
          const res = await prisma.post.updateMany({
            where: { id: t.postId, userId: spec.run.userId, status: 'ready' },
            data: { content: caption },
          })
          if (res.count === 0) continue
        }
        t.caption = caption
        updated++
      }
      if (!updated) return reply.status(400).send({ error: 'Posts are already scheduled and can no longer be edited' })

      await prisma.socialAutomationSpecResult.update({
        where: { id: spec.id },
        data: { previewJson: preview as object },
      })
      return reply.send({ ok: true, updated })
    },
  )

  // GET /api/social-automation/:runId
  app.get<{ Params: { runId: string } }>('/social-automation/:runId', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { runId } = request.params
    const run = await prisma.socialAutomationRun.findFirst({
      where: { id: runId, userId: user.id },
      include: {
        specResults: { orderBy: { slotKey: 'asc' } },
        _count: { select: { posts: true } },
        job: { select: { id: true, topic: { select: { topic: true } } } },
      },
    })

    if (!run) return reply.status(404).send({ error: 'Automation run not found' })
    return reply.send({ run })
  })

  // POST /api/social-automation/:runId/approve — approve + schedule the whole run
  // (source-agnostic: article or newsletter).
  app.post<{ Params: { runId: string } }>('/social-automation/:runId/approve', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { runId } = request.params
    const run = await prisma.socialAutomationRun.findFirst({ where: { id: runId, userId: user.id } })
    if (!run) return reply.status(404).send({ error: 'Automation run not found' })

    const result = await enqueueSocialDispatch(runId)
    if (!result.enqueued) {
      return reply.status(400).send({ error: result.message ?? 'Dispatch not enqueued' })
    }
    return reply.status(202).send({ ok: true, enqueued: true })
  })

  // POST /api/social-automation/:runId/approve/:slotKey
  app.post<{ Params: { runId: string; slotKey: string } }>(
    '/social-automation/:runId/approve/:slotKey',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { runId, slotKey } = request.params
      const run = await prisma.socialAutomationRun.findFirst({
        where: { id: runId, userId: user.id },
      })
      if (!run) return reply.status(404).send({ error: 'Automation run not found' })

      const result = await enqueueSocialDispatch(runId, {
        slotKey: slotKey.toUpperCase(),
      })
      if (!result.enqueued) {
        return reply.status(400).send({ error: result.message ?? 'Dispatch not enqueued' })
      }
      return reply.status(202).send({ ok: true, enqueued: true })
    },
  )

  // POST /api/social-automation/:runId/regenerate/:slotKey
  app.post<{ Params: { runId: string; slotKey: string } }>(
    '/social-automation/:runId/regenerate/:slotKey',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { runId, slotKey } = request.params
      const run = await prisma.socialAutomationRun.findFirst({
        where: { id: runId, userId: user.id },
      })
      if (!run) return reply.status(404).send({ error: 'Automation run not found' })

      const result = await enqueueSocialRegenerate(runId, slotKey)
      if (!result.enqueued) {
        return reply.status(400).send({ error: result.message ?? 'Regenerate not enqueued' })
      }
      return reply.status(202).send({ ok: true, enqueued: true })
    },
  )

  // POST /api/social-automation/:runId/retry/:slotKey
  app.post<{ Params: { runId: string; slotKey: string } }>(
    '/social-automation/:runId/retry/:slotKey',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return

      const user = await prisma.user.findUnique({ where: { clerkId } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const { runId, slotKey } = request.params
      const run = await prisma.socialAutomationRun.findFirst({
        where: { id: runId, userId: user.id },
      })
      if (!run) return reply.status(404).send({ error: 'Automation run not found' })

      try {
        await retryAutomationSpec(runId, slotKey.toUpperCase())
        return reply.send({ ok: true, message: `Retried slot ${slotKey.toUpperCase()}` })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.status(400).send({ error: message })
      }
    },
  )
}
