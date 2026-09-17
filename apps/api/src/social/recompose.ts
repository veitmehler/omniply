/**
 * Client recompose primitive (review UX, Veit 2026-09-17): re-run the
 * deterministic slide compositor for a spec result with stored overrides —
 * text mode (light/dark), per-slide text edits, per-slide photo swaps.
 * No LLM in the composite; a photo REGENERATION is one Nano Banana call.
 */
import { prisma } from '@omniply/shared'
import { generateStorySlidesAsset } from './generate-assets'
import { generateStoryPhoto } from './story-photo'
import { logger } from '../lib/logger'

export interface RecomposeOverrides {
  textMode?: 'light' | 'dark' | null
  slides?: Record<string, { text?: string; imageUrl?: string | null }>
}

interface StoryAssets {
  postType?: string
  mediaUrls?: string[]
  imageUrl?: string
  backgroundImageUrls?: string[]
  storySlides?: string[]
  title?: string
}

export async function recomposeStorySlot(
  specResultId: string,
  userId: string,
  patch: RecomposeOverrides & { regenerateImage?: number },
): Promise<{ mediaUrls: string[] } | { error: string; status: number }> {
  const spec = await prisma.socialAutomationSpecResult.findFirst({
    where: { id: specResultId, run: { userId } }, // account extension broadens
    include: { run: { select: { id: true, userId: true } } },
  })
  if (!spec) return { error: 'Post not found', status: 404 }
  const assets = (spec.assetsJson ?? {}) as StoryAssets
  if (assets.postType !== 'story_text' || !assets.storySlides?.length) {
    return { error: 'Only story carousels support editing (for now)', status: 400 }
  }

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
    const text = merged.slides?.[String(idx)]?.text ?? assets.storySlides[idx] ?? assets.storySlides[0]
    const url = await generateStoryPhoto(spec.run.userId, `recompose-${spec.id}`, text)
    if (!url) return { error: 'Image generation failed — try again', status: 502 }
    merged.slides![String(idx)] = { ...merged.slides![String(idx)], imageUrl: url }
  }

  const effectiveSlides = assets.storySlides.map((t, i) => merged.slides?.[String(i)]?.text ?? t)
  const slideImages: Record<number, string> = {}
  for (const [i, o] of Object.entries(merged.slides ?? {})) {
    if (o.imageUrl) slideImages[Number(i)] = o.imageUrl
  }
  // Reuse the original motif background so recomposites stay visually stable.
  const motifUrl = (assets.backgroundImageUrls ?? []).find((u, i) => !slideImages[i]) ?? assets.backgroundImageUrls?.[0]

  const story = await generateStorySlidesAsset({
    userId: spec.run.userId,
    slides: effectiveSlides,
    jobId: `recompose-${spec.id}`,
    forceTextMode: merged.textMode ?? undefined,
    reuseBackgroundUrl: motifUrl,
    slideImages: Object.keys(slideImages).length ? slideImages : undefined,
  })

  // Swap media everywhere the old URLs appear (assets + per-platform preview).
  const oldUrls = assets.mediaUrls ?? []
  const newAssets: StoryAssets = {
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
    where: { id: spec.id },
    data: {
      assetsJson: newAssets as object,
      previewJson: previewStr === 'null' ? undefined : (JSON.parse(previewStr) as object),
      overridesJson: merged as object,
    },
  })
  logger.info({ specResultId: spec.id, textMode: merged.textMode }, '[recompose] story slot recomposited')
  return { mediaUrls: story.imageUrls }
}
