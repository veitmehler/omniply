import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma, brandSettingsForUser, ghlSettingsForUser, canonicalAccountUserId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import {
  renderAndSave,
  renderEditPreview,
  regenerateNewsletterSection,
  toRenderBrand,
  type NewsletterSection,
} from '../newsletter/generate'
import { getNewsletterEmailConfig, type NewsletterEmailConfig } from '../lib/ghl/settings'
import { renderNewsletterHtml, type RenderBrand, type RenderInput } from '../newsletter/render'
import { findAlternateVideo, explicitVideo } from '../newsletter/research'
import { processLogo } from '../newsletter/logo-process'
import { maybeEnqueueNewsletterSocialAutomation } from '../social/automation/enqueue'
import { generateWithGeminiImage, uploadBufferWithKey, deleteOldVersions, deleteS3Keys } from '@omniply/shared'
import { getSystemApiKey } from '../lib/system-keys'
import { vtoken } from '../newsletter/image-overlay'
import { runNewsletterPrompt } from '../newsletter/llm'
import { cleanTextOutput } from '../article-pipeline/output-cleaner'
import { computeSendAt } from '../handlers/promo-email-generate'
import {
  createGhlEmailCampaign,
  scheduleGhlEmailCampaign,
  deleteGhlEmailCampaign,
  formatLocalSendAt,
  type GhlEmailMeta,
} from '../lib/ghl/client'

const J = (v: unknown): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue

const REGEN_SECTIONS: NewsletterSection[] = [
  'feature',
  'secondary',
  'teasers',
  'quickHits',
  'fun',
  'modules',
  'subject',
  'preview',
  'summaryImage',
  'all',
]

// JSON section columns that inline edit (PATCH) may overwrite wholesale.
const EDITABLE_JSON = ['featureArticle', 'secondaryArticle', 'teasers', 'quickHits', 'fun', 'modules'] as const

/** Allowlist HTML sanitizer for client-edited section content (review UX).
 *  The render normalizer restyles everything anyway — this only has to make
 *  stored content safe: no scripts, no event handlers, no foreign tags. */
export function sanitizeEditedHtml(html: string): string {
  let out = html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>(?:)/gi, '')
  const ALLOWED = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'br', 'div', 'span', 'u'])
  out = out.replace(/<\/?([a-z][a-z0-9]*)([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase()
    if (!ALLOWED.has(t)) return ''
    if (m.startsWith('</')) return `</${t}>`
    if (t === 'a') {
      const href = /href="(https?:[^"]+)"/i.exec(attrs)?.[1]
      return href ? `<a href="${href}" target="_blank">` : '<a>'
    }
    return `<${t}>`
  })
  return out
}

/** Deep-sanitize every string in a client-submitted section payload. */
function sanitizeSectionPayload<T>(value: T): T {
  if (typeof value === 'string') return (value.includes('<') ? sanitizeEditedHtml(value) : value) as T
  if (Array.isArray(value)) return value.map((v) => sanitizeSectionPayload(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeSectionPayload(v)
    return out as T
  }
  return value
}

// BrandSettings.nl* string fields the template editor controls.
const TEMPLATE_FIELDS = [
  'nlHeaderBgColor',
  'nlFooterBgColor',
  'nlSectionColor1',
  'nlSectionColor2',
  'nlSectionColor3',
  'nlSectionColor4',
  'nlBandTextColor',
  'nlBodyFontSize',
  'nlFooterTextColor',
  'nlSectionsDisabled',
  'nlFontFamily',
  'nlFontColor',
  'nlHeadingFontWeight',
  'nlBodyFontWeight',
  'nlLinkColor',
  'nlButtonColor',
  'nlButtonTextColor',
  'nlHeaderTextColor',
  'nlHeaderLogoLayout',
  'nlLogoUrl',
  'nlHeaderLogoVariant',
  'nlLogoColorUrl',
  'nlFooterLogoVariant',
  'nlFooterDisclaimer',
] as const

// GhlSettings.newsletter* delivery fields the user configures.
const DELIVERY_FIELDS = [
  'newsletterTagId',
  'newsletterTagName',
  'newsletterSendTime',
  'newsletterTimezone',
  'newsletterFromName',
  'newsletterFromEmail',
] as const

// A representative edition used for the live template preview.
const SAMPLE_PREVIEW: RenderInput = {
  previewText: 'A taste of how your newsletter will look',
  featureArticle: {
    title: 'Your Feature Story',
    teaser: '',
    tldr: 'The quick summary your readers see first.',
    body: '<h2>A section heading</h2><p>This is where the feature article body appears, in your chosen fonts and colors.</p><ul><li>Point one</li><li>Point two</li></ul>',
    imageUrl: null,
  },
  teasers: [
    { headline: 'A Curated Article Headline', title: 'A highlight', body: '<p>A short, voiced teaser of a curated article.</p>', cta: '<p>Worth a read.</p>', link: 'https://example.com' },
  ],
  quickHits: { tips: ['A punchy, practical tip', 'Another quick win'], facts: ['A surprising did-you-know fact'] },
  fun: { triviaQuestion: 'A curious question?', triviaAnswer: 'The satisfying answer.', joke: '<p>A light setup…</p><p>…and the payoff.</p>' },
  modules: null,
  video: null,
  summaryImageUrl: null,
}

function pick<T extends Record<string, unknown>>(src: T | null, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!src) {
    for (const k of keys) out[k] = null
    return out
  }
  for (const k of keys) out[k] = (src as Record<string, unknown>)[k] ?? null
  return out
}

async function resolveUserId(clerkId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } })
  return user?.id ?? null
}

/** Create + schedule the GHL campaign for one ready edition. Throws on failure. */
async function approveOne(
  newsletterId: string,
  userId: string,
  config: NewsletterEmailConfig,
): Promise<{ campaignId: string; scheduledFor: Date }> {
  const nl = await prisma.newsletter.findFirst({
    where: { id: newsletterId, userId },
    include: { topic: { select: { date: true, topic: true } } },
  })
  if (!nl) throw new Error('Newsletter not found')

  // Freeze the CURRENT design at approval (Option B, Veit 2026-09-16):
  // unsent editions always preview fresh, so what was just seen is what sends.
  const html = await renderAndSave(newsletterId)

  const subject = nl.subjectLine || nl.topic.topic
  const meta: GhlEmailMeta = {
    subject,
    fromName: config.fromName ?? config.fromEmail,
    fromEmail: config.fromEmail,
    previewText: nl.previewText ?? '',
  }

  // Reuse a campaign from a prior attempt (idempotent retry).
  let campaignId = nl.ghlCampaignId
  if (!campaignId) {
    const created = await createGhlEmailCampaign({
      apiKey: config.apiKey,
      locationId: config.locationId,
      name: `Newsletter — ${subject}`.slice(0, 120),
      meta,
      bodyHtml: html,
      timeZone: config.timezone,
      userId: config.ghlUserId,
    })
    campaignId = created.campaignId
    await prisma.newsletter.update({ where: { id: newsletterId }, data: { ghlCampaignId: campaignId } })
  }

  // topic.date is a date-only value (UTC midnight) → read its day in UTC so the
  // edition sends on the date the user picked, regardless of their timezone.
  const sendAtUtc = computeSendAt(nl.topic.date, config.sendTime, config.timezone, new Date(), true)
  const sendAtLocal = formatLocalSendAt(sendAtUtc, config.timezone)
  try {
    await scheduleGhlEmailCampaign({
      apiKey: config.apiKey,
      locationId: config.locationId,
      campaignId,
      meta,
      tagIds: config.tagIds,
      timeZone: config.timezone,
      userId: config.ghlUserId,
      sendAt: sendAtLocal,
    })
  } catch (scheduleErr) {
    try {
      await deleteGhlEmailCampaign(config.apiKey, config.locationId, campaignId)
      await prisma.newsletter.update({ where: { id: newsletterId }, data: { ghlCampaignId: null } })
    } catch (rollbackErr) {
      logger.warn({ newsletterId, campaignId, rollbackErr }, '[newsletters] rollback failed')
    }
    throw scheduleErr
  }

  await prisma.newsletter.update({
    where: { id: newsletterId },
    data: { status: 'scheduled', ghlCampaignId: campaignId, scheduledFor: sendAtUtc, approvedAt: new Date() },
  })

  // Fan out the weekly-cadence social posts for this newsletter (best-effort).
  await maybeEnqueueNewsletterSocialAutomation(newsletterId).catch((err: unknown) =>
    logger.warn({ newsletterId, err }, '[newsletters] social automation enqueue failed (non-fatal)'),
  )

  return { campaignId, scheduledFor: sendAtUtc }
}

export async function newsletterRoutes(app: FastifyInstance) {
  // GET /newsletters?status=ready_for_review
  app.get<{ Querystring: { status?: string } }>('/newsletters', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const status = request.query.status
    const rows = await prisma.newsletter.findMany({
      where: { userId, ...(status ? { status } : {}) },
      select: {
        id: true,
        status: true,
        subjectLine: true,
        validation: true,
        scheduledFor: true,
        updatedAt: true,
        topic: { select: { date: true, topic: true, calendar: { select: { name: true } } } },
      },
      orderBy: { topic: { date: 'asc' } },
    })
    return reply.send({ newsletters: rows })
  })

  // GET /newsletters/:id/social-automation — the newsletter's social run(s) for preview/approval
  app.get<{ Params: { id: string } }>('/newsletters/:id/social-automation', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const { id } = request.params
    const nl = await prisma.newsletter.findFirst({ where: { id, userId }, select: { id: true } })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })

    const runs = await prisma.socialAutomationRun.findMany({
      where: { newsletterId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        specResults: { orderBy: { slotKey: 'asc' } },
        _count: { select: { posts: true } },
      },
    })
    return reply.send({ runs })
  })

  // GET /newsletters/:id
  app.get<{ Params: { id: string } }>('/newsletters/:id', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const nl = await prisma.newsletter.findFirst({
      where: { id: request.params.id, userId },
      include: { topic: { select: { date: true, topic: true, secondaryTopic: true, calendar: { select: { name: true } } } } },
    })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })

    // Option B (Veit 2026-09-16): UNSENT editions always render fresh from
    // stored parts + CURRENT brand/template — template edits show up
    // immediately in every unsent preview. Approved/scheduled/sent editions
    // serve the HTML frozen at approval.
    const UNSENT = ['pending', 'researching', 'generating', 'ready_for_review', 'failed']
    if (UNSENT.includes(nl.status) || !nl.renderedHtml) {
      try {
        nl.renderedHtml = await renderAndSave(nl.id)
      } catch (err) {
        logger.warn({ id: nl.id, err }, '[newsletters] fresh render failed — serving cached html')
      }
    }
    return reply.send({ newsletter: nl })
  })

  // GET /newsletters/:id/edit-preview — fresh EDIT-MODE render (WYSIWYG):
  // data-nl-section anchors + the iframe bridge script. Never cached.
  app.get<{ Params: { id: string } }>('/newsletters/:id/edit-preview', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const nl = await prisma.newsletter.findFirst({
      where: { id: request.params.id, userId },
      include: { topic: true },
    })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
    const html = await renderEditPreview(nl.id)
    return reply.type('text/html').send(html)
  })

  // POST /newsletters/:id/video { url? } — review UX: "use my link" (url set)
  // or "find another" (no url → next search hit excluding already-seen ones).
  app.post<{ Params: { id: string }; Body: { url?: string } }>(
    '/newsletters/:id/video',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })
      const nl = await prisma.newsletter.findFirst({
        where: { id: request.params.id, userId },
        select: { id: true, status: true, topicId: true },
      })
      if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
      if (nl.status !== 'ready_for_review') {
        return reply.status(400).send({ error: `Cannot change the video in status "${nl.status}"` })
      }
      const topic = await prisma.newsletterTopic.findUnique({ where: { id: nl.topicId! } })
      if (!topic) return reply.status(404).send({ error: 'Topic not found' })
      const research = (topic.research as Record<string, unknown> | null) ?? {}
      const current = (research.video ?? {}) as { url?: string | null; rejectedUrls?: string[] }

      const url = request.body?.url?.trim()
      let video
      let rejected = current.rejectedUrls ?? []
      if (url) {
        if (!/^https:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/|vimeo\.com\/)/i.test(url)) {
          return reply.status(400).send({ error: 'Paste a YouTube or Vimeo link (https://…)' })
        }
        video = await explicitVideo(topic.id, url)
      } else {
        rejected = [...rejected, ...(current.url ? [current.url] : [])]
        video = await findAlternateVideo(topic.id, rejected)
        if (!video) return reply.status(404).send({ error: 'No other video found — try pasting a link instead' })
      }
      await prisma.newsletterTopic.update({
        where: { id: topic.id },
        data: { research: J({ ...research, video: { ...video, rejectedUrls: rejected } }) },
      })
      await renderAndSave(nl.id)
      const updated = await prisma.newsletter.findUnique({
        where: { id: nl.id },
        include: { topic: { select: { date: true, topic: true, secondaryTopic: true, calendar: { select: { name: true } } } } },
      })
      return reply.send({ newsletter: updated })
    },
  )

  // POST /newsletters/:id/regenerate { section }
  app.post<{ Params: { id: string }; Body: { section?: string } }>(
    '/newsletters/:id/regenerate',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })

      const section = request.body?.section as NewsletterSection | undefined
      if (!section || !REGEN_SECTIONS.includes(section)) {
        return reply.status(400).send({ error: `section must be one of: ${REGEN_SECTIONS.join(', ')}` })
      }

      const nl = await prisma.newsletter.findFirst({
        where: { id: request.params.id, userId },
        select: { id: true, status: true },
      })
      if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
      if (nl.status !== 'ready_for_review') {
        return reply.status(400).send({ error: `Cannot regenerate an edition in status "${nl.status}"` })
      }

      try {
        await regenerateNewsletterSection(nl.id, section)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ error: message })
      }
      const updated = await prisma.newsletter.findUnique({
        where: { id: nl.id },
        include: { topic: { select: { date: true, topic: true, secondaryTopic: true, calendar: { select: { name: true } } } } },
      })
      return reply.send({ newsletter: updated })
    },
  )

  // PATCH /newsletters/:id — inline edits (subjectLine, previewText, section JSON)
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/newsletters/:id',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })

      const nl = await prisma.newsletter.findFirst({
        where: { id: request.params.id, userId },
        select: { id: true, status: true },
      })
      if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
      if (nl.status !== 'ready_for_review') {
        return reply.status(400).send({ error: `Cannot edit an edition in status "${nl.status}"` })
      }

      const body = request.body ?? {}
      const data: Prisma.NewsletterUpdateInput = {}
      if (typeof body.subjectLine === 'string') data.subjectLine = body.subjectLine
      if (typeof body.previewText === 'string') data.previewText = body.previewText
      for (const key of EDITABLE_JSON) {
        if (body[key] !== undefined) {
          ;(data as Record<string, unknown>)[key] = J(sanitizeSectionPayload(body[key]))
        }
      }
      if (Array.isArray(body.sectionsDisabled)) {
        ;(data as Record<string, unknown>).sectionsDisabled = J(
          (body.sectionsDisabled as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 20),
        )
      }
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'No editable fields provided' })
      }

      await prisma.newsletter.update({ where: { id: nl.id }, data })
      await renderAndSave(nl.id) // re-render + re-validate from the edited row
      const updated = await prisma.newsletter.findUnique({
        where: { id: nl.id },
        include: { topic: { select: { date: true, topic: true, secondaryTopic: true, calendar: { select: { name: true } } } } },
      })
      return reply.send({ newsletter: updated })
    },
  )

  // POST /newsletters/:id/approve
  app.post<{ Params: { id: string } }>('/newsletters/:id/approve', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const config = await getNewsletterEmailConfig(userId)
    if (!config) {
      return reply.status(400).send({
        error: 'Newsletter delivery is not configured — set a GHL tag and From email in newsletter settings.',
      })
    }

    const nl = await prisma.newsletter.findFirst({
      where: { id: request.params.id, userId },
      select: { id: true, status: true },
    })
    if (!nl) return reply.status(404).send({ error: 'Newsletter not found' })
    if (nl.status !== 'ready_for_review') {
      return reply.status(400).send({ error: `Cannot approve an edition in status "${nl.status}"` })
    }

    try {
      const result = await approveOne(nl.id, userId, config)
      return reply.send({ status: 'scheduled', ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ id: nl.id, err }, '[newsletters] approve failed')
      return reply.status(502).send({ error: message })
    }
  })

  // POST /newsletters/:id/approve-all — approve every ready edition for the user
  app.post('/newsletters/approve-all', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const config = await getNewsletterEmailConfig(userId)
    if (!config) {
      return reply.status(400).send({
        error: 'Newsletter delivery is not configured — set a GHL tag and From email in newsletter settings.',
      })
    }

    const ready = await prisma.newsletter.findMany({
      where: { userId, status: 'ready_for_review' },
      select: { id: true },
      orderBy: { topic: { date: 'asc' } },
    })

    let approved = 0
    const failures: Array<{ id: string; error: string }> = []
    for (const row of ready) {
      try {
        await approveOne(row.id, userId, config)
        approved++
      } catch (err) {
        failures.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return reply.send({ approved, failed: failures.length, total: ready.length, failures })
  })

  // ── Template + delivery settings ───────────────────────────────────────────────

  // GET /newsletters/settings
  app.get('/newsletters/settings', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const brand = await brandSettingsForUser(userId)
    const ghl = await ghlSettingsForUser(userId)

    const template = pick(brand as Record<string, unknown> | null, TEMPLATE_FIELDS)
    template.nlLogoWidth = brand?.nlLogoWidth ?? null
    template.nlFooterLogoWidth = brand?.nlFooterLogoWidth ?? null
    template.nlLogoSourceUrl = brand?.nlLogoSourceUrl ?? null
    template.nlLogoLightUrl = brand?.nlLogoLightUrl ?? null
    template.nlLogoDarkUrl = brand?.nlLogoDarkUrl ?? null

    // Delivery fields fall back to the promo-email config so the editor is
    // pre-filled with the user's existing GHL details (still overridable).
    const PROMO_FALLBACK: Record<string, string> = {
      newsletterTagId: 'promoEmailTagId',
      newsletterTagName: 'promoEmailTagName',
      newsletterSendTime: 'promoEmailSendTime',
      newsletterTimezone: 'promoEmailTimezone',
      newsletterFromName: 'promoEmailFromName',
      newsletterFromEmail: 'promoEmailFromEmail',
    }
    const g = ghl as Record<string, unknown> | null
    const delivery: Record<string, unknown> = {}
    for (const k of DELIVERY_FIELDS) {
      delivery[k] = g?.[k] ?? g?.[PROMO_FALLBACK[k]] ?? null
    }
    const audienceTags = Array.isArray(g?.newsletterTagIds)
      ? (g!.newsletterTagIds as { name?: string }[]).map((t) => t.name).filter(Boolean)
      : []
    return reply.send({
      template,
      delivery,
      audienceTags,
      ghlConnected: !!(ghl?.ghlApiKey && ghl?.ghlLocationId && ghl?.ghlUserId),
    })
  })

  // PUT /newsletters/settings { template?: {...}, delivery?: {...} }
  app.put<{ Body: { template?: Record<string, unknown>; delivery?: Record<string, unknown> } }>(
    '/newsletters/settings',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })

      const { template, delivery } = request.body ?? {}
      // Brand + GHL are account-shared singletons → write to the account owner's row.
      const ownerUserId = await canonicalAccountUserId(userId)

      if (template) {
        const data: Record<string, string | number | null | string[]> = {}
        for (const k of TEMPLATE_FIELDS) {
          if (k === 'nlSectionsDisabled') continue // Json — handled below
          if (template[k] !== undefined) data[k] = (template[k] as string) || null
        }
        if (Array.isArray(template.nlSectionsDisabled)) {
          data.nlSectionsDisabled = (template.nlSectionsDisabled as unknown[]).filter(
            (k): k is string => typeof k === 'string',
          )
        }
        for (const wk of ['nlLogoWidth', 'nlFooterLogoWidth', 'nlBodyFontSize'] as const) {
          if (template[wk] !== undefined) {
            const w = parseInt(String(template[wk]), 10)
            data[wk] = Number.isFinite(w) && w > 0 ? w : null
          }
        }
        if (Object.keys(data).length > 0) {
          await prisma.brandSettings.upsert({
            where: { userId: ownerUserId },
            create: { userId: ownerUserId, ...data },
            update: data,
          })
        }
      }

      if (delivery) {
        const data: Record<string, string | null> = {}
        for (const k of DELIVERY_FIELDS) {
          if (delivery[k] !== undefined) data[k] = (delivery[k] as string) || null
        }
        if (Object.keys(data).length > 0) {
          await prisma.ghlSettings.upsert({
            where: { userId: ownerUserId },
            create: { userId: ownerUserId, ...data },
            update: data,
          })
        }
      }

      return reply.send({ ok: true })
    },
  )

  // POST /newsletters/template-preview { template?: {...} } — live preview HTML
  app.post<{ Body: { template?: Record<string, unknown> } }>(
    '/newsletters/template-preview',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })

      const brand = await brandSettingsForUser(userId)
      // ONE mapping (toRenderBrand) — the previous hand-copied field list
      // silently dropped every field added after it was written
      // (nlHeaderTextColor/nlHeaderLogoLayout/button colors: the review
      // preview ignored the design the client approved at onboarding —
      // found live 2026-09-15). Unsaved editor edits overlay on top.
      const t = (request.body?.template ?? {}) as Record<string, unknown>
      const renderBrand: RenderBrand = { ...toRenderBrand(brand) }
      const OVERLAYABLE: (keyof RenderBrand)[] = [
        'nlLogoUrl', 'nlLogoColorUrl', 'nlHeaderLogoVariant', 'nlFooterLogoVariant', 'nlFooterLogoWidth', 'nlBandTextColor', 'nlFooterTextColor',
        'nlFooterDisclaimer', 'nlLogoWidth', 'nlHeaderBgColor', 'nlFooterBgColor',
        'nlSectionColor1', 'nlSectionColor2', 'nlSectionColor3', 'nlSectionColor4',
        'nlFontFamily', 'nlFontColor', 'nlHeadingFontWeight', 'nlBodyFontWeight',
        'nlLinkColor', 'nlButtonColor', 'nlButtonTextColor', 'nlHeaderTextColor',
        'nlHeaderLogoLayout',
      ]
      for (const k of OVERLAYABLE) {
        if (t[k] !== undefined) (renderBrand as Record<string, unknown>)[k] = t[k]
      }
      return reply.send({ html: renderNewsletterHtml(SAMPLE_PREVIEW, renderBrand) })
    },
  )

  // POST /newsletters/logo/process — generate light/dark variants from the
  // stored source logo (called after a source upload, and on "re-process").
  app.post('/newsletters/logo/process', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })

    const brand = await brandSettingsForUser(userId)
    const sourceUrl = brand?.nlLogoSourceUrl
    if (!sourceUrl) return reply.status(400).send({ error: 'No source logo uploaded yet' })

    try {
      const { lightUrl, darkUrl, colorUrl, colorLuminance } = await processLogo(userId, sourceUrl)
      await prisma.brandSettings.update({
        where: { userId: await canonicalAccountUserId(userId) },
        data: { nlLogoLightUrl: lightUrl, nlLogoDarkUrl: darkUrl, nlLogoColorUrl: colorUrl, nlLogoColorLuminance: colorLuminance },
      })
      return reply.send({ lightUrl, darkUrl, colorUrl })
    } catch (err) {
      logger.error({ userId, err }, '[newsletters] logo processing failed')
      return reply.status(500).send({ error: 'Logo processing failed' })
    }
  })

  // ── Offers ─────────────────────────────────────────────────────────────────
  function offerData(b: Record<string, unknown>): Record<string, unknown> {
    const d: Record<string, unknown> = {}
    if ('title' in b) d.title = String(b.title ?? '')
    if ('body' in b) d.body = String(b.body ?? '')
    if ('ctaLabel' in b) d.ctaLabel = b.ctaLabel ? String(b.ctaLabel) : null
    if ('ctaUrl' in b) d.ctaUrl = b.ctaUrl ? String(b.ctaUrl) : null
    if ('imageUrl' in b) d.imageUrl = b.imageUrl ? String(b.imageUrl) : null
    if ('startDate' in b) d.startDate = b.startDate ? new Date(b.startDate as string) : null
    if ('endDate' in b) d.endDate = b.endDate ? new Date(b.endDate as string) : null
    if ('enabled' in b) d.enabled = !!b.enabled
    if ('sortOrder' in b) d.sortOrder = Number(b.sortOrder) || 0
    return d
  }

  // GET /newsletters/offers — list the user's offers
  app.get('/newsletters/offers', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const offers = await prisma.newsletterOffer.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return reply.send({ offers })
  })

  // POST /newsletters/offers — create
  app.post<{ Body: Record<string, unknown> }>('/newsletters/offers', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const d = offerData(request.body ?? {})
    if (!d.title) return reply.status(400).send({ error: 'Title is required' })
    const offer = await prisma.newsletterOffer.create({
      data: { userId, title: String(d.title), body: String(d.body ?? ''), ...d },
    })
    return reply.status(201).send({ offer })
  })

  // PUT /newsletters/offers/:id — update
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/newsletters/offers/:id',
    async (request, reply) => {
      const clerkId = await requireAuth(request, reply)
      if (!clerkId) return
      const userId = await resolveUserId(clerkId)
      if (!userId) return reply.status(404).send({ error: 'User not found' })
      const existing = await prisma.newsletterOffer.findFirst({ where: { id: request.params.id, userId } })
      if (!existing) return reply.status(404).send({ error: 'Offer not found' })
      const offer = await prisma.newsletterOffer.update({
        where: { id: existing.id },
        data: offerData(request.body ?? {}),
      })
      return reply.send({ offer })
    },
  )

  // DELETE /newsletters/offers/:id
  app.delete<{ Params: { id: string } }>('/newsletters/offers/:id', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const existing = await prisma.newsletterOffer.findFirst({ where: { id: request.params.id, userId } })
    if (!existing) return reply.status(404).send({ error: 'Offer not found' })
    if (existing.imageUrl) {
      try {
        await deleteS3Keys([new URL(existing.imageUrl).pathname.replace(/^\//, '')])
      } catch {
        /* non-fatal */
      }
    }
    await prisma.newsletterOffer.delete({ where: { id: existing.id } })
    return reply.send({ ok: true })
  })

  // POST /newsletters/offers/:id/generate-image — AI 16:9 banner from the offer copy
  app.post<{ Params: { id: string } }>('/newsletters/offers/:id/generate-image', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const offer = await prisma.newsletterOffer.findFirst({ where: { id: request.params.id, userId } })
    if (!offer) return reply.status(404).send({ error: 'Offer not found' })
    const geminiKey = await getSystemApiKey('gemini')
    if (!geminiKey) return reply.status(400).send({ error: 'Gemini API key not configured' })

    const brand = await brandSettingsForUser(userId)
    const prompt = `High-quality, eye-catching advertising banner photo for this promotional offer: "${offer.title}". ${offer.body}. Industry: ${brand?.industry || 'wellness'}. A clean, modern, inviting promotional visual with a strong focal subject and professional lighting. NO text, NO words, NO letters, NO logos in the image — purely a visual. 16:9 banner.`
    try {
      const buf = await generateWithGeminiImage(geminiKey, prompt, 'gemini-3.1-flash-image', '16:9')
      const base = `newsletter/offers/${userId}/${offer.id}-`
      const key = `${base}${vtoken()}.jpg`
      const { url } = await uploadBufferWithKey(key, buf, 'image/jpeg')
      await deleteOldVersions(base, key)
      await prisma.newsletterOffer.update({ where: { id: offer.id }, data: { imageUrl: url } })
      return reply.send({ imageUrl: url })
    } catch (err) {
      logger.error({ offerId: offer.id, err }, '[newsletters] offer image generation failed')
      return reply.status(500).send({ error: 'Image generation failed' })
    }
  })

  // POST /newsletters/offers/draft — AI-draft offer copy from a one-line brief
  app.post<{ Body: { brief?: string } }>('/newsletters/offers/draft', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const userId = await resolveUserId(clerkId)
    if (!userId) return reply.status(404).send({ error: 'User not found' })
    const brief = (request.body?.brief ?? '').trim()
    if (!brief) return reply.status(400).send({ error: 'Brief is required' })
    const brand = await brandSettingsForUser(userId)
    try {
      const { content } = await runNewsletterPrompt('nl_offer_draft', {
        brief,
        industry: brand?.industry ?? '',
        who: brand?.who ?? '',
      })
      const cleaned = cleanTextOutput(content)
      const json = cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)
      const parsed = JSON.parse(json) as { title?: string; body?: string; ctaLabel?: string }
      return reply.send({
        title: parsed.title ?? '',
        body: parsed.body ?? '',
        ctaLabel: parsed.ctaLabel ?? '',
      })
    } catch (err) {
      logger.error({ userId, err }, '[newsletters] offer draft failed')
      return reply.status(500).send({ error: 'Draft failed' })
    }
  })
}
