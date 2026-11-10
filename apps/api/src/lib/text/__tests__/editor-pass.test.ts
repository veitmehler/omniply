import { describe, it, expect } from 'vitest'
import {
  classifyEditorIssue,
  stripGlyphs,
  hasPresence,
  repeatedOpenerIndexes,
  sectionsWithoutPresence,
  sentenceRewriteAcceptable,
  presenceRewriteAcceptable,
  runEditorPass,
  countEditorIssues,
} from '../editor-pass'

describe('classifyEditorIssue', () => {
  it('flags stock phrases, self-reference and tour-guide transitions', () => {
    for (const s of [
      "In today's fast-paced world, back pain is everywhere.",
      'This article will explore the three main causes.',
      "Let's dive into what the discs are doing overnight.",
      "It's worth noting that most episodes settle.",
      'Now, let\'s turn to the morning routine.',
      'Final thoughts on sitting.',
      'We leverage movement to restore glide.',
      'Imagine a sponge that has been squeezed all night.',
    ])
      expect(classifyEditorIssue(s), s).toBe('phrase')
  })
  it('flags citation metadata in prose', () => {
    for (const s of [
      'A 2019 study found that walking cut recurrence by a quarter.',
      'Researchers at Macquarie University tracked 300 office workers.',
      'Nachemson (1976) measured disc pressure in sitting.',
      'The finding was published in the Journal of Spinal Disorders.',
      'Smith and colleagues reported the same pattern.',
      'A recent systematic review concluded that heat helps early on.',
      'A six-month sit-stand desk intervention alleviated overall musculoskeletal discomfort in participants.',
      'The cohort reported less pain at baseline than expected.',
    ])
      expect(classifyEditorIssue(s), s).toBe('source')
  })
  it('leaves plain clinical prose and statistic periods alone', () => {
    for (const s of [
      'Discs rehydrate overnight, which is why you are taller in the morning.',
      'In 2023, about one in six Australians reported back problems.',
      'Walking programs cut recurrence by about a quarter.',
      'The AIHW puts the cost of back problems above three billion dollars a year.',
      'Most people who come in with this have been sitting for ten hours a day.',
      'I check how you get out of the chair before I look at anything else.',
    ])
      expect(classifyEditorIssue(s), s).toBeNull()
  })
})

describe('stripGlyphs', () => {
  it('removes text checkboxes and bullets at the start of blocks', () => {
    const r = stripGlyphs('<ul>\n<li>☐ Walk ten minutes</li>\n<li>✓ Stand every half hour</li>\n</ul>\n<p>• A plain line.</p>')
    expect(r.removed).toBe(3)
    expect(r.text).toBe('<ul>\n<li>Walk ten minutes</li>\n<li>Stand every half hour</li>\n</ul>\n<p>A plain line.</p>')
  })
})

describe('presence and openers', () => {
  const html =
    '<h2>Why it hurts after sitting</h2>\n<p>Most people feel this in the first minute of standing. The discs have been loaded for hours.</p>\n<p>I see this most in people who drive for a living, and I check the hips first.</p>\n' +
    '<h2>Why it eases with walking</h2>\n<p>Most people feel better within ten minutes of walking. Movement pumps fluid back into the disc.</p>\n<p>The joints at the back of the spine glide again. Stiffness lifts as the tissue warms.</p>\n' +
    '<h2>When to come in</h2>\n<p>Pain that wakes you at night is the sign that matters. Numbness that spreads is the other.</p>'

  it('detects first-person markers precisely', () => {
    expect(hasPresence('I check the hips first.')).toBe(true)
    expect(hasPresence("In my experience the hips matter.")).toBe(true)
    expect(hasPresence('We see this weekly.')).toBe(true)
    expect(hasPresence('The US guidance says otherwise. It is late.')).toBe(false)
  })
  it('finds sections without presence and consecutive repeated openers', () => {
    expect(sectionsWithoutPresence(html)).toEqual([1, 2])
    expect(repeatedOpenerIndexes(html)).toEqual([1])
  })
})

describe('guards', () => {
  it('sentence guard rejects rewrites that reintroduce a tell or add a number', () => {
    const orig = 'A 2019 study found that walking cut recurrence by a quarter.'
    expect(sentenceRewriteAcceptable(orig, 'Walking cut recurrence by about a quarter.')).toBe(true)
    expect(sentenceRewriteAcceptable(orig, 'Researchers in Oslo found walking cut recurrence by a quarter.')).toBe(false)
    expect(sentenceRewriteAcceptable(orig, 'Walking cut recurrence by 25 percent in 2019.')).toBe(false)
  })
  it('presence guard requires a first-person marker and bounded growth', () => {
    const orig = 'Movement pumps fluid back into the disc. The joints at the back of the spine glide again.'
    expect(presenceRewriteAcceptable(orig, 'Movement pumps fluid back into the disc, which is why I get people walking before anything else. The joints at the back of the spine glide again.')).toBe(true)
    expect(presenceRewriteAcceptable(orig, 'Movement pumps fluid back into the disc. The joints glide again.')).toBe(false)
    expect(presenceRewriteAcceptable(orig, "I don't have trial data on this, but movement pumps fluid back into the disc.")).toBe(false)
    expect(presenceRewriteAcceptable(orig, 'Movement pumps fluid back into the disc, like a sponge. I see it daily. <b>Glide</b> returns.')).toBe(false)
  })
})

describe('runEditorPass', () => {
  const sentences: Record<string, string> = {
    "Let's dive into what the discs are doing overnight.": 'Here is what the discs are doing overnight.',
    'A 2019 study found that walking cut recurrence by a quarter.': 'Walking cut recurrence by about a quarter.',
    'Most people feel better within ten minutes of walking.': 'Ten minutes of walking is usually enough to feel the difference.',
  }
  const fakeSentence = async (s: string) => ({ text: sentences[s] ?? s, cost: 0.001 })
  const fakeParagraph = async (p: string) => ({ text: `I tell every patient the same thing here: ${p.charAt(0).toLowerCase()}${p.slice(1)}`, cost: 0.002 })

  it('rewrites flagged sentences, repeated openers and silent sections, strips glyphs, keeps markup', async () => {
    const html =
      '<h2>Why it hurts after sitting</h2>\n<p>Let\'s dive into what the discs are doing overnight. <a href="https://x.test">Discs rehydrate overnight</a>, and the morning is when they are fullest.</p>\n<p>I see this most in people who drive for a living, and I check the hips first.</p>\n' +
      '<h2>Why it eases with walking</h2>\n<p>Most people feel better within ten minutes of walking. A 2019 study found that walking cut recurrence by a quarter.</p>\n<p>The joints at the back of the spine glide again and the stiffness lifts as the tissue warms through.</p>\n' +
      '<h2>Why it hurts after sitting again</h2>\n<p>Most people feel this in the first minute of standing after a long drive home.</p>\n<ul>\n<li>☐ Walk ten minutes before you sit down again</li>\n</ul>'
    const r = await runEditorPass(html, {}, { sentence: fakeSentence, paragraph: fakeParagraph })
    expect(r.glyphsRemoved).toBe(1)
    expect(r.phraseFlagged).toBe(1)
    expect(r.sourceFlagged).toBe(1)
    expect(r.rewritten).toBeGreaterThanOrEqual(2)
    expect(r.sectionsWithoutPresence).toBe(2)
    expect(r.presenceAdded).toBe(2)
    expect(r.text).toContain('Here is what the discs are doing overnight. <a href="https://x.test">Discs rehydrate overnight</a>')
    expect(r.text).toContain('Walking cut recurrence by about a quarter.')
    expect(r.text).toContain('I tell every patient the same thing here:')
    expect(r.text).toContain('<li>Walk ten minutes before you sit down again</li>')
    expect(r.text).not.toContain('2019')
    expect(countEditorIssues(r.text)).toMatchObject({ phrase: 0, source: 0, glyphs: 0, sectionsWithoutPresence: 0 })
  })

  it('keeps the text when the guard rejects a rewrite', async () => {
    const html = '<h2>Heading</h2>\n<p>A 2019 study found that walking cut recurrence by a quarter. I see it weekly.</p>'
    const r = await runEditorPass(html, {}, { sentence: async () => ({ text: 'Walking cut recurrence by 25 percent.', cost: 0 }), paragraph: fakeParagraph })
    expect(r.kept).toBe(1)
    expect(r.text).toBe(html)
    expect(r.changed).toBe(false)
  })
})
