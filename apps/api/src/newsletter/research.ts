/**
 * Shared per-topic research for the newsletter pipeline (Phase 1b).
 *
 * `ensureTopicResearch(topicId)` computes the SHARED layer — video + recipe +
 * teaser source URLs/extracts — once per (calendar, topic) and writes it to
 * NewsletterTopic.research. It's idempotent (skips when researchStatus is already
 * 'complete') and fault-tolerant (each sub-researcher can fail to absent without
 * aborting the others; status is complete | partial | failed).
 *
 * The per-customer VOICED content (Phase 1c) reads this research and never
 * re-does it, so it's cheap across many customers on the same calendar.
 */
import type { NewsletterCalendar, NewsletterTopic } from '@prisma/client'
import { Prisma } from '@prisma/client'
import {
  prisma,
  downloadImageFromUrl,
  generateWithFalAI,
  uploadBufferWithKey,
  deleteOldVersions,
  brandSettingsForUser,
} from '@omniply/shared'
import { getSystemApiKey } from '../lib/system-keys'
import { cleanTextOutput } from '../article-pipeline/output-cleaner'
import { logger } from '../lib/logger'
import { runNewsletterPrompt, runNewsletterWriterJson } from './llm'
import {
  isOxylabsConfigured,
  googleSearch,
  youtubeSearch,
  scrapeUrl,
  urlStatus,
} from './oxylabs'
import { decodeEntities } from './render'
import { overlayPlayButton, overlayTitleBanner, vtoken } from './image-overlay'
import { specializationLabel } from './calendar-routing'

const NL_IMAGE_SIZE = 'landscape_16_9'

const NL_IMAGE_MODEL = 'fal-ai/flux-pro'
const SOCIAL_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'instagram.com',
  'medium.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'snapchat.com',
  'whatsapp.com',
]

// ── Research result shape (stored as NewsletterTopic.research JSON) ────────────

export interface VideoResearch {
  url: string | null
  title: string | null
  thumbnailUrl: string | null
  s3Url: string | null
  manual: boolean // true when no video was found — a human supplies one later
}

export interface RecipeResearch {
  title: string | null
  intro: string
  ingredients: string
  instructions: string
  imageUrl: string | null
}

export interface TeaserSource {
  bullet: string
  url: string
  extract: string
  headline: string | null // the source article's real title (og:title/<title>/<h1>)
  image: string | null // the source's og:image (for the cover tile), if any
}

export interface TopicResearch {
  video?: VideoResearch
  recipe?: RecipeResearch
  recipe2?: RecipeResearch
  teaserSources?: TeaserSource[]
}

/**
 * Minimal industry/specialization context the research/writer steps need — a
 * real NewsletterCalendar row for admin-curated topics, or one synthesized from
 * the account's own BrandSettings for account-scoped override topics (which
 * have no calendar at all). Any `NewsletterCalendar` already satisfies this.
 */
export interface TopicVoiceContext {
  industry: string
  specializationKey: string | null
}

/** Resolve the industry/specialization context for a topic, calendar-routed or account-scoped. */
export async function topicVoiceContext(
  topic: NewsletterTopic & { calendar: NewsletterCalendar | null },
): Promise<TopicVoiceContext> {
  if (topic.calendar) return { industry: topic.calendar.industry, specializationKey: topic.calendar.specializationKey }
  if (!topic.accountId) return { industry: '', specializationKey: null }
  const account = await prisma.account.findUnique({ where: { id: topic.accountId }, select: { ownerUserId: true } })
  const brand = account?.ownerUserId ? await brandSettingsForUser(account.ownerUserId) : null
  return { industry: brand?.industry ?? '', specializationKey: brand?.primarySpecialization ?? null }
}

// ── Video ─────────────────────────────────────────────────────────────────────

interface OEmbed {
  title?: string
  thumbnail_url?: string
}

async function fetchYouTubeOEmbed(videoUrl: string): Promise<OEmbed | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
      { signal: controller.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return null
    return (await res.json()) as OEmbed
  } catch {
    return null
  }
}

async function thumbnailToS3(topicId: string, thumbnailUrl: string | null): Promise<string | null> {
  if (!thumbnailUrl) return null
  // Composite a play button over the thumbnail so it reads as a video.
  const withPlay = await overlayPlayButton(thumbnailUrl, `${topicId}/video-thumb`)
  if (withPlay) return withPlay
  // Fallback: store the plain thumbnail if the overlay step failed.
  try {
    const buf = await downloadImageFromUrl(thumbnailUrl)
    const base = `newsletter/${topicId}/video-thumb-`
    const key = `${base}${vtoken()}.jpg`
    const { url } = await uploadBufferWithKey(key, buf, 'image/jpeg')
    await deleteOldVersions(base, key)
    return url
  } catch (err) {
    logger.warn({ topicId, err }, '[newsletter/research] thumbnail S3 upload failed (non-fatal)')
    return null
  }
}

export async function researchVideo(
  topic: NewsletterTopic,
  voice: TopicVoiceContext,
): Promise<VideoResearch> {
  // Explicit override → use it directly; oEmbed only enriches title/thumbnail.
  if (topic.videoUrl) {
    const oe = await fetchYouTubeOEmbed(topic.videoUrl)
    const s3Url = await thumbnailToS3(topic.id, oe?.thumbnail_url ?? null)
    return {
      url: topic.videoUrl,
      title: oe?.title ?? null,
      thumbnailUrl: oe?.thumbnail_url ?? null,
      s3Url,
      manual: false,
    }
  }

  if (!(await isOxylabsConfigured())) {
    return { url: null, title: null, thumbnailUrl: null, s3Url: null, manual: true }
  }

  // Phase 1: AI-generated query. Phase 2: raw topic title.
  const spec = await specializationLabel(voice.specializationKey)
  let hit = null
  try {
    const { content } = await runNewsletterPrompt('nl_youtube_query', {
      topic: topic.topic,
      industry: voice.industry,
      specialization: spec,
      who: spec,
    })
    const query = cleanTextOutput(content)
    if (query) hit = await youtubeSearch(query)
  } catch (err) {
    logger.warn({ topicId: topic.id, err }, '[newsletter/research] youtube AI-query phase failed')
  }
  if (!hit) {
    try {
      hit = await youtubeSearch(topic.topic)
    } catch (err) {
      logger.warn({ topicId: topic.id, err }, '[newsletter/research] youtube raw-topic phase failed')
    }
  }

  if (!hit) {
    return { url: null, title: null, thumbnailUrl: null, s3Url: null, manual: true }
  }

  // Enrich the search hit the same way as an explicit override: oEmbed for a
  // clean title, deterministic ytimg thumbnail (fallback to oEmbed's).
  const oe = await fetchYouTubeOEmbed(hit.url)
  const thumb = hit.thumbnailUrl ?? oe?.thumbnail_url ?? null
  const s3Url = await thumbnailToS3(topic.id, thumb)
  return { url: hit.url, title: (oe?.title ?? hit.title) ? decodeEntities(oe?.title ?? hit.title ?? '') : null, thumbnailUrl: thumb, s3Url, manual: false }
}

// ── Recipe ──────────────────────────────────────────────────────────────────

function firstH2(html: string): string | null {
  const m = html.match(/<h2[^>]*>(.*?)<\/h2>/is)
  if (!m) return null
  return m[1].replace(/<[^>]+>/g, '').trim() || null
}

/**
 * Research + write one recipe (shared, neutral voice). `slot` namespaces the S3
 * image key so recipe and recipe2 don't collide. Used for both CSV recipe columns.
 */
export async function researchOneRecipe(
  hint: string,
  voice: TopicVoiceContext,
  priorTitles: string[],
  topicId: string,
  slot: 'recipe' | 'recipe2',
): Promise<RecipeResearch | null> {
  if (!hint) return null

  // 1. Grounded research.
  const { content: research } = await runNewsletterPrompt(
    'nl_recipe_researcher',
    { recipeHint: hint },
    { useSearch: true },
  )

  // 2. Write (two-key system/user split). Shared content → neutral voice.
  const { data } = await runNewsletterWriterJson<{
    recipe_intro?: string
    recipe_ingredients?: string
    recipe_instructions?: string
  }>('nl_recipe_writer_system', 'nl_recipe_writer_user', {
    recipeHint: hint,
    recipeResearch: research,
    previousRecipeTitles: priorTitles.join('\n'),
    industry: voice.industry,
    specialization: await specializationLabel(voice.specializationKey),
    who: await specializationLabel(voice.specializationKey),
    writingStyle: '',
  })

  const intro = data.recipe_intro ?? ''
  const ingredients = data.recipe_ingredients ?? ''
  const instructions = data.recipe_instructions ?? ''
  const title = firstH2(intro)

  // 3. Image (16:9, non-fatal) — overlay the recipe name as a navy banner.
  let imageUrl: string | null = null
  try {
    const { content: imgPrompt } = await runNewsletterPrompt('nl_recipe_image_prompt', {
      recipeContent: `${intro}\n${ingredients}`,
    })
    const falKey = await getSystemApiKey('fal-ai')
    if (falKey && imgPrompt.trim()) {
      const buf = await generateWithFalAI(falKey, cleanTextOutput(imgPrompt), NL_IMAGE_MODEL, NL_IMAGE_SIZE)
      const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`
      // Composite the recipe name onto the image; fall back to the plain upload.
      imageUrl = title ? await overlayTitleBanner(dataUri, title, `${topicId}/${slot}`) : null
      if (!imageUrl) {
        const base = `newsletter/${topicId}/${slot}-`
        const key = `${base}${vtoken()}.jpg`
        const { url } = await uploadBufferWithKey(key, buf, 'image/jpeg')
        await deleteOldVersions(base, key)
        imageUrl = url
      }
    }
  } catch (err) {
    logger.warn({ topicId, slot, err }, '[newsletter/research] recipe image failed (non-fatal)')
  }

  return { title, intro, ingredients, instructions, imageUrl }
}

// ── Teaser sources ────────────────────────────────────────────────────────────

function isUsableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (!host.endsWith('.com')) return false
    return !SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** Extract the source article's real headline (og:title → <title> → first <h1>) + og:image. */
export function extractMeta(html: string): { headline: string | null; image: string | null } {
  if (!html) return { headline: null, image: null }
  const meta = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
      'i',
    )
    const m = html.match(re) ?? html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'),
    )
    return m ? m[1].trim() : null
  }
  const clean = (s: string | null) =>
    s ? s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || null : null

  const ogTitle = clean(meta('og:title'))
  const titleTag = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ?? null)
  const h1 = clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ?? null)
  const image = meta('og:image')
  return { headline: cleanHeadline(ogTitle || titleTag || h1), image: image || null }
}

/**
 * Strip a source page's site-branding suffix from a headline:
 * "Title | Site Name" / "Title - Brand" / "Title – Brand" → "Title".
 * Conservative: only drops a pipe tail, or a dash tail of ≤5 words.
 */
export function cleanHeadline(s: string | null): string | null {
  if (!s) return s
  let out = s.trim()
  const pipe = out.lastIndexOf(' | ')
  if (pipe > 0) out = out.slice(0, pipe).trim()
  out = out.replace(/\s+[–—-]\s+[^–—-]{1,40}$/, (tail) => {
    const words = tail.replace(/^\s+[–—-]\s+/, '').trim().split(/\s+/)
    return words.length <= 5 ? '' : tail
  })
  return out.trim() || s
}

/** Pull readable text from h1/h2/h3/p/li into a normalized block (capped). */
export function extractReadable(html: string): string {
  if (!html) return ''
  const blocks: string[] = []
  const re = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase()
    const text = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    if (tag === 'h1') blocks.push(`# Article Title: ${text}`)
    else if (tag === 'h2') blocks.push(`## ${text}`)
    else if (tag === 'h3') blocks.push(`### ${text}`)
    else if (tag === 'li') blocks.push(`- ${text}`)
    else blocks.push(text)
    if (blocks.join('\n').length > 8000) break
  }
  return blocks.join('\n').slice(0, 8000)
}

async function researchOneTeaser(
  bullet: string,
  voice: TopicVoiceContext,
): Promise<TeaserSource | null> {
  let urls = await googleSearch(bullet)
  urls = urls.filter(isUsableUrl)
  if (urls.length === 0) return null

  // Validate via the proxy, require HTTP 200, collect up to 10 (cap attempts).
  const valid: string[] = []
  for (const u of urls.slice(0, 12)) {
    if (valid.length >= 10) break
    if ((await urlStatus(u)) === 200) valid.push(u)
  }
  if (valid.length === 0) return null

  // Pick the best URL (fallback to the first valid one).
  let chosen = valid[0]
  try {
    const { content } = await runNewsletterPrompt('nl_teaser_url_selector', {
      bulletPoint: bullet,
      urlCount: String(valid.length),
      urls: valid.join('\n'),
      who: await specializationLabel(voice.specializationKey),
    })
    const picked = cleanTextOutput(content).trim()
    if (valid.includes(picked)) chosen = picked
  } catch (err) {
    logger.warn({ bullet, err }, '[newsletter/research] teaser URL selector failed — using first valid')
  }

  const { html } = await scrapeUrl(chosen)
  const extract = extractReadable(html)
  if (!extract) return null
  const { headline, image } = extractMeta(html)
  return { bullet, url: chosen, extract: decodeEntities(extract), headline: headline ? decodeEntities(headline) : headline, image }
}

export async function researchTeaserSources(
  topic: NewsletterTopic,
  voice: TopicVoiceContext,
): Promise<TeaserSource[]> {
  if (!(await isOxylabsConfigured())) return []
  const bullets = [topic.bullet1, topic.bullet2, topic.bullet3].filter(Boolean)
  const out: TeaserSource[] = []
  for (const bullet of bullets) {
    try {
      const ts = await researchOneTeaser(bullet, voice)
      if (ts) out.push(ts)
    } catch (err) {
      logger.warn({ topicId: topic.id, bullet, err }, '[newsletter/research] teaser source failed')
    }
  }
  return out
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function priorRecipeTitles(calendarId: string | null, excludeTopicId: string): Promise<string[]> {
  if (!calendarId) return [] // account-scoped override topic — no shared calendar to dedupe against
  const rows = await prisma.newsletterTopic.findMany({
    where: { calendarId, id: { not: excludeTopicId }, research: { not: Prisma.JsonNull } },
    select: { research: true },
    take: 100,
  })
  const titles: string[] = []
  for (const r of rows) {
    const research = r.research as TopicResearch | null
    if (research?.recipe?.title) titles.push(research.recipe.title)
    if (research?.recipe2?.title) titles.push(research.recipe2.title)
  }
  return titles
}

export interface ResearchOutcome {
  status: 'complete' | 'partial' | 'failed'
  research: TopicResearch
}

export async function ensureTopicResearch(topicId: string): Promise<ResearchOutcome> {
  const topic = await prisma.newsletterTopic.findUnique({
    where: { id: topicId },
    include: { calendar: true },
  })
  if (!topic) throw new Error(`NewsletterTopic ${topicId} not found`)

  if (topic.researchStatus === 'complete') {
    return { status: 'complete', research: (topic.research as TopicResearch) ?? {} }
  }

  const voice = await topicVoiceContext(topic)
  const research: TopicResearch = {}

  // Video (always attempted).
  try {
    research.video = await researchVideo(topic, voice)
  } catch (err) {
    logger.warn({ topicId, err }, '[newsletter/research] video research threw')
  }

  // Recipes (each only when its column is populated). Both share neutral voice.
  const priors = topic.recipe || topic.recipe2 ? await priorRecipeTitles(topic.calendarId, topic.id) : []
  if (topic.recipe) {
    try {
      const recipe = await researchOneRecipe(topic.recipe, voice, priors, topic.id, 'recipe')
      if (recipe) {
        research.recipe = recipe
        if (recipe.title) priors.push(recipe.title)
      }
    } catch (err) {
      logger.warn({ topicId, err }, '[newsletter/research] recipe research threw')
    }
  }
  if (topic.recipe2) {
    try {
      const recipe2 = await researchOneRecipe(topic.recipe2, voice, priors, topic.id, 'recipe2')
      if (recipe2) research.recipe2 = recipe2
    } catch (err) {
      logger.warn({ topicId, err }, '[newsletter/research] recipe2 research threw')
    }
  }

  // Teaser sources (one per bullet).
  try {
    research.teaserSources = await researchTeaserSources(topic, voice)
  } catch (err) {
    logger.warn({ topicId, err }, '[newsletter/research] teaser research threw')
  }

  // Completeness: a found-or-manual video, recipes iff required, all 3 teasers.
  const videoOk = !!research.video && (!!research.video.url || research.video.manual)
  const recipeOk = (!topic.recipe || !!research.recipe) && (!topic.recipe2 || !!research.recipe2)
  const teaserOk = (research.teaserSources?.length ?? 0) >= 3
  const anything =
    !!research.video || !!research.recipe || !!research.recipe2 || (research.teaserSources?.length ?? 0) > 0

  const status: ResearchOutcome['status'] =
    videoOk && recipeOk && teaserOk ? 'complete' : anything ? 'partial' : 'failed'

  await prisma.newsletterTopic.update({
    where: { id: topicId },
    data: { research: research as unknown as Prisma.InputJsonValue, researchStatus: status },
  })

  logger.info({ topicId, status }, '[newsletter/research] topic research written')
  return { status, research }
}
