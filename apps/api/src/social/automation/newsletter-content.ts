import type { Newsletter } from '@prisma/client'
import { logger } from '../../lib/logger'
import type { SlotContent } from './content'
import type { PostSource } from './weekly-matrix'

/**
 * Newsletter content source for social posts (weekly cadence, newsletter days).
 * Pulls from the Newsletter's authored JSON — no new content generation. Mirrors
 * ArticleContentContext / resolveSlotContent for the article side.
 */
export interface NewsletterContentContext {
  /** Edition topic titles — used for the "overview" reel bullets. */
  overviewTopics: string[]
  /** Tips of the Day — used for the quote post. */
  tips: string[]
  /** The edition's feature article — used for the image carousel. */
  feature: { title: string; body: string }
  /**
   * Story-arc beats for nl_story slots (P3 main-app rollout). Read from
   * Newsletter.storyArcJson at ctx build; ensureStoryArc mutates it in place
   * right after first generation (the resolver is pure-ctx, unlike the
   * article path which re-reads SitePage).
   */
  storyArc: { postText: string; slides: string[] }[] | null
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function buildNewsletterContentContext(nl: Newsletter): NewsletterContentContext {
  const feature = asObj(nl.featureArticle)
  const secondary = asObj(nl.secondaryArticle)
  const quickHits = asObj(nl.quickHits)
  const teasers = Array.isArray(nl.teasers) ? (nl.teasers as unknown[]) : []

  const overviewTopics: string[] = []
  if (feature && str(feature.title)) overviewTopics.push(str(feature.title))
  if (secondary && str(secondary.title)) overviewTopics.push(str(secondary.title))
  for (const t of teasers) {
    const o = asObj(t)
    if (o && str(o.title)) overviewTopics.push(str(o.title))
  }

  const tips: string[] = []
  if (quickHits && Array.isArray(quickHits.tips)) {
    for (const tip of quickHits.tips as unknown[]) {
      if (typeof tip === 'string' && tip.trim()) tips.push(tip.trim())
    }
  }

  const featureTitle =
    str(feature?.title) || nl.subjectLine || nl.summaryTitle || 'This edition'
  const featureBody = feature
    ? [str(feature.tldr), str(feature.body), str(feature.teaser)].filter(Boolean).join('\n\n')
    : ''

  const storyArc = Array.isArray(nl.storyArcJson)
    ? (nl.storyArcJson as unknown as { postText: string; slides: string[] }[])
    : null

  return { overviewTopics, tips, feature: { title: featureTitle, body: featureBody }, storyArc }
}

/** Resolve the content payload for a newsletter-sourced slot. */
export function resolveNewsletterSlotContent(
  source: PostSource,
  ctx: NewsletterContentContext,
  beatIndex?: number,
): SlotContent {
  switch (source) {
    case 'nl_story': {
      // Story-arc beat (mirrors art_story resolution in
      // article-social-selectors.ts): missing arc/beat → feature fallback.
      const idx = beatIndex ?? 0
      const beat = ctx.storyArc?.[idx]
      if (beat?.postText && Array.isArray(beat.slides) && beat.slides.length > 0) {
        return {
          text: beat.postText,
          title: beat.slides[0],
          quoteText: beat.slides[0],
          storySlides: beat.slides,
        }
      }
      logger.warn({ beatIndex: idx }, '[newsletter-social] story arc missing — feature fallback')
      return { text: ctx.feature.body, title: ctx.feature.title }
    }
    case 'nl_overview':
      // The reel generator extracts bullets from this text; feed it the topic list.
      return {
        text: ctx.overviewTopics.map((t) => `- ${t}`).join('\n'),
        title: 'In this edition',
      }
    case 'nl_tips': {
      const tip = ctx.tips.length ? ctx.tips[Math.floor(Math.random() * ctx.tips.length)] : ''
      return { text: ctx.tips.join('\n'), quoteText: tip }
    }
    case 'nl_feature':
    default:
      return { text: ctx.feature.body, title: ctx.feature.title }
  }
}
