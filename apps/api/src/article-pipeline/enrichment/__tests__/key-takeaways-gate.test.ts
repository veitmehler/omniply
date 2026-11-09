import { describe, it, expect } from 'vitest'
import { takeawayIssue, gateTakeaways, splitPoints } from '../key-takeaways-generator'

describe('takeawayIssue', () => {
  it('passes short, single-figure, source-free points', () => {
    for (const p of [
      'Walk before you sit down again; ten minutes is enough to reset the discs.',
      'Night pain that wakes you is the one sign I never wait on.',
      'About one in six adults carries a back problem at any time.',
    ])
      expect(takeawayIssue(p), p).toBeNull()
  })
  it('fails long points, two figures, years, source language and self-reference', () => {
    expect(takeawayIssue('This point runs on and on with far too many words to be remembered by anyone reading it quickly on a phone screen in the morning')).toMatch(/^long/)
    expect(takeawayIssue('Walking cut recurrence by 25 percent in 300 people.')).toMatch(/^numbers/)
    expect(takeawayIssue('Discs rehydrate overnight, as shown in 2019.')).toBe('year')
    expect(takeawayIssue('A review found that heat helps early.')).toBe('source language')
    expect(takeawayIssue('This article covers the three causes.')).toBe('article self-reference')
  })
})

describe('gateTakeaways', () => {
  it('drops failing bullets when three survive, keeps the list otherwise', () => {
    const html = '<ul>\n<li><b>Walk first</b>: ten minutes resets the discs.</li>\n<li>A 2019 study found walking helps.</li>\n<li>Night pain is the sign I never wait on.</li>\n<li>Sit less than an hour at a stretch.</li>\n</ul>'
    const r = gateTakeaways(html, false)
    expect(r.dropped).toHaveLength(1)
    expect(r.html).not.toContain('2019')
    expect(splitPoints(r.html, false)).toHaveLength(3)
    const thin = '<ul>\n<li>Walk first.</li>\n<li>A 2019 study found walking helps.</li>\n<li>Sit less.</li>\n</ul>'
    const r2 = gateTakeaways(thin, false)
    expect(r2.dropped).toHaveLength(0)
    expect(r2.issues).toEqual(['year'])
    expect(r2.html).toBe(thin)
  })
  it('handles the prose variant sentence by sentence', () => {
    const r = gateTakeaways('<p>Walk before you sit again. Researchers at Oslo tracked this. Night pain is the sign that matters.</p>', true)
    expect(r.html).toBe('<p>Walk before you sit again. Night pain is the sign that matters.</p>')
  })
})
