import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WEEKLY_SOCIAL_MATRIX,
  applyVoiceCapability,
  matrixForDay,
  storySlotsForDay,
  type DaySlot,
  type FeedEntry,
} from '../weekly-matrix'

function entries(slots: DaySlot[]): FeedEntry[] {
  return slots.map((daySlot, i) => ({ slotKey: `P${i + 1}`, daySlot }))
}

// P3 (2026-09-08): the default matrix carries no voiced post types anymore
// (ElevenLabs dropped for clients). applyVoiceCapability stays as dormant
// safety for any legacy/custom slot set that still contains video types.
describe('applyVoiceCapability (dormant safety)', () => {
  it('voice accounts keep the slots untouched (same reference)', () => {
    const slots = matrixForDay('article', 2)
    expect(applyVoiceCapability(slots, true)).toBe(slots)
  })

  it('still converts voiced types to accent carousels for synthetic legacy slots', () => {
    const legacy: DaySlot[] = [
      { hour: 9, postType: 'hook_video', source: 'art_section_0' },
      { hour: 12, postType: 'video_reel', source: 'art_keytakeaways' },
      { hour: 15, postType: 'quote', source: 'nl_tips' },
    ]
    const converted = applyVoiceCapability(legacy, false)
    expect(converted.map((s) => s.postType)).toEqual(['carousel', 'carousel', 'quote'])
    expect(converted[0]).toMatchObject({ designVariant: 'brand_tint_accent', source: 'art_section_0', hour: 9 })
    expect(converted[2].designVariant).toBeUndefined()
  })

  it('the P3 default matrix is voice-invariant: no-voice conversion changes nothing', () => {
    for (const day of Object.values(DEFAULT_WEEKLY_SOCIAL_MATRIX)) {
      const converted = applyVoiceCapability(day, false)
      expect(converted.map((s) => [s.postType, s.source, s.hour, s.designVariant])).toEqual(
        day.map((s) => [s.postType, s.source, s.hour, s.designVariant]),
      )
      expect(converted.some((s) => s.postType === 'hook_video' || s.postType === 'video_reel')).toBe(false)
    }
  })

  it('companion stories for legacy hook slots still swap pitch_hook → pitch_carousel', () => {
    const legacy: DaySlot[] = [{ hour: 9, postType: 'hook_video', source: 'art_section_0' }]
    const before = storySlotsForDay('article', entries(legacy))
    expect(before[0].storyType).toBe('pitch_hook')
    const after = storySlotsForDay('article', entries(applyVoiceCapability(legacy, false)))
    expect(after[0].storyType).toBe('pitch_carousel')
    expect(after[0].promotesFeedKey).toBe('P1')
  })
})
