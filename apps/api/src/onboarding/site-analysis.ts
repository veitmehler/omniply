/**
 * Onboarding website analysis (onboarding plan Phase 2).
 *
 * crawlSite: home + a handful of nav-linked pages → logo candidates, social
 * links, text corpus, CSS color/font hints. Screenshot via the pooled
 * Chromium; the screenshot is the PRIMARY palette source (vision-LLM with
 * SEMANTIC roles that map straight onto the nl* template fields) — CSS hints
 * are a cross-check. Specialization detection runs over the text corpus
 * against the Specialization registry.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { withRasterPage } from '../article-pipeline/enrichment/diagram-browser-pool'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'
import { normalizeHex, hexToHsl, type BrandColor, type BrandInventory } from './palette-compose'

const PAGE_FETCH_TIMEOUT_MS = 15_000
const MAX_PAGES = 6
const NAV_KEYWORDS = /about|service|team|treatment|therap|contact|care|condition/i

export interface CrawlResult {
  websiteUrl: string
  pages: { url: string; title: string; text: string }[]
  logoCandidates: string[]
  socialLinks: Record<string, string>
  cssColorHints: string[]
  fontHints: string[]
  /**
   * Newest substantial blog post found on the site (WP REST fast path, HTML
   * fallback) — offered as a writing-voice sample in onboarding, gated behind
   * an explicit "I wrote this" authorship confirmation (many clinic blogs are
   * vendor-ghostwritten; a scraped article is never silently ingested).
   */
  blogArticle?: { url: string; title: string; text: string; wordCount: number }
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/**
 * Paragraph-preserving strip for article bodies (same pattern as the
 * module-private stripHtmlTags in article-pipeline/syndication/generate.ts):
 * keeps \n\n between blocks so the sample reads as real prose.
 */
function stripHtmlKeepParagraphs(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A plain browser UA: common WP hosts (SiteGround et al) hard-403 anything
// with a "bot" marker in the UA, and we're fetching the client's own site
// with their consent during onboarding.
const CRAWL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(url, {
          headers: { 'User-Agent': CRAWL_USER_AGENT },
          redirect: 'follow',
          signal,
        }),
      PAGE_FETCH_TIMEOUT_MS,
      `fetch ${url}`,
    )
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
      logger.warn(
        { url, status: res.status, contentType: res.headers.get('content-type') },
        '[site-analysis] page fetch rejected',
      )
      return null
    }
    return await res.text()
  } catch (err) {
    logger.warn({ url, err }, '[site-analysis] page fetch failed')
    return null
  }
}

const SOCIAL_HOSTS: Record<string, RegExp> = {
  facebook: /facebook\.com\/(?!sharer)[\w.\-/]+/i,
  instagram: /instagram\.com\/[\w.\-/]+/i,
  linkedin: /linkedin\.com\/(company|in)\/[\w.\-/]+/i,
  youtube: /(youtube\.com\/(channel|c|@)[\w.\-/]*|youtu\.be\/[\w-]+)/i,
  tiktok: /tiktok\.com\/@[\w.\-]+/i,
}

export async function crawlSite(websiteUrl: string): Promise<CrawlResult> {
  const result: CrawlResult = {
    websiteUrl,
    pages: [],
    logoCandidates: [],
    socialLinks: {},
    cssColorHints: [],
    fontHints: [],
  }

  const homeHtml = await fetchHtml(websiteUrl)
  if (!homeHtml) return result

  const seen = new Set<string>([websiteUrl.replace(/\/$/, '')])
  const queue: string[] = []

  // Discover same-origin nav pages worth reading.
  const origin = new URL(websiteUrl).origin
  for (const m of homeHtml.matchAll(/<a[^>]+href=["']([^"'#?]+)["']/gi)) {
    const abs = absolutize(m[1], websiteUrl)
    if (!abs || !abs.startsWith(origin)) continue
    const norm = abs.replace(/\/$/, '')
    if (seen.has(norm) || !NAV_KEYWORDS.test(norm)) continue
    seen.add(norm)
    queue.push(abs)
    if (queue.length >= MAX_PAGES - 1) break
  }

  const htmls: { url: string; html: string }[] = [{ url: websiteUrl, html: homeHtml }]
  for (const url of queue) {
    const html = await fetchHtml(url)
    if (html) htmls.push({ url, html })
  }

  for (const { url, html } of htmls) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
    result.pages.push({ url, title, text: stripHtml(html).slice(0, 8000) })

    // Social links (footer/header hrefs).
    for (const [platform, re] of Object.entries(SOCIAL_HOSTS)) {
      if (result.socialLinks[platform]) continue
      const m = re.exec(html)
      if (m) result.socialLinks[platform] = `https://${m[0].replace(/^https?:\/\//, '')}`
    }
  }

  // Logo candidates — home page only, ordered by likely quality.
  const push = (u: string | null) => {
    if (u && !result.logoCandidates.includes(u)) result.logoCandidates.push(u)
  }
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(homeHtml)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(homeHtml)
  // Header <img> with "logo" in src/class/alt beats og:image (og is often a hero).
  for (const m of homeHtml.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0]
    if (/logo/i.test(tag)) {
      const src = /src=["']([^"']+)["']/i.exec(tag)?.[1]
      push(src ? absolutize(src, websiteUrl) : null)
    }
  }
  push(og ? absolutize(og[1], websiteUrl) : null)
  const appleIcon = /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(homeHtml)
  push(appleIcon ? absolutize(appleIcon[1], websiteUrl) : null)
  result.logoCandidates = result.logoCandidates.slice(0, 4)

  // CSS hints: hex colors + font families from inline <style> blocks.
  const styleBlocks = [...homeHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
  const colorCounts = new Map<string, number>()
  for (const m of styleBlocks.matchAll(/#[0-9a-f]{6}\b/gi)) {
    const c = m[0].toLowerCase()
    colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1)
  }
  result.cssColorHints = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c)
  const fonts = new Set<string>()
  for (const m of styleBlocks.matchAll(/font-family:\s*([^;}]+)/gi)) {
    const fam = m[1].split(',')[0].replace(/["']/g, '').trim()
    if (fam && !/inherit|sans-serif|serif|monospace/i.test(fam)) fonts.add(fam)
  }
  result.fontHints = [...fonts].slice(0, 4)

  try {
    result.blogArticle = await discoverBlogArticle(websiteUrl, homeHtml)
  } catch (err) {
    logger.warn({ websiteUrl, err }, '[site-analysis] blog discovery failed — sample offer skipped')
  }

  return result
}

const BLOG_MIN_WORDS = 400
const BLOG_TEXT_CAP = 12_000 // generateWritingStyle's own article cap

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(url, {
          headers: { 'User-Agent': CRAWL_USER_AGENT, Accept: 'application/json' },
          redirect: 'follow',
          signal,
        }),
      PAGE_FETCH_TIMEOUT_MS,
      `fetch ${url}`,
    )
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    return await res.json()
  } catch {
    return null
  }
}

function articleFromHtml(url: string, html: string): CrawlResult['blogArticle'] | undefined {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().split(/\s*[|–—-]\s*/)[0] ?? ''
  const articleRegion = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? html
  const text = stripHtmlKeepParagraphs(articleRegion).slice(0, BLOG_TEXT_CAP)
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < BLOG_MIN_WORDS) return undefined
  return { url, title, text, wordCount }
}

/**
 * Find the newest substantial blog post: WordPress REST fast path first
 * (most clinic sites are WP), generic listing-page fallback second.
 * Budget: at most 3 extra fetches, all failures soft.
 */
async function discoverBlogArticle(
  websiteUrl: string,
  homeHtml: string,
): Promise<CrawlResult['blogArticle'] | undefined> {
  const origin = new URL(websiteUrl).origin

  // 1. WordPress REST fast path.
  const wp = await fetchJson(
    `${origin}/wp-json/wp/v2/posts?per_page=3&orderby=date&_fields=title,content,link`,
  )
  if (Array.isArray(wp)) {
    for (const raw of wp) {
      const post = raw as { title?: { rendered?: string }; content?: { rendered?: string }; link?: string }
      const body = post.content?.rendered ?? ''
      const text = stripHtmlKeepParagraphs(body).slice(0, BLOG_TEXT_CAP)
      const wordCount = text.split(/\s+/).filter(Boolean).length
      if (wordCount >= BLOG_MIN_WORDS) {
        return {
          url: post.link ?? origin,
          title: stripHtmlKeepParagraphs(post.title?.rendered ?? '').trim(),
          text,
          wordCount,
        }
      }
    }
    return undefined // WP confirmed but no substantial post — don't double-fetch via HTML
  }

  // 2. Generic fallback: a blog/news listing linked from the homepage.
  const blogLinkRx = /blog|news|articles?|resources|posts/i
  let listingUrl: string | null = null
  for (const m of homeHtml.matchAll(/<a[^>]+href=["']([^"'#?]+)["']/gi)) {
    const abs = absolutize(m[1], websiteUrl)
    if (abs && abs.startsWith(origin) && blogLinkRx.test(new URL(abs).pathname)) {
      listingUrl = abs
      break
    }
  }
  if (!listingUrl) return undefined

  const listingHtml = await fetchHtml(listingUrl)
  if (!listingHtml) return undefined

  // The nav link may itself BE a post (single-post sites).
  const direct = articleFromHtml(listingUrl, listingHtml)

  const listingPath = new URL(listingUrl).pathname.replace(/\/$/, '')
  for (const m of listingHtml.matchAll(/<a[^>]+href=["']([^"'#?]+)["']/gi)) {
    const abs = absolutize(m[1], listingUrl)
    if (!abs || !abs.startsWith(origin)) continue
    const path = new URL(abs).pathname.replace(/\/$/, '')
    if (path === listingPath || !path.startsWith(listingPath + '/')) continue
    if (/\/(category|tag|page|author)\//i.test(path)) continue
    const postHtml = await fetchHtml(abs)
    const post = postHtml ? articleFromHtml(abs, postHtml) : undefined
    return post ?? direct
  }
  return direct
}

/**
 * FULL-PAGE homepage screenshot (palette v2 Phase A). The whole page is the
 * evidence — a mid-page band color the viewport never showed is exactly what
 * distinguishes a supporting color from a main one. Downscaled for the vision
 * call: color regions survive resizing; text legibility is not needed.
 */
/** One dominant color covering nearly everything = we probably hid the site itself. */
async function looksBlank(png: Buffer): Promise<boolean> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(png).resize({ width: 64, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
  const counts = new Map<string, number>()
  let total = 0
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    total++
  }
  return Math.max(...counts.values()) / (total || 1) > 0.92
}

export async function screenshotHomepage(websiteUrl: string): Promise<Buffer | null> {
  try {
    const raw = await withRasterPage(async (page) => {
      await page.setViewport({ width: 1440, height: 1200 })
      await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 30_000 })
      // Consent banners / modals darken or cover the page and poison the pixel
      // evidence (Wellness Way bench finding) — hide the usual suspects plus
      // any full-viewport fixed overlay before shooting.
      await page
        .evaluate(() => {
          // Browser context — globals via globalThis casts (no "dom" lib in this project).
          interface El {
            style: { setProperty(k: string, v: string, p?: string): void; overflow?: string }
            getBoundingClientRect(): { width: number; height: number }
          }
          const g = globalThis as unknown as {
            document: {
              createElement(t: string): { textContent: string }
              head: { appendChild(n: unknown): void }
              body: { querySelectorAll(sel: string): Iterable<El>; style: { overflow: string } }
            }
            window: {
              innerWidth: number
              innerHeight: number
              getComputedStyle(el: El): { position: string; zIndex: string }
            }
          }
          const style = g.document.createElement('style')
          style.textContent =
            '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="gdpr" i],#onetrust-consent-sdk,.cc-window,[class*="modal-backdrop" i]{display:none !important}'
          g.document.head.appendChild(style)
          for (const el of Array.from(g.document.body.querySelectorAll('*'))) {
            const cs = g.window.getComputedStyle(el)
            if (cs.position !== 'fixed') continue
            const r = el.getBoundingClientRect()
            if (r.width >= g.window.innerWidth * 0.8 && r.height >= g.window.innerHeight * 0.8 && Number(cs.zIndex) > 100) {
              el.style.setProperty('display', 'none', 'important')
            }
          }
          g.document.body.style.overflow = 'visible'
        })
        .catch(() => {})
      await new Promise((r) => setTimeout(r, 400))
      let shot = (await page.screenshot({ type: 'png', fullPage: true })) as Buffer
      // Safety net (Sherman bench finding): some themes wrap the whole site in
      // a large fixed element — if suppression blanked the page, reload and
      // shoot untouched (a visible cookie banner beats an empty screenshot).
      if (await looksBlank(shot)) {
        logger.warn({ websiteUrl }, '[onboarding/site] overlay suppression blanked the page — reshooting untouched')
        await page.reload({ waitUntil: 'networkidle2', timeout: 30_000 })
        await new Promise((r) => setTimeout(r, 400))
        shot = (await page.screenshot({ type: 'png', fullPage: true })) as Buffer
      }
      return shot
    })
    const sharp = (await import('sharp')).default
    const resized = await sharp(raw)
      .resize({ width: 1080, height: 12_000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    // Inline-data guard (Gemini limit 20MB; base64 adds ~33%).
    return resized.length <= 14_000_000 ? resized : await sharp(resized).jpeg({ quality: 80 }).toBuffer()
  } catch (err) {
    logger.warn({ websiteUrl, err }, '[onboarding/site] screenshot failed')
    return null
  }
}

/**
 * Deterministic pixel clusters from the screenshot (palette v2 Phase B).
 * Coverage percentages come from counted pixels, never from LLM estimates.
 *
 * Two histograms: a broad one (top clusters by area) plus a SATURATION-WEIGHTED
 * one — a button's worth of vivid orange is tiny by area but critical as
 * evidence, and must not be starved out of the cluster list by acres of white
 * (Parker bench finding: the guard dropped a real button color).
 */
export async function pixelClusters(screenshot: Buffer): Promise<{ hex: string; coverage: number }[]> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(screenshot)
    .resize({ width: 200, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const counts = new Map<string, number>()
  const vividCounts = new Map<string, number>()
  const q = 24 // quantization bucket size per channel
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = Math.min(255, Math.round(data[i] / q) * q)
    const g = Math.min(255, Math.round(data[i + 1] / q) * q)
    const b = Math.min(255, Math.round(data[i + 2] / q) * q)
    const key = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    // HSL-ish saturation of the quantized pixel — vivid pixels get their own tally.
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 510
    const sat = max === min ? 0 : l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min)
    if (sat >= 0.4 && max > 40) vividCounts.set(key, (vividCounts.get(key) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1
  const broad = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 96)
  const vivid = [...vividCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32)
  const merged = new Map<string, number>()
  for (const [hex, n] of [...broad, ...vivid]) if (!merged.has(hex)) merged.set(hex, n)
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex, n]) => ({ hex, coverage: n / total }))
}

export interface SemanticPalette {
  headerBackground?: string
  headerText?: string
  accent?: string
  button?: string
  bodyBackground?: string
  sectionTints?: string[]
  confidence?: Record<string, number>
}

const GEMINI_TEXT_MODEL = 'gemini-3-flash-preview'

async function geminiGenerate(
  apiKey: string,
  parts: unknown[],
  op: string,
  opts: { temperature?: number; responseSchema?: object } = {},
): Promise<string> {
  const res = await instrumentCall({ provider: 'gemini', op }, () =>
    withTimeout(
      (signal) =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: opts.temperature ?? 0.2,
                ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
              },
            }),
            signal,
          },
        ),
      60_000,
      op,
    ),
  )
  if (!res.ok) throw new Error(`gemini ${op} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }
  return (
    data.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('') ?? ''
  )
}

/**
 * Parse the first balanced JSON value in LLM output. Even in JSON response
 * mode Gemini occasionally appends trailing content after the object (seen
 * live: "Unexpected non-whitespace character after JSON at position N").
 */
function parseFirstJson<T>(text: string): T {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = cleaned.search(/[[{]/)
  if (start === -1) throw new Error('no JSON value in LLM output')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      if (inString) escaped = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T
      }
    }
  }
  return JSON.parse(cleaned.slice(start)) as T // unbalanced — let JSON.parse report it
}

export async function extractPaletteFromScreenshot(
  geminiKey: string,
  screenshotPng: Buffer,
  cssHints: string[],
): Promise<SemanticPalette | null> {
  try {
    const text = await geminiGenerate(
      geminiKey,
      [
        {
          text: `You are analyzing a screenshot of a business website to extract its brand palette for building email/newsletter templates.
Return STRICT JSON: {"headerBackground":"#hex","headerText":"#hex","accent":"#hex","button":"#hex","bodyBackground":"#hex","sectionTints":["#hex","#hex"],"confidence":{"headerBackground":0-1,...}}.
Rules: real rendered colors only (no guessing from the logo); accent = the color used for links/highlights; sectionTints = 2 light tints that would harmonize as alternating section backgrounds; if a role is genuinely absent use a sensible neutral and low confidence.
CSS hints found in the page source (frequency-ordered, may be noise): ${cssHints.join(', ') || 'none'}`,
        },
        { inlineData: { mimeType: 'image/png', data: screenshotPng.toString('base64') } },
      ],
      'onboarding.palette',
    )
    return parseFirstJson<SemanticPalette>(text)
  } catch (err) {
    logger.warn({ err }, '[onboarding/site] palette extraction failed')
    return null
  }
}

// ── brand inventory (palette v2 Phase B) ──────────────────────────────────────

const INVENTORY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    colors: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hex: { type: 'STRING' },
          name: { type: 'STRING' },
          prominence: { type: 'STRING', enum: ['main', 'supporting', 'ground'] },
          observedRoles: {
            type: 'ARRAY',
            items: {
              type: 'STRING',
              enum: [
                'nav_background',
                'hero_background',
                'band',
                'button_fill',
                'link_text',
                'icon_accent',
                'footer_background',
              ],
            },
          },
          confidence: { type: 'NUMBER' },
        },
        required: ['hex', 'prominence', 'observedRoles'],
      },
    },
  },
  required: ['colors'],
}

/**
 * Extract the brand color INVENTORY from a full-page screenshot: which hues
 * exist, where they were observed, how prominent they are. Role assignment is
 * NOT the model's job — palette-compose.ts does that deterministically.
 * Returned hexes are validated against measured pixel clusters (snap or drop),
 * and coverage comes from the clusters, never the model.
 */
export async function extractBrandInventory(
  geminiKey: string,
  screenshot: Buffer,
  cssHints: string[],
  clusters: { hex: string; coverage: number }[],
): Promise<BrandInventory | null> {
  try {
    const mime = screenshot.subarray(0, 3).toString('latin1') === '\x89PN' ? 'image/png' : 'image/jpeg'
    const text = await geminiGenerate(
      geminiKey,
      [
        {
          text: `You are a brand designer reading a FULL-PAGE screenshot of a business website. List the site's brand color inventory: 5-8 colors that define its identity.
For each color report: hex (as rendered), a short name, prominence, and every role you actually SEE it play.
Prominence rules: "ground" = page/base backgrounds; "main" = colors carrying the identity across large or structurally important areas (hero, nav, buttons, major bands); "supporting" = colors that appear only in one or two smaller areas (a single mid-page band, small icons) — present but not identity-carrying.
Report only colors genuinely rendered on the page — no inventions, no logo-derived guesses.
CSS color hints from the page source (frequency-ordered, may include noise): ${cssHints.join(', ') || 'none'}`,
        },
        { inlineData: { mimeType: mime, data: screenshot.toString('base64') } },
      ],
      'onboarding.brandInventory',
      { temperature: 0, responseSchema: INVENTORY_SCHEMA },
    )
    const raw = parseFirstJson<BrandInventory>(text)
    const valid: BrandColor[] = []
    for (const c of raw.colors ?? []) {
      const hex = normalizeHex(c.hex)
      if (!hex) continue
      // Snap to the nearest measured cluster; drop colors with no pixel evidence.
      let best: { hex: string; coverage: number } | null = null
      let bestD = Infinity
      for (const cl of clusters) {
        const d = rgbDistance(hex, cl.hex)
        if (d < bestD) {
          bestD = d
          best = cl
        }
      }
      if (!best || bestD > 90) {
        logger.warn({ hex, bestD: Math.round(bestD) }, '[onboarding/site] inventory color has no pixel evidence — dropped')
        continue
      }
      valid.push({ ...c, hex, coverage: best.coverage })
    }
    if (!valid.length) return null
    return { colors: augmentInventory(valid, clusters, cssHints) }
  } catch (err) {
    logger.warn({ err }, '[onboarding/site] brand inventory extraction failed')
    return null
  }
}

/**
 * Evidence-driven inventory augmentation (AlignLife bench finding): the LLM can
 * MISS a small brand color (a CTA button), and pixel clusters were previously
 * only a veto. A vivid cluster that ALSO appears in the site's CSS hints is
 * real by two independent sources — inject it as a role-unknown supporting
 * candidate so the composer's pop rules can consider it.
 */
export function augmentInventory(
  valid: BrandColor[],
  clusters: { hex: string; coverage: number }[],
  cssHints: string[],
): BrandColor[] {
  const hintHexes = cssHints.map((h) => normalizeHex(h)).filter((h): h is string => Boolean(h))
  const injected: BrandColor[] = []
  for (const cl of clusters) {
    if ((cl.coverage ?? 0) < 0.002) continue
    if (hexToHsl(cl.hex).s < 0.5) continue
    if (valid.some((c) => rgbDistance(c.hex, cl.hex) < 60)) continue
    const hint = hintHexes.find((h) => rgbDistance(h, cl.hex) < 40)
    if (!hint) continue
    if (injected.some((c) => rgbDistance(c.hex, hint) < 40)) continue
    // Prefer the exact CSS value over the quantized cluster centroid.
    injected.push({ hex: hint, prominence: 'supporting', observedRoles: [], coverage: cl.coverage })
    if (injected.length >= 3) break
  }
  if (injected.length) {
    logger.info({ injected: injected.map((c) => c.hex) }, '[onboarding/site] inventory augmented from pixel+CSS evidence')
  }
  return [...valid, ...injected]
}

function rgbDistance(a: string, b: string): number {
  const na = parseInt(a.slice(1), 16)
  const nb = parseInt(b.slice(1), 16)
  const dr = ((na >> 16) & 255) - ((nb >> 16) & 255)
  const dg = ((na >> 8) & 255) - ((nb >> 8) & 255)
  const db = (na & 255) - (nb & 255)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export interface SpecializationDraft {
  primarySpecialization?: string
  specializations?: string[]
  industry?: string
  targetMarket?: string
  services?: string[]
  toneObservations?: string
}

export async function detectSpecialization(
  geminiKey: string,
  corpus: string,
  registryKeys: string[],
): Promise<SpecializationDraft | null> {
  try {
    const text = await geminiGenerate(
      geminiKey,
      [
        {
          text: `Analyze this healthcare-practice website text and classify the practice.
Return STRICT JSON: {"industry":"e.g. Chiropractor","primarySpecialization":"<one of: ${registryKeys.join(', ')}>","specializations":["subset of the same list"],"targetMarket":"1-2 sentences","services":["..."],"toneObservations":"1-2 sentences on how they talk about themselves"}.
If none of the registry keys fit, pick the closest and note it in toneObservations.

WEBSITE TEXT:
${corpus.slice(0, 24_000)}`,
        },
      ],
      'onboarding.specialization',
    )
    return parseFirstJson<SpecializationDraft>(text)
  } catch (err) {
    logger.warn({ err }, '[onboarding/site] specialization detection failed')
    return null
  }
}

export async function specializationRegistryKeys(): Promise<string[]> {
  const rows = await prisma.specialization.findMany({ select: { key: true } })
  return rows.map((r) => r.key)
}
