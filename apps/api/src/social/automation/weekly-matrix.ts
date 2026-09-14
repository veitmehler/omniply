/**
 * Weekly social cadence — 3 feed posts/day, Mon–Sat.
 *
 * Replaces the flat 12-slot DEFAULT_SOCIAL_POST_SPECS as the source of truth for
 * WHICH posts run on a given day. Newsletter days (Mon/Wed/Fri/Sat) draw from the
 * week's newsletter; article days (Tue/Thu) draw from the article. See
 * .plans/social-weekly-cadence.implementation-plan.md.
 */

/** Where a slot's content comes from. */
export type PostSource =
  // ── Newsletter sources ──
  | 'nl_overview' // reel bullets from the newsletter's topics
  | 'nl_tips' // quote card from quickHits.tips
  | 'nl_feature' // image carousel from the feature article
  | 'nl_story' // story-arc beat from the edition's feature article (P3 main-app rollout), indexed by DaySlot.beatIndex
  // ── Article sources ──
  | 'art_diagram_0' // legacy: diagram carousel, 1st diagram section (fallback → image carousel)
  | 'art_diagram_1' // legacy: diagram carousel, 2nd diagram section (fallback → image carousel)
  | 'art_keytakeaways' // reel bullets from Key Takeaways
  | 'art_hook_diagram0' // legacy: hook video from the 1st diagram section
  | 'art_hook_other' // legacy: hook video from a section ≠ that day's diagram-carousel section
  | 'art_hook_unused' // legacy: hook from a section no other slot (either day) has used
  // Hard-bound content sections (.plans/social-sections-kt-video plan, user
  // decision 2026-08-19): index N = the (N+1)th content H2 section (Key
  // Takeaways / FAQ / Conclusion excluded). No free selection — every slot's
  // section is fixed by the matrix; wraps modulo when an article runs short.
  | 'art_section_0'
  | 'art_section_1'
  | 'art_section_2'
  | 'art_section_3'
  | 'art_section_4'
  // Story-arc beat (engagement v2): content = the article's generated story
  // arc, indexed by DaySlot.beatIndex. See .plans/story-arc-posts plan.
  | 'art_story'

export type SourceKind = 'newsletter' | 'article'

export interface DaySlot {
  /** Hour of day (user's social timezone). */
  hour: number
  /** Generator post type: quote | video_reel | carousel | hook_video. */
  postType: string
  source: PostSource
  /**
   * Optional per-slot design variant. 'brand_tint' (Wed/Sat carousels): slides
   * washed in the brand color at ~0.85 opacity, centered text, corner logo —
   * see .plans/social-brand-tint-carousel.implementation-plan.md.
   * 'brand_tint_accent': same design in the ACCENT color — the no-voice
   * substitution look (.plans/non-elevenlabs-carousel-conversion...md). The
   * matrix is the single source of truth for WHERE these apply; downstream
   * code only reads the flag.
   */
  designVariant?: CarouselDesignVariant
  /**
   * Classic half-panel carousels only (azavea, user decision 2026-08-24):
   * a fresh themed AI background per slide (design variety) instead of the
   * shared single image, and NO diagram mode. Ignored by tinted/diagram slots.
   */
  perSlideBg?: boolean
  /** art_story slots: which beat of the article's story arc this slot posts. */
  beatIndex?: number
}

export type CarouselDesignVariant = 'brand_tint' | 'brand_tint_accent'

/** ISO weekday: 1 = Mon … 6 = Sat (Sun = 0 has no posts). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6

// P3 main-app rollout (user decisions 2026-09-08): every day = story-beat AM →
// midday visual anchor → story-beat PM, 2-beat mini-arc per content piece.
// Hours 9/12/17 (user choice). Article middays = KT loop-bait music video;
// newsletter middays = the EXISTING newsletter visual carousel (locked design —
// promotes the edition). No voiced post types: ElevenLabs dropped for clients.
export const DEFAULT_WEEKLY_SOCIAL_MATRIX: Record<Weekday, DaySlot[]> = {
  // Mon — newsletter
  1: [
    { hour: 9, postType: 'story_text', source: 'nl_story', beatIndex: 0 },
    { hour: 12, postType: 'carousel', source: 'nl_feature', designVariant: 'brand_tint' },
    { hour: 17, postType: 'story_text', source: 'nl_story', beatIndex: 1 },
  ],
  // Tue — article
  2: [
    { hour: 9, postType: 'story_text', source: 'art_story', beatIndex: 0 },
    { hour: 12, postType: 'kt_music_video', source: 'art_keytakeaways' },
    { hour: 17, postType: 'story_text', source: 'art_story', beatIndex: 1 },
  ],
  // Wed — newsletter
  3: [
    { hour: 9, postType: 'story_text', source: 'nl_story', beatIndex: 0 },
    { hour: 12, postType: 'carousel', source: 'nl_feature', designVariant: 'brand_tint' },
    { hour: 17, postType: 'story_text', source: 'nl_story', beatIndex: 1 },
  ],
  // Thu — article
  4: [
    { hour: 9, postType: 'story_text', source: 'art_story', beatIndex: 0 },
    { hour: 12, postType: 'kt_music_video', source: 'art_keytakeaways' },
    { hour: 17, postType: 'story_text', source: 'art_story', beatIndex: 1 },
  ],
  // Fri — newsletter
  5: [
    { hour: 9, postType: 'story_text', source: 'nl_story', beatIndex: 0 },
    { hour: 12, postType: 'carousel', source: 'nl_feature', designVariant: 'brand_tint' },
    { hour: 17, postType: 'story_text', source: 'nl_story', beatIndex: 1 },
  ],
  // Sat — newsletter
  6: [
    { hour: 9, postType: 'story_text', source: 'nl_story', beatIndex: 0 },
    { hour: 12, postType: 'carousel', source: 'nl_feature', designVariant: 'brand_tint' },
    { hour: 17, postType: 'story_text', source: 'nl_story', beatIndex: 1 },
  ],
}

const ARTICLE_SOURCES: ReadonlySet<PostSource> = new Set([
  'art_diagram_0',
  'art_diagram_1',
  'art_keytakeaways',
  'art_hook_diagram0',
  'art_hook_other',
  'art_hook_unused',
  'art_section_0',
  'art_section_1',
  'art_section_2',
  'art_section_3',
  'art_section_4',
  'art_story',
])

/** Parse an `art_section_N` source to its 0-based section index (null otherwise). */
export function sectionIndexOfSource(source: PostSource): number | null {
  const m = /^art_section_(\d)$/.exec(source)
  return m ? Number(m[1]) : null
}

/**
 * Azavea 6-day cadence: each MWF article gets a SECOND run the next day
 * (Tue/Thu/Sat) drawing on sections day 1 didn't use. Thursday's set with
 * the Key-Takeaways repeat swapped for a hook from an untouched section
 * (user decision 2026-08-07). Runs with slotVariant 'article_day2' use this
 * set regardless of weekday.
 */
export const ARTICLE_DAY2_SLOTS: DaySlot[] = [
  // Story-arc restructure (2026-09-03): morning/evening story beats around
  // the midday KT music-video anchor.
  { hour: 7, postType: 'story_text', source: 'art_story', beatIndex: 2 },
  { hour: 12, postType: 'kt_music_video', source: 'art_keytakeaways' },
  { hour: 19, postType: 'story_text', source: 'art_story', beatIndex: 3 },
]

/**
 * Azavea article DAY 1 (no-voice account, sections interleaved for
 * story-arc distance — user decision 2026-08-19): sections 1/3/5 as
 * diagram carousels with alternating tints. Day 2 covers KT + 2/4.
 */
export const AZAVEA_ARTICLE_DAY1_SLOTS: DaySlot[] = [
  // Story beats am/pm; ONE section carousel kept at midday for variety
  // (user decision 2026-09-03) — per-slide motif backgrounds.
  // Section 5 (index 4), NOT the opening: beat 0 retells the article's
  // opening scene, so a section-0 carousel duplicated it on the same day
  // (user 2026-09-07). Fewer sections → selector clamps to the last one.
  { hour: 7, postType: 'story_text', source: 'art_story', beatIndex: 0 },
  { hour: 12, postType: 'carousel', source: 'art_section_4', perSlideBg: true },
  { hour: 19, postType: 'story_text', source: 'art_story', beatIndex: 1 },
]

export function sourceKind(source: PostSource): SourceKind {
  return ARTICLE_SOURCES.has(source) ? 'article' : 'newsletter'
}

/** Default matrix day for off-cadence content (article → Tue, newsletter → Mon). */
export const DEFAULT_ARTICLE_WEEKDAY: Weekday = 2
export const DEFAULT_NEWSLETTER_WEEKDAY: Weekday = 1

// ── Story posts (9:16, IG + FB, one companion story per feed slot) ──
//
// The Content Publishing API can't add link stickers to stories, so stories
// promote the on-profile feed post (pitch types reuse the feed asset) or carry
// standalone content (quote / newsletter tips). See Phase 8 in the plan.

/** Story companion type for a feed slot. */
export type StoryType =
  | 'pitch_carousel' // promote the day's carousel feed post (reuses its asset)
  | 'pitch_hook' // promote the day's hook-video feed post (reuses its asset)
  | 'quote' // standalone quote story
  | 'tips_bullets' // newsletter days: static tips bullets over the overview cover

export interface StorySlot {
  /** S1/S2/S3 — parallel to the feed P1/P2/P3 it trails. */
  slotKey: string
  storyType: StoryType
  /** Feed slot hour this story trails (a small random offset is added at schedule time). */
  anchorHour: number
  /** Feed slotKey whose generated asset a pitch story reuses. */
  promotesFeedKey?: string
  /** Content source for pitch/quote resolution (mirrors the companion feed slot). */
  source?: PostSource
}

export interface FeedEntry {
  slotKey: string
  daySlot: DaySlot
}

/**
 * Derive the day's 3 companion story slots from its feed slots. Each feed post
 * gets exactly one story that posts shortly after it:
 *   - carousel  → pitch_carousel (reuses the carousel)
 *   - hook_video → pitch_hook (reuses the hook clip)
 *   - video_reel/quote → tips_bullets or quote (newsletter) / quote (article)
 */
export function storySlotsForDay(kind: SourceKind, feedEntries: FeedEntry[]): StorySlot[] {
  return feedEntries.map((fe, i) => {
    const slotKey = `S${i + 1}`
    const { postType, hour, source } = fe.daySlot
    if (postType === 'carousel' || postType === 'story_text') {
      // story_text (2026-09-03): the 9:16 story PITCHES the feed story post
      // (reuses its hook slide) — the old generic pull-quote had no relation
      // to the beat and read as nonsense.
      return { slotKey, storyType: 'pitch_carousel', anchorHour: hour, promotesFeedKey: fe.slotKey, source }
    }
    if (postType === 'hook_video') {
      return { slotKey, storyType: 'pitch_hook', anchorHour: hour, promotesFeedKey: fe.slotKey, source }
    }
    if (kind === 'newsletter') {
      // nl_overview (video_reel) → tips-bullets story; nl_tips (quote) → a
      // distinct quote story sourced from the feature (avoids duplicating tips).
      if (postType === 'video_reel') {
        return { slotKey, storyType: 'tips_bullets', anchorHour: hour, source: 'nl_tips' }
      }
      return { slotKey, storyType: 'quote', anchorHour: hour, source: 'nl_feature' }
    }
    // Article day: the remaining slot (video_reel/key-takeaways) → a pull-quote story.
    return { slotKey, storyType: 'quote', anchorHour: hour, source }
  })
}

/**
 * No-ElevenLabs substitution (.plans/non-elevenlabs-carousel-conversion.implementation-plan.md):
 * accounts without a working voice get NO video slots — every video post type
 * becomes an accent-tinted carousel from the SAME content source. Resolved per
 * run, so adding ElevenLabs later flips the slots back automatically. Story
 * derivation runs on the TRANSFORMED slots, so pitch_hook companions become
 * pitch_carousel with zero story-side special-casing.
 */
export function applyVoiceCapability(slots: DaySlot[], hasVoice: boolean): DaySlot[] {
  if (hasVoice) return slots
  return slots.map((s) =>
    s.postType === 'hook_video' || s.postType === 'video_reel'
      ? { ...s, postType: 'carousel', designVariant: 'brand_tint_accent' as const }
      : s,
  )
}

/** Resolve the slot list for a given source kind + ISO weekday, with sensible defaults. */
export function matrixForDay(kind: SourceKind, isoWeekday: number): DaySlot[] {
  const wd = (isoWeekday >= 1 && isoWeekday <= 6 ? isoWeekday : null) as Weekday | null
  const day = wd ?? (kind === 'article' ? DEFAULT_ARTICLE_WEEKDAY : DEFAULT_NEWSLETTER_WEEKDAY)
  const slots = DEFAULT_WEEKLY_SOCIAL_MATRIX[day]
  // If the weekday's matrix is for the wrong kind (e.g. article published on a
  // newsletter day), fall back to that kind's default day.
  const firstKind = slots[0] ? sourceKind(slots[0].source) : kind
  if (firstKind !== kind) {
    return DEFAULT_WEEKLY_SOCIAL_MATRIX[kind === 'article' ? DEFAULT_ARTICLE_WEEKDAY : DEFAULT_NEWSLETTER_WEEKDAY]
  }
  return slots
}
