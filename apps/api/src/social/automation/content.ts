import type { SitePage } from '@prisma/client'
import { extractH2Sections, stripTags } from '../../article-pipeline/enrichment/html-parser'

export interface H2Section {
  heading: string
  text: string
}

export interface ArticleContentContext {
  title: string
  introText: string
  keyTakeawaysText: string
  h2Sections: H2Section[]
  /** First H2 section (legacy helpers). */
  h2Title: string
  h2SectionText: string
}

/**
 * H2 section index for each slot in the H2 cycle (F3 → S6).
 * Indices are resolved with modulo so shorter articles wrap around.
 * F1 = intro, F2 = keyTakeaways — neither appears here.
 */
export const H2_SLOT_SECTION_INDEX: Record<string, number> = {
  F3: 0,
  F4: 1,
  F5: 2,
  F6: 3,
  S1: 4,
  S2: 5,
  S3: 6,
  S4: 7,
  S5: 8,
  S6: 9,
}

function extractIntro(bodyHtml: string, excerpt?: string | null): string {
  if (excerpt?.trim()) return excerpt.trim()
  // Key Takeaways can sit above the opening (voice path); the intro is the first paragraph outside it.
  bodyHtml = bodyHtml.replace(/<section class="key-takeaways"[\s\S]*?<\/section>/i, '')
  const match = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (match) return stripTags(match[1]).slice(0, 800)
  return stripTags(bodyHtml).slice(0, 800)
}

function sectionAt(sections: H2Section[], index: number): H2Section | undefined {
  if (sections.length === 0) return undefined
  return sections[index % sections.length]
}

export function buildArticleContentContext(sitePage: SitePage): ArticleContentContext {
  const bodyHtml = sitePage.bodyHtml ?? ''
  const rawSections = extractH2Sections(bodyHtml)
  const h2Sections: H2Section[] = rawSections.map((s) => ({
    heading: s.heading,
    text: stripTags(s.sectionHtml).slice(0, 3000),
  }))
  const first = h2Sections[0]
  const fallbackText = stripTags(bodyHtml).slice(0, 3000)

  return {
    title: sitePage.title,
    introText: extractIntro(bodyHtml, sitePage.excerpt),
    keyTakeawaysText: sitePage.keyTakeawaysHtml
      ? stripTags(sitePage.keyTakeawaysHtml).slice(0, 2000)
      : extractIntro(bodyHtml, sitePage.excerpt),
    h2Sections,
    h2Title: first?.heading ?? sitePage.title,
    h2SectionText: first?.text ?? fallbackText,
  }
}

export interface SlotContent {
  text: string
  title?: string
  quoteText?: string
  /** art_story slots: the beat's IG slide texts (hook first). */
  storySlides?: string[]
}

function h2SlotContent(slotKey: string, ctx: ArticleContentContext): SlotContent {
  const index = H2_SLOT_SECTION_INDEX[slotKey] ?? 0
  const sec = sectionAt(ctx.h2Sections, index)
  const text = sec?.text ?? ctx.h2SectionText
  const title = sec?.heading ?? ctx.h2Title
  return { text, title }
}

/**
 * Map each slot to the article section used for asset generation.
 *
 * Tier 1 — F1:   article intro / excerpt
 * Tier 2 — F2:   key takeaways (always — no fallback to intro)
 * Tier 3 — rest: H2 section cycle (F3=0, F4=1, … S6=9, wraps with modulo)
 */
export function resolveSlotContent(slotKey: string, ctx: ArticleContentContext): SlotContent {
  if (slotKey === 'F1') {
    return { text: ctx.introText, quoteText: ctx.introText.slice(0, 280) }
  }
  if (slotKey === 'F2') {
    // Always key takeaways — intentionally no fallback so a missing keyTakeaways
    // surfaces as an upstream data issue rather than silently duplicating intro.
    return { text: ctx.keyTakeawaysText }
  }
  // All remaining slots (F3-F6, S1-S6) cycle through H2 sections
  return h2SlotContent(slotKey, ctx)
}
