import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WEEKLY_SOCIAL_MATRIX,
  matrixForDay,
  sourceKind,
  type Weekday,
} from '../weekly-matrix'

const ARTICLE_DAYS: Weekday[] = [2, 4]
const NEWSLETTER_DAYS: Weekday[] = [1, 3, 5, 6]

describe('DEFAULT_WEEKLY_SOCIAL_MATRIX', () => {
  it('has exactly 3 slots per day at 9/12/17 (P3 story rhythm)', () => {
    for (const day of [1, 2, 3, 4, 5, 6] as Weekday[]) {
      const slots = DEFAULT_WEEKLY_SOCIAL_MATRIX[day]
      expect(slots).toHaveLength(3)
      expect(slots.map((s) => s.hour)).toEqual([9, 12, 17])
    }
  })

  it('article days use only article sources; newsletter days only newsletter sources', () => {
    for (const day of ARTICLE_DAYS) {
      for (const slot of DEFAULT_WEEKLY_SOCIAL_MATRIX[day]) expect(sourceKind(slot.source)).toBe('article')
    }
    for (const day of NEWSLETTER_DAYS) {
      for (const slot of DEFAULT_WEEKLY_SOCIAL_MATRIX[day]) expect(sourceKind(slot.source)).toBe('newsletter')
    }
  })

  it('Tue/Thu = story beats around the KT music-video anchor (P3)', () => {
    for (const day of [2, 4] as const) {
      expect(DEFAULT_WEEKLY_SOCIAL_MATRIX[day].map((s) => [s.postType, s.source])).toEqual([
        ['story_text', 'art_story'],
        ['kt_music_video', 'art_keytakeaways'],
        ['story_text', 'art_story'],
      ])
      expect(DEFAULT_WEEKLY_SOCIAL_MATRIX[day].map((s) => s.beatIndex)).toEqual([0, undefined, 1])
    }
  })

  it('newsletter days = nl story beats around the brand-tint feature carousel (P3)', () => {
    for (const day of [1, 3, 5, 6] as const) {
      expect(DEFAULT_WEEKLY_SOCIAL_MATRIX[day].map((s) => [s.postType, s.source])).toEqual([
        ['story_text', 'nl_story'],
        ['carousel', 'nl_feature'],
        ['story_text', 'nl_story'],
      ])
      expect(DEFAULT_WEEKLY_SOCIAL_MATRIX[day][1].designVariant).toBe('brand_tint')
      expect(DEFAULT_WEEKLY_SOCIAL_MATRIX[day].map((s) => s.beatIndex)).toEqual([0, undefined, 1])
    }
  })
})

describe('matrixForDay', () => {
  it('returns the weekday matrix for in-cadence content', () => {
    expect(matrixForDay('article', 2)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[2])
    expect(matrixForDay('newsletter', 1)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[1])
  })

  it('falls back to the default day for off-cadence content', () => {
    // article published on Sunday (0/7) → default article day (Tue)
    expect(matrixForDay('article', 7)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[2])
    // newsletter on Sunday → default newsletter day (Mon)
    expect(matrixForDay('newsletter', 0)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[1])
    // article landing on a newsletter weekday (Mon) → falls back to Tue
    expect(matrixForDay('article', 1)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[2])
    // newsletter landing on an article weekday (Tue) → falls back to Mon
    expect(matrixForDay('newsletter', 2)).toBe(DEFAULT_WEEKLY_SOCIAL_MATRIX[1])
  })
})

describe('ARTICLE_DAY2_SLOTS (azavea 6-day cadence)', () => {
  it('day 2 = story beats am/pm around the KT music-video anchor', async () => {
    const { ARTICLE_DAY2_SLOTS, sourceKind, applyVoiceCapability } = await import('../weekly-matrix')
    expect(ARTICLE_DAY2_SLOTS.map((s) => [s.hour, s.postType, s.source])).toEqual([
      [7, 'story_text', 'art_story'],
      [12, 'kt_music_video', 'art_keytakeaways'],
      [19, 'story_text', 'art_story'],
    ])
    expect(ARTICLE_DAY2_SLOTS.map((s) => s.beatIndex)).toEqual([2, undefined, 3])
    // story_text and kt_music_video are voiceless by design — never substituted.
    const noVoice = applyVoiceCapability(ARTICLE_DAY2_SLOTS, false)
    expect(noVoice.map((s) => s.postType)).toEqual(['story_text', 'kt_music_video', 'story_text'])
    for (const s of ARTICLE_DAY2_SLOTS) expect(sourceKind(s.source)).toBe('article')
  })

  it('azavea day 1 = story beats am/pm around ONE section carousel (variety)', async () => {
    const { AZAVEA_ARTICLE_DAY1_SLOTS, sourceKind } = await import('../weekly-matrix')
    expect(AZAVEA_ARTICLE_DAY1_SLOTS.map((s) => [s.hour, s.postType, s.source])).toEqual([
      [7, 'story_text', 'art_story'],
      [12, 'carousel', 'art_section_4'],
      [19, 'story_text', 'art_story'],
    ])
    expect(AZAVEA_ARTICLE_DAY1_SLOTS.map((s) => s.beatIndex)).toEqual([0, undefined, 1])
    expect(AZAVEA_ARTICLE_DAY1_SLOTS[1].perSlideBg).toBe(true)
    for (const s of AZAVEA_ARTICLE_DAY1_SLOTS) expect(sourceKind(s.source)).toBe('article')
  })

  it('sectionIndexOfSource parses hard-bound sources and rejects others', async () => {
    const { sectionIndexOfSource } = await import('../weekly-matrix')
    expect(sectionIndexOfSource('art_section_0')).toBe(0)
    expect(sectionIndexOfSource('art_section_4')).toBe(4)
    expect(sectionIndexOfSource('art_keytakeaways')).toBeNull()
    expect(sectionIndexOfSource('nl_feature')).toBeNull()
  })
})
