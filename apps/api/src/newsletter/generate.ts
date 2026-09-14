/**
 * Per-customer voiced newsletter generation (Phase 1c).
 *
 * For an assigned customer × topic, fills the Newsletter row section-by-section in
 * the customer's voice, reading the SHARED research (video/recipe/teaser sources)
 * produced by ensureTopicResearch. Each section is fault-tolerant: a failure
 * leaves its column null and review surfaces the gap. Only a thrown FEATURE
 * article aborts the edition (per the plan).
 *
 * Rendering (renderedHtml) lands in Phase 1d; here we set status=ready_for_review
 * with the content populated.
 */
import { Prisma } from '@prisma/client'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import type { LLMResponse } from '../article-pipeline/llm/adapter'
import { cleanTextOutput } from '../article-pipeline/output-cleaner'
import { logger } from '../lib/logger'
import { runNewsletterPrompt, runNewsletterWriterJson, runNewsletterJsonPrompt } from './llm'
import { generateArticle, type VoiceVars, type UsageRecorder, type NewsletterArticle } from './article'
import { loadPlainLanguageConfig, formatExemplars } from '../article-pipeline/enrichment/plain-language'
import { sanitizeDashesText } from '../lib/text/dash-sanitizer'
import { mapWithConcurrency } from '../lib/concurrency'
import type { TopicResearch, TeaserSource } from './research'
import { renderNewsletterHtml, buildRenderInput, type RenderBrand, type RenderVideo } from './render'
import { generateCoverImage, type CoverItem, type CoverColors } from './cover'
import { specializationLabel } from './calendar-routing'


const J = (v: unknown): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue

/** Records LLMUsage per call and accumulates totals for the Newsletter row. */
class Usage implements UsageRecorder {
  cost = 0
  input = 0
  output = 0
  constructor(private userId: string) {}
  async record(r: LLMResponse): Promise<void> {
    this.cost += r.cost
    this.input += r.tokens.input
    this.output += r.tokens.output
    try {
      await prisma.lLMUsage.create({
        data: {
          userId: this.userId,
          source: 'newsletter',
          provider: r.provider,
          model: r.model,
          inputTokens: r.tokens.input,
          outputTokens: r.tokens.output,
          cost: r.cost,
        },
      })
    } catch (err) {
      logger.warn({ err }, '[newsletter/generate] LLMUsage write failed (non-fatal)')
    }
  }
}

interface Teaser {
  headline: string | null // real source article title (preferred heading)
  title: string
  body: string
  cta: string
  link: string
}

/** Hook types rotate across the 3 teaser slots so the pattern never reads as
 * formula. See .plans/de-ai-writing.implementation-plan.md Phase 4. */
const TEASER_HOOK_TYPES = ['scene', 'metaphor', 'question'] as const

async function voiceTeasers(
  sources: TeaserSource[],
  voice: VoiceVars,
  usage: Usage,
): Promise<Teaser[]> {
  const out: Teaser[] = []

  // Per-industry metaphor exemplars + advertising restrictions (empty for
  // industries without a PlainLanguageConfig — the hook craft still applies).
  let exemplars = ''
  let restrictions = ''
  try {
    const config = await loadPlainLanguageConfig(voice.industry)
    if (config) {
      exemplars = formatExemplars(config)
      restrictions = config.restrictions
    }
  } catch (err) {
    logger.warn({ err }, '[newsletter/generate] plain-language config load failed — teasers proceed without exemplars')
  }

  // The 3 teasers are independent — voiced in parallel; hookType stays
  // index-based so the scene→metaphor→question rotation is deterministic, and
  // results keep source order (mapWithConcurrency preserves index order).
  const voiced = await mapWithConcurrency(sources, 3, async (s, i) => {
    const hookType = TEASER_HOOK_TYPES[i % TEASER_HOOK_TYPES.length]
    try {
      const vars = {
        bulletPoint: s.bullet,
        articleContent: s.extract,
        writingStyle: voice.writingStyle,
        who: voice.targetAudience,
        industry: voice.industry,
        hookType,
        sourceTitle: s.headline ?? '',
        exemplars,
        restrictions,
      }
      let { data, response } = await runNewsletterWriterJson<{
        title?: string
        body?: string
        cta?: string
      }>('nl_teaser_summarizer_system', 'nl_teaser_summarizer_user', vars)
      await usage.record(response)

      // Compliance check against the source extract. Unlike plain-language
      // injections, a teaser slot shouldn't vanish on failure: regenerate once
      // with the reason, then accept (logged for QA).
      if (restrictions && data.body) {
        try {
          const verify = await runNewsletterJsonPrompt<{ ok?: boolean; reason?: string }>('pl_verify', {
            sectionExcerpt: s.extract.slice(0, 8000),
            generatedText: data.body.replace(/<[^>]+>/g, ' '),
            restrictions,
          })
          await usage.record(verify.response)
          if (verify.data.ok !== true) {
            const reason = verify.data.reason ?? 'unspecified'
            logger.warn({ bullet: s.bullet, reason }, '[newsletter/generate] teaser verify failed — regenerating once')
            const retry = await runNewsletterWriterJson<{ title?: string; body?: string; cta?: string }>(
              'nl_teaser_summarizer_system',
              'nl_teaser_summarizer_user',
              { ...vars, restrictions: `${restrictions}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED FOR: ${reason} — fix exactly this.` },
            )
            await usage.record(retry.response)
            if (retry.data.body) data = retry.data
          }
        } catch (err) {
          logger.warn({ bullet: s.bullet, err }, '[newsletter/generate] teaser verify errored — keeping first draft')
        }
      }

      return {
        headline: s.headline,
        title: (await sanitizeDashesText(data.title ?? s.bullet, { surface: 'nl_teaser_title' })).trim(),
        body: await sanitizeDashesText(data.body ?? '', { surface: 'nl_teaser_body' }),
        cta: await sanitizeDashesText(data.cta ?? '', { surface: 'nl_teaser_cta' }),
        link: s.url,
      } satisfies Teaser
    } catch (err) {
      logger.warn({ bullet: s.bullet, err }, '[newsletter/generate] teaser voicing failed')
      return null
    }
  })

  for (const t of voiced) if (t) out.push(t)
  return out
}

interface QuickHits {
  tips: string[]
  facts: string[]
}

async function generateQuickHits(
  topicVars: Record<string, string>,
  voice: VoiceVars,
  usage: Usage,
): Promise<QuickHits> {
  const vars = { ...topicVars, ...voiceToVars(voice) }
  const result: QuickHits = { tips: [], facts: [] }

  try {
    const { data, response } = await runNewsletterWriterJson<Record<string, string>>(
      'nl_tips_system',
      'nl_tips_user',
      vars,
    )
    await usage.record(response)
    const tips = [data.tip_1, data.tip_2, data.tip_3, data.tip_4].filter(Boolean) as string[]
    result.tips = await Promise.all(tips.map((t) => sanitizeDashesText(t, { surface: 'nl_tips' })))
  } catch (err) {
    logger.warn({ err }, '[newsletter/generate] tips failed')
  }

  try {
    const { data, response } = await runNewsletterWriterJson<Record<string, string>>(
      'nl_facts_system',
      'nl_facts_user',
      vars,
    )
    await usage.record(response)
    const facts = [data.fact_1, data.fact_2, data.fact_3, data.fact_4].filter(Boolean) as string[]
    result.facts = await Promise.all(facts.map((f) => sanitizeDashesText(f, { surface: 'nl_facts' })))
  } catch (err) {
    logger.warn({ err }, '[newsletter/generate] facts failed')
  }

  return result
}

interface Fun {
  triviaQuestion: string | null
  triviaAnswer: string | null
  joke: string | null
}

async function generateFun(
  topicVars: Record<string, string>,
  voice: VoiceVars,
  usage: Usage,
): Promise<Fun> {
  const vars = { ...topicVars, ...voiceToVars(voice) }
  const fun: Fun = { triviaQuestion: null, triviaAnswer: null, joke: null }

  try {
    const { data, response } = await runNewsletterWriterJson<{
      trivia_question?: string
      trivia_answer?: string
    }>('nl_trivia_system', 'nl_trivia_user', vars)
    await usage.record(response)
    fun.triviaQuestion = data.trivia_question ? await sanitizeDashesText(data.trivia_question, { surface: 'nl_trivia' }) : null
    fun.triviaAnswer = data.trivia_answer ? await sanitizeDashesText(data.trivia_answer, { surface: 'nl_trivia' }) : null
  } catch (err) {
    logger.warn({ err }, '[newsletter/generate] trivia failed')
  }

  try {
    const { data, response } = await runNewsletterWriterJson<{ joke?: string }>(
      'nl_joke_system',
      'nl_joke_user',
      vars,
    )
    await usage.record(response)
    fun.joke = data.joke ? await sanitizeDashesText(data.joke, { surface: 'nl_joke' }) : null
  } catch (err) {
    logger.warn({ err }, '[newsletter/generate] joke failed')
  }

  return fun
}

interface RecipeModule {
  intro: string
  ingredients: string
  instructions: string
  imageUrl: string | null
}
interface Modules {
  recipe?: RecipeModule
  recipe2?: RecipeModule
}

/**
 * Modules = the two recipes, both reused from the shared (neutral-voice) research
 * (written once per topic, identical for every customer). No per-customer LLM here.
 */
function buildModules(research: TopicResearch): Modules {
  const modules: Modules = {}
  const map = (r: NonNullable<TopicResearch['recipe']>) => ({
    intro: r.intro,
    ingredients: r.ingredients,
    instructions: r.instructions,
    imageUrl: r.imageUrl,
  })
  if (research.recipe) modules.recipe = map(research.recipe)
  if (research.recipe2) modules.recipe2 = map(research.recipe2)
  return modules
}

function voiceToVars(v: VoiceVars): Record<string, string> {
  return {
    writingStyle: v.writingStyle,
    who: v.targetAudience,
    industry: v.industry,
    specialization: v.specialization,
  }
}

// ── Validation (ported, lightweight — logged, non-blocking) ────────────────────

interface ValidationResult {
  completionPercentage: number
  missing: string[]
}

function validateNewsletter(parts: {
  featureArticle: { body: string; title: string } | null
  teasers: Teaser[] | null
  quickHits: QuickHits | null
  fun: Fun | null
  subjectLine: string | null
  previewText: string | null
  research: TopicResearch
  needsRecipe: boolean
}): ValidationResult {
  const checks: Array<[string, boolean]> = [
    ['featureArticle', !!parts.featureArticle && parts.featureArticle.body.length >= 200],
    ['teasers', (parts.teasers?.length ?? 0) >= 3],
    ['tips', (parts.quickHits?.tips.length ?? 0) >= 4],
    ['facts', (parts.quickHits?.facts.length ?? 0) >= 4],
    ['trivia', !!parts.fun?.triviaQuestion && !!parts.fun?.triviaAnswer],
    ['joke', !!parts.fun?.joke],
    ['subjectLine', !!parts.subjectLine],
    ['previewText', !!parts.previewText],
    ['video', !!parts.research.video && (!!parts.research.video.url || parts.research.video.manual)],
  ]
  if (parts.needsRecipe) checks.push(['recipe', !!parts.research.recipe])

  const passed = checks.filter(([, ok]) => ok).length
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name)
  return {
    completionPercentage: Math.round((passed / checks.length) * 100),
    missing,
  }
}

async function generateSubject(topic: { topic: string }, voice: VoiceVars, usage: Usage): Promise<string | null> {
  const s = await runNewsletterPrompt('nl_subject_line', {
    topic: topic.topic,
    who: voice.targetAudience,
  })
  await usage.record(s.response)
  const subject = cleanTextOutput(s.content)
  return subject ? await sanitizeDashesText(subject, { surface: 'nl_subject' }) : null
}

async function generatePreview(
  topic: { topic: string },
  subjectLine: string | null,
  voice: VoiceVars,
  usage: Usage,
): Promise<string | null> {
  const p = await runNewsletterPrompt('nl_preview_text', {
    topic: topic.topic,
    subjectLine: subjectLine ?? '',
    who: voice.targetAudience,
  })
  await usage.record(p.response)
  const preview = cleanTextOutput(p.content)
  return preview ? await sanitizeDashesText(preview, { surface: 'nl_preview' }) : null
}

// ── Shared context ────────────────────────────────────────────────────────────

interface GenContext {
  newsletterId: string
  userId: string
  topic: Prisma.NewsletterTopicGetPayload<{ include: { calendar: true } }>
  voice: VoiceVars
  research: TopicResearch
  usage: Usage
  bullets: string[]
  topicVars: Record<string, string>
  brand: RenderBrand | null
}

async function loadGenContext(newsletterId: string): Promise<GenContext> {
  const newsletter = await prisma.newsletter.findUnique({
    where: { id: newsletterId },
    include: { topic: { include: { calendar: true } } },
  })
  if (!newsletter) throw new Error(`Newsletter ${newsletterId} not found`)
  const topic = newsletter.topic
  const calendar = topic.calendar
  const user = await prisma.user.findUnique({
    where: { id: newsletter.userId },
    include: { brandSettings: true, settings: true },
  })
  const voice: VoiceVars = {
    writingStyle: user?.settings?.writingStyle ?? '',
    targetAudience: user?.brandSettings?.who ?? '',
    industry: user?.brandSettings?.industry ?? calendar?.industry ?? '',
    specialization:
      (await specializationLabel(user?.brandSettings?.primarySpecialization ?? calendar?.specializationKey ?? null)) ||
      user?.brandSettings?.specialization ||
      '',
  }
  return {
    newsletterId,
    userId: newsletter.userId,
    topic,
    voice,
    research: (topic.research as TopicResearch | null) ?? {},
    usage: new Usage(newsletter.userId),
    bullets: [topic.bullet1, topic.bullet2, topic.bullet3],
    topicVars: {
      topic: topic.topic,
      bullet1: topic.bullet1,
      bullet2: topic.bullet2,
      bullet3: topic.bullet3,
    },
    brand: user?.brandSettings ? toRenderBrand(user.brandSettings) : null,
  }
}

// ── Cover summary image ─────────────────────────────────────────────────────

/** Build the cover's tile items (priority order, cap 6) from the edition content. */
function coverItems(
  featureArticle: NewsletterArticle | null,
  secondaryArticle: NewsletterArticle | null,
  teasers: Teaser[] | null,
  research: TopicResearch,
): CoverItem[] {
  const items: CoverItem[] = []
  if (featureArticle) items.push({ headline: featureArticle.title })
  for (const t of teasers ?? []) items.push({ headline: t.headline || t.title })
  if (secondaryArticle) items.push({ headline: secondaryArticle.title })
  if (research.recipe?.title) items.push({ headline: research.recipe.title })
  return items.filter((i) => i.headline?.trim()).slice(0, 6)
}

/** Resolve the cover palette from the brand (example defaults). */
function coverColors(brand: RenderBrand | null): CoverColors {
  return {
    headerBg: brand?.nlHeaderBgColor?.trim() || '#011328',
    sections: [
      brand?.nlSectionColor1?.trim() || '#fa00bb',
      brand?.nlSectionColor2?.trim() || '#00bbf9',
      brand?.nlSectionColor3?.trim() || '#00142b',
      brand?.nlSectionColor4?.trim() || '#00dd81',
    ],
  }
}

/** Build + persist the cover image for an edition. Best-effort (non-fatal). */
async function buildAndSaveCover(
  ctx: GenContext,
  featureArticle: NewsletterArticle | null,
  secondaryArticle: NewsletterArticle | null,
  teasers: Teaser[] | null,
): Promise<void> {
  const items = coverItems(featureArticle, secondaryArticle, teasers, ctx.research)
  if (items.length === 0) return
  try {
    const { summaryTitle, summaryImageUrl } = await generateCoverImage({
      keyPrefix: `${ctx.topic.id}/${ctx.userId}`,
      industry: ctx.voice.industry,
      who: ctx.voice.targetAudience,
      editionDate: ctx.topic.date,
      items,
      colors: coverColors(ctx.brand),
      usage: ctx.usage,
    })
    const data: Prisma.NewsletterUpdateInput = {}
    if (summaryTitle) data.summaryTitle = summaryTitle
    if (summaryImageUrl) data.summaryImageUrl = summaryImageUrl
    if (Object.keys(data).length > 0) {
      await prisma.newsletter.update({ where: { id: ctx.newsletterId }, data })
    }
  } catch (err) {
    logger.warn({ newsletterId: ctx.newsletterId, err }, '[newsletter/generate] cover build failed')
  }
}

// ── Render + validate persistence ──────────────────────────────────────────────

/** Coerce the BrandSettings.socialMediaLinks JSON into the typed render shape. */
export function normalizeSocialLinks(v: unknown): RenderBrand['socialMediaLinks'] {
  if (!Array.isArray(v)) return null
  const out = v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.url === 'string' && (x.url as string).trim())
    .map((x) => ({ platform: typeof x.platform === 'string' ? x.platform : '', url: x.url as string }))
  return out.length > 0 ? out : null
}

export function toRenderBrand(
  b: (Partial<Omit<RenderBrand, 'socialMediaLinks'>> & { socialMediaLinks?: unknown }) | null,
): RenderBrand {
  if (!b) return {}
  return {
    organizationName: b.organizationName,
    defaultAuthorName: b.defaultAuthorName,
    organizationLogoUrl: b.organizationLogoUrl,
    organizationAddress: b.organizationAddress,
    organizationEmail: b.organizationEmail,
    organizationPhone: b.organizationPhone,
    socialMediaLinks: normalizeSocialLinks(b.socialMediaLinks),
    addressLine1: b.addressLine1,
    addressLine2: b.addressLine2,
    addressLocality: b.addressLocality,
    addressRegion: b.addressRegion,
    postalCode: b.postalCode,
    addressCountryName: b.addressCountryName,
    nlLogoUrl: b.nlLogoUrl,
    nlLogoLightUrl: b.nlLogoLightUrl,
    nlLogoDarkUrl: b.nlLogoDarkUrl,
    nlHeaderLogoVariant: b.nlHeaderLogoVariant,
    nlHeaderTextColor: b.nlHeaderTextColor,
    nlHeaderLogoLayout: b.nlHeaderLogoLayout,
    nlFooterLogoVariant: b.nlFooterLogoVariant,
    nlFooterLogoWidth: b.nlFooterLogoWidth,
    nlFooterDisclaimer: b.nlFooterDisclaimer,
    nlLogoWidth: b.nlLogoWidth,
    nlHeaderBgColor: b.nlHeaderBgColor,
    nlFooterBgColor: b.nlFooterBgColor,
    nlSectionColor1: b.nlSectionColor1,
    nlSectionColor2: b.nlSectionColor2,
    nlSectionColor3: b.nlSectionColor3,
    nlSectionColor4: b.nlSectionColor4,
    nlFontFamily: b.nlFontFamily,
    nlFontColor: b.nlFontColor,
    nlHeadingFontWeight: b.nlHeadingFontWeight,
    nlBodyFontWeight: b.nlBodyFontWeight,
    nlLinkColor: b.nlLinkColor,
  }
}

/**
 * Select the offers to include for an edition: one evergreen (no dates) + one
 * seasonal whose window contains the edition's day (UTC). Highest priority wins.
 */
async function selectOffers(userId: string, editionDate: Date) {
  const offers = await prisma.newsletterOffer.findMany({
    where: { userId, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  const dayNum = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
  const ed = dayNum(new Date(editionDate))
  const toRender = (o: (typeof offers)[number]) => ({
    title: o.title,
    body: o.body,
    ctaLabel: o.ctaLabel,
    ctaUrl: o.ctaUrl,
    imageUrl: o.imageUrl,
  })
  const inWindow = (o: (typeof offers)[number]) => {
    if (!o.startDate && !o.endDate) return false
    const s = o.startDate ? dayNum(o.startDate) : -Infinity
    const e = o.endDate ? dayNum(o.endDate) : Infinity
    return ed >= s && ed <= e
  }
  const evergreen = offers.find((o) => !o.startDate && !o.endDate)
  const seasonal = offers.find((o) => inWindow(o))
  return {
    evergreen: evergreen ? toRender(evergreen) : null,
    seasonal: seasonal ? toRender(seasonal) : null,
  }
}

/**
 * Recompute validation from the row's current columns, render the magazine HTML,
 * and persist both. Idempotent — safe to call after a full generate or a
 * single-section regenerate.
 */
export async function renderAndSave(newsletterId: string): Promise<string> {
  const nl = await prisma.newsletter.findUnique({
    where: { id: newsletterId },
    include: { topic: true },
  })
  if (!nl) throw new Error(`Newsletter ${newsletterId} not found`)
  const brandRow = await brandSettingsForUser(nl.userId)
  const research = (nl.topic.research as TopicResearch | null) ?? {}
  const video = (research.video as RenderVideo | undefined) ?? null

  const feature = nl.featureArticle as { body?: string; title?: string } | null
  const qh = nl.quickHits as QuickHits | null
  const fun = nl.fun as Fun | null
  const validation = validateNewsletter({
    featureArticle: feature ? { body: feature.body ?? '', title: feature.title ?? '' } : null,
    teasers: nl.teasers as Teaser[] | null,
    quickHits: qh,
    fun,
    subjectLine: nl.subjectLine,
    previewText: nl.previewText,
    research,
    needsRecipe: !!nl.topic.recipe,
  })

  const offers = await selectOffers(nl.userId, nl.topic.date)
  const input = buildRenderInput(nl, video, nl.topic.date, offers)

  // Recipes come from SHARED topic research rendered verbatim (no per-client LLM
  // call), so pre-sanitizer research can still carry em-dashes — clean them at
  // render time. Non-fatal; covers old research without re-running it.
  for (const recipe of [input.modules?.recipe, input.modules?.recipe2]) {
    if (!recipe) continue
    try {
      recipe.intro = await sanitizeDashesText(recipe.intro, { newsletterId, surface: 'recipe_intro' })
      recipe.ingredients = await sanitizeDashesText(recipe.ingredients, { newsletterId, surface: 'recipe_ingredients' })
      recipe.instructions = await sanitizeDashesText(recipe.instructions, { newsletterId, surface: 'recipe_instructions' })
    } catch {
      /* keep original */
    }
  }

  // Offer cards are human/admin-authored stored text (same class as the footer
  // disclaimer was) — full-elimination policy applies to them too.
  for (const offer of [input.seasonalOffer, input.evergreenOffer]) {
    if (!offer) continue
    try {
      offer.title = await sanitizeDashesText(offer.title, { newsletterId, surface: 'offer_title' })
      offer.body = await sanitizeDashesText(offer.body, { newsletterId, surface: 'offer_body' })
    } catch {
      /* keep original */
    }
  }

  const html = renderNewsletterHtml(input, toRenderBrand(brandRow))
  await prisma.newsletter.update({
    where: { id: newsletterId },
    data: { renderedHtml: html, validation: J(validation) },
  })
  return html
}

// ── Entry point — full generation ──────────────────────────────────────────────

/**
 * Generate the voiced content for one (userId, topicId) and set
 * status=ready_for_review. The Newsletter row must already exist (enqueue creates
 * it). Assumes ensureTopicResearch has run (the handler calls it first).
 */
export async function generateNewsletterForCustomer(userId: string, topicId: string): Promise<void> {
  const row = await prisma.newsletter.findUnique({
    where: { userId_topicId: { userId, topicId } },
    select: { id: true },
  })
  if (!row) throw new Error(`Newsletter (${userId}, ${topicId}) not found`)
  const ctx = await loadGenContext(row.id)
  const { topic, voice, research, usage, bullets, topicVars } = ctx

  // Feature + secondary articles run in PARALLEL — fully independent (distinct
  // imageKeys; plain-language imagery dedup is per-article). Feature stays
  // required (its rejection aborts the edition); secondary stays optional.
  // See .plans/production-throughput.implementation-plan.md Phase 1b.
  const [featureArticle, secondaryArticle] = await Promise.all([
    generateArticle(topic.topic, bullets, voice, `${topic.id}/${userId}-feature`, usage),
    topic.secondaryTopic
      ? generateArticle(topic.secondaryTopic, bullets, voice, `${topic.id}/${userId}-secondary`, usage).catch(
          (err) => {
            logger.warn({ topicId, err }, '[newsletter/generate] secondary article failed')
            return null
          },
        )
      : Promise.resolve(null),
  ])

  // Teasers, quick-hits, fun (all fault-tolerant) — also independent of each other.
  const [teasers, quickHits, fun] = await Promise.all([
    voiceTeasers(research.teaserSources ?? [], voice, usage).catch((err): Teaser[] | null => {
      logger.warn({ topicId, err }, '[newsletter/generate] teasers failed')
      return null
    }),
    generateQuickHits(topicVars, voice, usage),
    generateFun(topicVars, voice, usage),
  ])
  const modules = buildModules(research)

  let subjectLine: string | null = null
  let previewText: string | null = null
  try {
    subjectLine = await generateSubject(topic, voice, usage)
  } catch (err) {
    logger.warn({ topicId, err }, '[newsletter/generate] subject line failed')
  }
  try {
    previewText = await generatePreview(topic, subjectLine, voice, usage)
  } catch (err) {
    logger.warn({ topicId, err }, '[newsletter/generate] preview text failed')
  }

  // Persist sections that produced content (Json columns can't be set to plain
  // null via Prisma; leaving them out keeps the default null).
  const data: Prisma.NewsletterUpdateInput = {
    status: 'ready_for_review',
    cost: usage.cost,
    inputTokens: usage.input,
    outputTokens: usage.output,
    featureArticle: J(featureArticle),
    quickHits: J(quickHits),
    fun: J(fun),
  }
  if (secondaryArticle) data.secondaryArticle = J(secondaryArticle)
  if (teasers && teasers.length > 0) data.teasers = J(teasers)
  if (Object.keys(modules).length > 0) data.modules = J(modules)
  if (subjectLine) data.subjectLine = subjectLine
  if (previewText) data.previewText = previewText

  await prisma.newsletter.update({ where: { id: row.id }, data })

  // Cover summary image (best-effort) — sets summaryImageUrl before we render.
  await buildAndSaveCover(ctx, featureArticle, secondaryArticle, teasers)

  // Render + validate from the persisted row.
  await renderAndSave(row.id)
  logger.info({ topicId, userId, cost: usage.cost }, '[newsletter/generate] ready_for_review')
}

// ── Single-section regeneration ────────────────────────────────────────────────

export type NewsletterSection =
  | 'feature'
  | 'secondary'
  | 'teasers'
  | 'quickHits'
  | 'fun'
  | 'modules'
  | 'subject'
  | 'preview'
  | 'summaryImage'
  | 'all'

/**
 * Re-run one section's generator, write just its column, bump cost, then re-render
 * + re-validate. 'all' re-runs the whole edition.
 */
export async function regenerateNewsletterSection(
  newsletterId: string,
  section: NewsletterSection,
): Promise<void> {
  if (section === 'all') {
    const nl = await prisma.newsletter.findUnique({
      where: { id: newsletterId },
      select: { userId: true, topicId: true },
    })
    if (!nl) throw new Error(`Newsletter ${newsletterId} not found`)
    await generateNewsletterForCustomer(nl.userId, nl.topicId)
    return
  }

  const ctx = await loadGenContext(newsletterId)
  const { topic, voice, research, usage, bullets, topicVars, userId } = ctx
  const data: Prisma.NewsletterUpdateInput = {}

  switch (section) {
    case 'feature':
      data.featureArticle = J(
        await generateArticle(topic.topic, bullets, voice, `${topic.id}/${userId}-feature`, usage),
      )
      break
    case 'secondary':
      if (!topic.secondaryTopic) throw new Error('No secondary topic for this edition')
      data.secondaryArticle = J(
        await generateArticle(topic.secondaryTopic, bullets, voice, `${topic.id}/${userId}-secondary`, usage),
      )
      break
    case 'teasers':
      data.teasers = J(await voiceTeasers(research.teaserSources ?? [], voice, usage))
      break
    case 'quickHits':
      data.quickHits = J(await generateQuickHits(topicVars, voice, usage))
      break
    case 'fun':
      data.fun = J(await generateFun(topicVars, voice, usage))
      break
    case 'modules':
      data.modules = J(buildModules(research))
      break
    case 'subject':
      data.subjectLine = (await generateSubject(topic, voice, usage)) ?? null
      break
    case 'preview': {
      const nl = await prisma.newsletter.findUnique({
        where: { id: newsletterId },
        select: { subjectLine: true },
      })
      data.previewText = (await generatePreview(topic, nl?.subjectLine ?? null, voice, usage)) ?? null
      break
    }
    case 'summaryImage': {
      const nl = await prisma.newsletter.findUnique({
        where: { id: newsletterId },
        select: { featureArticle: true, secondaryArticle: true, teasers: true },
      })
      await buildAndSaveCover(
        ctx,
        (nl?.featureArticle as NewsletterArticle | null) ?? null,
        (nl?.secondaryArticle as NewsletterArticle | null) ?? null,
        (nl?.teasers as Teaser[] | null) ?? null,
      )
      break
    }
  }

  data.cost = { increment: usage.cost }
  data.inputTokens = { increment: usage.input }
  data.outputTokens = { increment: usage.output }

  await prisma.newsletter.update({ where: { id: newsletterId }, data })
  await renderAndSave(newsletterId)
  logger.info({ newsletterId, section }, '[newsletter/generate] section regenerated')
}
