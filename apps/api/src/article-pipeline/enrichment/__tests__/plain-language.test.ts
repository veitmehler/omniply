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
  pickImageMode,
  deviceShapeReason,
  IMAGE_NONE,
  IMAGE_CLAUSE,
  IMAGE_LIKE,
  IMAGE_APPOSITION,
  IMAGE_VERB,
  LIKE_FRAME_RE,
  splitTitle,
  titleGateReason,
  pickGlossOpener,
  lexicalGateReason,
  vehicleReuseReason,
  overlapReason,
  GLOSS_APPOSITION,
  GLOSS_CONSEQUENCE,
  GLOSS_EXAMPLE,
  GLOSS_PLAIN,
} from '../plain-language'

describe('pickImageMode / deviceShapeReason', () => {
  it('draws both image modes, deterministically per seed', () => {
    const a = seededRng('stable'), b = seededRng('stable')
    for (let i = 0; i < 8; i++) expect(pickImageMode(a)).toBe(pickImageMode(b))
    const rng = seededRng('variety')
    const modes = new Set(Array.from({ length: 30 }, () => pickImageMode(rng)))
    expect(modes).toContain(IMAGE_NONE)
    expect(modes).toContain(IMAGE_CLAUSE)
  })

  it('rejects the explicit mapping sentence', () => {
    expect(deviceShapeReason('A sponge soaks up water overnight. Your discs work in much the same way.')).toMatch(/mapping/)
    expect(deviceShapeReason('The same thing happens in your lower back.')).toBeTruthy()
  })

  it('rejects invented witnessed scenes and specific persons', () => {
    expect(deviceShapeReason('Last weekend I watched two kids on a seesaw find their balance point.')).toMatch(/fabricated/)
    expect(deviceShapeReason('Last winter I saw my neighbour stand at his open fridge.')).toBeTruthy()
    expect(deviceShapeReason('A mate of mine kinked his garden hose once.')).toBeTruthy()
  })

  it('rejects a closing rhetorical question', () => {
    expect(deviceShapeReason('The nerve calms once the pressure eases. What would your back say to that?')).toMatch(/question/)
  })

  it('passes a plain across-the-table explanation with one image clause', () => {
    expect(deviceShapeReason('Overnight your discs draw fluid back in, a little like a sponge in water, so the first bend of the morning feels tight until they settle.', { allowLike: true })).toBeNull()
    expect(deviceShapeReason('In practice I see this weekly: the joint is stiff because it has not moved for hours, not because it is damaged.')).toBeNull()
  })

  it('B11: caps the "like a …" frame at one per article and draws the other frames', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = seededRng(`img-${seed}`)
      const state = { likeUsed: false }
      const draws = Array.from({ length: 12 }, () => pickImageMode(rng, state))
      expect(draws.filter((d) => d === IMAGE_LIKE).length).toBeLessThanOrEqual(1)
      for (const d of draws) expect([IMAGE_NONE, IMAGE_LIKE, IMAGE_APPOSITION, IMAGE_VERB]).toContain(d)
    }
    const all = new Set<string>()
    for (let seed = 0; seed < 40; seed++) { const rng = seededRng(`imgv-${seed}`); const state = { likeUsed: false }; for (let i = 0; i < 6; i++) all.add(pickImageMode(rng, state)) }
    expect(all).toEqual(new Set([IMAGE_NONE, IMAGE_LIKE, IMAGE_APPOSITION, IMAGE_VERB]))
  })

  it('B11: rejects comparison frames unless the device was drawn with the like frame', () => {
    const like = 'The gel inside the disc carries inflammatory compounds, much like spilled cleaning fluid that irritates whatever it touches.'
    expect(deviceShapeReason(like)).toMatch(/comparison frame/)
    expect(deviceShapeReason(like, { allowLike: true })).toBeNull()
    expect(deviceShapeReason('Done gently and often, it works a bit like easing a drawer along its runners.')).toMatch(/comparison frame/)
    expect(deviceShapeReason('The nerve behaves as if it were bruised for a few days.')).toMatch(/comparison frame/)
    expect(LIKE_FRAME_RE.test("Most people would like a straight answer here.")).toBe(false)
    expect(LIKE_FRAME_RE.test('Things like this settle within a fortnight.')).toBe(false)
    expect(deviceShapeReason("The disc's soft centre, the jammy filling, pushes on the nerve root for a few days and then settles.")).toBeNull()
    expect(deviceShapeReason('The nerve sulks for days after the pressure eases, then quietens down.')).toBeNull()
  })

  it('B11: rejects the dictionary-split frame', () => {
    expect(deviceShapeReason('Break the word in two: "lumbar" is the lower back, and "radiculopathy" is trouble in a root.')).toMatch(/dictionary/)
  })

  it('B11: parses and gates the device-written box title', () => {
    expect(splitTitle('TITLE: Why discs soak up water overnight\n\nOvernight the discs draw fluid in.')).toEqual({ title: 'Why discs soak up water overnight', body: 'Overnight the discs draw fluid in.' })
    expect(splitTitle('Overnight the discs draw fluid in.')).toEqual({ title: null, body: 'Overnight the discs draw fluid in.' })
    expect(titleGateReason('Why discs soak up water overnight')).toBeNull()
    expect(titleGateReason('The Simple Version')).toMatch(/meta/)
    expect(titleGateReason('In Everyday Terms')).toMatch(/meta/)
    expect(titleGateReason('Discs')).toMatch(/words/)
    expect(titleGateReason('What is a disc really doing here?')).toMatch(/question/)
    expect(titleGateReason('A disc works much like jam doughnuts')).toMatch(/simile/)
  })

  it('gloss constructions ration "just means" to one per article', () => {
    for (let seed = 0; seed < 15; seed++) {
      const rng = seededRng(`gloss-${seed}`)
      const state = { justMeansUsed: false }
      const draws = Array.from({ length: 10 }, () => pickGlossOpener(rng, state))
      expect(draws.filter((d) => d === GLOSS_APPOSITION).length).toBeLessThanOrEqual(1)
      for (const d of draws) expect([GLOSS_APPOSITION, GLOSS_CONSEQUENCE, GLOSS_EXAMPLE, GLOSS_PLAIN]).toContain(d)
    }
  })
})

describe('overlapReason', () => {
  const passage = 'Psychological stress doesn\'t cause a disc to herniate. But it can raise muscle tension and nervous system reactivity, which changes how pain is experienced.'

  it('rejects a 6-word verbatim run shared with the passage', () => {
    expect(overlapReason('Stress can turn that knob up, and psychological stress doesn\'t cause a disc to herniate, but it can raise muscle tension too.', passage)).toMatch(/restate/)
  })

  it('passes a genuine illustration with no shared run', () => {
    expect(overlapReason('Picture the volume knob on a radio: the signal stays the same, but a tense day turns the playback up.', passage)).toBeNull()
  })

  it('ignores short passages and punctuation differences', () => {
    expect(overlapReason('anything', 'too short', 6)).toBeNull()
    expect(overlapReason('it can raise muscle tension and nervous-system reactivity, which...', passage)).toBeTruthy()
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

describe('B15: image-mandatory boxes and back-reference stance leaks', () => {
  it('never draws IMAGE_NONE when an image is required', () => {
    for (let seed = 0; seed < 40; seed++) {
      const rng = seededRng(`req-${seed}`)
      const state = { likeUsed: false }
      for (let i = 0; i < 6; i++) expect(pickImageMode(rng, state, { requireImage: true })).not.toBe(IMAGE_NONE)
    }
  })
  it('rejects a device that refers back to a study or passage it mentioned', () => {
    expect(lexicalGateReason('In the study I mentioned, adults who had 12 weeks of adjustments showed shifts in cortisol.', true)).toBeTruthy()
    expect(lexicalGateReason('As I said, the disc swells overnight.', true)).toBeTruthy()
    expect(lexicalGateReason('The hip flexors shorten when you sit, and the glutes switch off.', true)).toBeNull()
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
    expect(lexicalGateReason('Think of a dry sponge left on the sink.', false)).toMatch(/instructions forbid/)
    expect(lexicalGateReason('  Picture a garden hose with a kink.', false)).toBeTruthy()
    expect(lexicalGateReason('Think of a dry sponge left on the sink.', true)).toBeNull()
  })

  it('passes normal first-person prose, including mid-sentence imagery', () => {
    expect(lexicalGateReason('Your discs work like sponges: squeeze them all day and they stiffen.', false)).toBeNull()
    expect(lexicalGateReason('I tell my clients to think of it as a hinge that needs oil.', false)).toBeNull()
    expect(lexicalGateReason('A kettle left on the bench cools slowly.', false)).toBeNull()
  })
})

describe('rotatedLabel', () => {
  it('is stable for the same seed', () => {
    expect(rotatedLabel('page1:3')).toBe(rotatedLabel('page1:3'))
  })

  it('returns a known label', () => {
    expect(PL_BOX_LABELS).toContain(rotatedLabel('anything'))
  })

  it('B11: the generic device labels are gone; only the reader-facing fallback remains', () => {
    expect(PL_BOX_LABELS).toEqual(['What this means for you'])
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
      'motion.<span class="term"> Think of a kinked garden hose.</span> More detail',
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
    expect(out).toContain('</p>\n<p class="term">plain words</p>')
  })

  it('returns null when no paragraph contains the term', () => {
    expect(spliceGloss('<p>Nothing relevant.</p>', 'subluxation', 'x')).toBeNull()
  })
})

describe('insertBoxAfterAnchor', () => {
  const box = '\n<div class="note">BOX</div>\n'

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
    expect(html).toContain('class="note"')
  })

  it('falls back to a neutral accent on invalid hex', () => {
    expect(buildBoxHtml('L', 'text', 'not-a-color')).toContain('border-left:4px solid #4a5568')
  })

  it('B11: renders no title paragraph when the label is empty', () => {
    const html = buildBoxHtml('', 'Just the explanation.', '#1a2b3c')
    expect(html).not.toContain('font-weight:600')
    expect(html).toContain('<p style="margin:0;">Just the explanation.</p>')
  })
})

describe('buildBoxMarker', () => {
  it('emits the data-pl-box marker with escaped label and text', () => {
    const html = buildBoxMarker('Think of It This Way', 'Story "quoted" text.')
    expect(html).toContain('<div data-pl-box data-pl-label="Think of It This Way">')
    expect(html).toContain('Story &quot;quoted&quot; text.')
  })
})
