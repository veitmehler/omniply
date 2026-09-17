import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { requireAccount } from '../middleware/account'
import { sendTransactionalEmail } from '../lib/alerts'
import { logger } from '../lib/logger'

interface NewRequest {
  quotedText: string
  prefixContext?: string
  suffixContext?: string
  note: string
}

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? 'https://chiro.omniply.io'
}

/**
 * Where a notification should send the person: GHL-embedded accounts live in
 * their CRM (white-label domain), never on our app (they have no Clerk login
 * there). Fallback = the app for open-web accounts.
 */
async function notificationLink(accountOwnerUserId: string): Promise<{ href: string; label: string }> {
  const gs = await prisma.ghlSettings.findFirst({
    where: { userId: accountOwnerUserId },
    select: { ghlLocationId: true },
  })
  if (gs?.ghlLocationId) {
    return {
      href: `https://crm.omniply.io/v2/location/${gs.ghlLocationId}/`,
      label: 'Open your CRM, then open Omniply from the sidebar',
    }
  }
  return { href: `${baseUrl()}/dashboard`, label: 'Open your dashboard' }
}

/** Resolve an edit-request target (article or newsletter) scoped to the account. */
async function resolveTarget(
  kind: 'article' | 'newsletter',
  id: string,
  userId: string,
): Promise<{ where: { sitePageId: string } | { newsletterId: string }; refData: { sitePageId?: string; newsletterId?: string }; title: string } | null> {
  if (kind === 'article') {
    const sitePage = await prisma.sitePage.findFirst({
      where: { jobId: id, userId }, // extension → account members
      select: { id: true, title: true },
    })
    if (!sitePage) return null
    return { where: { sitePageId: sitePage.id }, refData: { sitePageId: sitePage.id }, title: sitePage.title }
  }
  const nl = await prisma.newsletter.findFirst({
    where: { id, userId },
    select: { id: true, subjectLine: true, topic: { select: { topic: true } } },
  })
  if (!nl) return null
  return { where: { newsletterId: nl.id }, refData: { newsletterId: nl.id }, title: nl.subjectLine || nl.topic.topic }
}

/**
 * Ensure the assignee has a seat (Veit 2026-09-16: seats are created ONLY at
 * deliberate moments — never silently on SSO). Owner + roster ≤ 3.
 */
async function ensureSeat(
  accountId: string,
  email: string,
  name: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await prisma.account.findUnique({
    where: { id: accountId },
    select: { ownerUserId: true },
  })
  const ownerUser = owner?.ownerUserId
    ? await prisma.user.findUnique({ where: { id: owner.ownerUserId }, select: { email: true } })
    : null
  if (ownerUser?.email?.toLowerCase() === email) return { ok: true }

  const existing = await prisma.accountMember.findUnique({ where: { email } })
  if (existing) {
    return existing.accountId === accountId
      ? { ok: true }
      : { ok: false, error: 'That email belongs to another team.' }
  }
  const rosterCount = await prisma.accountMember.count({ where: { accountId } })
  if (rosterCount >= 2) {
    // owner + 2 roster = 3 seats
    return { ok: false, error: 'Seat limit reached (3 users) — remove a member in Settings → Team first.' }
  }
  await prisma.accountMember.create({ data: { accountId, email, name } })
  logger.info({ accountId, email }, '[edit-requests] seat created for assignee (send-time provisioning)')
  return { ok: true }
}

async function handleCreate(
  kind: 'article' | 'newsletter',
  targetId: string,
  account: { accountId: string; userId: string },
  body: { assigneeEmail?: string; assigneeName?: string; requests?: NewRequest[] } | undefined,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const target = await resolveTarget(kind, targetId, account.userId)
  if (!target) return { status: 404, payload: { error: `${kind === 'article' ? 'Article' : 'Newsletter'} not found` } }

  const requests = (body?.requests ?? []).filter((r) => r.quotedText?.trim() && r.note?.trim())
  if (requests.length === 0) return { status: 400, payload: { error: 'No edit requests provided' } }

  const acct = await prisma.account.findUnique({
    where: { id: account.accountId },
    select: { assistantEmail: true, ownerUserId: true },
  })
  const assigneeEmail = (body?.assigneeEmail ?? acct?.assistantEmail ?? '').trim().toLowerCase()
  if (!assigneeEmail) return { status: 400, payload: { error: 'No assignee email (pick a teammate or set a default in Settings → Team).' } }

  const seat = await ensureSeat(account.accountId, assigneeEmail, body?.assigneeName?.trim() || null)
  if (!seat.ok) return { status: 409, payload: { error: seat.error } }

  const member = await prisma.user.findFirst({
    where: { accountId: account.accountId, email: assigneeEmail },
    select: { id: true },
  })

  const reviewRoundId = randomUUID()
  const writes: Parameters<typeof prisma.$transaction>[0] = [
    prisma.articleEditRequest.createMany({
      data: requests.map((r) => ({
        ...target.refData,
        reviewRoundId,
        requestedByUserId: account.userId,
        assigneeEmail,
        assigneeUserId: member?.id ?? null,
        quotedText: r.quotedText.trim(),
        prefixContext: r.prefixContext?.trim() || null,
        suffixContext: r.suffixContext?.trim() || null,
        note: r.note.trim(),
      })),
    }),
  ] as never
  if ('sitePageId' in target.refData && target.refData.sitePageId) {
    ;(writes as unknown as unknown[]).push(
      prisma.sitePage.update({ where: { id: target.refData.sitePageId }, data: { reviewState: 'edits_requested' } }),
    )
  }
  await prisma.$transaction(writes as never)

  const ownerId = acct?.ownerUserId ?? account.userId
  const { href, label } = await notificationLink(ownerId)
  await sendTransactionalEmail({
    to: assigneeEmail,
    subject: `${requests.length} edit request(s) on "${target.title}"`,
    html: `<p>You've been asked to make ${requests.length} edit(s) on <strong>${target.title}</strong>.</p><p><a href="${href}">${label} →</a></p><p>Open <strong>My Content</strong> and you'll see the edit requests waiting for you.</p>`,
    text: `You've been asked to make ${requests.length} edit(s) on "${target.title}".\n\n${label}: ${href}\n\nOpen My Content — the edit requests will be waiting for you.`,
  }).catch((err) => logger.warn({ err }, '[edit-requests] assignee email failed'))

  return { status: 201, payload: { reviewRoundId, count: requests.length } }
}

export async function editRequestRoutes(app: FastifyInstance) {
  // POST /articles/:jobId/edit-requests — reviewer sends a batch to a teammate
  app.post<{ Params: { jobId: string }; Body: { assigneeEmail?: string; assigneeName?: string; requests?: NewRequest[] } }>(
    '/articles/:jobId/edit-requests',
    async (request, reply) => {
      const account = await requireAccount(request, reply)
      if (!account) return
      const res = await handleCreate('article', request.params.jobId, account, request.body)
      return reply.status(res.status).send(res.payload)
    },
  )

  // POST /newsletters/:id/edit-requests — same flow for editions (review UX)
  app.post<{ Params: { id: string }; Body: { assigneeEmail?: string; assigneeName?: string; requests?: NewRequest[] } }>(
    '/newsletters/:id/edit-requests',
    async (request, reply) => {
      const account = await requireAccount(request, reply)
      if (!account) return
      const res = await handleCreate('newsletter', request.params.id, account, request.body)
      return reply.status(res.status).send(res.payload)
    },
  )

  // GET /articles/:jobId/edit-requests — assistant panel + reviewer view
  app.get<{ Params: { jobId: string } }>('/articles/:jobId/edit-requests', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return

    const sitePage = await prisma.sitePage.findFirst({
      where: { jobId: request.params.jobId, userId: account.userId },
      select: { id: true, reviewState: true },
    })
    if (!sitePage) return reply.status(404).send({ error: 'Article not found' })

    const requests = await prisma.articleEditRequest.findMany({
      where: { sitePageId: sitePage.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, quotedText: true, prefixContext: true, suffixContext: true, note: true, status: true, createdAt: true },
    })
    const openCount = requests.filter((r) => r.status === 'open').length
    return reply.send({ reviewState: sitePage.reviewState, requests, openCount })
  })

  // GET /newsletters/:id/edit-requests
  app.get<{ Params: { id: string } }>('/newsletters/:id/edit-requests', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return
    const nl = await prisma.newsletter.findFirst({
      where: { id: request.params.id, userId: account.userId },
      select: { id: true },
    })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
    const requests = await prisma.articleEditRequest.findMany({
      where: { newsletterId: nl.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, quotedText: true, prefixContext: true, suffixContext: true, note: true, status: true, createdAt: true },
    })
    const openCount = requests.filter((r) => r.status === 'open').length
    return reply.send({ requests, openCount })
  })

  // GET /edit-requests/mine — the embed's pickup banner: open requests
  // assigned to the current user, grouped by target.
  app.get('/edit-requests/mine', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return
    const me = await prisma.user.findUnique({ where: { id: account.userId }, select: { email: true } })
    if (!me?.email) return reply.send({ targets: [] })

    const open = await prisma.articleEditRequest.findMany({
      where: { assigneeEmail: me.email.toLowerCase(), status: 'open' },
      select: {
        sitePageId: true,
        newsletterId: true,
        sitePage: { select: { jobId: true, title: true, userId: true } },
        newsletter: { select: { id: true, subjectLine: true, userId: true, topic: { select: { topic: true } } } },
      },
    })
    const groups = new Map<string, { kind: 'article' | 'newsletter'; id: string; title: string; count: number }>()
    for (const r of open) {
      if (r.sitePage?.jobId) {
        const key = `a:${r.sitePage.jobId}`
        const g = groups.get(key) ?? { kind: 'article' as const, id: r.sitePage.jobId, title: r.sitePage.title, count: 0 }
        g.count++
        groups.set(key, g)
      } else if (r.newsletter) {
        const key = `n:${r.newsletter.id}`
        const g =
          groups.get(key) ??
          ({ kind: 'newsletter' as const, id: r.newsletter.id, title: r.newsletter.subjectLine || r.newsletter.topic.topic, count: 0 })
        g.count++
        groups.set(key, g)
      }
    }
    return reply.send({ targets: [...groups.values()] })
  })

  // PATCH /edit-requests/:id { status } — assistant resolves / reopens
  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/edit-requests/:id', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return

    const status = request.body?.status
    if (!status || !['open', 'resolved', 'wont_fix'].includes(status)) {
      return reply.status(400).send({ error: 'status must be open | resolved | wont_fix' })
    }

    const er = await prisma.articleEditRequest.findUnique({
      where: { id: request.params.id },
      select: { id: true, sitePageId: true, newsletterId: true },
    })
    if (!er) return reply.status(404).send({ error: 'Edit request not found' })
    const owned = er.sitePageId
      ? await prisma.sitePage.findFirst({ where: { id: er.sitePageId, userId: account.userId }, select: { id: true } })
      : er.newsletterId
        ? await prisma.newsletter.findFirst({ where: { id: er.newsletterId, userId: account.userId }, select: { id: true } })
        : null
    if (!owned) return reply.status(404).send({ error: 'Edit request not found' })

    const updated = await prisma.articleEditRequest.update({
      where: { id: request.params.id },
      data: {
        status,
        resolvedByUserId: status === 'open' ? null : account.userId,
        resolvedAt: status === 'open' ? null : new Date(),
      },
    })
    return reply.send({ request: updated })
  })

  // POST /articles/:jobId/request-review — assistant hands back for re-review
  app.post<{ Params: { jobId: string } }>('/articles/:jobId/request-review', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return

    const sitePage = await prisma.sitePage.findFirst({
      where: { jobId: request.params.jobId, userId: account.userId },
      select: { id: true, title: true },
    })
    if (!sitePage) return reply.status(404).send({ error: 'Article not found' })
    await prisma.sitePage.update({ where: { id: sitePage.id }, data: { reviewState: 're_review_requested' } })
    await notifyReviewer({ sitePageId: sitePage.id }, sitePage.title, account.accountId)
    return reply.send({ ok: true })
  })

  // POST /newsletters/:id/request-review — newsletter twin
  app.post<{ Params: { id: string } }>('/newsletters/:id/request-review', async (request, reply) => {
    const account = await requireAccount(request, reply)
    if (!account) return
    const nl = await prisma.newsletter.findFirst({
      where: { id: request.params.id, userId: account.userId },
      select: { id: true, subjectLine: true, topic: { select: { topic: true } } },
    })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
    await notifyReviewer({ newsletterId: nl.id }, nl.subjectLine || nl.topic.topic, account.accountId)
    return reply.send({ ok: true })
  })
}

async function notifyReviewer(
  where: { sitePageId: string } | { newsletterId: string },
  title: string,
  accountId: string,
): Promise<void> {
  const lastRound = await prisma.articleEditRequest.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { requestedByUserId: true },
  })
  if (!lastRound) return
  const reviewer = await prisma.user.findUnique({
    where: { id: lastRound.requestedByUserId },
    select: { email: true, name: true },
  })
  if (!reviewer?.email) return
  const acct = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  const { href, label } = await notificationLink(acct?.ownerUserId ?? lastRound.requestedByUserId)
  await sendTransactionalEmail({
    to: reviewer.email,
    subject: `Your requested edits on "${title}" are ready to review`,
    html: `<p>Hi ${reviewer.name ?? 'there'},</p><p>The edits you requested on <strong>${title}</strong> have been made and it's ready for your review.</p><p><a href="${href}">${label} →</a></p>`,
    text: `The edits you requested on "${title}" are ready to review.\n\n${label}: ${href}`,
  }).catch((err) => logger.warn({ err }, '[edit-requests] reviewer email failed'))
}
