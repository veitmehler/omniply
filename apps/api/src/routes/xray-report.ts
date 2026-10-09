/**
 * Personalized X-Ray Debrief PDF (marketing funnel, PUBLIC route).
 *
 * GET /api/xray/report?d=<base64url JSON>
 *   d = { v: 1, n: <name>, p: <practiceName|null>, c: <currency>, a: <answers> }
 *
 * STATELESS by design: the quiz page (apps/web/public/x-ray/index.html) builds
 * this URL client-side and ships it in the GHL webhook payload as reportUrl;
 * the nurture email's button is {{contact.xray_report_url}}. No DB, no tokens.
 * All numeric inputs are re-clamped to the quiz's slider ranges so a forged
 * URL can't produce absurd dollar figures, and names are HTML-escaped.
 *
 * Rendering reuses the pooled Chromium (diagram-browser-pool) — global page
 * semaphore caps concurrency; results are LRU-cached by the raw `d` param.
 */
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { readS3Object, uploadBufferWithKey } from '@omniply/shared'
import { logger } from '../lib/logger'
import { withRasterPage } from '../article-pipeline/enrichment/diagram-browser-pool'
import { compute, scoreRead, verdictHtml, missedCallsPhrase, type XrayAnswers } from '../marketing/xray-math'
import { buildBarsHtml, buildDebriefHtml } from '../marketing/xray-debrief-template'

const CHOICE_PTS = new Set([0, 3, 5, 7, 10])
const SYMBOLS: Record<string, string> = { USD: '$', AUD: '$', CAD: '$', NZD: '$', GBP: '£', EUR: '€' }

interface ReportPayload {
  v: number
  n?: string
  p?: string | null
  c?: string
  a: Record<string, unknown>
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strict-parse the payload; returns null on anything malformed. */
export function parseReportPayload(dParam: string): { answers: XrayAnswers; preparedFor: string; currency: string } | null {
  let payload: ReportPayload
  try {
    const json = Buffer.from(dParam, 'base64url').toString('utf8')
    payload = JSON.parse(json) as ReportPayload
  } catch {
    return null
  }
  if (!payload || payload.v !== 1 || typeof payload.a !== 'object' || payload.a === null) return null

  const a = payload.a as Record<string, unknown>
  const choice = (k: string): number | null => {
    const v = Number(a[k])
    return CHOICE_PTS.has(v) ? v : null
  }
  const num = (k: string): number | null => {
    const v = Number(a[k])
    return Number.isFinite(v) ? v : null
  }

  const c = {
    a1: choice('a1'), a2: choice('a2'), a3: choice('a3'),
    b1: choice('b1'), b2: choice('b2'),
    c1: choice('c1'), c2: choice('c2'),
    d1: choice('d1'), d2: choice('d2'),
  }
  if (Object.values(c).some((v) => v === null)) return null
  const inquiriesWeekly = num('inquiriesWeekly')
  const maintRate = num('maintRate')
  const activePatients = num('activePatients')
  const visitFee = num('visitFee')
  if (inquiriesWeekly === null || maintRate === null || activePatients === null || visitFee === null) return null

  const answers: XrayAnswers = {
    a1: c.a1!, a2: c.a2!, a3: c.a3!, b1: c.b1!, b2: c.b2!,
    c1: c.c1!, c2: c.c2!, d1: c.d1!, d2: c.d2!,
    inquiriesWeekly: clamp(Math.round(inquiriesWeekly), 0, 50),
    maintRate: clamp(maintRate, 0, 0.8),
    activePatients: clamp(Math.round(activePatients), 100, 5000),
    visitFee: clamp(Math.round(visitFee), 40, 150),
  }

  // Practice name wins; fall back to the lead's own name from the quiz gate.
  const rawName = (typeof payload.p === 'string' && payload.p.trim()) || (typeof payload.n === 'string' && payload.n.trim()) || 'your practice'
  const preparedFor = escapeHtml(rawName.slice(0, 60))
  const currency = SYMBOLS[payload.c ?? ''] ? (payload.c as string) : 'USD'
  return { answers, preparedFor, currency }
}

// Tiny LRU: Map preserves insertion order; delete+set refreshes recency.
const CACHE_MAX = 100
const pdfCache = new Map<string, Buffer>()

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

async function renderDebriefPdf(dParam: string, parsed: NonNullable<ReturnType<typeof parseReportPayload>>): Promise<Buffer> {
  const cached = pdfCache.get(dParam)
  if (cached) {
    pdfCache.delete(dParam)
    pdfCache.set(dParam, cached)
    return cached
  }

  const { answers, preparedFor, currency } = parsed
  const sym = SYMBOLS[currency]
  const money = (n: number) => sym + Math.round(n).toLocaleString('en-US')
  const r = compute(answers)

  const now = new Date()
  const scanDate = `${String(now.getUTCDate()).padStart(2, '0')} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`

  const miss = missedCallsPhrase(r.missedCallsWeekly)
  const html = buildDebriefHtml({
    preparedFor,
    scanDate,
    totalScore: r.total,
    scoreRead: scoreRead(r.total),
    barsHtml: buildBarsHtml(r.scores, r.weakest),
    verdictHtml: verdictHtml(answers, r, money),
    totalLeak: money(r.totalLeak),
    driftLeak: money(r.driftLeak),
    respLeak: money(r.responseLeak),
    missBig: miss.big,
    missUnit: miss.unit,
    missLine:
      r.missedCallsWeekly <= 0
        ? 'Based on your answers, inquiries get a live response... the leak below is what the remaining gaps cost.'
        : 'That’s an estimated <b>' + money(r.responseLeak) + '/month</b> walking to whichever clinic answers first.',
    missReframe:
      answers.b1 === 10 && answers.b2 === 10
        ? 'You’re tight... the numbers below show what closing the last gaps is worth.'
        : 'Sound low? Most owners only ever see the missed calls that leave a voicemail.',
    mult: r.priceMultiple,
    fee: money(answers.visitFee),
    feeYear: money(answers.visitFee * 12),
    aiLine:
      answers.inquiriesWeekly <= 0
        ? 'Patients have started asking ChatGPT and Siri the question they used to type into Google: "who should I see about this?" As inquiries grow, being readable to the answer engines decides whether you come up at all.'
        : 'Patients have started asking ChatGPT and Siri the question they used to type into Google: "who should I see about this?" An estimated <b>' +
          (r.aiResearchedWeekly < 1 ? '1 of your weekly inquiries' : Math.round(r.aiResearchedWeekly) + ' of your weekly inquiries') +
          '</b> now starts inside an AI assistant... and at your current visibility scores, roughly <b>' +
          Math.round(r.aiInvisibleShare * 100) +
          '%</b> of those patients never find you at all. If the trend holds, that is a projected <b>' +
          money(r.aiLeak) +
          '/month</b> on top of the leak above... one that no missed-call log will ever show you.',
  })

  const pdf = await withRasterPage(async (page) => {
    // 'load' suffices: the document is fully inline (data-URI images only).
    await page.setContent(html, { waitUntil: 'load' })
    // Cold-start guard: the very first render after container boot produced
    // a truncated PDF once (fonts/layout still settling). Wait for fonts +
    // a settle tick before printing.
    await page.evaluate(() =>
      (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready,
    )
    await new Promise((res) => setTimeout(res, 150))
    return await page.pdf({ printBackground: true, preferCSSPageSize: true })
  })
  const buf = Buffer.from(pdf)
  pdfCache.set(dParam, buf)
  if (pdfCache.size > CACHE_MAX) {
    const oldest = pdfCache.keys().next().value
    if (oldest) pdfCache.delete(oldest)
  }
  logger.info({ preparedFor, totalLeak: r.totalLeak, weakest: r.weakest }, '[xray] personalized debrief rendered')
  return buf
}

const PDF_HEADERS = { type: 'application/pdf', disposition: 'inline; filename="X-Ray-Debrief.pdf"' }
const S3_PREFIX = 'xray-reports/'
// Bump on template design changes: it feeds the publish id so already-published
// reports re-render with the new design instead of serving the old S3 object.
// v4: missed-call-first leak card + AI-search force extension + HBR basis
// (missed-call sweep Part 1, 2026-10-03)
// v5: AI-first technology force + AI-era projection card + Adyen/Visa sources
// (angle sweep, 2026-10-09)
const TEMPLATE_VERSION = '5'

function publicApiBase(): string {
  return (process.env.XRAY_PUBLIC_API_BASE ?? 'https://svc.omniply.io').replace(/\/$/, '')
}

export async function xrayReportRoutes(app: FastifyInstance) {
  // Stateless render: the URL carries the data. Permanent fallback link.
  app.get<{ Querystring: { d?: string } }>('/xray/report', async (request, reply) => {
    const dParam = request.query.d
    if (!dParam || dParam.length > 4096) {
      return reply.code(400).send({ error: 'missing or oversized report data' })
    }
    const parsed = parseReportPayload(dParam)
    if (!parsed) return reply.code(400).send({ error: 'invalid report data' })

    try {
      const buf = await renderDebriefPdf(dParam, parsed)
      return reply.header('Content-Type', PDF_HEADERS.type).header('Content-Disposition', PDF_HEADERS.disposition).send(buf)
    } catch (err) {
      logger.error({ err }, '[xray] debrief render failed')
      return reply.code(500).send({ error: 'report rendering failed, please retry' })
    }
  })

  // Publish: render once, store in S3, return a short shareable link.
  // Called by the quiz at capture time; idempotent (id = content hash).
  app.post<{ Body: { d?: string } }>('/xray/publish', async (request, reply) => {
    const dParam = typeof request.body?.d === 'string' ? request.body.d : undefined
    if (!dParam || dParam.length > 4096) {
      return reply.code(400).send({ error: 'missing or oversized report data' })
    }
    const parsed = parseReportPayload(dParam)
    if (!parsed) return reply.code(400).send({ error: 'invalid report data' })

    const id = createHash('sha256').update(TEMPLATE_VERSION + ':' + dParam).digest('hex').slice(0, 16)
    const key = `${S3_PREFIX}${id}.pdf`
    const url = `${publicApiBase()}/api/xray/r/${id}.pdf`

    try {
      // Already published? (readS3Object throws on missing key.)
      await readS3Object(key)
      return reply.send({ url, id })
    } catch {
      /* not yet published — render + upload below */
    }

    try {
      const buf = await renderDebriefPdf(dParam, parsed)
      await uploadBufferWithKey(key, buf, 'application/pdf')
      logger.info({ id, preparedFor: parsed.preparedFor }, '[xray] debrief published to S3')
      return reply.send({ url, id })
    } catch (err) {
      logger.error({ err }, '[xray] debrief publish failed')
      return reply.code(500).send({ error: 'publish failed' })
    }
  })

  // Short link: stream the published PDF from S3.
  app.get<{ Params: { file: string } }>('/xray/r/:file', async (request, reply) => {
    const file = request.params.file
    if (!/^[a-f0-9]{16}\.pdf$/.test(file)) return reply.code(404).send({ error: 'not found' })
    try {
      const { body } = await readS3Object(`${S3_PREFIX}${file}`)
      return reply
        .header('Content-Type', PDF_HEADERS.type)
        .header('Content-Disposition', PDF_HEADERS.disposition)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'not found' })
    }
  })
}
