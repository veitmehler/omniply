import { describe, it, expect } from 'vitest'
import { stripMetaCommentary, isMetaParagraph, fixSentenceSpacing } from '../meta-commentary'

describe('meta-commentary guard (social bench 2026-11-11)', () => {
  it('drops the model narrating its constraint and keeps the caption', () => {
    const raw =
      "The section text I was given is only the article title, so there's no scene, number, or client detail I can pull from without inventing it. Here is a caption built on what the title and brand voice actually support.\n\nMost people plan their training week down to the minute. Almost nobody plans the recovery that makes it work.\n\nIf you move a lot, there's a quiet question under the schedule: what does your week give back to your body?"
    const out = stripMetaCommentary(raw)
    expect(out.startsWith('Most people plan their training week')).toBe(true)
    expect(out).not.toMatch(/section text/i)
  })
  it('returns empty when only commentary came back', () => {
    expect(stripMetaCommentary("The brief you gave me has no body copy, so I can't write a hook without inventing facts.")).toBe('')
  })
  it('leaves ordinary captions alone, including ones that mention a brief in passing', () => {
    const cap = 'Your training plan is mapped to the minute. Your recovery plan is "I\'ll rest when I\'m tired."\n\nThe guide maps a week around sleep, stress and your nervous system first.'
    expect(stripMetaCommentary(cap)).toBe(cap)
    expect(isMetaParagraph('Sleep comes first. Then the tools.')).toBe(false)
  })
  it('repairs a missing space between sentences without touching decimals or domains', () => {
    expect(fixSentenceSpacing('moved her energy.Her heavy metals scan pointed to mercury.')).toBe('moved her energy. Her heavy metals scan pointed to mercury.')
    expect(fixSentenceSpacing('HbA1c of 5.5 and cabaretehealth.com')).toBe('HbA1c of 5.5 and cabaretehealth.com')
  })
})
