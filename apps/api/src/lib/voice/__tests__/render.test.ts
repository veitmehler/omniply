import { describe, it, expect } from 'vitest'
import { assembleProfile, type AuthorMaterial } from '../profile'
import { authorLimits, authorSays, clip, DEFAULT_LIMITS, isFragments, ownWordsForWriter, proseMeasure, renderAuthorVoice, renderAuthorVoiceShort } from '../render'

const prose = (n: number) => Array.from({ length: n }, (_, i) => `I tell every person who walks in that rest is the work, and I mean it on day ${i + 1}. Do you believe me? Well, most of them do not at first!`).join(' ')
const outline = Array.from({ length: 40 }, (_, i) => `Point ${i + 1}. Pause here. Then go on. Seven. Not one.`).join(' ')
const caseStory = 'One client, a runner in his forties, came in sure he needed surgery. I sat with him for an hour and we looked at how he slept. Three weeks later he ran again.'
const ownStory = 'My grandmother never rested a day in her life, and she told me so every single morning over a cup of very strong tea.'

const material: AuthorMaterial = {
  author: { name: 'Ana Ruiz', practice: 'Tide Clinic', industry: 'Wellness', location: 'Lisbon, Portugal' },
  brand: {},
  answers: { q_line: prose(6), q_moments: `${caseStory} ${ownStory} That was a good day for all of us at the clinic and I still think of it.` },
  sample: { text: outline },
}
const raw = JSON.stringify({
  role: 'Founder',
  beliefs: [{ kind: 'stands_for', quote: 'rest is the work', topics: ['rest'] }, { kind: 'stands_for', quote: 'I tell every person who walks in that rest is the work', topics: ['rest'] }],
  stories: [
    { kind: 'client', starts: 'One client, a runner in his forties, came', ends: 'Three weeks later he ran again', topics: ['running'] },
    { kind: 'own', starts: 'My grandmother never rested a day in', ends: 'a cup of very strong tea', topics: ['rest'] },
  ],
  habits: [{ habit: 'Asks the reader a direct question', example: 'Do you believe me?', where: 'anywhere', seen: 6 }],
  phrases: ['rest is the work'],
  reader: 'Straight to "you".',
})
const p = assembleProfile(material, raw)

describe('what the writer is shown', () => {
  it('cuts a client case out of the author\'s words and keeps their own story', () => {
    const words = ownWordsForWriter(p).map((w) => w.text).join(' ')
    expect(words).not.toContain('a runner in his forties')
    expect(words).toContain('My grandmother never rested')
    const full = renderAuthorVoice(p)
    expect(full).not.toContain('a runner in his forties')
    expect(full).toContain('## Stories of your own')
    expect(full).toContain('My grandmother never rested')
  })
  it('leads with who the author is, then beliefs, then their own words, then habits', () => {
    const full = renderAuthorVoice(p)
    const order = ['## Who you are', '## What you believe', '## Stories of your own', '## Your own words', '## Your habits'].map((h) => full.indexOf(h))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(full).toContain('You are Ana Ruiz, Founder, at Tide Clinic in Lisbon, Portugal.')
    expect(full).toContain('Asked: What do you refuse to compromise on')
  })
  it('says "we" for treatment when the account does not say what the author does', () => {
    expect(renderAuthorVoice(p)).toContain('Write "we" for assessment and treatment.')
    const stated = assembleProfile({ ...material, ownWork: 'I do the consultations. Joao does the massage.' }, raw)
    const full = renderAuthorVoice(stated)
    expect(full).toContain('I do the consultations. Joao does the massage.')
    expect(full).toContain('Write "I" only for work this says is yours.')
  })
  it('keeps the own words inside a budget by cutting the written piece, never the answers', () => {
    const long = Array.from({ length: 120 }, (_, i) => `Point ${i + 1}. Pause here. Then go on. Seven. Not one.`).join(' ')
    const big = assembleProfile({ ...material, sample: { text: long } }, raw)
    const small = renderAuthorVoice(big, { maxOwnWords: 300 })
    expect(small).toContain('on day 6')
    expect(small).toContain('Point 1.')
    expect(small).not.toContain('Point 120.')
  })
  it('never shows the answer about a favourite patient, and uses the job title on the account', () => {
    const withTribe = assembleProfile({ ...material, author: { ...material.author, jobTitle: 'Founder & Consultant' }, answers: { ...material.answers, q_tribe: 'My favourite patient is Audrey. She is a real estate agent in her fifties and she kites every single morning before work.' } }, raw)
    const full = renderAuthorVoice(withTribe)
    expect(full).not.toContain('Audrey')
    expect(renderAuthorVoiceShort(withTribe)).not.toContain('Audrey')
    expect(full).toContain('You are Ana Ruiz, Founder & Consultant, at Tide Clinic')
  })
  it('has a short form for sentence repairs', () => {
    const short = renderAuthorVoiceShort(p)
    expect(short.split(/\s+/).length).toBeLessThan(420)
    expect(short).toContain('You are Ana Ruiz')
    expect(short).toContain('How you sound, in your own words:')
    expect(short).not.toContain('a runner in his forties')
  })
})

describe('measurements and limits', () => {
  it('takes the running prose, not the outline, as the measure of the author', () => {
    expect(isFragments(p)).toBe(true)
    expect(proseMeasure(p)).toBe(p.manner.measured.answers)
    expect(renderAuthorVoice(p)).toContain('It is in notes and fragments')
  })
  it('raises a limit for an author who has the habit and leaves the default for one who has not', () => {
    const lim = authorLimits(p)
    expect(lim.questionShare).toBeGreaterThan(0.3)
    expect(lim.exclaimShare).toBeGreaterThan(0.3)
    const plain = assembleProfile({ ...material, answers: { q_line: Array(12).fill('The body heals in its own time and nobody can hurry it along.').join(' ') }, sample: null }, '{}')
    expect(authorLimits(plain)).toEqual(DEFAULT_LIMITS)
  })
  it('knows what the author says themselves', () => {
    expect(authorSays(p)).toContain('rest is the work')
    expect(authorSays(p)).not.toContain('bottom line')
  })
  it('clips at a sentence end', () => {
    expect(clip('One two three. Four five six. Seven eight nine.', 6)).toBe('One two three. Four five six.')
  })
})
