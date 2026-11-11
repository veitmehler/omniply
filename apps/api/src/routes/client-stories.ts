/**
 * Story bank routes (Veit 2026-11-11): the account owner sees, edits, adds and
 * removes the sanitized story beats that feed articles and social story arcs,
 * and can rebuild the bank from the onboarding transcripts + pending reviews.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, resolveAccountForClerkId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { listStoriesForAccount } from '../article-pipeline/client-stories/bank'
import { extractBeatsFromOnboardingSession, lintBeat, syncProofPool, beatHash, sanitizeSubstances } from '../article-pipeline/client-stories/beats'
import { triagePendingReviews } from '../article-pipeline/client-stories/triage'

const MAX_TEXT = 1200

export async function clientStoryRoutes(app: FastifyInstance) {
  // GET /api/client-stories — the bank for the caller's account.
  app.get('/client-stories', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })
    return reply.send({ stories: await listStoriesForAccount(account.accountId) })
  })

  // POST /api/client-stories — add a story by hand (already in the owner's words; linted, not rewritten).
  app.post<{ Body: { storyText?: string; kind?: string; topicTags?: string[] } }>('/client-stories', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })
    const text = sanitizeSubstances((request.body?.storyText ?? '').trim().slice(0, MAX_TEXT))
    const lint = lintBeat(text)
    if (!lint.ok) return reply.status(422).send({ error: `This story cannot be published as written (${lint.reason}). Remove names, exact ages, cure claims and grey-zone substance names, then try again.` })
    const kind = request.body?.kind === 'owner_moment' ? 'owner_moment' : 'client_case'
    const topicTags = Array.isArray(request.body?.topicTags) ? request.body!.topicTags!.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 4) : []
    const story = await prisma.clientStory.upsert({
      where: { accountId_sourceHash: { accountId: account.accountId, sourceHash: beatHash(text) } },
      create: { accountId: account.accountId, storyText: text, topicTags, source: 'manual', kind, originalText: text, sourceHash: beatHash(text) },
      update: { storyText: text, topicTags, kind },
    })
    await syncProofPool(account.accountId).catch(() => undefined)
    return reply.send({ story })
  })

  // PUT /api/client-stories/:id — edit the publishable text / tags / kind.
  app.put<{ Params: { id: string }; Body: { storyText?: string; kind?: string; topicTags?: string[] } }>('/client-stories/:id', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })
    const existing = await prisma.clientStory.findFirst({ where: { id: request.params.id, accountId: account.accountId } })
    if (!existing) return reply.status(404).send({ error: 'Story not found' })
    const data: { storyText?: string; kind?: string; topicTags?: string[] } = {}
    if (typeof request.body?.storyText === 'string') {
      const text = sanitizeSubstances(request.body.storyText.trim().slice(0, MAX_TEXT))
      const lint = lintBeat(text)
      if (!lint.ok) return reply.status(422).send({ error: `This story cannot be published as written (${lint.reason}). Remove names, exact ages, cure claims and grey-zone substance names, then try again.` })
      data.storyText = text
    }
    if (request.body?.kind === 'owner_moment' || request.body?.kind === 'client_case') data.kind = request.body.kind
    if (Array.isArray(request.body?.topicTags)) data.topicTags = request.body.topicTags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 4)
    const story = await prisma.clientStory.update({ where: { id: existing.id }, data })
    await syncProofPool(account.accountId).catch(() => undefined)
    return reply.send({ story })
  })

  // DELETE /api/client-stories/:id
  app.delete<{ Params: { id: string } }>('/client-stories/:id', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })
    const existing = await prisma.clientStory.findFirst({ where: { id: request.params.id, accountId: account.accountId }, select: { id: true } })
    if (!existing) return reply.status(404).send({ error: 'Story not found' })
    await prisma.clientStory.delete({ where: { id: existing.id } })
    await syncProofPool(account.accountId).catch(() => undefined)
    return reply.send({ ok: true })
  })

  // POST /api/client-stories/rebuild — re-scan the onboarding transcripts and triage pending reviews.
  app.post('/client-stories/rebuild', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })
    const pending = await prisma.rawReview.findMany({ where: { accountId: account.accountId, triageStatus: 'pending' }, select: { id: true } })
    let reviews = 0
    if (pending.length) {
      await triagePendingReviews(account.accountId, pending.map((p) => p.id)).catch((err) => logger.warn({ err }, '[client-stories] rebuild: triage failed'))
      reviews = pending.length
    }
    const beats = await extractBeatsFromOnboardingSession(account.accountId, { route: 'client-stories/rebuild' }).catch((err) => {
      logger.warn({ err }, '[client-stories] rebuild: beat extraction failed')
      return null
    })
    return reply.send({ reviewsTriaged: reviews, beats: beats ? { extracted: beats.extracted, stored: beats.stored, dropped: beats.dropped.length } : null, stories: await listStoriesForAccount(account.accountId) })
  })
}
