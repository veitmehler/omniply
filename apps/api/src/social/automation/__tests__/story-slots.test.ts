import { describe, it, expect } from 'vitest'
import { matrixForDay, storySlotsForDay, type FeedEntry } from '../weekly-matrix'
import { storyOffsetMinutes } from '../story-processor'

function feedEntries(kind: 'article' | 'newsletter', isoWeekday: number): FeedEntry[] {
  return matrixForDay(kind, isoWeekday).map((daySlot, i) => ({ slotKey: `P${i + 1}`, daySlot }))
}

describe('storySlotsForDay — article days (P3 story shape)', () => {
  it('Tue/Thu: pitch_carousels promote the story beats, KT anchor gets a quote story', () => {
    for (const day of [2, 4]) {
      const stories = storySlotsForDay('article', feedEntries('article', day))
      // Feed: P1 story_text(b0), P2 kt_music_video(KT), P3 story_text(b1).
      expect(stories.map((s) => s.storyType)).toEqual(['pitch_carousel', 'quote', 'pitch_carousel'])
      expect(stories[0].promotesFeedKey).toBe('P1')
      expect(stories[2].promotesFeedKey).toBe('P3')
      expect(stories[1].source).toBe('art_keytakeaways')
    }
  })

  it('every story keeps 3 slots keyed S1/S2/S3 in feed order', () => {
    const stories = storySlotsForDay('article', feedEntries('article', 2))
    expect(stories.map((s) => s.slotKey)).toEqual(['S1', 'S2', 'S3'])
  })
})

describe('storySlotsForDay — newsletter days (P3 story shape)', () => {
  it('all four days: pitch_carousels promote beats + the feature carousel', () => {
    for (const day of [1, 3, 5, 6]) {
      const stories = storySlotsForDay('newsletter', feedEntries('newsletter', day))
      // Feed: P1 story_text(nl b0), P2 carousel(nl_feature), P3 story_text(nl b1).
      expect(stories.map((s) => s.storyType)).toEqual(['pitch_carousel', 'pitch_carousel', 'pitch_carousel'])
      expect(stories.map((s) => s.promotesFeedKey)).toEqual(['P1', 'P2', 'P3'])
    }
  })
})

describe('storyOffsetMinutes', () => {
  it('always returns a 2–8 minute offset', () => {
    for (let i = 0; i < 200; i++) {
      const m = storyOffsetMinutes()
      expect(m).toBeGreaterThanOrEqual(2)
      expect(m).toBeLessThanOrEqual(8)
    }
  })
})
