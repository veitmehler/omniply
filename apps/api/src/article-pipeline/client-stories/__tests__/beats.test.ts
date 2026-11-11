import { describe, it, expect } from 'vitest'
import { lintBeat, transcriptsFromStepData, beatHash } from '../beats'
import { pickStory, type StoryCandidate } from '../select'

describe('story bank — lint (the gate after the sanitizer)', () => {
  it('passes a sanitized first-person beat', () => {
    expect(
      lintBeat(
        'A client of mine, a Dominican athlete in his forties, came in with an HbA1c I believe was seven or higher. Within a couple of months of the food and lifestyle changes we worked through, it had come down below 5.5. That was his willpower; we gave him the map.',
      ).ok,
    ).toBe(true)
  })
  it('drops grey-zone substances, cure certainty, honorific names and exact ages', () => {
    expect(lintBeat('A client used peptides to recover from dengue and COVID at the same time and came back faster than anyone around her expected to see.').reason).toMatch(/peptides/)
    expect(lintBeat('Her fillings were the true cause of everything we had seen, and once they were out her energy came back within a few weeks of that.').reason).toMatch(/true cause/)
    expect(lintBeat('Dr Ramirez sent her to me after two hip replacements had not solved the fatigue, and we started with a full heavy-metals scan that week.').reason).toMatch(/named person/)
    expect(lintBeat('A 65-year-old woman with two hip replacements and a thyroid problem came in exhausted, and her heavy-metals scan pointed to mercury.').reason).toMatch(/exact age/)
    expect(lintBeat('Too short to be a story.').reason).toMatch(/short/)
    expect(lintBeat('I guarantee this works for everyone who walks through the door, and I tell every client exactly that on their first visit.').reason).toMatch(/guarantee/)
  })
  it('allows a negated guarantee (the sanitizer\'s own disclaimer)', () => {
    expect(
      lintBeat(
        'One person in our community caught dengue and COVID at the same time. They worked with a supervised protocol to support their immune system, and by their own account they bounced back faster than others around them. That is no guarantee for anyone else, but it stayed with me.',
      ).ok,
    ).toBe(true)
  })
})

describe('story bank — transcripts from an onboarding session', () => {
  it('reads every spoken answer and the writing sample, skipping empty ones', () => {
    const t = transcriptsFromStepData({
      q_declaration: { text: 'x'.repeat(50) },
      q_moments: { text: 'One client, a man in his 40s, came back with an HbA1c that was very high and decided to take matters into his own hands.' },
      q_proof: { text: '' },
      writing_sample: 'y'.repeat(60),
      offers: [{ name: 'not a transcript' }],
    })
    expect(t.map((x) => x.step)).toEqual(['q_declaration', 'q_moments', 'writing_sample'])
  })
  it('hashes the original excerpt independent of whitespace and case', () => {
    expect(beatHash('One  client, a man')).toBe(beatHash('one client, A MAN '))
  })
})

describe('story bank — one story per article', () => {
  const c = (over: Partial<StoryCandidate>): StoryCandidate => ({ id: 'x', storyText: 's', topicTags: [], kind: 'client_case', source: 'onboarding', lastUsedAt: null, useCount: 0, ...over })
  it('prefers the matching client case, then a matching owner moment, then any onboarding beat', () => {
    const cands = [
      c({ id: 'review-off-topic', source: 'review', topicTags: ['knee'] }),
      c({ id: 'moment', kind: 'owner_moment', topicTags: ['recovery'] }),
      c({ id: 'case', topicTags: ['recovery', 'sleep'] }),
    ]
    expect(pickStory(cands, 'Weekly recovery for busy people')!.id).toBe('case')
    expect(pickStory(cands.filter((x) => x.id !== 'case'), 'Weekly recovery for busy people')!.id).toBe('moment')
    expect(pickStory([c({ id: 'any-onboarding', topicTags: ['hbot'] }), c({ id: 'review', source: 'review', topicTags: ['knee'] })], 'Sports massage after training')!.id).toBe('any-onboarding')
    expect(pickStory([c({ id: 'review', source: 'review', topicTags: ['knee'] })], 'Sports massage after training')).toBe(null)
  })
  it('breaks ties toward the least-used story', () => {
    const cands = [c({ id: 'used', topicTags: ['recovery'], useCount: 3 }), c({ id: 'fresh', topicTags: ['recovery'], useCount: 0 })]
    expect(pickStory(cands, 'recovery')!.id).toBe('fresh')
  })
})
