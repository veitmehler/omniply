import { prisma, brandSettingsForUser } from '@omniply/shared'
import { Prisma } from '@prisma/client'
import { logger } from '../../lib/logger'
import type { AutomationLogContext } from './log-context'
import { ensureRunSlideCount } from './slide-count'
import {
  matrixForDay,
  storySlotsForDay,
  applyVoiceCapability,
  ARTICLE_DAY2_SLOTS,
  AZAVEA_ARTICLE_DAY1_SLOTS,
  sectionIndexOfSource,
  sourceKind,
  type DaySlot,
} from './weekly-matrix'
import { accountHasVoice } from '../../lib/elevenlabs/settings'
import { verticalForUser } from '../../lib/prompt-resolver'
import { buildMatrixRunContext, processMatrixSlot, type MatrixRunContext } from './matrix-processor'
import { sectionAtIndex } from './article-social-selectors'
import { resolveNewsletterSlotContent } from './newsletter-content'
import type { SlotContent } from './content'
import { listAutomationPlatforms } from './platforms'
import { PLATFORM_CHAR_LIMITS } from './captions'
import { generateBatchedCaptionsForPlatform, type CaptionSlotInput } from '../generators/batched-captions'
import { generateStoryArc, articleMaterialFromCtx } from '../generators/story-arc'
import { ensureShortTakeaways } from '../generators/short-takeaways'
import { loadSocialBrandTheme, commentHookFromTheme, commentFbAppendFromTheme } from '../brand-theme'
import { processStorySlot } from './story-processor'
import { finalizeGenerationCounts, updateGenerationProgress, loadPriorAssets } from './spec-processor'
import { mapWithConcurrency } from '../../lib/concurrency'

/** 1g wave widths — all 3 slots of a wave in flight at once; heavier local
 * stages are bounded downstream (ffmpeg 2, Chromium 4, provider caps). */
const FEED_WAVE_CONCURRENCY = 3
const STORY_WAVE_CONCURRENCY = 3

/** scheduledDate (YYYY-MM-DD, user tz) → ISO weekday (1=Mon … 7=Sun). */
function isoWeekdayOf(scheduledDate: string): number {
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay() // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow
}

interface SlotEntry {
  slotKey: string
  daySlot: DaySlot
}

/** The 3 matrix slots for a run, keyed P1/P2/P3 in time order. */
function slotEntriesForRun(
  kind: 'article' | 'newsletter',
  scheduledDate: string,
  hasVoice: boolean,
  slotVariant?: string | null,
  vertical?: string | null,
): SlotEntry[] {
  // Azavea cadence (hard-bound sections, arc-distance interleave — see
  // .plans/social-sections-kt-video plan): day 2 = KT + sections 2/4;
  // day 1 = sections 1/3/5. Other accounts use the weekday matrix.
  const base =
    slotVariant === 'article_day2'
      ? ARTICLE_DAY2_SLOTS
      : vertical === 'azavea' && kind === 'article'
        ? AZAVEA_ARTICLE_DAY1_SLOTS
        : matrixForDay(kind, isoWeekdayOf(scheduledDate))
  const slots = applyVoiceCapability(base, hasVoice)
  return slots.map((daySlot, i) => ({ slotKey: `P${i + 1}`, daySlot }))
}

/**
 * Text-only slot resolution for caption pre-generation — no S3, no image
 * work. Returns null for sources whose text needs the full resolver
 * (legacy selector sources); those runs skip batching and use the per-slot
 * caption path.
 */
function tryResolveSlotTextOnly(source: DaySlot['source'], ctx: MatrixRunContext, beatIndex?: number): SlotContent | null {
  if (sourceKind(source) === 'newsletter') {
    return ctx.newsletterCtx ? resolveNewsletterSlotContent(source, ctx.newsletterCtx, beatIndex) : null
  }
  if (!ctx.articleCtx) return null
  if (source === 'art_keytakeaways') {
    return { text: ctx.articleCtx.keyTakeawaysText, title: 'Key Takeaways' }
  }
  const idx = sectionIndexOfSource(source)
  if (idx !== null) return sectionAtIndex(ctx.articleCtx, idx)
  return null
}

/**
 * Generate + persist the article's story arc BEFORE the wave when any
 * art_story slot is present (engagement v2). Idempotent: an existing arc on
 * SitePage.storyArcJson is reused (day 2 reads day 1's arc). Azavea's
 * 2-day window always generates 4 beats so day 2 finds its half. Failure
 * logs and returns — story slots then degrade to section carousels.
 */
/**
 * Newsletter story arc (P3 main-app rollout): one edition posts on exactly one
 * day (enqueue.ts singleton per newsletter), so each edition gets its own
 * 2-beat arc from its freshly written feature article. Stored on
 * Newsletter.storyArcJson (first-write-wins claim as cheap insurance) and
 * mutated into the in-memory ctx, because the newsletter slot resolver is
 * pure-ctx. Failure logs and returns — nl_story slots degrade to the feature.
 */
async function ensureNewsletterStoryArc(
  newsletterId: string,
  userId: string,
  ctx: MatrixRunContext,
  logCtx: AutomationLogContext,
): Promise<void> {
  const nlCtx = ctx.newsletterCtx
  if (!nlCtx) return
  if (Array.isArray(nlCtx.storyArc) && nlCtx.storyArc.length > 0) return
  try {
    const material = [
      `# ${nlCtx.feature.title}`,
      nlCtx.feature.body.slice(0, 12_000),
      nlCtx.overviewTopics.length
        ? 'Also in this edition:\n' + nlCtx.overviewTopics.map((t) => `- ${t}`).join('\n')
        : '',
      nlCtx.tips.length ? 'Tips of the day:\n' + nlCtx.tips.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 24_000)
    const beats = await generateStoryArc({
      userId,
      articleTitle: nlCtx.feature.title,
      articleMaterial: material,
      articleUrl: '',
      beatCount: 2,
      logCtx,
    })
    const claimed = await prisma.newsletter.updateMany({
      where: { id: newsletterId, storyArcJson: { equals: Prisma.AnyNull } },
      data: { storyArcJson: beats as unknown as object },
    })
    if (claimed.count === 0) {
      const again = await prisma.newsletter.findUnique({ where: { id: newsletterId }, select: { storyArcJson: true } })
      nlCtx.storyArc = Array.isArray(again?.storyArcJson)
        ? (again.storyArcJson as unknown as { postText: string; slides: string[] }[])
        : (beats as unknown as { postText: string; slides: string[] }[])
    } else {
      nlCtx.storyArc = beats as unknown as { postText: string; slides: string[] }[]
    }
    logger.info({ ...logCtx, newsletterId, beats: nlCtx.storyArc?.length ?? 0 }, '[social-automation] newsletter story arc generated + stored')
  } catch (err) {
    logger.warn({ ...logCtx, newsletterId, err }, '[social-automation] newsletter story arc failed — feature fallback')
  }
}

async function ensureStoryArc(opts: {
  run: { jobId: string | null; newsletterId?: string | null; userId: string }
  feedEntries: SlotEntry[]
  ctx: MatrixRunContext
  vertical: string | null
  logCtx: AutomationLogContext
}): Promise<void> {
  const { run, feedEntries, ctx, vertical, logCtx } = opts
  // Newsletter runs (P3 main-app rollout): one edition = one posting day =
  // one 2-beat arc, stored on Newsletter.storyArcJson and mutated into the
  // in-memory ctx (the newsletter resolver is pure-ctx).
  if (run.newsletterId && ctx.newsletterCtx && feedEntries.some((e) => e.daySlot.source === 'nl_story')) {
    await ensureNewsletterStoryArc(run.newsletterId, run.userId, ctx, logCtx)
    return
  }
  if (!run.jobId || !ctx.articleCtx) return
  if (!feedEntries.some((e) => e.daySlot.source === 'art_story')) return

  try {
    const page = await prisma.sitePage.findFirst({
      where: { jobId: run.jobId },
      select: { id: true, storyArcJson: true, internalSlug: true },
    })
    if (!page || (Array.isArray(page.storyArcJson) && page.storyArcJson.length > 0)) return

    const beatCount = vertical === 'azavea' ? 4 : 2
    const attempt = await prisma.outputAttempt.findFirst({
      where: { jobId: run.jobId, status: 'success', resultUrl: { not: null } },
      select: { resultUrl: true },
    })
    const beats = await generateStoryArc({
      userId: run.userId,
      articleTitle: ctx.articleCtx.title,
      articleMaterial: articleMaterialFromCtx(ctx.articleCtx),
      articleUrl: attempt?.resultUrl ?? '',
      beatCount,
      logCtx,
    })
    // FIRST write wins: when both cadence-day runs process concurrently they
    // both pass the null check above and generate in parallel; an
    // unconditional update let the LAST write clobber the arc the sibling had
    // already rendered slides from (posted days could carry two different
    // arcs — found 2026-09-04). The loser discards its beats and reuses the
    // stored arc via the normal selectors.
    const claimed = await prisma.sitePage.updateMany({
      where: { id: page.id, storyArcJson: { equals: Prisma.AnyNull } },
      data: { storyArcJson: beats as unknown as object },
    })
    if (claimed.count === 0) {
      logger.info({ ...logCtx }, '[social-automation] sibling run stored the arc first — discarding this generation')
      return
    }
    logger.info({ ...logCtx, beats: beats.length }, '[social-automation] story arc generated + stored')
  } catch (err) {
    // Concurrent-runs race (late approvals enqueue both cadence days at
    // once): the sibling run may store the arc moments after our attempt
    // failed. Wait briefly and re-read before conceding to the fallback.
    logger.warn({ ...logCtx, err }, '[social-automation] story arc generation failed — re-checking for sibling arc')
    await new Promise((r) => setTimeout(r, 30_000))
    const again = await prisma.sitePage.findFirst({
      where: { jobId: run.jobId },
      select: { storyArcJson: true },
    })
    if (Array.isArray(again?.storyArcJson) && again.storyArcJson.length > 0) {
      logger.info({ ...logCtx }, '[social-automation] sibling run stored the arc — using it')
      return
    }
    logger.warn({ ...logCtx }, '[social-automation] no arc available — section fallback')
  }
}

/**
 * Phase 2 of the sections/KT plan: ONE caption call per platform covering
 * all feed slots, so the model writes mutually distinct captions. Returns
 * slotKey → platform → caption; empty map (or missing platforms) falls back
 * to the legacy per-slot path inside buildPostsForSpec.
 */
async function pregenerateBatchedCaptions(opts: {
  feedEntries: SlotEntry[]
  ctx: MatrixRunContext
  logCtx: AutomationLogContext
  jobId?: string | null
  vertical?: string | null
}): Promise<Record<string, Record<string, string>>> {
  const { feedEntries, ctx, logCtx } = opts
  if (feedEntries.length === 0) return {}

  const platforms = await listAutomationPlatforms(logCtx.userId, false)
  const bySlot: Record<string, Record<string, string>> = {}

  // Key-Takeaways slots publish the article's takeaways VERBATIM — no
  // caption generator, ever (user decision 2026-08-19). Only truncation to
  // the platform limit is applied.
  const llmEntries: SlotEntry[] = []
  // Story beats publish their postText VERBATIM as content/caption on every
  // platform — no caption LLM (same rule as Key Takeaways).
  const hasStorySlots = feedEntries.some((e) => e.daySlot.source === 'art_story' || e.daySlot.source === 'nl_story')
  let storyArc: { postText?: string }[] | null = null
  const jobIdForArc = opts.jobId ?? null
  if (jobIdForArc && feedEntries.some((e) => e.daySlot.source === 'art_story')) {
    const page = await prisma.sitePage.findFirst({ where: { jobId: jobIdForArc }, select: { storyArcJson: true } })
    storyArc = (page?.storyArcJson as { postText?: string }[] | null) ?? null
  } else if (ctx.newsletterCtx?.storyArc) {
    storyArc = ctx.newsletterCtx.storyArc
  }
  // Comment-keyword hook (platform CTA split, 2026-09-03; generalized to the
  // dm_keyword preset for clients, P3 2026-09-08): IG drops URL lines + gets
  // the comment hook, FB gets the comment path IN ADDITION to the link.
  const hookTheme = hasStorySlots ? await loadSocialBrandTheme(logCtx.userId) : null
  const storyHook =
    opts.vertical === 'azavea'
      ? 'Comment "XRAY" and I will send you the free 2-minute Practice X-Ray.'
      : (hookTheme ? commentHookFromTheme(hookTheme) : null) ?? ''
  const fbAppend =
    opts.vertical === 'azavea'
      ? 'Or just comment "XRAY" and I will send it straight to you.'
      : (hookTheme ? commentFbAppendFromTheme(hookTheme) : null) ?? ''
  for (const e of feedEntries) {
    if (e.daySlot.source === 'art_story' || e.daySlot.source === 'nl_story') {
      const beat = storyArc?.[e.daySlot.beatIndex ?? 0]
      if (beat?.postText) {
        for (const platform of platforms) {
          const limit = PLATFORM_CHAR_LIMITS[platform] ?? 2000
          let t = beat.postText
          if (storyHook && fbAppend && platform === 'facebook' && /\.[a-z]{2,4}\/|https?:/i.test(t.split('\n').pop() ?? '')) {
            t = `${t}\n\n${fbAppend}`
          } else if (storyHook && platform === 'instagram') {
            // IG captions are not clickable: drop EVERY URL-bearing line (a
            // mid-caption article link slipped the last-line-only replace —
            // sweep 2026-09-07), then make sure the comment hook closes it.
            const lines = t.split('\n').filter((l) => !/https?:\/\/|\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|net|org|ai|co|app|dev|us)\b(?:\/\S*)?/i.test(l))
            while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
            if (!lines.some((l) => l.includes(storyHook))) lines.push('', storyHook)
            t = lines.join('\n')
          }
          ;(bySlot[e.slotKey] ??= {})[platform] = t.length <= limit ? t : t.slice(0, limit - 1).trim() + '…'
        }
      }
      continue // story slots NEVER go to the caption LLM (fallback carousel reuses section content caption-free)
    }
    if (e.daySlot.source === 'art_keytakeaways' && ctx.articleCtx?.keyTakeawaysText) {
      let kt = ctx.articleCtx.keyTakeawaysText.trim()
      // Lead with the derived curiosity headline instead of the literal
      // "Key Takeaways" heading (weak first line — user 2026-09-08). The
      // bullets below stay FULL VERBATIM; cache hit in the normal case.
      if (opts.jobId) {
        const shorts = await ensureShortTakeaways({
          jobId: opts.jobId,
          userId: logCtx.userId,
          logCtx: { userId: logCtx.userId, jobId: opts.jobId },
        }).catch(() => null)
        if (shorts?.headline) {
          kt = kt.replace(/^key takeaways?\s*:?\s*\n+/i, '')
          kt = `${shorts.headline}\n\n${kt}`
        }
      }
      for (const platform of platforms) {
        const limit = PLATFORM_CHAR_LIMITS[platform] ?? 2000
        ;(bySlot[e.slotKey] ??= {})[platform] =
          kt.length <= limit ? kt : kt.slice(0, limit - 1).trim() + '…'
      }
    } else {
      llmEntries.push(e)
    }
  }

  const slots: CaptionSlotInput[] = []
  for (const e of llmEntries) {
    const sc = tryResolveSlotTextOnly(e.daySlot.source, ctx, e.daySlot.beatIndex)
    if (!sc?.text) return bySlot // legacy source in the mix — those slots use per-slot captions
    slots.push({
      slotKey: e.slotKey,
      postType: e.daySlot.postType,
      title: sc.title ?? ctx.contextTitle,
      text: sc.text,
    })
  }
  if (slots.length === 0) return bySlot

  await Promise.all(
    platforms.map(async (platform) => {
      try {
        const captions = await generateBatchedCaptionsForPlatform({
          platform,
          articleTitle: ctx.contextTitle,
          slots,
          logCtx,
        })
        for (const [slotKey, caption] of Object.entries(captions)) {
          ;(bySlot[slotKey] ??= {})[platform] = caption
        }
      } catch (err) {
        logger.warn(
          { ...logCtx, platform, err },
          '[social-automation] batched captions failed — per-slot fallback for platform',
        )
      }
    }),
  )
  return bySlot
}

export async function runSocialAutomation(
  runId: string,
  opts?: { onlySlot?: string; resumeIncomplete?: boolean },
): Promise<void> {
  const run = await prisma.socialAutomationRun.findUnique({
    where: { id: runId },
    include: { sitePage: true },
  })

  if (!run || (!run.jobId && !run.newsletterId)) {
    throw new Error(`Social automation run missing content source: ${runId}`)
  }

  if (opts?.onlySlot) {
    const reclaimed = await prisma.socialAutomationRun.updateMany({
      where: { id: runId, status: { in: ['ready', 'processing', 'completed', 'failed'] } },
      data: { status: 'processing', error: null },
    })
    if (reclaimed.count === 0) {
      logger.info({ runId }, '[social-automation] single-slot retry skipped — run not reclaimable')
      return
    }
  } else {
    const claim = await prisma.socialAutomationRun.updateMany({
      where: { id: runId, status: { in: ['pending', 'processing'] } },
      data: { status: 'processing', error: null },
    })
    if (claim.count === 0) {
      logger.info({ runId }, '[social-automation] run already finished or claimed elsewhere')
      return
    }
  }

  const settings = await prisma.settings.findUnique({ where: { userId: run.userId } })
  const timeZone = settings?.socialTimezone ?? 'America/New_York'
  const kind: 'article' | 'newsletter' = run.newsletterId ? 'newsletter' : 'article'

  // No-voice accounts get NO video slots — accent-tinted carousels instead.
  // Story derivation runs on the transformed entries, so pitch_hook companions
  // become pitch_carousel automatically.
  const hasVoice = await accountHasVoice(run.userId)
  const vertical = kind === 'article' ? await verticalForUser(run.userId) : null
  const feedEntries = slotEntriesForRun(kind, run.scheduledDate, hasVoice, run.slotVariant, vertical)
  const storySlots = storySlotsForDay(kind, feedEntries)
  if (!hasVoice) {
    logger.info({ runId }, '[social-automation] no working voice — video slots substituted with accent carousels')
  }

  // Story slot keys are S1/S2/S3; feed keys are P1/P2/P3.
  const onlyStory = opts?.onlySlot?.startsWith('S') ? opts.onlySlot : null
  const onlyFeed = opts?.onlySlot && !onlyStory ? opts.onlySlot : null

  let feedToRun = feedEntries
  let storiesToRun = storySlots
  if (onlyFeed) {
    feedToRun = feedEntries.filter((e) => e.slotKey === onlyFeed)
    storiesToRun = []
    if (feedToRun.length === 0) throw new Error(`Invalid slot key: ${onlyFeed}`)
  } else if (onlyStory) {
    feedToRun = []
    storiesToRun = storySlots.filter((s) => s.slotKey === onlyStory)
    if (storiesToRun.length === 0) throw new Error(`Invalid slot key: ${onlyStory}`)
  } else if (opts?.resumeIncomplete) {
    // Auto-recovery from the stale-run sweeper: skip slots that already
    // completed rather than throwing away their (Fal-billed) work and
    // regenerating from scratch. Only 'completed' rows are skipped — 'failed'
    // or missing rows are reprocessed.
    const completed = await prisma.socialAutomationSpecResult.findMany({
      where: { runId, status: 'completed' },
      select: { slotKey: true },
    })
    const completedKeys = new Set(completed.map((c) => c.slotKey))
    feedToRun = feedEntries.filter((e) => !completedKeys.has(e.slotKey))
    storiesToRun = storySlots.filter((s) => !completedKeys.has(s.slotKey))
  }

  const ctx = await buildMatrixRunContext(run)
  const brand = await brandSettingsForUser(run.userId)
  const diagramLogoVariant: 'light' | 'dark' = brand?.diagramLogoVariant === 'dark' ? 'dark' : 'light'
  const slideCount = await ensureRunSlideCount(runId, { reset: !opts?.onlySlot && !opts?.resumeIncomplete })

  const baseCtx: AutomationLogContext = { runId, userId: run.userId, jobId: run.jobId ?? undefined }
  logger.info(
    {
      ...baseCtx,
      kind,
      scheduledDate: run.scheduledDate,
      feed: feedToRun.length,
      stories: storiesToRun.length,
      onlySlot: opts?.onlySlot,
      resumeIncomplete: opts?.resumeIncomplete,
    },
    '[social-automation] run started',
  )

  if (opts?.onlySlot) {
    await prisma.post.deleteMany({
      where: { automationRunId: runId, slotKey: opts.onlySlot, status: 'ready' },
    })
  } else if (opts?.resumeIncomplete) {
    // Targeted cleanup: only wipe 'ready' posts for the slots being
    // reprocessed — completed slots (and their posts) are left untouched.
    const slotsToReprocess = [...feedToRun.map((e) => e.slotKey), ...storiesToRun.map((s) => s.slotKey)]
    if (slotsToReprocess.length > 0) {
      await prisma.post.deleteMany({
        where: { automationRunId: runId, slotKey: { in: slotsToReprocess }, status: 'ready' },
      })
    }
    await prisma.socialAutomationRun.update({
      where: { id: runId },
      data: { totalSpecs: feedEntries.length + storySlots.length },
    })
  } else {
    await prisma.socialAutomationSpecResult.deleteMany({ where: { runId } })
    await prisma.post.deleteMany({ where: { automationRunId: runId, status: 'ready' } })
    await prisma.socialAutomationRun.update({
      where: { id: runId },
      data: { completedSpecs: 0, failedSpecs: 0, totalSpecs: feedEntries.length + storySlots.length },
    })
  }

  // Two-wave parallelism (.plans/production-throughput.implementation-plan.md 1g):
  // WAVE 1 — the day's feed slots in parallel (mutually independent; per-slot
  // failure isolation lives inside processMatrixSlot's spec-result handling).
  // WAVE 2 — story slots in parallel AFTER wave 1 settles (stories reuse feed
  // assets). Heavy local stages stay bounded by the ffmpeg/Chromium/provider
  // semaphores. currentSpec shows the most recently STARTED slot.
  // Story arc first (engagement v2): generated once per article, persisted,
  // read by both cadence days' story slots + the caption pregen below.
  await ensureStoryArc({ run, feedEntries: feedToRun, ctx, vertical, logCtx: baseCtx })

  // Batched captions (one call per platform, all slots together) BEFORE the
  // wave — distinctness across the day's captions is enforced in-prompt.
  const captionsBySlot =
    feedToRun.length > 0
      ? await pregenerateBatchedCaptions({ feedEntries: feedToRun, ctx, logCtx: baseCtx, jobId: run.jobId, vertical })
      : {}

  await mapWithConcurrency(feedToRun, FEED_WAVE_CONCURRENCY, async (entry) => {
    await prisma.socialAutomationRun.update({
      where: { id: runId },
      data: { currentSpec: entry.slotKey },
    })

    await processMatrixSlot({
      run,
      slotKey: entry.slotKey,
      daySlot: entry.daySlot,
      ctx,
      timeZone,
      slideCount,
      diagramLogoVariant,
      logCtx: baseCtx,
      pregeneratedCaptions: captionsBySlot[entry.slotKey],
    })

    await updateGenerationProgress(runId)
  })

  if (storiesToRun.length > 0) {
    const priorAssets = await loadPriorAssets(runId)
    await mapWithConcurrency(storiesToRun, STORY_WAVE_CONCURRENCY, async (story) => {
      await prisma.socialAutomationRun.update({
        where: { id: runId },
        data: { currentSpec: story.slotKey },
      })

      await processStorySlot({ run, story, ctx, priorAssets, timeZone, logCtx: baseCtx })

      await updateGenerationProgress(runId)
    })
  }

  await finalizeGenerationCounts(runId)
}

/** Re-run a single matrix slot (P1/P2/P3) — used by the admin "retry slot" action. */
export async function retryAutomationSpec(runId: string, slotKey: string): Promise<void> {
  await prisma.socialAutomationRun.update({
    where: { id: runId },
    data: { status: 'processing', currentSpec: slotKey },
  })
  await runSocialAutomation(runId, { onlySlot: slotKey })
  const result = await prisma.socialAutomationSpecResult.findUnique({
    where: { runId_slotKey: { runId, slotKey } },
  })
  if (result?.status === 'failed') throw new Error(result.error ?? 'Spec retry failed')
}

export {
  dispatchSocialAutomationRun,
  dispatchSocialAutomationSlot,
} from './dispatch-run'
