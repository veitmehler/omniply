/**
 * Lead-gen branding compiler (leadgen plan Phase 4, Model B).
 *
 * Master = designed HTML with {{brand.*}} tokens and <slot name="x">neutral
 * text</slot> content slots. Per clinic: brand tokens applied, eligible slots
 * voice-rewritten under HARD guards (length ratio, numeric tokens survive
 * verbatim, dash sanitizer), rendered to PDF via the pooled Chromium, uploaded
 * to S3 + the account's Drive folder, and parked as pending_review — the
 * review gate is the AHPRA checkpoint (user decision).
 */
import { prisma, uploadBufferWithKey } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { withRasterPage } from '../article-pipeline/enrichment/diagram-browser-pool'
import { sanitizeDashesText } from '../lib/text/dash-sanitizer'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'
import { ensureAccountFolder, uploadPdf, driveConfigured, deleteFile, grantReader } from '../lib/gdrive/client'

const MODEL = 'gemini-3-flash-preview'
/** Active-drip window: leads captured within it get silently regranted on a
 * rotated (recompiled) file so their drip links keep working. */
const COHORT_REGRANT_DAYS = 42
const LENGTH_RATIO_MIN = 0.7
const LENGTH_RATIO_MAX = 1.4

interface SlotMeta {
  maxChars?: number
  rewriteEligible?: boolean
}

export interface BrandTokens {
  organizationName: string
  phone: string
  email: string
  website: string
  address: string
  bookingCta: string
  bookingUrl: string
  openingHours: string
  readerOffer: string
  logoUrl: string
  logoDarkUrl: string
  headerColor: string
  accentColor: string
  fontColor: string
}

/** ROTATION support: grant the recent capture cohort on a fresh file (silent). */
export async function regrantActiveCohort(accountId: string, newFileId: string, documentId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - COHORT_REGRANT_DAYS * 24 * 60 * 60 * 1000)
    const recent = await prisma.leadCapture.findMany({
      where: { document: { accountId }, createdAt: { gte: cutoff }, status: { in: ['captured', 'ghl_failed'] } },
      select: { requesterEmail: true },
      distinct: ['requesterEmail'],
      take: 300,
    })
    for (const r of recent) {
      await grantReader(newFileId, r.requesterEmail, false).catch(() => {})
    }
    if (recent.length) logger.info({ documentId, regranted: recent.length }, '[leadgen-compile] active cohort regranted on new file')
  } catch (err) {
    logger.warn({ documentId, err }, '[leadgen-compile] cohort regrant failed (non-fatal)')
  }
}

/**
 * Repoint the location's omniply-spine-check trigger link at the clinic's
 * live quiz URL (WP page when connected, hosted route otherwise). The comment
 * workflows DM this link — the quiz is the funnel's front door (P3
 * 2026-09-09). Non-fatal like the guide repoints.
 */
export async function repointSpineCheckTriggerLink(userId: string): Promise<void> {
  try {
    const { spineCheckUrlForUser } = await import('../spine-check/generate')
    const url = await spineCheckUrlForUser(userId)
    if (!url) return
    const { getGhlCredentials } = await import('../lib/ghl/settings')
    const creds = await getGhlCredentials(userId)
    if (!creds) return
    const { listTriggerLinks, updateTriggerLink } = await import('../lib/ghl/client')
    const links = await listTriggerLinks(creds.apiKey, creds.locationId)
    const match = links.find((l) => l.name === 'omniply-spine-check')
    if (!match?.id) {
      logger.info({ userId }, '[leadgen-compile] omniply-spine-check link not found (older snapshot) — skipped')
      return
    }
    const ok = await updateTriggerLink(creds.apiKey, match.id, 'omniply-spine-check', url)
    logger.info({ userId, ok, url }, '[leadgen-compile] spine-check trigger link repointed')
  } catch (err) {
    logger.warn({ userId, err }, '[leadgen-compile] spine-check trigger-link repoint failed — non-fatal')
  }
}

/** Repoint the location's omniply-guide-<slug> trigger link at the current Drive file. */
export async function repointGuideTriggerLink(
  userId: string,
  slug: string,
  driveLink: string,
  documentId: string,
): Promise<void> {
  try {
    const { getGhlCredentials } = await import('../lib/ghl/settings')
    const { listTriggerLinks, updateTriggerLink } = await import('../lib/ghl/client')
    const creds = await getGhlCredentials(userId)
    if (!creds) return
    const linkName = `omniply-guide-${slug}`
    const links = await listTriggerLinks(creds.apiKey, creds.locationId)
    const match = links.find((l) => l.name === linkName)
    if (match) {
      const ok = await updateTriggerLink(creds.apiKey, match.id, linkName, driveLink)
    logger.info({ documentId, linkName, ok }, '[leadgen-compile] guide trigger link repointed')
    } else {
      logger.info({ documentId, linkName }, '[leadgen-compile] guide trigger link not found (older snapshot) — skipped')
    }
  } catch (err) {
    logger.warn({ documentId, err }, '[leadgen-compile] guide trigger-link repoint failed — non-fatal')
  }
}

async function brandTokensFor(userId: string): Promise<BrandTokens> {
  const [brand, offer] = await Promise.all([
    prisma.brandSettings.findUnique({ where: { userId } }),
    prisma.newsletterOffer.findFirst({ where: { userId, enabled: true }, orderBy: { createdAt: 'asc' } }),
  ])
  return {
    organizationName: brand?.organizationName ?? 'Your Practice',
    phone: brand?.organizationPhone ?? '',
    email: brand?.organizationEmail ?? '',
    website: brand?.organizationWebsite ?? '',
    address: brand?.geolocation ?? '',
    bookingCta: brand?.socialCallToAction ?? 'Book an appointment',
    bookingUrl: brand?.bookingUrl ?? '',
    openingHours: brand?.openingHours ?? '',
    // Reader offer = the account's first enabled newsletter offer (locked
    // decision 2026-07-23); neutral fallback when none exists yet.
    readerOffer: offer?.title?.trim() || 'Ask about our new-patient assessment when you book',
    // Cover renders on the dark brand color → the light (white-on-transparent)
    // processed variant; legacy single-logo field and org logo as fallbacks.
    logoUrl: brand?.nlLogoLightUrl ?? brand?.nlLogoUrl ?? brand?.organizationLogoUrl ?? '',
    // Back page renders on white → the dark (navy-on-transparent) variant.
    logoDarkUrl: brand?.nlLogoDarkUrl ?? brand?.organizationLogoUrl ?? '',
    // Platform convention (matches social/carousel theming): newsletter palette
    // first, then the settings-page brand colors (diagram* fields), then defaults.
    headerColor: brand?.nlHeaderBgColor ?? brand?.diagramPrimaryColor ?? '#0b2545',
    accentColor: brand?.nlLinkColor ?? brand?.diagramSecondaryColor ?? '#2a6f97',
    fontColor: brand?.nlFontColor ?? brand?.diagramTextColor ?? '#222222',
  }
}

/**
 * Elements marked data-optional="<tokenKey>" are removed entirely when that
 * brand token is empty (opening hours, booking URL, …) — a document must never
 * render an empty label. Keep optional wrappers flat (no nested same-tag).
 */
export function dropEmptyOptionalBlocks(html: string, t: BrandTokens): string {
  return html.replace(
    /<(\w+)[^>]*\bdata-optional="(\w+)"[^>]*>[\s\S]*?<\/\1>/g,
    (m, _tag, key: string) =>
      String((t as unknown as Record<string, string>)[key] ?? '').trim() ? m : '',
  )
}

/** Inline both logo variants as data URIs so the print render never races a network fetch. */
export async function inlineLogo(t: BrandTokens): Promise<BrandTokens> {
  const inline = async (url: string): Promise<string> => {
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) throw new Error(`logo fetch ${res.status}`)
    const mime = res.headers.get('content-type') ?? 'image/png'
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  }
  const out = { ...t }
  for (const key of ['logoUrl', 'logoDarkUrl'] as const) {
    try {
      out[key] = await inline(t[key])
    } catch (err) {
      logger.warn({ err, url: t[key], key }, '[leadgen-compile] logo inline failed — fallback')
      out[key] = ''
    }
  }
  return out
}

const MM = 72 / 25.4 // pt per mm
const STRIP_MM = 13
const SIDE_INSET_MM = 22

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0.04, g: 0.15, b: 0.27 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/**
 * Two-pass assembly (print-geometry redesign, 2026-07-24): the cover renders
 * full-bleed (margin 0, exactly one page); the content renders with honest
 * print margins (18mm top / 26mm bottom) so Chromium GUARANTEES text never
 * enters them; the brand strip is then stamped straight onto each content
 * page with pdf-lib at the true paper bottom (Chromium's footerTemplate box
 * is inset ~5.5mm from the edge and overlaps the content area — measured,
 * unusable). 26mm bottom = 13mm guaranteed air + the 13mm strip.
 */
async function assemblePdf(coverPdf: Buffer, contentPdf: Buffer, t: BrandTokens): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  const cover = await PDFDocument.load(coverPdf)
  const content = await PDFDocument.load(contentPdf)
  const font = await merged.embedFont(StandardFonts.Helvetica)
  const navy = hexToRgb01(t.headerColor)

  for (const pg of await merged.copyPages(cover, cover.getPageIndices())) merged.addPage(pg)
  const contentPages = await merged.copyPages(content, content.getPageIndices())
  const line = [t.phone, t.website.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ')
  for (const pg of contentPages) {
    merged.addPage(pg)
    const { width } = pg.getSize()
    pg.drawRectangle({ x: 0, y: 0, width, height: STRIP_MM * MM, color: rgb(navy.r, navy.g, navy.b) })
    const fontSize = 8.5
    const baseline = (STRIP_MM * MM) / 2 - fontSize * 0.36
    try {
      pg.drawText(t.organizationName, { x: SIDE_INSET_MM * MM, y: baseline, size: fontSize, font, color: rgb(1, 1, 1) })
      const lw = font.widthOfTextAtSize(line, fontSize)
      pg.drawText(line, { x: width - SIDE_INSET_MM * MM - lw, y: baseline, size: fontSize, font, color: rgb(1, 1, 1) })
    } catch (err) {
      logger.warn({ err }, '[leadgen-compile] strip text encoding failed — strip drawn without text')
    }
  }
  return Buffer.from(await merged.save())
}

/** Split the compiled single-html master at the cover marker into two full documents. */
export function splitAtCover(html: string): { coverHtml: string; contentHtml: string } {
  const [pre, post] = html.split('<!--SPLIT-->')
  if (!post) return { coverHtml: '', contentHtml: html }
  const bodyAt = pre.indexOf('<body>')
  return { coverHtml: pre + '</body></html>', contentHtml: pre.slice(0, bodyAt + 6) + post }
}

function applyBrandTokens(html: string, t: BrandTokens): string {
  return dropEmptyOptionalBlocks(html, t).replace(/\{\{brand\.(\w+)\}\}/g, (_m, key: string) =>
    String((t as unknown as Record<string, string>)[key] ?? ''),
  )
}

/** Numeric tokens (claims, dosages, stats) must survive a rewrite verbatim. */
export function numericTokensMatch(a: string, b: string): boolean {
  const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?%?/g) ?? []).sort()
  return JSON.stringify(nums(a)) === JSON.stringify(nums(b))
}

export function rewriteWithinGuards(original: string, rewritten: string, maxChars?: number): boolean {
  const ratio = rewritten.length / Math.max(1, original.length)
  if (ratio < LENGTH_RATIO_MIN || ratio > LENGTH_RATIO_MAX) return false
  if (maxChars && rewritten.length > maxChars) return false
  if (!numericTokensMatch(original, rewritten)) return false
  if (/—|(?<![0-9])–(?![0-9])/.test(rewritten)) return false
  return true
}

async function rewriteSlot(
  geminiKey: string,
  slotText: string,
  writingStyle: string,
  feedbackNote?: string,
): Promise<string | null> {
  try {
    const res = await instrumentCall({ provider: 'gemini', op: 'leadgen.rewrite' }, () =>
      withTimeout(
        (signal) =>
          fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `Rewrite this lead-magnet passage in the practitioner's voice. HARD RULES:
- Keep ALL facts, numbers and claims EXACTLY as written (change nothing factual — this is regulated healthcare content, no new therapeutic claims, no guarantees).
- Keep the length within ±20% of the original.
- Keep any HTML tags exactly where they are.
- No em-dashes.
VOICE: ${writingStyle.slice(0, 1500)}${feedbackNote ? `\nCLIENT FEEDBACK on the previous version (honor it within the rules above): ${feedbackNote}` : ''}

PASSAGE:
${slotText}

Return ONLY the rewritten passage.`,
                    },
                  ],
                },
              ],
              generationConfig: { temperature: 0.5 },
            }),
            signal,
          }),
        60_000,
        'leadgen.rewrite',
      ),
    )
    if (!res.ok) return null
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() || null
  } catch {
    return null
  }
}

export async function compileLeadGenDocument(documentId: string, feedbackNote?: string): Promise<void> {
  const doc = await prisma.leadGenDocument.findUnique({
    where: { id: documentId },
    include: { template: true, account: { select: { name: true, driveFolderId: true } } },
  })
  if (!doc?.template) {
    logger.warn({ documentId }, '[leadgen-compile] no document/template')
    return
  }

  // Special master: the QR review counter card (Phase F) — no rewrite pass,
  // A6 geometry, QR generated per clinic at compile time.
  if ((doc.template.slotMeta as { __kind?: string } | null)?.__kind === 'review_card') {
    return compileReviewCard(doc.id, doc.userId, doc.accountId, doc.template.sourceHtml, {
      name: doc.account.name,
      driveFolderId: doc.account.driveFolderId,
    })
  }

  try {
    const tokens = await brandTokensFor(doc.userId)
    const settings = await prisma.settings.findUnique({ where: { userId: doc.userId }, select: { writingStyle: true } })
    const slotMeta = (doc.template.slotMeta as Record<string, SlotMeta>) ?? {}
    const geminiKey = await getSystemApiKey('gemini')

    // 1. Voice-rewrite eligible slots under guards; fallback = neutral master text.
    let html = doc.template.sourceHtml
    const slotRe = /<slot name="([\w-]+)">([\s\S]*?)<\/slot>/g
    const slots = [...html.matchAll(slotRe)]
    for (const m of slots) {
      const [full, name, original] = m
      const meta = slotMeta[name] ?? {}
      let finalText = original
      if (meta.rewriteEligible !== false && geminiKey && settings?.writingStyle) {
        const rewritten = await rewriteSlot(geminiKey, original, settings.writingStyle, feedbackNote)
        if (rewritten && rewriteWithinGuards(original, rewritten, meta.maxChars)) {
          finalText = await sanitizeDashesText(rewritten, { surface: 'leadgen_slot' })
        } else if (rewritten) {
          logger.info({ documentId, slot: name }, '[leadgen-compile] rewrite failed guards — neutral text kept')
        }
      }
      html = html.replace(full, finalText)
    }

    // 2. Brand tokens (logo inlined as data URI) + two-pass render: full-bleed
    // cover, margin-bounded content, brand strip stamped via pdf-lib.
    const inked = await inlineLogo(tokens)
    html = applyBrandTokens(html, inked)
    const { coverHtml, contentHtml } = splitAtCover(html)
    const [coverPdf, contentPdf] = await withRasterPage(async (page) => {
      await page.setContent(coverHtml || html, { waitUntil: 'load', timeout: 60_000 })
      const c = (await page.pdf({ format: 'a4', printBackground: true })) as Buffer
      await page.setContent(contentHtml, { waitUntil: 'load', timeout: 60_000 })
      const b = (await page.pdf({
        format: 'a4',
        printBackground: true,
        margin: { top: '18mm', bottom: '26mm', left: '0', right: '0' },
      })) as Buffer
      return [c, b]
    })
    const pdf = coverHtml ? await assemblePdf(coverPdf, contentPdf, inked) : contentPdf

    // 3. S3 copy (source of truth) + Drive upload (when configured).
    const pdfKey = `leadgen/${doc.accountId}/${doc.slug}-${Date.now()}.pdf`
    await uploadBufferWithKey(pdfKey, pdf, 'application/pdf')

    let driveFileId: string | null = null
    let driveLink: string | null = null
    if (driveConfigured()) {
      let folderId = doc.account.driveFolderId
      if (!folderId) {
        folderId = await ensureAccountFolder(doc.accountId, doc.account.name ?? 'client')
        await prisma.account.update({ where: { id: doc.accountId }, data: { driveFolderId: folderId } })
      }
      // ROTATION (2026-07-29): never delete the old generation — previously
      // granted leads keep their access; the old id is archived and the new
      // file starts with a fresh ~600-share ACL budget.
      const uploaded = await uploadPdf(folderId, `${doc.title}.pdf`, pdf)
      driveFileId = uploaded.fileId
      driveLink = uploaded.webViewLink

      await regrantActiveCohort(doc.accountId, driveFileId, documentId)
    }

    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: {
        status: 'pending_review',
        pdfKey,
        driveFileId,
        driveLink,
        compiledAt: new Date(),
        rotatedAt: new Date(),
        ...(doc.driveFileId && doc.driveFileId !== driveFileId
          ? { archivedDriveFileIds: { push: doc.driveFileId } }
          : {}),
        lastError: null,
      },
    })
    logger.info({ documentId, driveFileId, pdfKey }, '[leadgen-compile] compiled → pending_review')

    // Guide trigger link (snapshot drip design, swapped 2026-07-29): each
    // clinic's location carries an `omniply-guide-<slug>` trigger link the
    // nurture drip emails use — insertable in the email builder (custom values
    // are not) and click-tracked per guide. Repointed here at every compile so
    // regenerated documents keep working links. Best-effort, never fails compile.
    if (driveLink) await repointGuideTriggerLink(doc.userId, doc.slug, driveLink, documentId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ documentId, err }, '[leadgen-compile] FAILED')
    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: { status: 'failed', lastError: msg },
    })
  }
}

// ── Custom uploads (Model A — leadgen plan Phase 6) ──────────────────────────

/** Minimal branded cover for a client-uploaded PDF. */
function customCoverHtml(title: string, t: BrandTokens): string {
  const esc = (s: string) => s.replace(/</g, '&lt;')
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  .cover { width: 210mm; height: 297mm; background: ${t.headerColor}; color: #fff; display: flex; flex-direction: column; justify-content: space-between; padding: 28mm 22mm; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .logo img { max-height: 22mm; max-width: 60mm; }
  .logo-fallback { font-size: 20px; font-weight: 700; }
  h1 { font-size: 40px; line-height: 1.15; max-width: 150mm; }
  .bar { width: 42mm; height: 2.5mm; background: ${t.accentColor}; margin-top: 10mm; border-radius: 2px; }
  .foot { font-size: 13px; opacity: .85; }
</style></head><body><div class="cover">
  <div class="logo">${t.logoUrl ? `<img src="${t.logoUrl}"/>` : `<div class="logo-fallback">${esc(t.organizationName)}</div>`}</div>
  <div><h1>${esc(title)}</h1><div class="bar"></div></div>
  <div class="foot">Prepared for you by ${esc(t.organizationName)} · ${esc(t.website)}</div>
</div></body></html>`
}

/**
 * Custom upload path: original PDF as-is, optionally with a branded cover page
 * merged in front (pdf-lib). NO text modification — baked layouts stay theirs.
 */
export async function compileCustomDocument(documentId: string, addCover: boolean): Promise<void> {
  const doc = await prisma.leadGenDocument.findUnique({
    where: { id: documentId },
    include: { account: { select: { name: true, driveFolderId: true } } },
  })
  if (!doc?.sourcePdfKey) {
    logger.warn({ documentId }, '[leadgen-compile] custom doc without sourcePdfKey')
    return
  }
  try {
    const cdn = (process.env.CDN_BASE ?? 'https://cdn.omniply.io').replace(/\/$/, '')
    const srcRes = await fetch(`${cdn}/${doc.sourcePdfKey}`)
    if (!srcRes.ok) throw new Error(`source PDF fetch ${srcRes.status}`)
    const original = Buffer.from(await srcRes.arrayBuffer())

    let finalPdf = original
    if (addCover) {
      const tokens = await inlineLogo(await brandTokensFor(doc.userId))
      const coverPdf = await withRasterPage(async (page) => {
        await page.setContent(customCoverHtml(doc.title, tokens), { waitUntil: 'load', timeout: 60_000 })
        return (await page.pdf({ format: 'a4', printBackground: true })) as Buffer
      })
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      const cover = await PDFDocument.load(coverPdf)
      const body = await PDFDocument.load(original, { ignoreEncryption: true })
      for (const p of await merged.copyPages(cover, cover.getPageIndices())) merged.addPage(p)
      for (const p of await merged.copyPages(body, body.getPageIndices())) merged.addPage(p)
      finalPdf = Buffer.from(await merged.save())
    }

    const pdfKey = `leadgen/${doc.accountId}/${doc.slug}-${Date.now()}.pdf`
    await uploadBufferWithKey(pdfKey, finalPdf, 'application/pdf')

    let driveFileId: string | null = null
    let driveLink: string | null = null
    if (driveConfigured()) {
      let folderId = doc.account.driveFolderId
      if (!folderId) {
        folderId = await ensureAccountFolder(doc.accountId, doc.account.name ?? 'client')
        await prisma.account.update({ where: { id: doc.accountId }, data: { driveFolderId: folderId } })
      }
      // ROTATION: archive, never delete — see compileLeadGenDocument.
      const uploaded = await uploadPdf(folderId, `${doc.title}.pdf`, finalPdf)
      driveFileId = uploaded.fileId
      driveLink = uploaded.webViewLink
      await regrantActiveCohort(doc.accountId, driveFileId, documentId)
    }

    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: {
        status: 'pending_review',
        pdfKey,
        driveFileId,
        driveLink,
        compiledAt: new Date(),
        rotatedAt: new Date(),
        ...(doc.driveFileId && doc.driveFileId !== driveFileId
          ? { archivedDriveFileIds: { push: doc.driveFileId } }
          : {}),
        lastError: null,
      },
    })
    logger.info({ documentId, addCover }, '[leadgen-compile] custom upload processed → pending_review')
  } catch (err) {
    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: { status: 'failed', lastError: err instanceof Error ? err.message : String(err) },
    })
    logger.error({ documentId, err }, '[leadgen-compile] custom upload FAILED')
  }
}

/** Phase F: compile the A6 QR review card (see review-card.ts for the design). */
async function compileReviewCard(
  documentId: string,
  userId: string,
  accountId: string,
  sourceHtml: string,
  account: { name: string | null; driveFolderId: string | null },
): Promise<void> {
  try {
    const brand = await prisma.brandSettings.findUnique({
      where: { userId },
      select: { googlePlaceId: true },
    })
    if (!brand?.googlePlaceId) {
      await prisma.leadGenDocument.update({
        where: { id: documentId },
        data: { status: 'disabled', lastError: 'No Google listing captured — card skipped (re-enable after adding the GBP link)' },
      })
      logger.info({ documentId }, '[leadgen-compile] review card skipped — no place id')
      return
    }
    const { reviewDeepLink } = await import('../lib/google/places')
    const directUrl = reviewDeepLink(brand.googlePlaceId)

    // Prefer the snapshot trigger link (GHL scan stats); fall back to the direct link.
    let target = directUrl
    try {
      const { getGhlCredentials } = await import('../lib/ghl/settings')
      const creds = await getGhlCredentials(userId)
      if (creds) {
        const { listTriggerLinks } = await import('../lib/ghl/client')
        const links = await listTriggerLinks(creds.apiKey, creds.locationId)
        const link = links.find((l) => l.name?.toLowerCase() === 'omniply-review')
        if (link?.fieldKey || link?.id) {
          // The public trigger-link URL lives in the link record; shape verified at
          // first real use — fall back to the direct URL when absent.
          const url = (link as { url?: string; shareUrl?: string }).url ?? (link as { shareUrl?: string }).shareUrl
          if (url) target = url
        }
      }
    } catch (err) {
      logger.warn({ err, documentId }, '[leadgen-compile] trigger-link lookup failed — direct review URL used')
    }

    const { qrSvg } = await import('./review-card')
    const inked = await inlineLogo(await brandTokensFor(userId))
    const withQr = { ...inked, reviewQrSvg: await qrSvg(target) } as BrandTokens & { reviewQrSvg: string }
    const html = applyBrandTokens(sourceHtml, withQr as unknown as BrandTokens).replace(
      /\{\{brand\.reviewQrSvg\}\}/g,
      withQr.reviewQrSvg,
    )

    const pdf = await withRasterPage(async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 60_000 })
      return (await page.pdf({ width: '105mm', height: '148mm', printBackground: true })) as Buffer
    })

    const pdfKey = `leadgen/${accountId}/review-counter-card-${Date.now()}.pdf`
    await uploadBufferWithKey(pdfKey, pdf, 'application/pdf')

    let driveFileId: string | null = null
    let driveLink: string | null = null
    if (driveConfigured()) {
      let folderId = account.driveFolderId
      if (!folderId) {
        folderId = await ensureAccountFolder(accountId, account.name ?? 'client')
        await prisma.account.update({ where: { id: accountId }, data: { driveFolderId: folderId } })
      }
      const doc = await prisma.leadGenDocument.findUnique({ where: { id: documentId }, select: { driveFileId: true, title: true } })
      if (doc?.driveFileId) await deleteFile(doc.driveFileId)
      const uploaded = await uploadPdf(folderId, `${doc?.title ?? 'Review card'}.pdf`, pdf)
      driveFileId = uploaded.fileId
      driveLink = uploaded.webViewLink
    }

    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: { status: 'pending_review', pdfKey, driveFileId, driveLink, compiledAt: new Date(), lastError: null },
    })
    logger.info({ documentId, target: target === directUrl ? 'direct' : 'trigger-link' }, '[leadgen-compile] review card compiled')
  } catch (err) {
    await prisma.leadGenDocument.update({
      where: { id: documentId },
      data: { status: 'failed', lastError: err instanceof Error ? err.message : String(err) },
    })
    logger.error({ documentId, err }, '[leadgen-compile] review card FAILED')
  }
}
