/**
 * Client recompose primitive (review UX, Veit 2026-09-17): re-run the
 * deterministic slide compositor for a spec result with stored overrides —
 * text mode (light/dark), per-slide text edits, per-slide photo swaps.
 * No LLM in the composite; a photo REGENERATION is one Nano Banana call.
 *
 * Two post families share the primitive:
 * - story_text: full re-composite of the tinted story slides (storySlides).
 * - carousel:   per-slide re-render from the persisted slide plans
 *               (carouselSlides); untouched slides keep their exact PNGs.
 */
import { prisma } from '@omniply/shared'
import { generateStorySlidesAsset, regenerateCarouselSlide } from './generate-assets'
import { generateStoryPhoto } from './story-photo'
import { socialImageModel } from './automation/matrix-processor'
import { logger } from '../lib/logger'

export interface RecomposeOverrides {
  textMode?: 'light' | 'dark' | null
  slides?: Record<string, { text?: string; headline?: string; body?: string; imageUrl?: string | null }>
}

interface EditableAssets {
  postType?: string
  mediaUrls?: string[]
  imageUrl?: string
  backgroundImageUrls?: string[]
  storySlides?: string[]
  tintColorHex?: string | null
  carouselSlides?: { type: string; headlineText: string | null; bodyText: string | null; imagePrompt: string }[]
  carouselVariant?: 'brand_tint' | 'brand_tint_accent' | null
  carouselDiagram?: boolean
  title?: string
}

export async function recomposeStorySlot(
  specResultId: string,
  memberUserIds: string[],
  patch: RecomposeOverrides & { regenerateImage?: number },
): Promise<{ mediaUrls: string[] } | { error: string; status: number }> {
  // Explicit member scoping: the account extension broadens only TOP-LEVEL
  // where.userId — a nested run.userId filter is never rewritten, which
  // 404'd every teammate edit (found live 2026-09-22).
  const spec = await prisma.socialAutomationSpecResult.findFirst({
    where: { id: specResultId, run: { userId: { in: memberUserIds } } },
    include: { run: { select: { id: true, userId: true } } },
  })
  if (!spec) return { error: 'Post not found', status: 404 }
  // Same immutability rule as caption edits: once approved, the posts are
  // (about to be) scheduled in GHL — a recompose would silently diverge the
  // preview from what actually publishes.
  if (spec.approvedAt) return { error: 'Approved posts can no longer be edited', status: 400 }
  const assets = (spec.assetsJson ?? {}) as EditableAssets

  if (assets.postType === 'story_text' && assets.storySlides?.length) {
    return recomposeStory(spec.id, spec.run.userId, assets, spec, patch)
  }
  if (assets.postType === 'carousel' && assets.carouselSlides?.length && !assets.carouselDiagram) {
    return recomposeCarousel(spec.id, spec.run.userId, assets, spec, patch)
  }
  return { error: 'This post type does not support editing (for now)', status: 400 }
}

type SpecRow = { previewJson: unknown; overridesJson: unknown; runId: string; slotKey: string }

/** Pure remap of one Post row's media fields through an old→new URL map. */
export function remapPostMedia(
  post: { mediaUrls: string[]; imageUrl: string | null },
  urlMap: Map<string, string>,
): { mediaUrls: string[]; imageUrl: string | null; changed: boolean } {
  const mediaUrls = post.mediaUrls.map((u) => urlMap.get(u) ?? u)
  const imageUrl = post.imageUrl ? urlMap.get(post.imageUrl) ?? post.imageUrl : post.imageUrl
  const changed = imageUrl !== post.imageUrl || mediaUrls.some((u, i) => u !== post.mediaUrls[i])
  return { mediaUrls, imageUrl, changed }
}

/**
 * Dual-write (bugfix 2026-09-17): the platform Post rows are what approval
 * dispatches to GHL — recompose used to update only the spec preview, so
 * tint/slide edits never reached the published posts (captions did, because
 * the caption endpoint writes post.content). Guarded to rows still awaiting
 * dispatch; text-only story posts carry no media and are untouched.
 */
async function syncPostMedia(runId: string, slotKey: string, urlMap: Map<string, string>): Promise<void> {
  if (!urlMap.size) return
  const posts = await prisma.post.findMany({
    where: { automationRunId: runId, slotKey, status: 'ready' },
    select: { id: true, mediaUrls: true, imageUrl: true },
  })
  for (const post of posts) {
    const next = remapPostMedia(post, urlMap)
    if (next.changed) {
      await prisma.post.update({
        where: { id: post.id },
        data: { mediaUrls: next.mediaUrls, imageUrl: next.imageUrl },
      })
    }
  }
}

async function recomposeStory(
  specId: string,
  ownerId: string,
  assets: EditableAssets,
  spec: SpecRow,
  patch: RecomposeOverrides & { regenerateImage?: number },
): Promise<{ mediaUrls: string[] } | { error: string; status: number }> {
  const storySlides = assets.storySlides!
  const stored = (spec.overridesJson ?? {}) as RecomposeOverrides
  const merged: RecomposeOverrides = {
    textMode: patch.textMode !== undefined ? patch.textMode : stored.textMode,
    slides: { ...(stored.slides ?? {}) },
  }
  for (const [i, o] of Object.entries(patch.slides ?? {})) {
    merged.slides![i] = { ...merged.slides![i], ...o }
  }
  if (typeof patch.regenerateImage === 'number') {
    const idx = patch.regenerateImage
    const text = merged.slides?.[String(idx)]?.text ?? storySlides[idx] ?? storySlides[0]
    const url = await generateStoryPhoto(ownerId, `recompose-${specId}`, text)
    if (!url) return { error: 'Image generation failed — try again', status: 502 }
    merged.slides![String(idx)] = { ...merged.slides![String(idx)], imageUrl: url }
  }

  const effectiveSlides = storySlides.map((t, i) => merged.slides?.[String(i)]?.text ?? t)
  const slideImages: Record<number, string> = {}
  for (const [i, o] of Object.entries(merged.slides ?? {})) {
    if (o.imageUrl) slideImages[Number(i)] = o.imageUrl
  }
  // Reuse the original motif background so recomposites stay visually stable.
  const motifUrl = (assets.backgroundImageUrls ?? []).find((u, i) => !slideImages[i]) ?? assets.backgroundImageUrls?.[0]

  const story = await generateStorySlidesAsset({
    userId: ownerId,
    slides: effectiveSlides,
    jobId: `recompose-${specId}`,
    forceTextMode: merged.textMode ?? undefined,
    reuseBackgroundUrl: motifUrl,
    slideImages: Object.keys(slideImages).length ? slideImages : undefined,
    // Beat-1 slots carry the second brand tint — reproduce it exactly.
    tintColor: assets.tintColorHex ?? undefined,
  })

  // Swap media everywhere the old URLs appear (assets + per-platform preview).
  const oldUrls = assets.mediaUrls ?? []
  const newAssets: EditableAssets = {
    ...assets,
    mediaUrls: story.imageUrls,
    imageUrl: story.imageUrls[0],
    backgroundImageUrls: story.backgroundImageUrls,
    storySlides: effectiveSlides,
  }
  let previewStr = JSON.stringify(spec.previewJson ?? null)
  oldUrls.forEach((oldUrl, i) => {
    if (story.imageUrls[i]) previewStr = previewStr.split(oldUrl).join(story.imageUrls[i])
  })

  await prisma.socialAutomationSpecResult.update({
    where: { id: specId },
    data: {
      assetsJson: newAssets as object,
      previewJson: previewStr === 'null' ? undefined : (JSON.parse(previewStr) as object),
      overridesJson: merged as object,
    },
  })
  const urlMap = new Map<string, string>()
  oldUrls.forEach((oldUrl, i) => {
    if (story.imageUrls[i] && story.imageUrls[i] !== oldUrl) urlMap.set(oldUrl, story.imageUrls[i])
  })
  await syncPostMedia(spec.runId, spec.slotKey, urlMap)
  logger.info({ specResultId: specId, textMode: merged.textMode }, '[recompose] story slot recomposited')
  return { mediaUrls: story.imageUrls }
}

async function recomposeCarousel(
  specId: string,
  ownerId: string,
  assets: EditableAssets,
  spec: SpecRow,
  patch: RecomposeOverrides & { regenerateImage?: number },
): Promise<{ mediaUrls: string[] } | { error: string; status: number }> {
  if (patch.textMode !== undefined) {
    return { error: 'Light/dark text applies to story posts only', status: 400 }
  }
  const plans = assets.carouselSlides!
  const stored = (spec.overridesJson ?? {}) as RecomposeOverrides
  const merged: RecomposeOverrides = { slides: { ...(stored.slides ?? {}) } }
  for (const [i, o] of Object.entries(patch.slides ?? {})) {
    merged.slides![i] = { ...merged.slides![i], ...o }
  }

  // Only slides touched by THIS call re-render: text changed now, or a fresh
  // image was requested. Prior overrides are already baked into the PNGs.
  const dirty = new Set<number>(Object.keys(patch.slides ?? {}).map(Number))
  if (typeof patch.regenerateImage === 'number') dirty.add(patch.regenerateImage)
  const valid = [...dirty].filter((i) => Number.isInteger(i) && i >= 0 && i < plans.length)
  if (!valid.length) return { mediaUrls: assets.mediaUrls ?? [] }

  const mediaUrls = [...(assets.mediaUrls ?? [])]
  const backgroundUrls = [...(assets.backgroundImageUrls ?? [])]
  const imageModel = await socialImageModel()
  const urlMap = new Map<string, string>()

  for (const i of valid) {
    const ov = merged.slides?.[String(i)] ?? {}
    const plan = {
      ...plans[i],
      type: plans[i].type as 'hook' | 'content' | 'cta',
      headlineText: ov.headline !== undefined ? ov.headline : plans[i].headlineText,
      bodyText: ov.body !== undefined ? ov.body : plans[i].bodyText,
    }
    const freshImage = patch.regenerateImage === i
    const slide = await regenerateCarouselSlide({
      userId: ownerId,
      slidePlan: plan,
      slideIndex: i,
      totalSlides: plans.length,
      jobId: `recompose-${specId}`,
      designVariant: assets.carouselVariant ?? undefined,
      backgroundUrl: freshImage ? undefined : backgroundUrls[i],
      imageModel,
    })
    if (mediaUrls[i]) {
      const oldUrl = mediaUrls[i]
      mediaUrls[i] = slide.imageUrl
      urlMap.set(oldUrl, slide.imageUrl)
      spec.previewJson = JSON.parse(
        JSON.stringify(spec.previewJson ?? null)
          .split(oldUrl)
          .join(slide.imageUrl),
      )
    } else {
      mediaUrls[i] = slide.imageUrl
    }
    backgroundUrls[i] = slide.backgroundUrl
  }

  const newAssets: EditableAssets = {
    ...assets,
    mediaUrls,
    imageUrl: mediaUrls[0],
    backgroundImageUrls: backgroundUrls,
  }
  await prisma.socialAutomationSpecResult.update({
    where: { id: specId },
    data: {
      assetsJson: newAssets as object,
      previewJson: spec.previewJson === null ? undefined : (spec.previewJson as object),
      overridesJson: merged as object,
    },
  })
  await syncPostMedia(spec.runId, spec.slotKey, urlMap)
  logger.info({ specResultId: specId, slides: valid }, '[recompose] carousel slides recomposited')
  return { mediaUrls }
}
