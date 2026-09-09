/**
 * Real commit bodies for the onboarding steps (onboarding plan Phases 4–7).
 * Kept out of flow.ts so the step machine stays readable.
 */
import { prisma, encrypt, ghlSettingsForUser } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getBoss, QUEUES } from '../queues/index'
import { getSystemApiKey } from '../lib/system-keys'
import { getGhlCredentials } from '../lib/ghl/settings'
import { listGhlAccounts } from '../lib/ghl/client'
import { processLogo } from '../newsletter/logo-process'
import {
  generateWritingStyle,
  generateOfferDrafts,
  buildTemplatePreviewHtml,
  type BrandProfileDraft,
  type OfferDraft,
} from './synthesis'
import { effectiveHemisphere } from '../newsletter/calendar-routing'
import type { SemanticPalette } from './site-analysis'
import { labelColorFor } from './palette-compose'
import type { StepContext } from './flow'

async function brandUpsert(userId: string, data: Record<string, unknown>): Promise<void> {
  await prisma.brandSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
}

async function settingsUpsert(userId: string, data: Record<string, unknown>): Promise<void> {
  await prisma.settings.upsert({
    where: { userId },
    create: { userId, theme: 'light', sidebarState: 'open', ...data },
    update: data,
  })
}

/** business_confirm: persist identity basics; (re)start the crawl on a corrected URL. */
export async function commitBusinessConfirm(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as Record<string, string> & { confirmed?: boolean }
  const prefill = (ctx.stepData.ghlPrefill as Record<string, string>) ?? {}
  const merged = { ...prefill, ...a }
  if (!merged.organizationName?.trim()) return 'Business name is required'

  await brandUpsert(ctx.userId, {
    organizationName: merged.organizationName.trim(),
    geolocation: merged.address || null,
    organizationCountryCode: merged.country || null,
    defaultAuthorName: merged.contactName || null,
    organizationWebsite: merged.website || null,
  })
  if (merged.timezone) await settingsUpsert(ctx.userId, { socialTimezone: merged.timezone })

  const oldWebsite = (prefill.website ?? '').trim()
  const newWebsite = (merged.website ?? '').trim()
  ctx.stepData.ghlPrefill = merged
  if (newWebsite && (newWebsite !== oldWebsite || !ctx.stepData.crawlDone)) {
    const boss = await getBoss()
    await boss.send(
      QUEUES.ONBOARDING_CRAWL,
      { accountId: ctx.accountId, websiteUrl: newWebsite.startsWith('http') ? newWebsite : `https://${newWebsite}` },
      { singletonKey: `onboarding-crawl-${ctx.accountId}-${Date.now()}`, expireInSeconds: 15 * 60 },
    )
    ctx.stepData.crawlDone = false
  }
  return null
}

/** q_proof (fifth question): kick the synthesis job. */
export async function afterFifthQuestion(ctx: StepContext): Promise<void> {
  const boss = await getBoss()
  await boss.send(
    QUEUES.ONBOARDING_SYNTHESIS,
    { accountId: ctx.accountId },
    { singletonKey: `onboarding-synthesis-${ctx.accountId}`, expireInSeconds: 15 * 60 },
  )
}

/** Relative luminance of a #rrggbb color (0 = black, 1 = white). */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 1
  const n = parseInt(m[1], 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/**
 * Ink for the logo's DARK variant (shown on light backgrounds). Light-header
 * brands (cream sites) must not yield a light "dark" logo, so take the first
 * genuinely dark brand color, not the header color blindly.
 */
function darkInkFromPalette(p: SemanticPalette): string {
  const candidates = [p.headerBackground, p.button, p.accent].filter((c): c is string => Boolean(c))
  return candidates.find((c) => hexLuminance(c) < 0.4) ?? '#011328'
}

/** logo_confirm: chosen/uploaded URL → light/dark variants → nlLogoUrl. */
export async function commitLogoConfirm(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { chosenUrl?: string; none?: boolean }
  if (a.none) {
    ctx.stepData.logoChosen = null
    return null // org-name text header fallback; not a validator blocker if nlLogoUrl set later in settings
  }
  const source = a.chosenUrl?.trim()
  if (!source) return 'Pick a logo or choose "no logo"'
  const palette = (ctx.stepData.palette as SemanticPalette) ?? {}
  try {
    const processed = await processLogo(ctx.userId, source, darkInkFromPalette(palette), `onboarding/${ctx.accountId}/logo`)
    ctx.stepData.logoVariants = processed as unknown as Record<string, unknown>
    const light = (processed as { lightUrl?: string }).lightUrl
    const dark = (processed as { darkUrl?: string }).darkUrl
    await brandUpsert(ctx.userId, {
      nlLogoUrl: light ?? source,
      nlLogoLightUrl: light ?? null,
      nlLogoDarkUrl: dark ?? null,
      nlLogoWidth: 180,
    })
  } catch (err) {
    logger.warn({ err }, '[onboarding] logo processing failed — using source as-is')
    await brandUpsert(ctx.userId, { nlLogoUrl: source, nlLogoWidth: 180 })
  }
  ctx.stepData.logoChosen = source
  return null
}

/** photo: spokesperson photo → brandSettings.socialLogoUrl (quote-card avatar). */
export async function commitPhoto(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { url?: string; none?: boolean }
  if (a.none) return null // quote cards fall back to the logo
  const url = a.url?.trim()
  if (!url) return 'Upload a photo or skip this step'
  if (!/^https?:\/\//.test(url)) return "That doesn't look like an image URL"
  await brandUpsert(ctx.userId, { socialLogoUrl: url })
  return null
}

/** brand_profile_confirm: persist the (possibly edited) profile; ready the reveal. */
export async function commitBrandProfile(ctx: StepContext, answer: unknown): Promise<string | null> {
  const edited = (answer ?? {}) as Partial<BrandProfileDraft> & { confirmed?: boolean }
  const draft = { ...((ctx.stepData.brandProfileDraft as BrandProfileDraft) ?? {}), ...edited }
  if (!draft.businessDescription?.trim() || !draft.who?.trim()) {
    return 'The profile needs at least a business description and target audience — fix those fields'
  }
  // Specializations come from registry CHECKBOXES (calendar-routing keys, no
  // free text). Primary = the detected one if still checked, else the first.
  const checked = Array.isArray(edited.specializations) ? edited.specializations.filter(Boolean) : draft.specializations ?? []
  if (checked.length === 0) return 'Check at least one specialization — it routes your content calendar'
  const primary = checked.includes(draft.primarySpecialization ?? '') ? draft.primarySpecialization! : checked[0]
  await brandUpsert(ctx.userId, {
    businessDescription: draft.businessDescription,
    who: draft.who,
    ourExperience: draft.ourExperience ?? null,
    articleGoal: draft.articleGoal ?? null,
    specialInstructions: draft.specialInstructions ?? null,
    industry: draft.industry ?? null,
    primarySpecialization: primary,
    specializations: checked,
    specialization: primary,
    // Logistics-only FAQ pairs from synthesis → FAQPage schema (agent plan 3.1).
    ...(Array.isArray(ctx.stepData.clinicFaqsDraft) && (ctx.stepData.clinicFaqsDraft as unknown[]).length > 0
      ? { clinicFaqs: ctx.stepData.clinicFaqsDraft }
      : {}),
  })
  ctx.stepData.brandProfileDraft = draft as unknown as Record<string, unknown>

  // Ready "the reveal": preview from palette + logo (manual palette fallback).
  const palette = (ctx.stepData.palette as SemanticPalette) ?? {}
  const prefill = (ctx.stepData.ghlPrefill as Record<string, string>) ?? {}
  const variants = (ctx.stepData.logoVariants as { lightUrl?: string; darkUrl?: string } | undefined) ?? {}
  const logo = variants.lightUrl ?? (ctx.stepData.logoChosen as string | null)
  ctx.stepData.templateDraft = {
    palette,
    logoUrl: logo,
    logoVariants: variants,
    organizationName: prefill.organizationName ?? 'Your Practice',
    previewHtml: buildTemplatePreviewHtml({
      organizationName: prefill.organizationName ?? 'Your Practice',
      logoUrl: logo,
      palette,
    }),
  }
  ctx.stepData.templateReady = true
  return null
}

/** template_reveal: write the nl* template fields; pre-generate the offer drafts. */
export async function commitTemplateReveal(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { palette?: SemanticPalette; logoVariant?: 'light' | 'dark'; confirmed?: boolean }
  const draft = (ctx.stepData.templateDraft as { palette?: SemanticPalette }) ?? {}
  const palette: SemanticPalette = { ...(draft.palette ?? {}), ...(a.palette ?? {}) }

  // Honor the light/dark logo choice against the (possibly recolored) header.
  const variants = (ctx.stepData.logoVariants as { lightUrl?: string; darkUrl?: string } | undefined) ?? {}
  const pickedLogo = a.logoVariant === 'dark' ? variants.darkUrl : a.logoVariant === 'light' ? variants.lightUrl : null
  if (pickedLogo) await brandUpsert(ctx.userId, { nlLogoUrl: pickedLogo })
  const tints = palette.sectionTints?.length ? palette.sectionTints : ['#f2f6fa', '#fdf6ee']
  const fonts = ((ctx.stepData.crawl as { fontHints?: string[] })?.fontHints ?? [])[0]

  await brandUpsert(ctx.userId, {
    nlHeaderBgColor: palette.headerBackground ?? '#0b2545',
    nlFooterBgColor: palette.headerBackground ?? '#0b2545',
    nlLinkColor: palette.accent ?? '#2a6f97',
    nlButtonColor: palette.button ?? null,
    // Computed against the FINAL button color — the user may have overridden
    // the swatch, so never trust a stale precomputed label.
    nlButtonTextColor: palette.button
      ? labelColorFor(palette.button, palette.headerBackground ?? '#0b2545')
      : null,
    nlFontColor: '#222222',
    nlSectionColor1: tints[0],
    nlSectionColor2: tints[1] ?? tints[0],
    nlSectionColor3: palette.bodyBackground ?? '#ffffff',
    nlSectionColor4: tints[0],
    ...(fonts ? { nlFontFamily: fonts } : {}),
  })
  ctx.stepData.paletteFinal = palette as unknown as Record<string, unknown>

  // Pre-generate offers so the next step is instant.
  try {
    const geminiKey = await getSystemApiKey('gemini')
    const profile = (ctx.stepData.brandProfileDraft as BrandProfileDraft) ?? null
    if (geminiKey && profile && !ctx.stepData.offerDrafts) {
      const prefill = (ctx.stepData.ghlPrefill as Record<string, string>) ?? {}
      const hemisphere = effectiveHemisphere(prefill.country, null) ?? 'south'
      ctx.stepData.offerDrafts = (await generateOfferDrafts(geminiKey, profile, hemisphere)) as unknown as Record<string, unknown>[]
    }
  } catch (err) {
    logger.warn({ err }, '[onboarding] offer generation failed — manual offers')
    ctx.stepData.offerDrafts = []
  }
  ctx.stepData.offersReady = true
  return null
}

/** offers: create NewsletterOffer rows for the kept drafts. */
export async function commitOffers(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { offers?: OfferDraft[]; confirmed?: boolean }
  const kept = a.offers ?? ((ctx.stepData.offerDrafts as OfferDraft[]) ?? [])
  if (kept.length === 0) return 'Keep at least one offer — your newsletter needs something to feature'

  const now = new Date()
  let sort = 0
  for (const o of kept) {
    let startDate: Date | null = null
    let endDate: Date | null = null
    if (o.month && o.month >= 1 && o.month <= 12) {
      const year = o.month - 1 >= now.getUTCMonth() ? now.getUTCFullYear() : now.getUTCFullYear() + 1
      startDate = new Date(Date.UTC(year, o.month - 1, 1))
      endDate = new Date(Date.UTC(year, o.month, 0, 23, 59, 59))
    }
    await prisma.newsletterOffer.create({
      data: {
        userId: ctx.userId,
        title: o.title.slice(0, 120),
        body: o.body,
        ctaLabel: o.ctaLabel?.slice(0, 60) ?? null,
        startDate,
        endDate,
        enabled: true,
        sortOrder: sort++,
      },
    })
  }
  ctx.stepData.offersCreated = kept.length
  return null
}

/** cta: socialCallToAction (+ goal mapping). */
export async function commitCta(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { value?: string; label?: string; customText?: string }
  if (a.value === 'dm_keyword') {
    // FIXED keyword (user decision 2026-09-09: no free input — the snapshot
    // comment workflows hard-filter on SPINE, and the DM delivers the
    // clinic's 2-Minute Spine Check quiz trigger link).
    await brandUpsert(ctx.userId, {
      socialCallToAction: 'SPINE|our 2-Minute Spine Check',
      socialPrimaryGoal: 'dm_keyword',
    })
    return null
  }
  const text = a.value === 'custom' ? a.customText?.trim() : (a.label ?? a.value)?.trim()
  if (!text) return 'Tell me where posts should send people'
  const preset = a.value === 'booking' || a.value === 'newsletter' || a.value === 'custom' ? a.value : null
  await brandUpsert(ctx.userId, { socialCallToAction: text, socialPrimaryGoal: preset })
  return null
}

/** writing_sample: transcripts (+ optional article) → writingStyle. */
/** q_moments: real practice-owner stories → narrator moments for story-arc posts. */
export async function commitStoryMoments(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { text?: string }
  const text = a.text?.trim() ?? ''
  if (!text) return 'Give me at least one real moment — a sentence or two is enough'
  await brandUpsert(ctx.userId, { storyBeats: text })
  return null
}

export async function commitWritingSample(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { text?: string }
  const raw = a.text?.trim() ?? ''
  const blogSample = ctx.stepData.blogSample as { text?: string; url?: string } | null | undefined

  let article: string | null
  if (/^i wrote (this|it)\.?$/i.test(raw) && blogSample?.text) {
    // Explicit authorship confirmation of the scraped candidate — the ONLY
    // path that ingests it (clinic blogs are often vendor-ghostwritten).
    article = blogSample.text
    ctx.stepData.writingSampleSource = 'scraped_confirmed'
  } else if (raw.toLowerCase() === 'skip') {
    article = null
    ctx.stepData.writingSampleSource = 'skipped'
  } else if (raw.length >= 200) {
    article = raw
    ctx.stepData.writingSampleSource = 'pasted'
  } else if (raw.length > 0) {
    return blogSample?.text
      ? 'Three options here: type exactly "I wrote this" to use the article I found on your site, paste a full article you wrote (200+ characters), or type "skip"'
      : 'That looks too short to learn a voice from — paste a full article (200+ characters), or type "skip"'
  } else {
    article = null
  }

  const transcripts = ['q_declaration', 'q_enemy', 'q_tribe', 'q_line', 'q_moments', 'q_proof']
    .map((k) => (ctx.stepData[k] as { text?: string })?.text)
    .filter(Boolean)
    .join('\n\n')
  if (!transcripts && !article) return 'I need either your spoken answers or a writing sample to learn your voice'

  const geminiKey = await getSystemApiKey('gemini')
  if (!geminiKey) return 'Style analysis is unavailable right now — try again in a minute'
  try {
    const style = await generateWritingStyle(geminiKey, transcripts, article)
    await settingsUpsert(ctx.userId, { writingStyle: style })
    ctx.stepData.writingStyleSet = true
    return null
  } catch (err) {
    logger.error({ err }, '[onboarding] writing style generation failed')
    return 'Style analysis hiccuped — hit send again'
  }
}

/** wordpress: verify + store, or record the explicit opt-out. */
export async function commitWordpress(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { mode?: string; siteUrl?: string; username?: string; appPassword?: string }
  if (a.mode === 'skip') {
    ctx.stepData.wordpressDeclined = true
    return null
  }
  const { siteUrl, username, appPassword } = a
  if (!siteUrl || !username || !appPassword) return 'I need the site URL, username and Application Password'
  const base = siteUrl.replace(/\/$/, '').startsWith('http') ? siteUrl.replace(/\/$/, '') : `https://${siteUrl.replace(/\/$/, '')}`
  try {
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
    const res = await fetch(`${base}/wp-json/wp/v2/users/me`, { headers: { Authorization: auth } })
    if (!res.ok) return `WordPress said no (${res.status}) — double-check the username and Application Password`
  } catch {
    return "Couldn't reach that site — is the URL right?"
  }
  await prisma.wordPressConnection.create({
    data: {
      userId: ctx.userId,
      label: 'Main website',
      siteUrl: base,
      username,
      appPassword: encrypt(appPassword),
      defaultStatus: 'draft',
    },
  })
  ctx.stepData.wordpressConnected = true
  return null
}

/** socials: pull the Social Planner connections into ghlSettings.accountIds. */
export async function commitSocials(ctx: StepContext, _answer: unknown): Promise<string | null> {
  const creds = await getGhlCredentials(ctx.userId)
  if (!creds) {
    ctx.stepData.socialAccounts = []
    return null // provisioning covers this; validator flags ghlSettings separately
  }
  try {
    const accounts = await listGhlAccounts(creds.apiKey, creds.locationId)
    ctx.stepData.socialAccounts = accounts as unknown as Record<string, unknown>[]
    const ids: Record<string, string> = { ...((creds.accountIds as Record<string, string>) ?? {}) }
    for (const acc of accounts) {
      const platform = acc.platform?.toLowerCase()
      if (platform && ['facebook', 'instagram', 'linkedin', 'threads'].includes(platform) && !ids[platform]) {
        ids[platform] = acc.id
      }
    }
    // Credentials resolve account-wide, so write to the row that actually
    // holds them — the session user (a second account member) may not own it.
    const row = await ghlSettingsForUser(ctx.userId)
    if (row) await prisma.ghlSettings.update({ where: { id: row.id }, data: { accountIds: ids } })
  } catch (err) {
    logger.warn({ err }, '[onboarding] social account fetch failed (retryable from settings)')
    ctx.stepData.socialAccounts = []
  }
  return null
}

/** elevenlabs: store key + clone the voice from the archived answers. */
export async function commitElevenLabs(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { value?: string; apiKey?: string }
  if (a.value !== 'yes') return null // decision recorded via stepData

  const elKey = a.apiKey?.trim()
  if (!elKey) return 'Paste your ElevenLabs API key (Profile → API Keys) to set up your voice'

  // ApiKey has no (userId, provider) unique — mirror the voice route's pattern.
  const existingKey = await prisma.apiKey.findFirst({ where: { userId: ctx.userId, provider: 'elevenlabs' } })
  if (existingKey) {
    await prisma.apiKey.update({ where: { id: existingKey.id }, data: { encryptedKey: encrypt(elKey) } })
  } else {
    await prisma.apiKey.create({ data: { userId: ctx.userId, provider: 'elevenlabs', encryptedKey: encrypt(elKey) } })
  }

  // Voice clone from the archived answers (best-effort; settings page can redo).
  try {
    const cdn = (process.env.CDN_BASE ?? 'https://cdn.omniply.io').replace(/\/$/, '')
    const audioKeys = ['q_declaration', 'q_enemy', 'q_tribe', 'q_line', 'q_proof']
      .map((k) => (ctx.stepData[k] as { audioKey?: string })?.audioKey)
      .filter((k): k is string => !!k)
      .slice(0, 4)
    if (audioKeys.length === 0) {
      ctx.stepData.voiceCloneSkipped = 'no audio archived'
      return null
    }
    const form = new FormData()
    form.append('name', `Onboarding voice ${ctx.accountId.slice(0, 8)}`)
    for (const key of audioKeys) {
      const res = await fetch(`${cdn}/${key}`)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      form.append('files', new Blob([buf], { type: 'audio/webm' }), key.split('/').pop() ?? 'answer.webm')
    }
    const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': elKey },
      body: form,
    })
    if (res.ok) {
      const data = (await res.json()) as { voice_id?: string }
      if (data.voice_id) {
        await settingsUpsert(ctx.userId, { elevenLabsVoiceId: data.voice_id })
        ctx.stepData.voiceCloned = true
      }
    } else {
      logger.warn({ status: res.status }, '[onboarding] ElevenLabs clone failed (key stored; redo from settings)')
      ctx.stepData.voiceCloneSkipped = `elevenlabs HTTP ${res.status}`
    }
  } catch (err) {
    logger.warn({ err }, '[onboarding] voice clone errored (key stored)')
  }
  return null
}

/** toggles: automation on + auto-generate-on-payment choice. */
export async function commitToggles(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { value?: string }
  await settingsUpsert(ctx.userId, {
    socialAutomationEnabled: true,
    autoGenerateNextCycle: a.value === 'auto',
  })
  return null
}

/** booking_url: the universal CTA destination (clinic's PMS booking page). */
export async function commitBookingUrl(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { text?: string }
  const raw = a.text?.trim()
  if (!raw) return 'Paste your online booking link (the page patients use to book)'
  const url = raw.startsWith('http') ? raw : `https://${raw}`
  try {
    new URL(url)
  } catch {
    return "That doesn't look like a link — try copying it straight from your booking page"
  }
  const brand = await prisma.brandSettings.findUnique({ where: { userId: ctx.userId }, select: { socialBioUrl: true } })
  await brandUpsert(ctx.userId, {
    bookingUrl: url,
    // Existing CTA consumers read socialBioUrl — backfill it so the booking
    // destination takes effect immediately without touching those call sites.
    ...(brand?.socialBioUrl?.trim() ? {} : { socialBioUrl: url }),
  })
  return null
}

/** pms: market-research capture only (connector framework stays parked). */
export async function commitPms(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { value?: string; customText?: string }
  const value = a.value === 'other' ? (a.customText?.trim() || 'other') : a.value
  if (!value) return 'Pick the closest option'
  await brandUpsert(ctx.userId, { pmsSystem: value })
  return null
}

/** gbp: capture the Google Business Profile / Maps link; resolve place + probe (best-effort). */
export async function commitGbp(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { text?: string }
  const raw = a.text?.trim() ?? ''
  if (!raw) return 'Paste your Google listing link, or type "skip" if you don\'t have one'
  if (/^(skip|none|no)$/i.test(raw)) {
    ctx.stepData.gbpSkipped = true
    return null
  }
  const url = raw.startsWith('http') ? raw : `https://${raw}`
  try {
    new URL(url)
  } catch {
    return 'That doesn\'t look like a link — use the Share button on your Google Business Profile, or type "skip"'
  }
  await brandUpsert(ctx.userId, { googleBusinessProfileUrl: url })

  // Best-effort place resolution + review/hours probe — NEVER blocks onboarding.
  try {
    const { placesConfigured, resolvePlaceId, probePlace } = await import('../lib/google/places')
    if (placesConfigured()) {
      const brand = await prisma.brandSettings.findUnique({
        where: { userId: ctx.userId },
        select: { organizationName: true, geolocation: true, openingHours: true },
      })
      const placeId = await resolvePlaceId(url, [brand?.organizationName, brand?.geolocation].filter(Boolean).join(' '))
      if (placeId) {
        await brandUpsert(ctx.userId, { googlePlaceId: placeId })
        const probe = await probePlace(placeId)
        if (probe) {
          if (probe.openingHours && !brand?.openingHours?.trim()) {
            await brandUpsert(ctx.userId, { openingHours: probe.openingHours })
          }
          const { ingestReviews } = await import('../lib/google/review-ingest')
          await ingestReviews(ctx.accountId, 'places-probe', probe.reviews)
        }
        // Option C provisioning: point the snapshot's `omniply-review` trigger
        // link at the clinic's Google review deep link (best-effort).
        try {
          const { getGhlCredentials } = await import('../lib/ghl/settings')
          const creds = await getGhlCredentials(ctx.userId)
          if (creds) {
            const { listTriggerLinks, updateTriggerLink } = await import('../lib/ghl/client')
            const { reviewDeepLink } = await import('../lib/google/places')
            const link = (await listTriggerLinks(creds.apiKey, creds.locationId)).find(
              (l) => l.name?.toLowerCase() === 'omniply-review',
            )
            if (link) await updateTriggerLink(creds.apiKey, link.id, link.name, reviewDeepLink(placeId))
          }
        } catch (err) {
          logger.warn({ err }, '[onboarding] trigger-link provisioning failed (non-fatal)')
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, '[onboarding] places probe failed (non-fatal)')
  }
  return null
}

/** google_reviews: record the OAuth decision (the popup does the actual connect). */
export async function commitGoogleReviews(ctx: StepContext, answer: unknown): Promise<string | null> {
  const a = (answer ?? {}) as { value?: string }
  if (!a.value) return 'Pick an option'
  ctx.stepData.googleReviews = a.value
  return null
}

// ── Front Desk Questions (chat-kb plan E) ────────────────────────────────────

export interface FrontDeskAnswers {
  insurance?: { funds?: string; hicaps?: boolean; medicareCarePlans?: boolean; workersComp?: boolean; motorAccident?: boolean }
  firstVisit?: { duration?: string; description?: string; bring?: string }
  freeAssessment?: { offered?: boolean; terms?: string }
  pricing?: { share?: boolean; standard?: string; discounts?: string }
  bookingPolicy?: { how?: string; cancellation?: string }
  practitioners?: { name?: string; gender?: string; hours?: string }[]
  treats?: { children?: boolean; pregnancy?: boolean; seniors?: boolean; ageLimit?: string | null }
  referrals?: string
  payment?: { methods?: string[]; other?: string }
  access?: string
  languages?: string
  afterHours?: string
}

/** Deterministic answers → logistics-only Q&A pairs. No LLM: instant, safe. */
export function buildFrontDeskFaqs(a: FrontDeskAnswers): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = []
  const add = (q: string, ans: string | undefined | null) => {
    const t = ans?.trim()
    if (t) out.push({ q, a: t })
  }

  if (a.insurance) {
    const bits: string[] = []
    if (a.insurance.funds?.trim()) bits.push(`We accept: ${a.insurance.funds.trim()}.`)
    if (a.insurance.hicaps) bits.push('HICAPS instant claims are available at the practice.')
    if (a.insurance.medicareCarePlans) bits.push('We accept Medicare care plans (EPC/CDM referrals).')
    if (a.insurance.workersComp) bits.push("We treat workers' compensation cases.")
    if (a.insurance.motorAccident) bits.push('We treat motor accident claims.')
    if (bits.length) out.push({ q: 'Which insurers or health funds do you accept?', a: bits.join(' ') })
  }
  if (a.firstVisit) {
    const bits: string[] = []
    if (a.firstVisit.duration?.trim()) bits.push(`A first visit takes about ${a.firstVisit.duration.trim()}.`)
    if (a.firstVisit.description?.trim()) bits.push(a.firstVisit.description.trim())
    if (bits.length) out.push({ q: 'What happens at a first visit and how long does it take?', a: bits.join(' ') })
    add('What should I bring or wear to my appointment?', a.firstVisit.bring)
  }
  if (a.freeAssessment?.offered && a.freeAssessment.terms?.trim()) {
    out.push({ q: 'Do you offer a free initial assessment?', a: `Yes. ${a.freeAssessment.terms.trim()}` })
  }
  if (a.pricing?.share) {
    const bits: string[] = []
    if (a.pricing.standard?.trim()) bits.push(a.pricing.standard.trim())
    if (a.pricing.discounts?.trim()) bits.push(a.pricing.discounts.trim())
    bits.push('Depending on your situation, the front desk can walk you through what applies to you.')
    out.push({ q: 'How much does a visit cost?', a: bits.join(' ') })
  }
  if (a.bookingPolicy) {
    add('How do I book, reschedule or cancel an appointment?', a.bookingPolicy.how)
    add('What is your cancellation policy?', a.bookingPolicy.cancellation)
  }
  const pract = (a.practitioners ?? []).filter((p) => p.name?.trim())
  if (pract.length) {
    const lines = pract.map((p) => `${p.name!.trim()}${p.gender ? ` (${p.gender})` : ''}${p.hours?.trim() ? ` — ${p.hours.trim()}` : ''}`)
    out.push({ q: 'Who are the practitioners, and can I request a specific one?', a: `${lines.join('; ')}. You can request a specific practitioner when booking.` })
    if (pract.some((p) => p.gender === 'female')) {
      out.push({ q: 'Is there a female practitioner available?', a: `Yes: ${pract.filter((p) => p.gender === 'female').map((p) => p.name!.trim()).join(', ')}.` })
    }
  }
  if (a.treats) {
    const yes: string[] = []
    if (a.treats.children) yes.push('children')
    if (a.treats.pregnancy) yes.push('patients during pregnancy')
    if (a.treats.seniors) yes.push('seniors')
    const bits: string[] = []
    if (yes.length) bits.push(`We see ${yes.join(', ')}.`)
    if (a.treats.ageLimit?.trim()) bits.push(`Age note: ${a.treats.ageLimit.trim()}.`)
    if (bits.length) out.push({ q: 'Do you treat children, pregnant patients or seniors?', a: bits.join(' ') })
  }
  add('Do I need a referral to book?', a.referrals)
  if (a.payment) {
    const methods = [...(a.payment.methods ?? [])]
    if (a.payment.other?.trim()) methods.push(a.payment.other.trim())
    if (methods.length) out.push({ q: 'Which payment methods do you accept?', a: `${methods.join(', ')}.` })
  }
  add('Where do I park and how accessible is the practice?', a.access)
  add('Which languages does the team speak?', a.languages)
  add('What should I do outside opening hours?', a.afterHours)
  return out
}

/** Validate + stage the Front Desk answers (written to the KB at kb_review). */
export async function commitFrontDesk(ctx: StepContext, answer: unknown): Promise<string | null> {
  if (typeof answer !== 'object' || answer === null) return 'Please fill in the form.'
  const a = answer as FrontDeskAnswers
  if (a.freeAssessment?.offered && !a.freeAssessment.terms?.trim()) {
    return 'Free initial assessment needs its terms stated (advertising rules require it).'
  }
  if (a.pricing?.share && !a.pricing.standard?.trim()) {
    return 'To share prices in chat, add your standard rates (or turn price sharing off).'
  }
  const faqs = buildFrontDeskFaqs(a)
  ctx.stepData.frontDesk = a as unknown as Record<string, unknown>
  ctx.stepData.frontDeskFaqs = faqs
  return null
}

/**
 * KB review (chat-kb plan F1): the clinic approved (possibly edited) the
 * assembled business info — commit it as the chat knowledge base.
 */
export async function commitKbReview(ctx: StepContext, answer: unknown): Promise<string | null> {
  if (typeof answer !== 'object' || answer === null) return 'Please review your details.'
  const a = answer as {
    faqs?: { q?: string; a?: string }[]
    openingHours?: string
    organizationPhone?: string
    bookingUrl?: string
  }
  const faqs = (a.faqs ?? [])
    .map((f) => ({ q: (f.q ?? '').trim(), a: (f.a ?? '').trim() }))
    .filter((f) => f.q && f.a)
  if (faqs.length === 0) return 'The knowledge base needs at least one question and answer.'

  await brandUpsert(ctx.userId, {
    clinicFaqs: faqs,
    ...(a.openingHours?.trim() ? { openingHours: a.openingHours.trim() } : {}),
    ...(a.organizationPhone?.trim() ? { organizationPhone: a.organizationPhone.trim() } : {}),
    ...(a.bookingUrl?.trim() ? { bookingUrl: a.bookingUrl.trim() } : {}),
  })
  ctx.stepData.kbApprovedAt = new Date().toISOString()

  // The chat reflects edits within seconds, not the 15-min cache TTL.
  const { clearAgentContextFor } = await import('../agent/context')
  clearAgentContextFor(ctx.accountId)
  return null
}
