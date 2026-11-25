/**
 * Lightweight inline article chain used for BOTH the feature and the secondary
 * (specialization) article in a per-customer newsletter.
 *
 * outline → intro → FAQs → FAQ facts → facts → write → image, mirroring the
 * reference workflow's main-article sub-pipeline but voiced per customer. Gemini
 * steps are Google-Search-grounded; the writer is Claude; the image is Fal.
 */
import {
  generateWithFalAI,
  uploadBufferWithKey,
  deleteOldVersions,
} from '@omniply/shared'
import type { LLMResponse } from '../article-pipeline/llm/adapter'
import { getSystemApiKey } from '../lib/system-keys'
import { cleanTextOutput } from '../article-pipeline/output-cleaner'
import { logger } from '../lib/logger'
import { runNewsletterPrompt, runNewsletterWriterJson } from './llm'
import { loadPlainLanguageConfig, runNewsletterPlainLanguage } from '../article-pipeline/enrichment/plain-language'
import { sanitizeDashesText } from '../lib/text/dash-sanitizer'
import { vtoken } from './image-overlay'
import { FAL_IMAGE_MODEL } from '../lib/media-costs'

const NL_IMAGE_MODEL = FAL_IMAGE_MODEL
const NL_IMAGE_SIZE = 'landscape_16_9'

/** Sink for per-call cost/token accounting (implemented by the generator). */
export interface UsageRecorder {
  record(response: LLMResponse): Promise<void>
}

export interface VoiceVars {
  writingStyle: string
  targetAudience: string
  industry: string
  specialization: string
}

export interface NewsletterArticle {
  title: string
  teaser: string
  tldr: string
  body: string
  imageUrl: string | null
}

interface ArticleWriterJson {
  article_title?: string
  article_teaser?: string
  article_tldr?: string
  article_body?: string
}

/**
 * Run the full chain for one article topic. The feature article is required (a
 * throw aborts the edition); the caller wraps the secondary article in try/catch.
 */
export async function generateArticle(
  topicText: string,
  bullets: string[],
  voice: VoiceVars,
  imageKey: string,
  usage: UsageRecorder,
): Promise<NewsletterArticle> {
  const base = {
    industry: voice.industry,
    specialization: voice.specialization,
    who: voice.targetAudience,
    writingStyle: voice.writingStyle,
    bullet1: bullets[0] ?? '',
    bullet2: bullets[1] ?? '',
    bullet3: bullets[2] ?? '',
  }

  // 1. Outline (grounded)
  const outline = await runNewsletterPrompt(
    'nl_article_outline',
    { ...base, topic: topicText },
    { useSearch: true },
  )
  await usage.record(outline.response)

  // 2. Intro (grounded)
  const intro = await runNewsletterPrompt(
    'nl_article_intro',
    { articleOutline: outline.content, writingStyle: voice.writingStyle },
    { useSearch: true },
  )
  await usage.record(intro.response)

  // 3. FAQs (grounded)
  const faqs = await runNewsletterPrompt(
    'nl_article_faq',
    { articleTopic: topicText, articleOutline: outline.content },
    { useSearch: true },
  )
  await usage.record(faqs.response)

  // 4. FAQ facts (grounded)
  const faqFacts = await runNewsletterPrompt(
    'nl_article_faq_facts',
    { articleFAQs: faqs.content },
    { useSearch: true },
  )
  await usage.record(faqFacts.response)

  // 5. Article facts (grounded)
  const facts = await runNewsletterPrompt(
    'nl_article_facts',
    { articleOutline: outline.content },
    { useSearch: true },
  )
  await usage.record(facts.response)

  // 6. Write (Claude, two-key system/user)
  const writer = await runNewsletterWriterJson<ArticleWriterJson>(
    'nl_article_writer_system',
    'nl_article_writer_user',
    {
      ...base,
      topic: topicText,
      articleIntro: intro.content,
      articleOutline: outline.content,
      articleFAQs: faqs.content,
      articleFacts: facts.content,
      faqFacts: faqFacts.content,
    },
  )
  await usage.record(writer.response)

  // 6a. Em-dash elimination on the fresh body (before plain-language injection,
  // whose own outputs are sanitized at their generation point).
  let body = await sanitizeDashesText(writer.data.article_body ?? '', { imageKey, surface: 'nl_article_body' })

  // 6b. Plain-language storytelling injection (additive; non-fatal — body stays
  // unmodified on any failure; skips when no PlainLanguageConfig matches the
  // industry). See .plans/plain-language-storytelling.implementation-plan.md.
  if (body) {
    try {
      const plConfig = await loadPlainLanguageConfig(voice.industry)
      if (plConfig) {
        body = await runNewsletterPlainLanguage({
          bodyHtml: body,
          voice: {
            writingStyle: voice.writingStyle,
            audience: voice.targetAudience,
            industry: voice.industry,
          },
          config: plConfig,
          labelSeed: imageKey,
          onResponse: (r) => usage.record(r),
        })
      }
    } catch (err) {
      logger.warn({ imageKey, err }, '[newsletter/article] plain-language pass failed (non-fatal)')
    }
  }

  // 7. Image (non-fatal)
  let imageUrl: string | null = null
  try {
    const imgPrompt = await runNewsletterPrompt('nl_article_image_prompt', {
      articleIntro: intro.content,
      industry: voice.industry,
    })
    await usage.record(imgPrompt.response)
    const falKey = await getSystemApiKey('fal-ai')
    const prompt = cleanTextOutput(imgPrompt.content)
    if (falKey && prompt) {
      const buf = await generateWithFalAI(falKey, prompt, NL_IMAGE_MODEL, NL_IMAGE_SIZE)
      const base = `newsletter/${imageKey}-`
      const key = `${base}${vtoken()}.jpg`
      const { url } = await uploadBufferWithKey(key, buf, 'image/jpeg')
      await deleteOldVersions(base, key) // GC superseded article-image versions
      imageUrl = url
    }
  } catch (err) {
    logger.warn({ imageKey, err }, '[newsletter/article] image failed (non-fatal)')
  }

  return {
    title: (await sanitizeDashesText(writer.data.article_title ?? topicText, { imageKey, surface: 'nl_article_title' })).trim(),
    teaser: (await sanitizeDashesText(writer.data.article_teaser ?? '', { imageKey, surface: 'nl_article_teaser' })).trim(),
    tldr: (await sanitizeDashesText(writer.data.article_tldr ?? '', { imageKey, surface: 'nl_article_tldr' })).trim(),
    body,
    imageUrl,
  }
}
