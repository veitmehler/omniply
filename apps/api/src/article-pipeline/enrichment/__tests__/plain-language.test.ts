import { describe, it, expect } from 'vitest'
import {
  PL_BOX_LABELS,
  rotatedLabel,
  sentenceEndAfterTerm,
  spliceGloss,
  buildBoxHtml,
  buildBoxMarker,
  insertBoxAfterAnchor,
  seededRng,
  pickStoryOpener,
  pickGlossOpener,
  lexicalGateReason,
  vehicleReuseReason,
  OPENER_THINK_OF,
  OPENER_WEAVE,
  OPENER_PLAIN,
  OPENER_SCENE,
} from '../plain-language'

describe('pickStoryOpener', () => {
  it('rations the think-of scaffold to at most one per article', () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = seededRng(`job-${seed}`)
      const state = { thinkOfUsed: false }
      const draws = Array.from({ length: 12 }, () => pickStoryOpener(rng, state))
      expect(draws.filter((d) => d === OPENER_THINK_OF).length).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic per seed and varies styles across many draws', () => {
    const a = seededRng('stable'), b = seededRng('stable')
    const sa = { thinkOfUsed: false }, sb = { thinkOfUsed: false }
    for (let i = 0; i < 8; i++) expect(pickStoryOpener(a, sa)).toBe(pickStoryOpener(b, sb))
    const rng = seededRng('variety')
    const state = { thinkOfUsed: false }
    const styles = new Set(Array.from({ length: 30 }, () => pickStoryOpener(rng, state)))
    expect(styles.size).toBeGreaterThanOrEqual(3)
  })

  it('gloss openers only use weave/plain', () => {
    const rng = seededRng('gloss')
    for (let i = 0; i < 20; i++) {
      expect([OPENER_WEAVE, OPENER_PLAIN]).toContain(pickGlossOpener(rng))
    }
  })
})

describe('vehicleReuseReason', () => {
  it('rejects a registered vehicle on word boundary, case-insensitive', () => {
    expect(vehicleReuseReason('Your discs behave like a Sponge left on the sink.', ['sponge', 'honey'])).toMatch(/sponge/)
    expect(vehicleReuseReason('Stir a jar of honey on a cold morning.', ['sponge', 'honey'])).toMatch(/honey/)
    expect(vehicleReuseReason('It works like a rusty gate hinge.', ['rusty gate'])).toBeTruthy()
  })

  it('matches plural/inflected forms via prefix but not unrelated words', () => {
    expect(vehicleReuseReason('Two sponges side by side.', ['sponge'])).toBeTruthy()
    expect(vehicleReuseReason('The response was immediate.', ['sponge'])).toBeNull()
    expect(vehicleReuseReason('A completely fresh image here.', ['honey', 'garden hose'])).toBeNull()
  })

  it('ignores empty and too-short vehicles', () => {
    expect(vehicleReuseReason('anything at all', ['', 'a', 'of'])).toBeNull()
  })
})

describe('lexicalGateReason', () => {
  it('rejects outside-the-byline stance leaks', () => {
    expect(lexicalGateReason('Your discs behave like sponges, and the article notes that load shifts.', true)).toMatch(/the article/)
    expect(lexicalGateReason('The article describes this as down-regulating.', true)).toBeTruthy()
    expect(lexicalGateReason('This passage calls it time-sensitive.', true)).toBeTruthy()
    expect(lexicalGateReason('As mentioned above, discs rehydrate overnight.', true)).toBeTruthy()
  })

  it('rejects banned scaffold openers unless allowed', () => {
    expect(lexicalGateReason('Think of a dry sponge left on the sink.', false)).toMatch(/OPENER STYLE/)
    expect(lexicalGateReason('  Picture a garden hose with a kink.', false)).toBeTruthy()
    expect(lexicalGateReason('Think of a dry sponge left on the sink.', true)).toBeNull()
  })

  it('passes normal first-person prose, including mid-sentence imagery', () => {
    expect(lexicalGateReason('Your discs work like sponges: squeeze them all day and they stiffen.', false)).toBeNull()
    expect(lexicalGateReason('I tell my clients to think of it as a hinge that needs oil.', false)).toBeNull()
    expect(lexicalGateReason(OPENER_SCENE.length > 0 ? 'A kettle left on the bench cools slowly; muscle warms the same way.' : '', false)).toBeNull()
  })
})

describe('rotatedLabel', () => {
  it('is stable for the same seed', () => {
    expect(rotatedLabel('page1:3')).toBe(rotatedLabel('page1:3'))
  })

  it('returns a known label', () => {
    expect(PL_BOX_LABELS).toContain(rotatedLabel('anything'))
  })

  it('varies across seeds (at least two distinct labels over a spread)', () => {
    const labels = new Set(Array.from({ length: 20 }, (_, i) => rotatedLabel(`seed-${i}`)))
    expect(labels.size).toBeGreaterThan(1)
  })
})

describe('sentenceEndAfterTerm', () => {
  it('finds the period ending the sentence containing the term', () => {
    const p = 'A subluxation changes joint motion. The next sentence is here.'
    const end = sentenceEndAfterTerm(p, 'subluxation')
    expect(p.slice(0, end)).toBe('A subluxation changes joint motion.')
  })

  it('skips periods inside tags', () => {
    const p = 'A <a href="https://x.com/a.b">subluxation</a> changes motion. Next.'
    const end = sentenceEndAfterTerm(p, 'subluxation')
    expect(p.slice(0, end)).toBe('A <a href="https://x.com/a.b">subluxation</a> changes motion.')
  })

  it('is case-insensitive on the term', () => {
    const p = 'Subluxation is a term. More text.'
    expect(sentenceEndAfterTerm(p, 'subluxation')).toBe('Subluxation is a term.'.length)
  })

  it('returns -1 when the term is absent', () => {
    expect(sentenceEndAfterTerm('No jargon here.', 'subluxation')).toBe(-1)
  })

  it('returns -1 when no sentence end follows', () => {
    expect(sentenceEndAfterTerm('trailing subluxation without punctuation', 'subluxation')).toBe(-1)
  })
})

describe('spliceGloss', () => {
  it('inserts the gloss right after the sentence containing the term', () => {
    const html = '<h2>Heading</h2><p>A subluxation changes joint motion. More detail follows.</p>'
    const out = spliceGloss(html, 'subluxation', 'Think of a kinked garden hose.')
    expect(out).toContain(
      'motion.<span class="plain-gloss"> Think of a kinked garden hose.</span> More detail',
    )
  })

  it('never touches headings even when the term appears there', () => {
    const html = '<h2>What is a subluxation?</h2><p>Unrelated paragraph text here.</p>'
    const out = spliceGloss(html, 'subluxation', 'gloss')
    expect(out).toBeNull() // term only in heading → no paragraph anchor → null
  })

  it('escapes HTML in the gloss text', () => {
    const html = '<p>A subluxation changes motion. End.</p>'
    const out = spliceGloss(html, 'subluxation', 'a <b>bold</b> claim & more')
    expect(out).toContain('a &lt;b&gt;bold&lt;/b&gt; claim &amp; more')
  })

  it('falls back to a standalone paragraph when the term is split by markup', () => {
    // term visible in stripped text but not contiguous in raw HTML
    const html = '<p>The sub<strong>luxation</strong> shifted, and there is no clean match</p>'
    const out = spliceGloss(html, 'subluxation', 'plain words')
    expect(out).toContain('</p>\n<p class="plain-gloss">plain words</p>')
  })

  it('returns null when no paragraph contains the term', () => {
    expect(spliceGloss('<p>Nothing relevant.</p>', 'subluxation', 'x')).toBeNull()
  })
})

describe('insertBoxAfterAnchor', () => {
  const box = '\n<div class="plain-language-box">BOX</div>\n'

  it('inserts after the paragraph containing the anchor quote', () => {
    const html = '<p>First para.</p><p>The vagus nerve carries signals to organs.</p><p>Third.</p>'
    const out = insertBoxAfterAnchor(html, 'vagus nerve carries signals', box)
    expect(out).toBe(`<p>First para.</p><p>The vagus nerve carries signals to organs.</p>${box}<p>Third.</p>`)
  })

  it('matches the anchor case-insensitively with normalized whitespace', () => {
    const html = '<p>The  Vagus   Nerve carries signals.</p><p>Next.</p>'
    const out = insertBoxAfterAnchor(html, 'vagus nerve carries', box)
    expect(out?.indexOf(box)).toBeGreaterThan(0)
    expect(out?.indexOf(box)).toBeLessThan(out!.indexOf('<p>Next.</p>'))
  })

  it('falls back to the first paragraph when the quote is not found', () => {
    const html = '<p>First.</p><p>Second.</p>'
    const out = insertBoxAfterAnchor(html, 'nonexistent quote', box)
    expect(out).toBe(`<p>First.</p>${box}<p>Second.</p>`)
  })

  it('shifts down one paragraph when the anchor abuts an existing injected block', () => {
    const html = '<p>First.</p><div class="geo-summary"><p>s</p></div><p>Second.</p>'
    const out = insertBoxAfterAnchor(html, 'First', box)
    // would abut geo-summary → shifted to after "Second."
    expect(out).toBe(`<p>First.</p><div class="geo-summary"><p>s</p></div><p>Second.</p>${box}`)
  })

  it('returns null when the html has no paragraphs', () => {
    expect(insertBoxAfterAnchor('<h2>Only a heading</h2>', 'x', box)).toBeNull()
  })
})

describe('buildBoxHtml', () => {
  it('uses the brand accent and rotated label, escaping story text', () => {
    const html = buildBoxHtml('Simply Put', 'A story with <tags> & ampersands.', '#1a2b3c')
    expect(html).toContain('border-left:4px solid #1a2b3c')
    expect(html).toContain('background:#1a2b3c14')
    expect(html).toContain('Simply Put')
    expect(html).toContain('A story with &lt;tags&gt; &amp; ampersands.')
    expect(html).toContain('class="plain-language-box"')
  })

  it('falls back to a neutral accent on invalid hex', () => {
    expect(buildBoxHtml('L', 'text', 'not-a-color')).toContain('border-left:4px solid #4a5568')
  })
})

describe('buildBoxMarker', () => {
  it('emits the data-pl-box marker with escaped label and text', () => {
    const html = buildBoxMarker('Think of It This Way', 'Story "quoted" text.')
    expect(html).toContain('<div data-pl-box data-pl-label="Think of It This Way">')
    expect(html).toContain('Story &quot;quoted&quot; text.')
  })
})
