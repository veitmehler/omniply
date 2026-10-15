import { describe, it, expect } from 'vitest'
import {
  normalizeDashes,
  stripSafeDashes,
  stripResidualDashes,
  rewriteIsSafe,
  wordTokens,
  splitTagAffixes,
  parseSimpleInlineTags,
  rewrapInlineTags,
} from '../dash-sanitizer'

describe('normalizeDashes', () => {
  it('converts double hyphens to em-dashes', () => {
    expect(normalizeDashes('one--two')).toBe('one—two')
  })

  it('converts word-adjacent en-dashes but keeps digit ranges', () => {
    expect(normalizeDashes('pain–relief in 2–4 weeks')).toBe('pain—relief in 2–4 weeks')
  })

  it('leaves hyphenated compounds alone', () => {
    expect(normalizeDashes('well-being and long-term care')).toBe('well-being and long-term care')
  })
})

describe('stripSafeDashes', () => {
  it('converts a paired parenthetical em-dash to commas', () => {
    expect(stripSafeDashes('The spine—like any structure—needs balance.')).toBe(
      'The spine, like any structure, needs balance.',
    )
  })

  it('handles spaced paired dashes', () => {
    expect(stripSafeDashes('The spine — like any structure — needs balance.')).toBe(
      'The spine, like any structure, needs balance.',
    )
  })

  it('converts a dash before a coordinating conjunction to a comma', () => {
    expect(stripSafeDashes('Cold stiffens muscles—and that increases strain.')).toBe(
      'Cold stiffens muscles, and that increases strain.',
    )
  })

  it('leaves a lone non-conjunction dash for tier 2', () => {
    const out = stripSafeDashes('It was never the mattress—it was the alignment.')
    expect(out).toContain('—')
  })

  it('only pairs dashes within the same sentence', () => {
    const text = 'First has one—dash here. Second also has one—dash there.'
    const out = stripSafeDashes(text)
    // Neither is a pair within its sentence → both stay for tier 2.
    expect((out.match(/—/g) ?? []).length).toBe(2)
  })

  it('never touches dashes inside HTML tags or attributes', () => {
    const html = '<a href="https://x.com/a—b" data-x="1—2">link—text stays for tier 2</a>'
    const out = stripSafeDashes(html)
    expect(out).toContain('href="https://x.com/a—b"')
    expect(out).toContain('data-x="1—2"')
  })

  it('skips code and pre blocks entirely', () => {
    const html = '<pre>const x = a—b—c;</pre><p>The spine—like any structure—needs balance.</p>'
    const out = stripSafeDashes(html)
    expect(out).toContain('const x = a—b—c;')
    expect(out).toContain('The spine, like any structure, needs balance.')
  })

  it('normalizes double hyphens before fixing', () => {
    expect(stripSafeDashes('The spine--like any structure--needs balance.')).toBe(
      'The spine, like any structure, needs balance.',
    )
  })

  it('is idempotent on clean text', () => {
    const clean = 'A normal sentence, with commas, and 2–4 week ranges.'
    expect(stripSafeDashes(clean)).toBe(clean)
  })

  it('never pairs dashes across block boundaries (punctuation-less heading + paragraph)', () => {
    // Without block-boundary splitting these two lone dashes would fuse into one
    // span and get wrongly converted as a parenthetical pair.
    const html = '<h2>Winter tea—a guide</h2><p>Chamomile soothes—ginger warms</p>'
    const out = stripSafeDashes(html)
    expect((out.match(/—/g) ?? []).length).toBe(2)
  })

  it('still pairs dashes within one paragraph after a heading', () => {
    const html = '<h2>Title</h2><p>The spine—like any bridge—needs balance.</p>'
    expect(stripSafeDashes(html)).toBe('<h2>Title</h2><p>The spine, like any bridge, needs balance.</p>')
  })
})

describe('rewriteIsSafe (token-diff guard)', () => {
  const original = 'It was never the mattress—it was the alignment.'

  it('accepts a punctuation-only rewrite', () => {
    expect(rewriteIsSafe(original, 'It was never the mattress. It was the alignment.')).toBe(true)
  })

  it('accepts a rewrite with one allowlisted insertion', () => {
    expect(rewriteIsSafe(original, 'It was never the mattress, because it was the alignment.')).toBe(true)
  })

  it('rejects a rewrite that drops a word', () => {
    expect(rewriteIsSafe(original, 'It was never the mattress. The alignment.')).toBe(false)
  })

  it('rejects a rewrite that paraphrases', () => {
    expect(rewriteIsSafe(original, 'The mattress was never the problem; the alignment was.')).toBe(false)
  })

  it('rejects a rewrite introducing a non-allowlisted word', () => {
    expect(rewriteIsSafe(original, 'It was never the mattress, rather it was the alignment.')).toBe(false)
  })

  it('rejects a rewrite that still contains a dash', () => {
    expect(rewriteIsSafe(original, 'It was never the mattress—it was the alignment.')).toBe(false)
  })

  it('rejects more than two insertions even if allowlisted', () => {
    expect(rewriteIsSafe('a—b', 'a and but so b')).toBe(false)
  })
})

describe('splitTagAffixes', () => {
  it('peels a wrapping <p> tag so the core is tag-free', () => {
    const { lead, core, trail } = splitTagAffixes('<p>It was never the mattress—it was the alignment.')
    expect(lead).toBe('<p>')
    expect(core).toBe('It was never the mattress—it was the alignment.')
    expect(trail).toBe('')
  })

  it('peels trailing closing tags', () => {
    const { lead, core, trail } = splitTagAffixes('Final dash—sentence here.</p>')
    expect(lead).toBe('')
    expect(core).toBe('Final dash—sentence here.')
    expect(trail).toBe('</p>')
  })

  it('keeps inner markup in the core (so it still blocks the rewrite)', () => {
    const { core } = splitTagAffixes('<p>A <a href="x">link—here</a> stays.')
    expect(core).toContain('<a href="x">')
  })

  it('handles multiple leading tags and whitespace', () => {
    const { lead, core } = splitTagAffixes('\n<div><p> Text—body. ')
    expect(lead).toBe('\n<div><p> ')
    expect(core).toBe('Text—body.')
  })
})

describe('parseSimpleInlineTags', () => {
  it('extracts plain text and simple tag pairs with attributes', () => {
    const core = 'These <strong>Banana Oat Cookies</strong> combine oats—both are <a href="/x">sources</a> of melatonin.'
    const parsed = parseSimpleInlineTags(core)
    expect(parsed).not.toBeNull()
    expect(parsed!.plain).toBe('These Banana Oat Cookies combine oats—both are sources of melatonin.')
    expect(parsed!.spans).toEqual([
      { open: '<strong>', close: '</strong>', innerText: 'Banana Oat Cookies' },
      { open: '<a href="/x">', close: '</a>', innerText: 'sources' },
    ])
  })

  it('returns null for nested tags', () => {
    expect(parseSimpleInlineTags('a <strong>b <em>c</em></strong> d—e.')).toBeNull()
  })

  it('returns null for void tags', () => {
    expect(parseSimpleInlineTags('line one—line two<br>rest.')).toBeNull()
  })

  it('returns null for a stray closing tag', () => {
    expect(parseSimpleInlineTags('dangling</a> text—here.')).toBeNull()
  })

  it('handles a tag-free sentence', () => {
    const parsed = parseSimpleInlineTags('no tags—at all.')
    expect(parsed!.plain).toBe('no tags—at all.')
    expect(parsed!.spans).toEqual([])
  })
})

describe('rewrapInlineTags', () => {
  const spans = [
    { open: '<strong>', close: '</strong>', innerText: 'Banana Oat Cookies' },
    { open: '<a href="/x">', close: '</a>', innerText: 'sources' },
  ]

  it('re-wraps tags around their preserved text in the rewrite', () => {
    const rewrite = 'These Banana Oat Cookies combine oats; both are sources of melatonin.'
    expect(rewrapInlineTags(rewrite, spans)).toBe(
      'These <strong>Banana Oat Cookies</strong> combine oats; both are <a href="/x">sources</a> of melatonin.',
    )
  })

  it('returns null when a tagged phrase was altered by the rewrite', () => {
    const rewrite = 'These Banana Oat, Cookies combine oats; both are sources of melatonin.'
    expect(rewrapInlineTags(rewrite, spans)).toBeNull()
  })

  it('respects original order for repeated phrases', () => {
    const twice = [
      { open: '<em>', close: '</em>', innerText: 'sleep' },
      { open: '<strong>', close: '</strong>', innerText: 'sleep' },
    ]
    const out = rewrapInlineTags('sleep now, then sleep again.', twice)
    expect(out).toBe('<em>sleep</em> now, then <strong>sleep</strong> again.')
  })
})

describe('wordTokens', () => {
  it('lowercases and strips punctuation, keeping apostrophes', () => {
    expect(wordTokens("It's the spine—not the mattress!")).toEqual(["it's", 'the', 'spine', 'not', 'the', 'mattress'])
  })
})

describe('stripResidualDashes (tier 3)', () => {
  it('replaces the unspaced word-adjacent tell with ", "', () => {
    expect(stripResidualDashes('$189 per patient—three times more patients')).toBe(
      '$189 per patient, three times more patients',
    )
  })

  it('replaces spaced word-adjacent dashes', () => {
    expect(stripResidualDashes('the data — not the vibe — decides')).toBe('the data, not the vibe, decides')
  })

  it('converts digit ranges to a tight en-dash, spaced or not', () => {
    expect(stripResidualDashes('open 30—45 days ahead')).toBe('open 30–45 days ahead')
    expect(stripResidualDashes('open 30 — 45 days ahead')).toBe('open 30–45 days ahead')
  })

  it('keeps a standalone divider line', () => {
    expect(stripResidualDashes('end of thought.\n\n—\n\n## Next Section')).toBe(
      'end of thought.\n\n—\n\n## Next Section',
    )
  })

  it('keeps a dash introducing a URL (reference lists)', () => {
    expect(stripResidualDashes('1. Some Study — https://example.com/paper')).toBe(
      '1. Some Study — https://example.com/paper',
    )
  })

  it('never touches dashes inside tags or code blocks', () => {
    expect(stripResidualDashes('<a href="https://x.com/a—b">link</a> word—word')).toBe(
      '<a href="https://x.com/a—b">link</a> word, word',
    )
    expect(stripResidualDashes('<code>a—b</code> stays, text—tell goes')).toBe(
      '<code>a—b</code> stays, text, tell goes',
    )
  })

  it('leaves dash-free text untouched', () => {
    const s = 'plain text with a hyphen-word and a range 2–4'
    expect(stripResidualDashes(s)).toBe(s)
  })
})
