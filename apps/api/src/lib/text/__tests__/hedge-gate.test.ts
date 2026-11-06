import { describe, it, expect } from 'vitest'
import { classifyHedge, stripThinkingNoise, rewriteAcceptable, gateHedges, countHedges } from '../hedge-gate'

const B9_HEDGES = [
  "The studies don't agree on a single tidy number, and I'd rather tell you that than quote a neat percentage.",
  "I don't have trial data on mattresses and I won't pretend there's a winner.",
  "I don't have controlled data to hand that settles this, so this is practitioner observation.",
  "I can't give you a trial-backed ranking of whole body cryotherapy over a simple ice pack, so I won't.",
  "Decompression therapy and home inversion tables are areas where I don't have trial data to quote.",
  "Individual results vary, and I won't promise a timeline.",
  "I don't have evidence in front of me that they fix morning stiffness, so I won't claim they do.",
  "The honest answer is that it's usually mechanical.",
  "I can't cite a trial for that exact ratio.",
]

const BOUNDARIES = [
  "I won't hand out a number without examining you.",
  "I won't hand you a number before I've seen you move.",
  "That's why I'd rather examine you and watch how you move first, and keep imaging for later.",
]

describe('classifyHedge', () => {
  it('flags every narrated-evidence sentence from the B9 batch', () => {
    for (const s of B9_HEDGES) expect(classifyHedge(s), s).toBe('narrated')
  })
  it('classifies first-person clinical boundaries separately', () => {
    for (const s of BOUNDARIES) expect(classifyHedge(s), s).toBe('boundary')
  })
  it('leaves plain clinical prose alone', () => {
    for (const s of [
      'Ice usually wins in the first two days.',
      'Estimates range from 30 to 60 percent depending on the study.',
      'Rep counts depend on what the examination finds.',
      'In forty years of practice I have seen this weekly.',
      "Look, this is usually mechanical, and mechanical problems have mechanical answers.",
    ])
      expect(classifyHedge(s), s).toBeNull()
  })
})

describe('stripThinkingNoise', () => {
  it('deletes a sentence-initial Hmm and recapitalises', () => {
    const r = stripThinkingNoise('<p>Hmm, these thresholds are screening aids. They are not diagnoses.</p>')
    expect(r.text).toBe('<p>These thresholds are screening aids. They are not diagnoses.</p>')
    expect(r.removed).toBe(1)
  })
  it('handles Um and "Okay, so" mid-paragraph', () => {
    const r = stripThinkingNoise('<p>That is the plan. Um, it also helps to walk. Okay, so here is the routine.</p>')
    expect(r.text).toBe('<p>That is the plan. It also helps to walk. Here is the routine.</p>')
    expect(r.removed).toBe(2)
  })
  it('keeps Well and Look as openers', () => {
    const src = '<p>Well, that depends. Look, most of this is mechanical.</p>'
    expect(stripThinkingNoise(src)).toEqual({ text: src, removed: 0 })
  })
})

describe('rewriteAcceptable', () => {
  const orig = "I don't have trial data on mattresses and I won't pretend there's a winner."
  it('accepts a plain restatement and the delete token', () => {
    expect(rewriteAcceptable(orig, 'No mattress type has a clear edge in the research.')).toBe(true)
    expect(rewriteAcceptable(orig, '[DELETE]')).toBe(true)
  })
  it('rejects rewrites that still hedge, add numbers, add links, strengthen, or grow', () => {
    expect(rewriteAcceptable(orig, "I can't cite a trial, but medium-firm is best.")).toBe(false)
    expect(rewriteAcceptable(orig, 'Medium-firm mattresses help 68% of people.')).toBe(false)
    expect(rewriteAcceptable(orig, 'See https://example.com for mattress data.')).toBe(false)
    expect(rewriteAcceptable(orig, 'A medium-firm mattress is proven to fix it.')).toBe(false)
    expect(rewriteAcceptable(orig, 'No mattress type has a clear edge in the research, although medium firm tends to come out slightly ahead for most people in most of the trials.')).toBe(false)
    expect(rewriteAcceptable(orig, 'No mattress has an edge — none.')).toBe(false)
  })
})

describe('gateHedges', () => {
  const fake = (map: Record<string, string>) => async (sentence: string) => ({ text: map[sentence] ?? sentence, cost: 0.001 })

  it('rewrites narrated hedges, deletes empty ones, keeps one boundary line, preserves markup', async () => {
    const html =
      '<p>Ice beats heat early on. <a href="https://x.test">A 2024 review</a> agrees.</p>\n' +
      "<p>I don't have controlled data to hand that settles this, so this is practitioner observation. Most people do better with ice.</p>\n" +
      "<p>I won't hand out a number without examining you.</p>\n" +
      "<p>Individual results vary, and I won't promise a timeline.</p>\n" +
      "<p>I won't hand you a number before I've seen you move.</p>"
    const r = await gateHedges(
      html,
      {},
      fake({
        "I don't have controlled data to hand that settles this, so this is practitioner observation.": '[DELETE]',
        "Individual results vary, and I won't promise a timeline.": 'Individual results vary.',
        "I won't hand you a number before I've seen you move.": 'Rep counts depend on what the examination finds.',
      }),
    )
    expect(r.flagged).toBe(3)
    expect(r.deleted).toBe(1)
    expect(r.rewritten).toBe(2)
    expect(r.boundaryKept).toBe(1)
    expect(r.kept).toBe(0)
    expect(r.text).toContain('<a href="https://x.test">A 2024 review</a>')
    expect(r.text).toContain('<p>Most people do better with ice.</p>')
    expect(r.text).toContain("<p>I won't hand out a number without examining you.</p>")
    expect(r.text).toContain('<p>Individual results vary.</p>')
    expect(r.text).toContain('<p>Rep counts depend on what the examination finds.</p>')
    expect(r.text).not.toContain('practitioner observation')
    expect(countHedges(r.text)).toEqual({ narrated: 0, boundary: 1, noise: 0 })
  })

  it('removes a paragraph that a deletion empties', async () => {
    const html = "<p>First point.</p>\n<p>I can't cite a trial for that exact ratio.</p>\n<p>Last point.</p>"
    const r = await gateHedges(html, {}, fake({ "I can't cite a trial for that exact ratio.": '[DELETE]' }))
    expect(r.text).toBe('<p>First point.</p>\n<p>Last point.</p>')
    expect(r.deleted).toBe(1)
  })

  it('keeps the sentence when the guard rejects the rewrite', async () => {
    const html = "<p>I can't cite a trial for that exact ratio.</p>"
    const r = await gateHedges(html, {}, fake({ "I can't cite a trial for that exact ratio.": 'Trials show a 3.4 ratio.' }))
    expect(r.kept).toBe(1)
    expect(r.text).toBe(html)
    expect(r.changed).toBe(false)
  })

  it('strips thinking-noise even when nothing else is flagged', async () => {
    const r = await gateHedges('<p>Hmm, these thresholds are screening aids.</p>', {}, fake({}))
    expect(r.noiseRemoved).toBe(1)
    expect(r.text).toBe('<p>These thresholds are screening aids.</p>')
    expect(r.changed).toBe(true)
  })
})
