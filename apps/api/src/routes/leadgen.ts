/**
 * Lead Magnets routes (leadgen plan Phase 5) — review-gated library.
 * Works in both auth modes (Clerk / embed token) like the onboarding routes.
 */
import type { FastifyInstance } from 'fastify'
import { prisma, resolveAccountForClerkId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { getBoss, QUEUES } from '../queues/index'
import { uploadBufferWithKey } from '@omniply/shared'

export async function leadgenRoutes(app: FastifyInstance) {
  async function accountFor(clerkId: string) {
    return resolveAccountForClerkId(clerkId)
  }

  // GET /leadgen/documents — the account's library + capture counts.
  app.get('/leadgen/documents', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await accountFor(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })

    const docs = await prisma.leadGenDocument.findMany({
      where: { accountId: account.accountId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { captures: true } }, template: { select: { name: true } } },
    })
    return reply.send({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        slug: d.slug,
        kind: d.kind,
        status: d.status,
        driveLink: d.driveLink,
        pdfUrl: d.pdfKey ? `${(process.env.CDN_BASE ?? 'https://cdn.omniply.io').replace(/\/$/, '')}/${d.pdfKey}` : null,
        ghlTagNames: d.ghlTagNames,
        templateName: d.template?.name ?? null,
        captureCount: d._count.captures,
        lastError: d.lastError,
        compiledAt: d.compiledAt,
        approvedAt: d.approvedAt,
      })),
    })
  })

  // GET /leadgen/documents/:id/captures — recent leads for visible ROI.
  app.get<{ Params: { id: string } }>('/leadgen/documents/:id/captures', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await accountFor(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })
    const doc = await prisma.leadGenDocument.findFirst({
      where: { id: request.params.id, accountId: account.accountId },
      select: { id: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Not found' })
    const captures = await prisma.leadCapture.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { requesterEmail: true, status: true, createdAt: true },
    })
    return reply.send({ captures })
  })

  // POST /leadgen/documents/from-template { templateId, tagNames? } — create + compile.
  app.post<{ Body: { templateId?: string; tagNames?: string[] } }>(
    '/leadgen/documents/from-template',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const account = await accountFor(clerkId)
      if (!account) return reply.status(404).send({ error: 'No account' })

      const acct = await prisma.account.findUnique({ where: { id: account.accountId }, select: { vertical: true } })
      const template = await prisma.leadGenTemplate.findFirst({
        where: { id: request.body?.templateId, active: true, vertical: { in: [acct?.vertical ?? 'chiro', 'all'] } },
      })
      if (!template) return reply.status(404).send({ error: 'Template not found' })

      const doc = await prisma.leadGenDocument.upsert({
        where: { accountId_slug: { accountId: account.accountId, slug: template.slug } },
        create: {
          accountId: account.accountId,
          userId: account.ownerUserId,
          templateId: template.id,
          title: template.name,
          slug: template.slug,
          kind: 'template',
          status: 'compiling',
          ghlTagNames: request.body?.tagNames ?? [`leadgen-${template.slug}`],
        },
        update: { status: 'compiling', lastError: null },
      })
      const boss = await getBoss()
      await boss.send(QUEUES.LEADGEN_COMPILE, { documentId: doc.id }, { singletonKey: `leadgen-compile-${doc.id}`, expireInSeconds: 1800 })
      return reply.status(202).send({ documentId: doc.id })
    },
  )

  // POST /leadgen/documents/:id/approve — the review gate.
  app.post<{ Params: { id: string } }>('/leadgen/documents/:id/approve', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await accountFor(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })
    const doc = await prisma.leadGenDocument.findFirst({
      where: { id: request.params.id, accountId: account.accountId },
    })
    if (!doc) return reply.status(404).send({ error: 'Not found' })
    if (doc.status !== 'pending_review') {
      return reply.status(400).send({ error: `Only pending_review documents can be approved (current: ${doc.status})` })
    }
    const updated = await prisma.leadGenDocument.update({
      where: { id: doc.id },
      data: { status: 'live', approvedAt: new Date() },
      select: { id: true, status: true, driveLink: true },
    })
    return reply.send(updated)
  })

  // POST /leadgen/documents/:id/regenerate { note? } — back through the compiler.
  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/leadgen/documents/:id/regenerate',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const account = await accountFor(clerkId)
      if (!account) return reply.status(404).send({ error: 'No account' })
      const doc = await prisma.leadGenDocument.findFirst({
        where: { id: request.params.id, accountId: account.accountId },
        select: { id: true, kind: true },
      })
      if (!doc) return reply.status(404).send({ error: 'Not found' })
      if (doc.kind !== 'template') return reply.status(400).send({ error: 'Custom uploads cannot be regenerated' })
      await prisma.leadGenDocument.update({ where: { id: doc.id }, data: { status: 'compiling', lastError: null } })
      const boss = await getBoss()
      await boss.send(QUEUES.LEADGEN_COMPILE, { documentId: doc.id, note: request.body?.note?.slice(0, 500) }, { singletonKey: `leadgen-compile-${doc.id}-${Date.now()}`, expireInSeconds: 1800 })
      return reply.status(202).send({ documentId: doc.id })
    },
  )

  // PATCH /leadgen/documents/:id { tagNames } — per-document GHL tags.
  app.patch<{ Params: { id: string }; Body: { tagNames?: string[] } }>(
    '/leadgen/documents/:id',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const account = await accountFor(clerkId)
      if (!account) return reply.status(404).send({ error: 'No account' })
      const tagNames = (request.body?.tagNames ?? []).map((t) => t.trim()).filter(Boolean)
      if (tagNames.length === 0) return reply.status(400).send({ error: 'At least one tag' })
      const doc = await prisma.leadGenDocument.findFirst({
        where: { id: request.params.id, accountId: account.accountId },
        select: { id: true },
      })
      if (!doc) return reply.status(404).send({ error: 'Not found' })
      const updated = await prisma.leadGenDocument.update({
        where: { id: doc.id },
        data: { ghlTagNames: tagNames },
        select: { id: true, ghlTagNames: true },
      })
      return reply.send(updated)
    },
  )


  // POST /leadgen/documents/upload — custom PDF (Model A, leadgen plan Phase 6).
  // multipart: file `pdf` + fields title, addCover ('true'|'false'), tagNames (csv).
  app.post('/leadgen/documents/upload', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await accountFor(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })

    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'PDF file required' })
    if (!(file.mimetype ?? '').includes('pdf')) return reply.status(400).send({ error: 'Only PDF files are accepted' })
    const buf = await file.toBuffer()
    if (buf.length === 0 || buf.length > 15 * 1024 * 1024) {
      return reply.status(400).send({ error: 'PDF missing or larger than 15 MB' })
    }
    const fields = file.fields as Record<string, { value?: string } | undefined>
    const title = fields.title?.value?.trim() || file.filename.replace(/\.pdf$/i, '')
    const addCover = fields.addCover?.value === 'true'
    const tagNames = (fields.tagNames?.value ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `custom-${Date.now()}`

    const sourcePdfKey = `leadgen/${account.accountId}/src-${slug}-${Date.now()}.pdf`
    await uploadBufferWithKey(sourcePdfKey, buf, 'application/pdf')

    const doc = await prisma.leadGenDocument.upsert({
      where: { accountId_slug: { accountId: account.accountId, slug } },
      create: {
        accountId: account.accountId,
        userId: account.ownerUserId,
        title,
        slug,
        kind: 'custom',
        status: 'compiling',
        sourcePdfKey,
        ghlTagNames: tagNames.length ? tagNames : [`leadgen-${slug}`],
      },
      update: { status: 'compiling', sourcePdfKey, lastError: null },
    })
    const boss = await getBoss()
    await boss.send(
      QUEUES.LEADGEN_COMPILE,
      { documentId: doc.id, custom: true, addCover },
      { singletonKey: `leadgen-compile-${doc.id}-${Date.now()}`, expireInSeconds: 1800 },
    )
    return reply.status(202).send({ documentId: doc.id })
  })

  // GET /leadgen/templates — active masters OF THE ACCOUNT'S VERTICAL
  // (for "add from template").
  app.get('/leadgen/templates', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await accountFor(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })
    const acct = await prisma.account.findUnique({ where: { id: account.accountId }, select: { vertical: true } })
    const templates = await prisma.leadGenTemplate.findMany({
      where: { active: true, vertical: { in: [acct?.vertical ?? 'chiro', 'all'] } },
      select: { id: true, name: true, slug: true, description: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ templates })
  })
}
