/**
 * Onboarding step machine (onboarding plan Phase 1).
 *
 * SCRIPTED, not LLM-driven: a fixed ordered list of steps, each with a
 * `prepare` (what the chat shows) and a `commit` (what the answer writes).
 * The LLM only ever runs INSIDE analysis steps (crawl, synthesis, transcribe).
 * Every commit persists to OnboardingSession.stepData immediately — closing
 * the tab resumes exactly where the user left off.
 *
 * Phase 1 ships the engine with all steps DECLARED and walkable; the
 * data-heavy prepare/commit bodies (crawl, vision, synthesis, offers,
 * connections) are filled in by Phases 2–7 behind the same interface.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import {
  commitBusinessConfirm,
  afterFifthQuestion,
  commitLogoConfirm,
  commitPhoto,
  commitBrandProfile,
  commitTemplateReveal,
  commitOffers,
  commitCta,
  commitBookingUrl,
  commitPms,
  commitFrontDesk,
  commitKbReview,
  commitGbp,
  commitGoogleReviews,
  commitWritingSample,
  commitStoryMoments,
  commitWordpress,
  commitSocials,
  commitElevenLabs,
  commitToggles,
} from './commits'
import { specializationRegistryKeys } from './site-analysis'

export type StepKind = 'info' | 'text' | 'choice' | 'confirm_card' | 'voice' | 'action'

export interface StepView {
  id: string
  kind: StepKind
  /** Chat bubbles shown for this step (already-interpolated). */
  messages: string[]
  /** For 'choice': the options. */
  options?: { value: string; label: string }[]
  /** For 'confirm_card': arbitrary card payload the UI knows how to render. */
  card?: Record<string, unknown>
  /** Progress: 1-based index / total. */
  progress: { index: number; total: number }
  /** True while a background job this step depends on is still running. */
  pending?: boolean
}

export interface StepContext {
  accountId: string
  userId: string
  stepData: Record<string, unknown>
}

interface StepDef {
  id: string
  kind: StepKind
  prepare(ctx: StepContext): Promise<Omit<StepView, 'id' | 'kind' | 'progress'>>
  /** Returns validation error string, or null on success. */
  commit(ctx: StepContext, answer: unknown): Promise<string | null>
}

/** Simple steps store their raw answer under stepData[id] — later phases refine. */
function storeAnswer(id: string): StepDef['commit'] {
  return async (ctx, answer) => {
    ctx.stepData[id] = answer
    return null
  }
}

const STEPS: StepDef[] = [
  {
    id: 'welcome',
    kind: 'info',
    prepare: async () => ({
      messages: [
        "Hi! I'm your content setup assistant. Over the next ~15 minutes we'll build your entire content engine together — your brand, your voice, your calendar.",
        "Everything you tell me gets used to write the way YOU would. Ready?",
      ],
    }),
    commit: async () => null,
  },
  {
    id: 'business_confirm',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: ["First — here's what I already know about your business from your account. Anything to fix?"],
      card: (ctx.stepData.ghlPrefill as Record<string, unknown>) ?? {},
    }),
    commit: async (ctx, answer) => {
      const err = await commitBusinessConfirm(ctx, answer)
      if (!err) ctx.stepData.business_confirm = answer
      return err
    },
  },
  // Q1–Q5: the Manifesto-derived voice questions (Phase 3 adds recording).
  {
    id: 'q_declaration',
    kind: 'voice',
    prepare: async () => ({
      messages: [
        "Now the good part — six questions about your practice. Answer them out loud if you can (tap the mic); speaking works better than typing, and I'll use your voice later too.",
        "Be detailed and elaborate — ramble, tell stories, go on tangents. The more you say, the better I capture how YOU naturally talk, and that's what makes your content sound like you instead of a robot.",
        'Imagine a patient describing your clinic to a friend three years from now. What do you want them to say you did for them?',
      ],
    }),
    commit: storeAnswer('q_declaration'),
  },
  {
    id: 'q_enemy',
    kind: 'voice',
    prepare: async () => ({
      messages: ["What's the one thing in your industry that drives you crazy — the thing patients keep falling for before they find you?"],
    }),
    commit: storeAnswer('q_enemy'),
  },
  {
    id: 'q_tribe',
    kind: 'voice',
    prepare: async () => ({
      messages: ['Describe your favorite patient — the one you wish you had 100 more of. Who are they, what does their life look like?'],
    }),
    commit: storeAnswer('q_tribe'),
  },
  {
    id: 'q_line',
    kind: 'voice',
    prepare: async () => ({
      messages: ['What do you refuse to compromise on, even when it costs you?'],
    }),
    commit: storeAnswer('q_line'),
  },
  {
    id: 'q_moments',
    kind: 'voice',
    prepare: async () => ({
      messages: [
        "Tell me two or three short TRUE stories from running your practice — a mistake you fixed, a lesson that cost you something, a moment you're proud of. These become the personal moments in your social posts, so real moments only, and no patient details.",
      ],
    }),
    commit: async (ctx, answer) => {
      const err = await commitStoryMoments(ctx, answer)
      if (!err) ctx.stepData.q_moments = answer
      return err
    },
  },
  {
    id: 'q_proof',
    kind: 'voice',
    prepare: async () => ({
      messages: ["Last one: walk me through what actually happens in a patient's first visit and first month with you."],
    }),
    commit: async (ctx, answer) => {
      ctx.stepData.q_proof = answer
      await afterFifthQuestion(ctx)
      return null
    },
  },
  {
    id: 'logo_confirm',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: ['While we talked, I explored your website. Is this your logo?'],
      card: { candidates: (ctx.stepData.logoCandidates as unknown[]) ?? [] },
      pending: !ctx.stepData.crawlDone,
    }),
    commit: async (ctx, answer) => {
      const err = await commitLogoConfirm(ctx, answer)
      if (!err) ctx.stepData.logo_confirm = answer
      return err
    },
  },
  {
    id: 'photo',
    kind: 'confirm_card',
    prepare: async () => ({
      messages: [
        "Your quote posts show a real face next to the words — that's what makes them feel personal instead of corporate.",
        'Upload a photo of the person who represents your content (you, or your lead practitioner). Square, good light, shoulders-up works best — it appears as a circular avatar on quote cards.',
      ],
      card: { type: 'photo_upload' },
    }),
    commit: async (ctx, answer) => {
      const err = await commitPhoto(ctx, answer)
      if (!err) ctx.stepData.photo = answer
      return err
    },
  },
  {
    id: 'brand_profile_confirm',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: [
        "Here's your Brand Profile — built from your website plus everything you just told me. Read it over and fix anything that's off. This drives every article, newsletter and post we write.",
      ],
      card: {
        ...((ctx.stepData.brandProfileDraft as Record<string, unknown>) ?? {}),
        availableSpecializations: await specializationRegistryKeys(),
      },
      pending: !ctx.stepData.synthesisDone,
    }),
    commit: async (ctx, answer) => {
      const err = await commitBrandProfile(ctx, answer)
      if (!err) ctx.stepData.brand_profile_confirm = answer
      return err
    },
  },
  {
    id: 'writing_sample',
    kind: 'text',
    prepare: async (ctx) => {
      const sample = ctx.stepData.blogSample as
        | { url: string; title: string; text: string; wordCount: number }
        | null
        | undefined
      if (sample?.text) {
        const excerpt = sample.text.slice(0, 300).trim()
        return {
          messages: [
            `While exploring your website I found this article${sample.title ? `: "${sample.title}"` : ''} (${sample.wordCount} words).\n\n"${excerpt}…"\n\nIf YOU wrote this (not a website vendor or content service), type exactly: I wrote this — and I'll learn your written voice from it.\n\nIf it was ghostwritten, paste an article you DID write instead, or type "skip" and I'll work from your spoken answers alone.`,
          ],
        }
      }
      return {
        messages: [
          'To write in your voice, I need a sample of your real writing — a blog post, a patient email, anything 500+ words. Paste it here (or type "skip" and I\'ll work from your spoken answers alone).',
        ],
      }
    },
    commit: async (ctx, answer) => {
      const err = await commitWritingSample(ctx, answer)
      if (!err) ctx.stepData.writing_sample = answer
      return err
    },
  },
  {
    id: 'template_reveal',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: ['Drumroll… this is YOUR newsletter. Your logo, your colors, your fonts. Tap any color to adjust.'],
      card: (ctx.stepData.templateDraft as Record<string, unknown>) ?? {},
      pending: !ctx.stepData.templateReady,
    }),
    commit: async (ctx, answer) => {
      const err = await commitTemplateReveal(ctx, answer)
      if (!err) ctx.stepData.template_reveal = answer
      return err
    },
  },
  {
    id: 'offers',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: ["I've drafted a year of seasonal offers for your newsletter, tailored to your specialty. Keep what you like, edit or drop the rest."],
      card: { offers: (ctx.stepData.offerDrafts as unknown[]) ?? [] },
      pending: !ctx.stepData.offersReady,
    }),
    commit: async (ctx, answer) => {
      const err = await commitOffers(ctx, answer)
      if (!err) ctx.stepData.offers = answer
      return err
    },
  },
  {
    id: 'cta',
    kind: 'choice',
    prepare: async (ctx) => ({
      messages: ['When someone loves a post, where should it send them?'],
      options: (ctx.stepData.ctaOptions as { value: string; label: string }[]) ?? [
        { value: 'booking', label: 'Book an appointment' },
        { value: 'newsletter', label: 'Join my newsletter' },
        { value: 'dm_keyword', label: 'Send a free guide when they comment a keyword' },
        { value: 'custom', label: 'Something else…' },
      ],
    }),
    commit: async (ctx, answer) => {
      const err = await commitCta(ctx, answer)
      if (!err) ctx.stepData.cta = answer
      return err
    },
  },
  {
    id: 'booking_url',
    kind: 'text',
    prepare: async (ctx) => ({
      messages: [
        "Where should bookings go? Paste the link patients use to book with you online (your booking system's page).",
      ],
      card: { website: (ctx.stepData.ghlPrefill as { website?: string })?.website ?? '' },
    }),
    commit: async (ctx, answer) => {
      const err = await commitBookingUrl(ctx, answer)
      if (!err) ctx.stepData.booking_url = answer
      return err
    },
  },
  {
    id: 'pms',
    kind: 'choice',
    prepare: async () => ({
      messages: ['Which system does your practice run on day to day? (This just helps us build the right integrations next.)'],
      options: [
        { value: 'cliniko', label: 'Cliniko' },
        { value: 'nookal', label: 'Nookal' },
        { value: 'jane', label: 'Jane' },
        { value: 'chirotouch', label: 'ChiroTouch' },
        { value: 'none', label: 'None yet' },
        { value: 'other', label: 'Something else…' },
      ],
    }),
    commit: async (ctx, answer) => {
      const err = await commitPms(ctx, answer)
      if (!err) ctx.stepData.pms = answer
      return err
    },
  },
  {
    id: 'wordpress',
    kind: 'confirm_card',
    prepare: async (ctx) => ({
      messages: [
        "Let's connect your website so articles publish straight to it. I'll walk you through creating a WordPress Application Password — takes about 30 seconds.",
      ],
      card: {
        type: 'wordpress_connect',
        website: (ctx.stepData.ghlPrefill as { website?: string })?.website ?? '',
      },
    }),
    commit: async (ctx, answer) => {
      const err = await commitWordpress(ctx, answer)
      if (!err) ctx.stepData.wordpress = answer
      return err
    },
  },
  {
    id: 'socials',
    kind: 'confirm_card',
    prepare: async () => ({
      messages: ['Now connect your social accounts (Facebook, Instagram, LinkedIn) — this opens your Social Planner. Come back here when done and I\'ll pick them up.'],
      card: { type: 'social_connect' },
    }),
    commit: async (ctx, answer) => {
      const err = await commitSocials(ctx, answer)
      if (!err) ctx.stepData.socials = answer
      return err
    },
  },
  {
    id: 'gbp',
    kind: 'text',
    prepare: async () => ({
      messages: [
        "Almost there. Paste the link to your Google Business Profile (your Google Maps listing) — it powers your review QR card and lets us celebrate real patient wins. Type \"skip\" if you don't have one yet.",
      ],
    }),
    commit: async (ctx, answer) => {
      const err = await commitGbp(ctx, answer)
      if (!err) ctx.stepData.gbp = answer
      return err
    },
  },
  {
    id: 'google_reviews',
    kind: 'choice',
    prepare: async (ctx) => {
      const configured = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID)
      return {
        messages: [
          configured
            ? 'Want to connect your Google account so we can pull in ALL your reviews? Real patient stories make the strongest content. (You can disconnect anytime.)'
            : "One more thing for later: we'll be able to pull in your Google reviews to power patient-story content. Nothing needed from you today.",
        ],
        options: configured
          ? [
              { value: 'connect', label: 'Connect Google' },
              { value: 'skip', label: 'Skip for now' },
            ]
          : [{ value: 'skip', label: 'Continue' }],
        card: configured ? { type: 'google_oauth', startPath: `/api/google/oauth/start?account=${ctx.accountId}` } : undefined,
      }
    },
    commit: async (ctx, answer) => {
      const err = await commitGoogleReviews(ctx, answer)
      if (!err) ctx.stepData.google_reviews = answer
      return err
    },
  },
  {
    id: 'front_desk',
    kind: 'confirm_card',
    prepare: async () => ({
      messages: [
        "Nearly there! These are the questions patients ask your front desk every day — your answers power the website chat assistant so it answers like your best receptionist.",
      ],
      card: { type: 'front_desk' },
    }),
    commit: async (ctx, answer) => commitFrontDesk(ctx, answer),
  },
  {
    id: 'kb_review',
    kind: 'confirm_card',
    prepare: async (ctx) => {
      const { brandSettingsForUser } = await import('@omniply/shared')
      const brand = await brandSettingsForUser(ctx.userId)
      const existing = Array.isArray(brand?.clinicFaqs) ? (brand!.clinicFaqs as { q: string; a: string }[]) : []
      const fromForm = Array.isArray(ctx.stepData.frontDeskFaqs)
        ? (ctx.stepData.frontDeskFaqs as { q: string; a: string }[])
        : []
      // Form answers win on duplicate questions; crawl-derived entries fill gaps.
      const seen = new Set(fromForm.map((f) => f.q.toLowerCase()))
      const faqs = [...fromForm, ...existing.filter((f) => !seen.has(f.q.toLowerCase()))]
      return {
        messages: [
          'Last check: this is everything the assistant will know about your practice. Edit anything that needs fixing, then approve.',
        ],
        card: {
          type: 'kb_review',
          faqs,
          openingHours: brand?.openingHours ?? '',
          organizationPhone: brand?.organizationPhone ?? '',
          bookingUrl: brand?.bookingUrl ?? '',
          hoursSource: brand?.googlePlaceId ? 'google' : 'manual',
        },
      }
    },
    commit: async (ctx, answer) => commitKbReview(ctx, answer),
  },
  {
    id: 'toggles',
    kind: 'choice',
    prepare: async () => ({
      messages: [
        "Last setting: each month, the moment your payment clears, I can produce the whole month's content automatically — you just review and approve. Want that on?",
      ],
      options: [
        { value: 'auto', label: 'Yes, fully automatic' },
        { value: 'manual', label: "I'll trigger each month myself" },
      ],
    }),
    commit: async (ctx, answer) => {
      const err = await commitToggles(ctx, answer)
      if (!err) ctx.stepData.toggles = answer
      return err
    },
  },
  {
    id: 'final',
    kind: 'action',
    prepare: async (ctx) => ({
      messages: [
        'That\'s everything! Your first month of content is planned and ready.',
        'Hit the button to start generating — articles, newsletters and social posts will appear for your review as they finish.',
      ],
      card: { readiness: (ctx.stepData.readiness as Record<string, unknown>) ?? {} },
    }),
    commit: async () => null, // completion handled by the route (validator-gated)
  },
]

export const STEP_ORDER = STEPS.map((s) => s.id)

export function stepDef(id: string): StepDef | undefined {
  return STEPS.find((s) => s.id === id)
}

export async function getOrCreateSession(accountId: string) {
  return prisma.onboardingSession.upsert({
    where: { accountId },
    create: { accountId },
    update: {},
  })
}

export async function currentStepView(ctx: StepContext, currentStep: string): Promise<StepView> {
  const idx = Math.max(0, STEP_ORDER.indexOf(currentStep))
  const def = STEPS[idx]
  const prepared = await def.prepare(ctx)
  return { id: def.id, kind: def.kind, progress: { index: idx + 1, total: STEPS.length }, ...prepared }
}

/** Commit the answer for `stepId` and advance. Returns the next step id. */
export async function commitAndAdvance(
  ctx: StepContext,
  sessionId: string,
  stepId: string,
  answer: unknown,
): Promise<{ error?: string; nextStep: string }> {
  const idx = STEP_ORDER.indexOf(stepId)
  if (idx === -1) return { error: 'Unknown step', nextStep: stepId }
  const def = STEPS[idx]
  const error = await def.commit(ctx, answer)
  if (error) return { error, nextStep: stepId }

  const history = (ctx.stepData.__history as { step: string; answer: unknown; at: string }[]) ?? []
  history.push({ step: stepId, answer, at: new Date().toISOString() })
  ctx.stepData.__history = history

  const nextStep = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)]
  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { currentStep: nextStep, stepData: ctx.stepData as object },
  })
  logger.info({ sessionId, stepId, nextStep }, '[onboarding] step committed')
  return { nextStep }
}
