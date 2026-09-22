import { prisma } from '@omniply/shared'
import { decrypt } from '@omniply/shared'
import { logger } from '../../lib/logger'
import { assertSafeWpUrl } from '../../lib/ssrf'
import { selectWordPressCategory } from '../enrichment/wp-category-selector'
import { selectWordPressTags } from '../enrichment/wp-tag-selector'
import type { OutputPayload, OutputTarget, OutputAttemptResult } from './types'

// ── SEO plugin meta key mappings ──────────────────────────────────────────

type SeoMetaKeys = {
  title: string
  description: string
  focusKeyword?: string
}

const SEO_META_KEYS: Record<string, SeoMetaKeys> = {
  yoast: {
    title:        '_yoast_wpseo_title',
    description:  '_yoast_wpseo_metadesc',
    focusKeyword: '_yoast_wpseo_focuskw',
  },
  rankmath: {
    title:        'rank_math_title',
    description:  'rank_math_description',
    focusKeyword: 'rank_math_focus_keyword',
  },
  aioseo: {
    title:        '_aioseo_title',
    description:  '_aioseo_description',
    focusKeyword: '_aioseo_keywords',
  },
  seopress: {
    title:        '_seopress_titles_title',
    description:  '_seopress_titles_desc',
    focusKeyword: '_seopress_analysis_target_kw',
  },
  theseoframework: {
    title:       '_genesis_title',
    description: '_genesis_description',
    // The SEO Framework has no focus keyword field
  },
}

// ── WordPress API helpers ──────────────────────────────────────────────────

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
}

async function wpFetch(
  siteUrl: string,
  authHeader: string,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${siteUrl.replace(/\/$/, '')}${endpoint}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function uploadWpMedia(
  siteUrl: string,
  authHeader: string,
  imageUrl: string,
  filename: string,
  altText: string,
): Promise<{ id: number; source_url: string }> {
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Could not download image: ${imageUrl}`)
  const imgBuf = await imgRes.arrayBuffer()

  const ext = filename.split('.').pop() ?? 'jpg'
  const contentType = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg'

  const siteBase = siteUrl.replace(/\/$/, '')
  const res = await fetch(`${siteBase}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: imgBuf,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`WP media upload failed (${res.status}): ${err.message ?? res.statusText}`)
  }
  const media = await res.json() as { id: number; source_url: string; alt_text?: string }

  // Set alt text via patch
  if (altText) {
    await fetch(`${siteBase}/wp-json/wp/v2/media/${media.id}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt_text: altText }),
    }).catch(() => {})
  }

  return { id: media.id, source_url: media.source_url }
}

function rewriteImageSrcs(
  html: string,
  urlMap: Map<string, string>,
): string {
  let result = html
  for (const [original, replacement] of urlMap.entries()) {
    result = result.replaceAll(original, replacement)
  }
  return result
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildWordPressCitationsHtml(payload: OutputPayload): string {
  const referenceCitations = payload.citations.filter(
    (c) => c.link_url && c.source_type !== 'inline',
  )
  if (referenceCitations.length === 0) return ''

  const listItems = referenceCitations
    .map(
      (c) =>
        `<li><a href="${escapeHtml(c.link_url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(c.link_title || c.link_url)}</a></li>`,
    )
    .join('\n    ')

  return `<details style="margin-top:2rem;border-top:1px solid #e5e7eb;padding-top:1rem;">
  <summary style="cursor:pointer;list-style:revert;">
    <h5 style="display:inline;margin:0;">Article Citations:</h5>
  </summary>
  <ol style="margin-top:0.75rem;padding-left:1.25rem;">
    ${listItems}
  </ol>
</details>`
}

// ── WordPressTarget ────────────────────────────────────────────────────────

/**
 * Disclaimer footer as per-paragraph styled <p> tags. A single <p> holding
 * multi-paragraph text gets split apart by WordPress's wpautop filter — the
 * first chunk kept our inline style, the rest rendered at theme default
 * (seen live 2026-09-22). Wrapping every paragraph ourselves leaves wpautop
 * nothing to rewrite.
 */
export function wpDisclaimerHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="font-size:0.85em;color:#64748b;margin:0 0 0.75em;"><em>${esc(p).replace(/\n/g, '<br />')}</em></p>`)
    .join('\n')
}

/** Parse "HH:mm" (Settings.wpPublishTime), falling back to 9:00 on anything malformed. */
export function parsePublishTime(raw: string | null | undefined): [number, number] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((raw ?? '').trim())
  if (!m) return [9, 0]
  return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)]
}

/**
 * UTC instant for a wall-clock date+time in an IANA timezone, without a tz
 * library: start from the UTC guess, measure the zone's offset at that
 * instant via Intl, correct once (a second pass handles the rare case where
 * the correction crosses a DST boundary).
 */
export function zonedDateTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date {
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = wallUtc
  for (let i = 0; i < 2; i++) {
    guess = wallUtc - tzOffsetMs(new Date(guess), timeZone)
  }
  return new Date(guess)
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const p: Record<string, number> = {}
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number.parseInt(part.value, 10)
  }
  // Intl uses hour "24" for midnight in some environments.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return asUtc - at.getTime()
}

interface WpConfig {
  connectionId: string
  status?: string
  categoryId?: number
  authorId?: number
}

export class WordPressTarget implements OutputTarget {
  name = 'wordpress'

  async publish(
    payload: OutputPayload,
    config: Record<string, unknown>,
    _attemptId: string,
  ): Promise<OutputAttemptResult> {
    const start = Date.now()
    const { connectionId, status, categoryId, authorId } = config as unknown as WpConfig

    if (!connectionId) throw new Error('WordPress connectionId is required')

    const conn = await prisma.wordPressConnection.findFirst({
      where: { id: connectionId, userId: payload.userId },
      select: {
        id: true, username: true, appPassword: true, siteUrl: true,
        defaultStatus: true, defaultCategoryId: true, defaultAuthorId: true,
        seoPlugin: true,
      },
    })

    if (!conn) {
      throw new Error(
        `WordPress connection not found (id: ${connectionId}). It may have been deleted or belongs to a different account. Please refresh the page and try again.`,
      )
    }

    const plainPassword = decrypt(conn.appPassword)
    const auth = basicAuthHeader(conn.username, plainPassword)
    const siteUrl = conn.siteUrl

    // SSRF guard: refuse to publish to an internal/loopback/link-local target,
    // even if the stored connection's host now resolves somewhere private.
    await assertSafeWpUrl(siteUrl)

    // Resolve topic row for category/tag IDs — select at publish time if not already set
    const jobRow = await prisma.articleJob.findFirst({
      where: { id: payload.jobId },
      select: {
        topicId: true,
        topic: {
          select: { id: true, topic: true, wpCategoryId: true, wpTagIds: true, publishingDate: true, scheduledDate: true },
        },
      },
    })
    const topicRow = jobRow?.topic ?? null
    // A cached "Uncategorized" (WP's default, id 1) is NOT a real selection —
    // it just means the site had no categories at the earlier export (found
    // live 2026-09-23 after the taxonomy bootstrap). Re-select in that case.
    let topicCategory = topicRow?.wpCategoryId && topicRow.wpCategoryId !== 1 ? topicRow.wpCategoryId : null
    let topicTags = topicRow?.wpTagIds ?? []

    const sitePage = await prisma.sitePage.findUnique({
      where: { jobId: payload.jobId },
      select: { title: true },
    })
    const articleTitle = sitePage?.title ?? topicRow?.topic ?? payload.title

    if (topicRow && topicCategory == null && !categoryId) {
      try {
        const cat = await selectWordPressCategory({
          topic: topicRow.topic,
          title: articleTitle,
          siteUrl,
          authHeader: auth,
          jobId: payload.jobId,
        })
        if (cat.categoryId != null) {
          await prisma.topic.update({ where: { id: topicRow.id }, data: { wpCategoryId: cat.categoryId } })
          topicCategory = cat.categoryId
          logger.info({ jobId: payload.jobId, wpCategoryId: cat.categoryId }, '[wordpress] publish-time category selected')
        }
      } catch (err) {
        logger.warn({ jobId: payload.jobId, err }, '[wordpress] publish-time category selection failed — skipping')
      }
    }

    if (topicRow && topicTags.length === 0) {
      try {
        const sel = await selectWordPressTags({
          topic: topicRow.topic,
          title: articleTitle,
          siteUrl,
          authHeader: auth,
          jobId: payload.jobId,
        })
        if (sel.tagIds.length > 0) {
          await prisma.topic.update({ where: { id: topicRow.id }, data: { wpTagIds: sel.tagIds } })
          topicTags = sel.tagIds
          logger.info({ jobId: payload.jobId, tagIds: sel.tagIds }, '[wordpress] publish-time tags selected')
        } else {
          logger.warn({ jobId: payload.jobId }, '[wordpress] publish-time tag selection returned no tags — WP site may have no tags configured')
        }
      } catch (err) {
        logger.warn({ jobId: payload.jobId, err }, '[wordpress] publish-time tag selection failed — skipping')
      }
    }

    // 1. Upload featured image to WP media library
    let featuredMediaId: number | undefined
    if (payload.featuredImage) {
      try {
        const { id } = await uploadWpMedia(
          siteUrl,
          auth,
          payload.featuredImage.cdnUrl,
          `${payload.slug}-featured.jpg`,
          payload.featuredImage.alt,
        )
        featuredMediaId = id
      } catch (err) {
        logger.error({ err, jobId: payload.jobId }, '[wordpress] featured image upload failed')
        throw new Error(`Featured image upload failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 2. Upload diagrams to WP — SVG first, PNG as fallback.
    // bodyHtml contains SVG CDN URLs, so the map key must be svgCdnUrl.
    const diagramUrlMap = new Map<string, string>()
    for (const d of payload.diagrams) {
      const svgSrc = d.svgCdnUrl // what bodyHtml contains in <img src>

      // Attempt SVG upload (preferred — same fidelity, smaller DOM footprint)
      if (d.svgS3Key) {
        try {
          const { source_url } = await uploadWpMedia(
            siteUrl,
            auth,
            d.svgCdnUrl,
            `${payload.slug}-diagram-${d.position}.svg`,
            d.caption ?? d.sectionTitle,
          )
          diagramUrlMap.set(svgSrc, source_url)
          continue
        } catch (err) {
          logger.warn(
            { err, jobId: payload.jobId, position: d.position },
            '[wordpress] SVG upload failed — trying PNG fallback',
          )
        }
      }

      // PNG fallback (e.g. WP site blocks SVG uploads without a plugin)
      try {
        const { source_url } = await uploadWpMedia(
          siteUrl,
          auth,
          d.cdnUrl,
          `${payload.slug}-diagram-${d.position}.png`,
          d.caption ?? d.sectionTitle,
        )
        diagramUrlMap.set(svgSrc, source_url)
      } catch (err) {
        logger.warn(
          { err, jobId: payload.jobId, position: d.position },
          '[wordpress] diagram upload failed — using CDN fallback',
        )
      }
    }

    let wpReadyHtml = rewriteImageSrcs(payload.bodyHtml, diagramUrlMap)

    const citationsHtml = buildWordPressCitationsHtml(payload)
    if (citationsHtml) {
      wpReadyHtml += `\n${citationsHtml}`
    }

    // Disclaimer footer — generated for every article (YMYL compliance for
    // health content; publisher disclosure for B2B) but previously rendered
    // only by the html target, never on WordPress. Escaped as text.
    if (payload.disclaimer?.trim()) {
      wpReadyHtml += `\n<hr />\n${wpDisclaimerHtml(payload.disclaimer)}`
    }

    // Clinic themes know nothing about our .article-toc class — carry the
    // spacing inline so the ToC never sits flush against the first section.
    wpReadyHtml = wpReadyHtml.replace(
      '<nav class="article-toc"',
      '<nav class="article-toc" style="margin:0 0 1.5em;"',
    )

    // Append JSON-LD schema markup so it is published with the post regardless of plugin.
    if (payload.schemaJson?.trim()) {
      wpReadyHtml += `\n<script type="application/ld+json">\n${payload.schemaJson.trim()}\n</script>`
    }

    // 3. Create the WP post — schedule by the article's NOMINAL date.
    // Precedence: explicit config.status > nominal-date scheduling >
    // conn.defaultStatus (legacy) > 'draft'. Scheduling: the topic's
    // publishing/scheduled date at Settings.wpPublishTime in the clinic's
    // socialTimezone — future dates become WP 'future' (auto-publish on the
    // day), today/past publish immediately with the nominal date preserved.
    const nominalDate = topicRow?.publishingDate ?? topicRow?.scheduledDate ?? null
    let postStatus = status ?? conn.defaultStatus ?? 'draft'
    let postDateGmt: string | undefined
    if (!status && nominalDate) {
      const userSettings = await prisma.settings.findUnique({
        where: { userId: payload.userId },
        select: { socialTimezone: true, wpPublishTime: true },
      })
      const tz = userSettings?.socialTimezone?.trim() || 'America/New_York'
      const [hh, mm] = parsePublishTime(userSettings?.wpPublishTime)
      const publishAt = zonedDateTimeToUtc(
        nominalDate.getUTCFullYear(), nominalDate.getUTCMonth() + 1, nominalDate.getUTCDate(), hh, mm, tz,
      )
      postStatus = publishAt.getTime() > Date.now() ? 'future' : 'publish'
      postDateGmt = publishAt.toISOString().replace(/\.\d{3}Z$/, '')
      logger.info(
        { jobId: payload.jobId, postStatus, postDateGmt, tz },
        '[wordpress] scheduling post by nominal article date',
      )
    }
    const categories = categoryId
      ? [categoryId]
      : topicCategory != null
        ? [topicCategory]
        : conn.defaultCategoryId
          ? [conn.defaultCategoryId]
          : []
    const author = authorId ?? conn.defaultAuthorId ?? undefined

    const seoKeys = conn.seoPlugin ? SEO_META_KEYS[conn.seoPlugin] : undefined
    const seoMeta = seoKeys
      ? {
          [seoKeys.title]: payload.seoTitle,
          [seoKeys.description]: payload.seoDescription,
          ...(seoKeys.focusKeyword ? { [seoKeys.focusKeyword]: payload.primaryKeyword } : {}),
        }
      : undefined

    const postBody: Record<string, unknown> = {
      title: payload.title,
      slug: payload.slug,
      content: wpReadyHtml,
      excerpt: payload.excerpt,
      status: postStatus,
      ...(postDateGmt ? { date_gmt: postDateGmt } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      ...(topicTags.length > 0 ? { tags: topicTags } : {}),
      ...(author ? { author } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      ...(seoMeta ? { meta: seoMeta } : {}),
    }

    const { status: wpStatus, data: post } = await wpFetch(
      siteUrl,
      auth,
      'POST',
      '/wp-json/wp/v2/posts',
      postBody,
    )

    if (wpStatus !== 201) {
      const msg = (post as { message?: string }).message ?? `WP returned ${wpStatus}`

      // Slug collision — retry with jobId suffix
      if (wpStatus === 409 || (typeof msg === 'string' && msg.includes('slug'))) {
        const fallbackSlug = `${payload.slug}-${payload.jobId.slice(0, 8)}`
        const { status: s2, data: post2 } = await wpFetch(
          siteUrl,
          auth,
          'POST',
          '/wp-json/wp/v2/posts',
          { ...postBody, slug: fallbackSlug },
        )
        if (s2 !== 201) {
          throw new Error(`WP post creation failed (${s2}): ${(post2 as { message?: string }).message ?? s2}`)
        }
        const p2 = post2 as { id: number; link: string }
        return { success: true, resultUrl: p2.link, targetRefId: String(p2.id), durationMs: Date.now() - start }
      }

      throw new Error(`WP post creation failed (${wpStatus}): ${msg}`)
    }

    const p = post as { id: number; link: string }
    return {
      success: true,
      resultUrl: p.link,
      targetRefId: String(p.id),
      durationMs: Date.now() - start,
    }
  }
}
