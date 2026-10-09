import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../middleware/admin'
import { prisma } from '@omniply/shared'
import { logger } from '../../lib/logger'

export async function articlesAdminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { page?: string; status?: string; userId?: string } }>(
    '/articles',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply)
      if (!admin) return

      const page = Math.max(1, parseInt(request.query.page ?? '1', 10))
      const pageSize = 25
      const skip = (page - 1) * pageSize

      const where: Record<string, unknown> = {}
      if (request.query.status) where.status = request.query.status
      if (request.query.userId) where.userId = request.query.userId

      const [jobs, total] = await Promise.all([
        prisma.articleJob.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            topic: { select: { topic: true, mode: true } },
            user: { select: { email: true, name: true } },
            sitePage: { select: { title: true, slug: true, primaryKeyword: true } },
            _count: { select: { pipelineSteps: true, errorLogs: true } },
          },
        }),
        prisma.articleJob.count({ where }),
      ])

      return reply.send({ jobs, total, page, pageSize })
    },
  )

  app.get<{ Params: { jobId: string } }>('/articles/:jobId', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    const job = await prisma.articleJob.findUnique({
      where: { id: request.params.jobId },
      include: {
        topic: true,
        user: { select: { id: true, email: true, name: true } },
        pipelineSteps: {
          orderBy: { stepNumber: 'asc' },
          include: { promptTemplate: { select: { stepName: true, defaultProvider: true, defaultModel: true } } },
        },
        sitePage: { include: { diagrams: true } },
        outputAttempts: { orderBy: { startedAt: 'desc' } },
        errorLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        llmUsage: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!job) return reply.status(404).send({ error: 'Not found' })
    return reply.send(job)
  })

  // Release a quality-gate-held article into the normal flow (Phase B +
  // enrichment → client review). The ONE human action a needs_review article
  // requires — before this, flagged articles were a dead end: no approve
  // control on any surface (live test 2026-10-09).
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/release', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    const job = await prisma.articleJob.findUnique({
      where: { id: request.params.jobId },
      select: { id: true, status: true },
    })
    if (!job) return reply.status(404).send({ error: 'Not found' })
    if (job.status !== 'needs_review') {
      return reply.status(409).send({ error: `Article is not held for review (status: ${job.status})` })
    }

    const { approveArticleJob } = await import('../../article-pipeline/approval-service')
    await approveArticleJob(job.id)
    logger.info({ jobId: job.id, adminId: admin.id }, '[admin] needs_review article released')
    return reply.send({ ok: true })
  })
}
