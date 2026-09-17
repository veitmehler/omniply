import sharp from 'sharp'
import { downloadImageFromUrl } from '@omniply/shared'
import { loadSocialBrandTheme, loadLogoBuffer, loadTintLogo } from './brand-theme'
import { tintScheme, forcedTintScheme, type TintScheme } from './compositors/brand-tint'
import { registerSocialMedia } from './media-register'
import { renderQuoteCard } from './compositors/quote-card'
import { selectQuoteForCard } from './generators/quote-selection'
import {
  generateCarouselBackground,
  renderCarouselSlide,
  renderDiagramExplainerSlide,
  loadContinuationArrow,
  buildBulletStoryPng,
  DIAGRAM_EXPLAINER_TEXT,
  type CarouselSlidePlan,
} from './compositors/carousel'
import { planCarouselSlides } from './generators/carousel-plan'
import { renderPitchStory, type PitchStoryType } from './compositors/pitch-story'
import { maxSlidesForPlatforms } from './platform-limits'
import { mapWithConcurrency } from '../lib/concurrency'

/** Parallel slide chains per carousel (bounded upstream by the fal/gemini provider limiter). */
const SLIDE_CONCURRENCY = 3

export type QuoteCardVariant = 'feed' | 'story'

export interface GeneratedQuoteCard {
  postType: 'quote'
  quoteText: string
  attribution?: string
  variant: QuoteCardVariant
  imageUrl: string
  mediaId: string
}

export interface GeneratedCarousel {
  postType: 'carousel'
  /** Shared id for this carousel's media; reused when regenerating a single slide. */
  jobId: string
  slides: Array<{ imageUrl: string; mediaId: string; headline: string }>
  /** Full slide plans retained so callers can extract per-slide text for voiceover sync. */
  slidePlans: CarouselSlidePlan[]
  imageUrls: string[]
  /** Raw (pre-overlay) background image URLs, one per slide — used by S4/S6 pitch slides. */
  backgroundImageUrls: string[]
}

export interface GeneratedPitchStory {
  postType: 'pitch_carousel' | 'pitch_hook'
  slides: Array<{ imageUrl: string; mediaId: string }>
  imageUrls: string[]
}

function generationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Prompt for the single per-post carousel background (user decision
 * 2026-08-24): an industry motif as a soft background element for visual
 * depth — NOT content-specific per slide. Motif rotates per generation so
 * a day's posts don't share the identical image.
 */
const BACKGROUND_MOTIFS: Record<string, string[]> = {
  chiropractic: [
    'an elegant minimal line-art icon of a human spine',
    'softly rendered abstract vertebrae shapes as geometric forms',
    'a simple line-art icon of two hands, iconographic and abstract',
    'an abstract stick-figure posture icon with a clean vertical alignment line',
  ],
  default: [
    'soft overlapping abstract geometric shapes',
    'gentle flowing gradient waves',
    'a calm arrangement of translucent circles',
  ],
}

/** Motif background model. Recraft was tried first (2026-09-03) but kept
 *  baking gibberish pseudo-labels into illustrations despite hard wordless
 *  directives; gemini flash-image produces clean wordless flat icons.
 *  Admin-configurable model = v2. */
export const MOTIF_IMAGE_MODEL = 'gemini-3.1-flash-image'

export function themedBackgroundPrompt(industry: string | null | undefined, seed: string): string {
  // Chiro motifs for chiropractic clinics AND the azavea vertical (industry
  // "B2B practice-growth software" — its audience is chiropractors).
  const key = /chiro|practice-growth/i.test(industry ?? '') ? 'chiropractic' : 'default'
  const motifs = BACKGROUND_MOTIFS[key]
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const motif = motifs[h % motifs.length]
  return (
    `Flat minimalist vector illustration background for a social media graphic: ${motif}, ` +
    'ONE single subject only on a plain background, clean geometric iconographic style, ' +
    'positioned off-center as a large soft background element, ' +
    'muted professional palette, gentle gradient, generous negative space, ' +
    'STRICTLY no photorealism, no realistic human bodies or figures, ' +
    'completely WORDLESS: no text, no letters, no labels, no captions, no typography, ' +
    'no interface elements, no diagrams with annotations, no numbers, no people, no logos'
  )
}

/**
 * Story-arc IG carousel (engagement v2): the beat's slides rendered as
 * brand-tinted cards over ONE shared motif background. Slide 1 renders as
 * the tint HOOK banner (big, centered, swipe arrows); the rest as tint
 * content blocks. Zero new compositor machinery — synthetic slide plans
 * through renderCarouselSlide.
 */
export async function generateStorySlidesAsset(opts: {
  userId: string
  slides: string[]
  jobId?: string
  imageModel?: string
  /** Client override: force light/dark text + matching logo (per-post). */
  forceTextMode?: 'light' | 'dark'
  /** Recompose: reuse the existing motif background instead of generating. */
  reuseBackgroundUrl?: string
  /** Per-slide photo backgrounds (story images / client swaps): index → URL. */
  slideImages?: Record<number, string>
}): Promise<{ imageUrls: string[]; backgroundImageUrls: string[] }> {
  const brand = await loadSocialBrandTheme(opts.userId)
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  const tint = opts.forceTextMode ? forcedTintScheme(brand.primaryColor, opts.forceTextMode) : tintScheme(brand.primaryColor)
  const tintLogoBuffer = await loadTintLogo(brand, tint.logoVariant)
  const arrowBuffer = await loadContinuationArrow(tint.logoVariant)
  const logoBuffer = await loadLogoBuffer(brand.logoUrl)

  const rawMotif = opts.reuseBackgroundUrl
    ? await downloadImageFromUrl(opts.reuseBackgroundUrl)
    : await generateCarouselBackground(
        themedBackgroundPrompt(brand.industry, genId),
        jobId,
        MOTIF_IMAGE_MODEL,
        opts.userId,
      )

  // Soften: flat brand canvas + motif at ~70% alpha (0.45 read too faint —
  // dialed up 2026-09-03 evening). Under the slide's 0.85 wash the motif
  // reads at ~10% — present as texture, still behind the text.
  const hex = (tint.overlayColor ?? '#052234').replace('#', '')
  const canvasBgColor = {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    alpha: 1,
  }
  const softMotif = await sharp(rawMotif)
    .resize(1080, 1080, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .ensureAlpha(0.7)
    .png()
    .toBuffer()
  const bg = await sharp({ create: { width: 1080, height: 1080, channels: 4, background: canvasBgColor } })
    .composite([{ input: softMotif }])
    .png()
    .toBuffer()

  const bgReg = opts.reuseBackgroundUrl
    ? { url: opts.reuseBackgroundUrl }
    : await registerSocialMedia({
        userId: opts.userId,
        buffer: bg,
        s3Key: `social/${opts.userId}/${jobId}/story-bg-${genId}.png`,
        title: 'Story background',
        altText: 'Story background',
        source: 'carousel_slide',
        jobId,
      })

  const imageUrls: string[] = []
  const perSlideBgUrls: string[] = []
  for (let i = 0; i < opts.slides.length; i++) {
    const isHook = i === 0
    const plan = {
      type: (isHook ? 'hook' : 'content') as 'hook' | 'content',
      headlineText: isHook ? opts.slides[i] : null,
      bodyText: isHook ? null : opts.slides[i],
      imagePrompt: '',
    }
    // Story image (Veit 2026-09-17): a photo backdrop for this slide — the
    // half-panel design was built for exactly this. Falls back to the motif.
    let slideBg = bg
    let slideBgUrl = bgReg.url
    const photoUrl = opts.slideImages?.[i]
    if (photoUrl) {
      try {
        const photo = await downloadImageFromUrl(photoUrl)
        slideBg = await sharp(photo).resize(1080, 1080, { fit: 'cover', position: 'centre' }).png().toBuffer()
        slideBgUrl = photoUrl
      } catch {
        /* keep motif */
      }
    }
    const buffer = await renderCarouselSlide(slideBg, {
      slide: plan,
      slideIndex: i,
      totalSlides: opts.slides.length,
      brand,
      logoBuffer,
      tint,
      tintLogoBuffer,
      arrowBuffer: i < opts.slides.length - 1 ? arrowBuffer : null,
      storyMode: true,
    })
    const reg = await registerSocialMedia({
      userId: opts.userId,
      buffer,
      s3Key: `social/${opts.userId}/${jobId}/story-slide-${i + 1}-${genId}.png`,
      title: `Story slide ${i + 1}`,
      altText: opts.slides[i].slice(0, 120),
      source: 'carousel_slide',
      jobId,
    })
    imageUrls.push(reg.url)
    perSlideBgUrls.push(slideBgUrl)
  }
  // Parallel background array — per-slide (photo slides carry their own).
  return { imageUrls, backgroundImageUrls: perSlideBgUrls }
}

export async function generateQuoteCardAsset(opts: {
  userId: string
  content: string
  variant?: QuoteCardVariant
  quoteText?: string
  attribution?: string
  jobId?: string
}): Promise<GeneratedQuoteCard> {
  const brand = await loadSocialBrandTheme(opts.userId)
  const logoBuffer = await loadLogoBuffer(brand.logoUrl)
  const variant = opts.variant ?? 'feed'

  let quoteText = opts.quoteText?.trim()
  let attribution = opts.attribution?.trim()

  if (!quoteText) {
    const selected = await selectQuoteForCard({
      userId: opts.userId,
      content: opts.content,
      organizationName: brand.organizationName,
    })
    quoteText = selected.quote
    attribution = selected.attribution
  }

  const buffer = await renderQuoteCard({
    quoteText,
    attribution,
    variant,
    brand,
    logoBuffer,
  })

  const genId = generationId()
  const s3Key = `social/${opts.userId}/${opts.jobId ?? genId}/quote-${variant}-${genId}.png`
  const registered = await registerSocialMedia({
    userId: opts.userId,
    buffer,
    s3Key,
    title: `Quote card — ${quoteText.slice(0, 40)}`,
    altText: quoteText,
    source: 'quote_card',
    jobId: opts.jobId,
  })

  return {
    postType: 'quote',
    quoteText,
    attribution,
    variant,
    imageUrl: registered.url,
    mediaId: registered.mediaId,
  }
}

export async function generateCarouselAssets(opts: {
  userId: string
  content: string
  topic?: string
  articleUrl?: string
  platforms?: string[]
  slideCount?: number
  jobId?: string
  /**
   * When set (F4), this stylized article diagram is used as the background for
   * EVERY slide (instead of per-slide AI backgrounds), and a "Let's explain the
   * diagram >>>" slide is inserted right after the hook.
   */
  diagramBackground?: Buffer | null
  /** Watermark/arrow variant for diagram mode: 'light' (dark bg) → white arrows. */
  diagramLogoVariant?: 'light' | 'dark'
  /** Wed/Sat brand-tinted design (ignored when diagramBackground is set). */
  designVariant?: 'brand_tint' | 'brand_tint_accent'
  /** Fal.ai image model for AI slide backgrounds (admin-configurable). */
  imageModel?: string
  /**
   * Classic half-panel carousels (azavea): fresh themed background per slide
   * instead of the shared single image (user decision 2026-08-24).
   */
  perSlideBackgrounds?: boolean
}): Promise<GeneratedCarousel> {
  const brand = await loadSocialBrandTheme(opts.userId)
  const logoBuffer = await loadLogoBuffer(brand.logoUrl)
  const slideCount = opts.slideCount ?? maxSlidesForPlatforms(opts.platforms ?? [])
  const genId = generationId()
  const jobId = opts.jobId ?? genId

  const useDiagram = !!opts.diagramBackground

  // Brand-tint design (Wed/Sat): resolve text/logo contrast against the brand
  // color once for the whole carousel. Diagram mode wins if both are set.
  let tint: TintScheme | undefined
  let tintLogoBuffer: Buffer | null = null
  if ((opts.designVariant === 'brand_tint' || opts.designVariant === 'brand_tint_accent') && !useDiagram) {
    tint = tintScheme(opts.designVariant === 'brand_tint_accent' ? brand.accentColor : brand.primaryColor)
    tintLogoBuffer = await loadTintLogo(brand, tint.logoVariant)
  }
  // Reserve one slot for the inserted explainer slide so the total stays within
  // the platform slide cap.
  const planCount = useDiagram ? Math.max(2, slideCount - 1) : slideCount

  // Continuation-arrow glyph for the hook slide's swipe cue: diagram mode colors
  // it by the watermark variant; tint mode by the measured text/logo variant
  // (light text → white arrows). Classic carousels carry no arrows.
  const arrowVariant: 'light' | 'dark' = opts.diagramLogoVariant === 'dark' ? 'dark' : 'light'
  const arrowBuffer = useDiagram
    ? await loadContinuationArrow(arrowVariant)
    : tint
      ? await loadContinuationArrow(tint.logoVariant)
      : null

  const slidePlans = await planCarouselSlides({
      userId: opts.userId,
    content: opts.content,
    topic: opts.topic,
    organizationName: brand.organizationName,
    industry: brand.industry || undefined,
    writingStyle: brand.writingStyle || undefined,
    callToAction: brand.socialCallToAction || undefined,
    slideCount: planCount,
    articleUrl: opts.articleUrl ?? '',
    specialInstructions: brand.videoSpecialInstructions || undefined,
  })

  // When using the diagram, register it once and reuse the URL for every slide
  // (S4/S6 read backgroundImageUrls for their pitch slides).
  let diagramBgUrl: string | null = null
  if (useDiagram) {
    const reg = await registerSocialMedia({
      userId: opts.userId,
      buffer: opts.diagramBackground!,
      s3Key: `social/${opts.userId}/${jobId}/carousel-diagram-bg-${genId}.png`,
      title: 'Diagram background',
      altText: 'Article diagram',
      source: 'carousel_slide',
      jobId,
    })
    diagramBgUrl = reg.url
  }

  // ONE AI background per post, reused across every slide (user decision
  // 2026-08-24): an industry-motif image for visual depth instead of a unique
  // image per slide — ~10x fewer image calls; the alternating half-panels
  // keep slides visually distinct. Diagram mode already reuses its diagram.
  let sharedBg: Buffer | null = null
  let sharedBgUrl: string | null = null
  const perSlideBg = !!opts.perSlideBackgrounds && !useDiagram
  if (!useDiagram && !perSlideBg) {
    sharedBg = await generateCarouselBackground(
      themedBackgroundPrompt(brand.industry, genId),
      jobId,
      MOTIF_IMAGE_MODEL,
      opts.userId,
    )
    const reg = await registerSocialMedia({
      userId: opts.userId,
      buffer: sharedBg,
      s3Key: `social/${opts.userId}/${jobId}/carousel-bg-${genId}.png`,
      title: 'Carousel background',
      altText: 'Carousel background',
      source: 'carousel_slide',
      jobId,
    })
    sharedBgUrl = reg.url
  }

  // Slides run in PARALLEL (concurrency 3) — each slide's chain (background gen
  // → register → composite → register) is independent; results keep index order
  // via mapWithConcurrency. See .plans/production-throughput.implementation-plan.md 1c.
  const slideResults = await mapWithConcurrency(slidePlans, SLIDE_CONCURRENCY, async (plan, i) => {
    // Background: diagram > per-slide themed images (azavea classic slots) >
    // the single shared themed image. S4/S6 read backgroundImageUrls for
    // their pitch slides.
    let bg: Buffer
    let bgUrl: string
    if (useDiagram) {
      bg = opts.diagramBackground!
      bgUrl = diagramBgUrl!
    } else if (perSlideBg) {
      // REAL photographic images per slide (user decision 2026-09-03): the
      // slide planner's own image prompts through the shared gemini image
      // model — motif icons stay on story slides only.
      bg = await generateCarouselBackground(
        plan.imagePrompt || plan.headlineText || '',
        jobId,
        opts.imageModel,
        opts.userId,
      )
      const reg = await registerSocialMedia({
        userId: opts.userId,
        buffer: bg,
        s3Key: `social/${opts.userId}/${jobId}/carousel-bg-${i + 1}-${genId}.png`,
        title: `Carousel background ${i + 1}`,
        altText: `Background for slide ${i + 1}`,
        source: 'carousel_slide',
        jobId,
      })
      bgUrl = reg.url
    } else {
      bg = sharedBg!
      bgUrl = sharedBgUrl!
    }

    const buffer = await renderCarouselSlide(bg, {
      slide: plan,
      slideIndex: i,
      totalSlides: slidePlans.length,
      brand,
      logoBuffer,
      diagramMode: useDiagram,
      arrowBuffer,
      diagramVariant: useDiagram ? arrowVariant : undefined,
      tint,
      tintLogoBuffer,
    })

    const registered = await registerSocialMedia({
      userId: opts.userId,
      buffer,
      s3Key: `social/${opts.userId}/${jobId}/carousel-${i + 1}-${genId}.png`,
      title: `Carousel slide ${i + 1} — ${(plan.headlineText ?? plan.bodyText ?? '').slice(0, 40)}`,
      altText: plan.headlineText ?? plan.bodyText ?? `Slide ${i + 1}`,
      source: 'carousel_slide',
      jobId,
    })

    return {
      bgUrl,
      slide: {
        imageUrl: registered.url,
        mediaId: registered.mediaId,
        headline: plan.headlineText ?? plan.bodyText?.split('\n')[0] ?? `Slide ${i + 1}`,
      },
    }
  })

  const slides: GeneratedCarousel['slides'] = slideResults.map((r) => r.slide)
  const backgroundImageUrls: string[] = slideResults.map((r) => r.bgUrl)

  // Insert the "Let's explain the diagram >>>" slide right after the hook (slide 1).
  if (useDiagram && slides.length >= 1) {
    const explainerBuf = await renderDiagramExplainerSlide(opts.diagramBackground!, arrowBuffer, arrowVariant)
    const explainerReg = await registerSocialMedia({
      userId: opts.userId,
      buffer: explainerBuf,
      s3Key: `social/${opts.userId}/${jobId}/carousel-explainer-${genId}.png`,
      title: 'Carousel slide — explain the diagram',
      altText: DIAGRAM_EXPLAINER_TEXT,
      source: 'carousel_slide',
      jobId,
    })
    slides.splice(1, 0, {
      imageUrl: explainerReg.url,
      mediaId: explainerReg.mediaId,
      headline: DIAGRAM_EXPLAINER_TEXT,
    })
    backgroundImageUrls.splice(1, 0, diagramBgUrl!)
    slidePlans.splice(1, 0, {
      type: 'content',
      headlineText: DIAGRAM_EXPLAINER_TEXT,
      bodyText: null,
      imagePrompt: '',
    })
  }

  return {
    postType: 'carousel',
    jobId,
    slides,
    slidePlans,
    imageUrls: slides.map((s) => s.imageUrl),
    backgroundImageUrls,
  }
}

/**
 * Re-render a single carousel slide from a (possibly user-edited) plan. Mirrors
 * one iteration of generateCarouselAssets' loop: generate a fresh background
 * from the slide's imagePrompt, composite the text overlay, and register it.
 * Fast (one image) so it runs synchronously in the request, unlike full videos.
 */
export async function regenerateCarouselSlide(opts: {
  userId: string
  slidePlan: CarouselSlidePlan
  slideIndex: number
  totalSlides: number
  jobId?: string
  /** Pass 'brand_tint' when regenerating a slide of a Wed/Sat tinted carousel. */
  designVariant?: 'brand_tint' | 'brand_tint_accent'
  /** Reuse this background (text-only edits) instead of generating a fresh one. */
  backgroundUrl?: string
  /** Image model for fresh backgrounds (shared social image model). */
  imageModel?: string
}): Promise<{ imageUrl: string; mediaId: string; backgroundUrl: string }> {
  const brand = await loadSocialBrandTheme(opts.userId)
  const logoBuffer = await loadLogoBuffer(brand.logoUrl)
  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const plan = opts.slidePlan

  let tint: TintScheme | undefined
  let tintLogoBuffer: Buffer | null = null
  let tintArrowBuffer: Buffer | null = null
  if (opts.designVariant === 'brand_tint' || opts.designVariant === 'brand_tint_accent') {
    tint = tintScheme(opts.designVariant === 'brand_tint_accent' ? brand.accentColor : brand.primaryColor)
    tintLogoBuffer = await loadTintLogo(brand, tint.logoVariant)
    tintArrowBuffer = await loadContinuationArrow(tint.logoVariant)
  }

  let bg: Buffer
  let bgUrl: string
  if (opts.backgroundUrl) {
    bg = await downloadImageFromUrl(opts.backgroundUrl)
    bgUrl = opts.backgroundUrl
  } else {
    bg = await generateCarouselBackground(
      plan.imagePrompt || plan.headlineText || '',
      jobId,
      opts.imageModel,
      opts.userId,
    )
    const bgReg = await registerSocialMedia({
      userId: opts.userId,
      buffer: bg,
      s3Key: `social/${opts.userId}/${jobId}/carousel-bg-${opts.slideIndex + 1}-${genId}.png`,
      title: `Carousel background ${opts.slideIndex + 1}`,
      altText: `Background for slide ${opts.slideIndex + 1}`,
      source: 'carousel_slide',
      jobId,
    })
    bgUrl = bgReg.url
  }

  const buffer = await renderCarouselSlide(bg, {
    slide: plan,
    slideIndex: opts.slideIndex,
    totalSlides: opts.totalSlides,
    brand,
    logoBuffer,
    tint,
    tintLogoBuffer,
    arrowBuffer: tintArrowBuffer,
  })

  const registered = await registerSocialMedia({
    userId: opts.userId,
    buffer,
    s3Key: `social/${opts.userId}/${jobId}/carousel-${opts.slideIndex + 1}-${genId}.png`,
    title: `Carousel slide ${opts.slideIndex + 1} — ${(plan.headlineText ?? plan.bodyText ?? '').slice(0, 40)}`,
    altText: plan.headlineText ?? plan.bodyText ?? `Slide ${opts.slideIndex + 1}`,
    source: 'carousel_slide',
    jobId,
  })

  return { imageUrl: registered.url, mediaId: registered.mediaId, backgroundUrl: bgUrl }
}

export interface GeneratedTipsBulletStory {
  postType: 'tips_story'
  imageUrl: string
  mediaId: string
}

/**
 * Newsletter tips-bullet story (static 9:16). Uses the newsletter's overview
 * cover image as the background with the Tips-of-the-Day bullets overlaid —
 * no video, no AI generation.
 */
export async function generateTipsBulletStoryAsset(opts: {
  userId: string
  title: string
  bullets: string[]
  backgroundUrl?: string | null
  jobId?: string
}): Promise<GeneratedTipsBulletStory> {
  const brand = await loadSocialBrandTheme(opts.userId)

  // Background: the newsletter overview cover if available, else the brand logo
  // on a neutral field (fallback via a solid dark canvas).
  let bgBuffer: Buffer
  if (opts.backgroundUrl) {
    const resp = await fetch(opts.backgroundUrl)
    bgBuffer = Buffer.from(await resp.arrayBuffer())
  } else {
    // Solid navy fallback so bullets always render on something.
    const { default: sharp } = await import('sharp')
    bgBuffer = await sharp({
      create: { width: 1080, height: 1920, channels: 3, background: brand.primaryColor || '#011328' },
    })
      .png()
      .toBuffer()
  }

  const buffer = await buildBulletStoryPng(bgBuffer, opts.title, opts.bullets)

  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const registered = await registerSocialMedia({
    userId: opts.userId,
    buffer,
    s3Key: `social/${opts.userId}/${jobId}/tips-story-${genId}.png`,
    title: `Tips story — ${opts.title.slice(0, 40)}`,
    altText: opts.bullets.join(' • ').slice(0, 200),
    source: 'tips_story',
    jobId,
    width: 1080,
    height: 1920,
  })

  return { postType: 'tips_story', imageUrl: registered.url, mediaId: registered.mediaId }
}

export async function generatePitchStoryAssets(opts: {
  userId: string
  title: string
  pitchType: PitchStoryType
  jobId?: string
}): Promise<GeneratedPitchStory> {
  const brand = await loadSocialBrandTheme(opts.userId)
  const buffers = await renderPitchStory({
    title: opts.title,
    pitchType: opts.pitchType,
    brand,
    logoBuffer: await loadLogoBuffer(brand.logoUrl),
  })

  const genId = generationId()
  const jobId = opts.jobId ?? genId
  const postType = opts.pitchType === 'carousel' ? 'pitch_carousel' : 'pitch_hook'
  const slides: GeneratedPitchStory['slides'] = []

  for (let i = 0; i < buffers.length; i++) {
    const registered = await registerSocialMedia({
      userId: opts.userId,
      buffer: buffers[i],
      s3Key: `social/${opts.userId}/${jobId}/pitch-${opts.pitchType}-${i + 1}-${genId}.png`,
      title: `Pitch ${opts.pitchType} slide ${i + 1}`,
      altText: i === 0 ? opts.title : 'View profile CTA',
      source: 'pitch_story',
      jobId,
    })
    slides.push({ imageUrl: registered.url, mediaId: registered.mediaId })
  }

  return { postType, slides, imageUrls: slides.map((s) => s.imageUrl) }
}

export type { CarouselSlidePlan, PitchStoryType }
