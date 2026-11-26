import { describe, it, expect } from 'vitest'
import { buildReference, chunkProse, splitSentences, toProse, voiceFeatures, voiceScore, voiceGaps, wordCount } from '../voice-score'
import { attribute, maskIdentity, parseVerdict, pickSample, seeded, lineupPrompt } from '../attribution'

// Two invented writers with opposite habits. Each has several paragraphs so the reference can average.
const blunt = (i: number) =>
  `I banged my foot on the door again. Ouch! You might ask why I keep doing it. Well, I'm glad you asked. I don't look. Simple as that. My body sorted it out by ${i} o'clock, and I didn't lift a finger. Isn't that something? I think it is. I love that about us. We heal. We just do. And we rarely notice!`
const formal = (i: number) =>
  `The intervertebral disc, which is composed of a fibrous outer ring and a gelatinous centre, distributes compressive load across the vertebral endplates; consequently, sustained flexion over a period of ${i} hours alters that distribution considerably. It is generally accepted that the resulting stiffness, although uncomfortable, resolves with graded movement (provided that no neurological deficit is present), and the available evidence suggests that prolonged rest may, in many cases, delay recovery.`
const many = (f: (i: number) => string, n: number) => Array.from({ length: n }, (_, i) => f(i + 2)).join('\n\n')

describe('toProse and sentences', () => {
  it('drops headings, figures and markup, and keeps the paragraphs', () => {
    const p = toProse('<h2>Why Does It Hurt?</h2><p>It hurts because you sat. <a href="https://x.org/y">Sitting loads the disc</a>.</p><figure><img alt="x"><figcaption>A caption.</figcaption></figure><ul><li>Stand up.</li></ul>')
    expect(p).not.toMatch(/Why Does It Hurt|caption|<|http/)
    expect(p).toContain('Sitting loads the disc')
    expect(p).toContain('Stand up.')
  })
  it('reads a markdown draft the same way', () => {
    const p = toProse('## A Heading\n\nFirst line with a [link](https://x.org/y) in it.\n\n- one point\n- another point')
    expect(p).not.toMatch(/Heading|\]\(|https/)
    expect(p).toContain('First line with a link in it.')
  })
  it('splits sentences on end marks and line breaks', () => {
    expect(splitSentences('I stood up. Did it hurt? Yes!\nA new line')).toEqual(['I stood up.', 'Did it hurt?', 'Yes!', 'A new line'])
  })
})

describe('voiceFeatures', () => {
  it('measures the habits that separate the two writers', () => {
    const b = voiceFeatures(many(blunt, 4))
    const f = voiceFeatures(many(formal, 4))
    expect(b.sentLenMean).toBeLessThan(f.sentLenMean / 3)
    expect(b.fpSingular).toBeGreaterThan(5)
    expect(f.fpSingular).toBe(0)
    expect(b.questionShare).toBeGreaterThan(0.05)
    expect(b.exclaimShare).toBeGreaterThan(0.05)
    expect(b.contractions).toBeGreaterThan(f.contractions)
    expect(f.semicolons).toBeGreaterThan(b.semicolons)
    expect(f.parens).toBeGreaterThan(0)
    expect(f.longWordShare).toBeGreaterThan(b.longWordShare)
    expect(b.conjOpenShare).toBeGreaterThan(0)
  })
  it('counts words on the prose only', () => {
    expect(wordCount('<h2>Not counted here</h2><p>Three words here.</p>')).toBe(3)
  })
})

describe('reference and score', () => {
  const ref = buildReference({ blunt: chunkProse(many(blunt, 12), 120), formal: chunkProse(many(formal, 12), 120) })
  it('puts a new text by each writer closest to that writer', () => {
    const b = voiceScore(many(blunt, 3).replace(/door/g, 'gate'), 'blunt', ref)
    const f = voiceScore(many(formal, 3).replace(/disc/g, 'joint'), 'formal', ref)
    expect(b.rank).toBe(1)
    expect(b.score).toBeGreaterThan(0.5)
    expect(f.rank).toBe(1)
    expect(f.score).toBeGreaterThan(0.5)
  })
  it('scores a text in the other manner at or below zero, and says where it differs', () => {
    const wrong = voiceScore(many(formal, 3), 'blunt', ref)
    expect(wrong.rank).toBe(2)
    expect(wrong.score).toBeLessThan(0)
    expect(wrong.nearest).toBe('formal')
    const gaps = voiceGaps(many(formal, 3), 'blunt', ref, 40).map((g) => g.feature)
    expect(gaps).toContain('sentLenMean')
  })
  it('chunks on paragraphs and keeps a short tail with the last piece', () => {
    const chunks = chunkProse(many(blunt, 10), 200)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('\n').split(/\s+/).length).toBe(toProse(many(blunt, 10)).split(/\s+/).length)
  })
})

describe('attribution judge', () => {
  it('masks names, clinics and places, longest first', () => {
    const m = maskIdentity("Mark's rooms at Coast Chiropractic Kawana, on the Sunshine Coast, near Kawana.", ['Mark', 'Kawana', 'Coast Chiropractic Kawana', 'Sunshine Coast'])
    expect(m).not.toMatch(/Mark|Kawana|Coast Chiropractic|Sunshine/)
    expect(m).toContain('[name]')
  })
  it('reads a verdict and gives every candidate a place', () => {
    const v = parseVerdict('{"ranking":["Writer C","A"],"none_fits":"false","confidence":0.7,"evidence":"short blunt sentences"}', ['A', 'B', 'C'])!
    expect(v.ranking).toEqual(['C', 'A', 'B'])
    expect(v.noneFits).toBe(false)
    expect(parseVerdict('no json', ['A'])).toBeNull()
    expect(parseVerdict('{"ranking":["Z"]}', ['A', 'B'])).toBeNull()
  })
  it('names the candidates by letter and tells the judge to ignore the topic', () => {
    const p = lineupPrompt([{ label: 'A', sample: 'sample one' }, { label: 'B', sample: 'sample two' }], 'the text')
    expect(p).toContain('=== WRITER A ===\nsample one')
    expect(p).toMatch(/Ignore the TOPIC/)
    expect(p).toMatch(/may be by none of them/)
  })
  it('counts votes across shuffled line-ups and is repeatable with a seed', async () => {
    const candidates = [{ id: 'blunt', samples: [many(blunt, 2)] }, { id: 'formal', samples: [many(formal, 2)] }, { id: 'third', samples: ['Some other writer entirely, with medium sentences and no questions at all.'] }]
    // A judge that always finds the writer whose sample contains "Ouch", wherever it sits in the line-up.
    const call = async (prompt: string) => {
      const blocks = prompt.split('=== WRITER ').slice(1)
      const hit = blocks.find((b) => b.includes('Ouch'))!.slice(0, 1)
      const rest = blocks.map((b) => b.slice(0, 1)).filter((l) => l !== hit && /^[A-L]$/.test(l))
      return JSON.stringify({ ranking: [hit, ...rest], none_fits: false, confidence: 0.9, evidence: 'exclamations' })
    }
    const r = await attribute({ text: 'x', candidates, call, votes: 5, seed: 7 })
    expect(r.winner).toBe('blunt')
    expect(r.firstPlaces.blunt).toBe(5)
    expect(r.meanPlace.blunt).toBe(1)
    expect(r.votes).toBe(5)
    const again = await attribute({ text: 'x', candidates, call, votes: 5, seed: 7 })
    expect(again.meanPlace).toEqual(r.meanPlace)
  })
  it('skips a vote the judge answered badly instead of counting it', async () => {
    let n = 0
    const r = await attribute({ text: 'x', candidates: [{ id: 'a', samples: ['s'] }, { id: 'b', samples: ['t'] }], call: async () => (n++ === 0 ? 'garbage' : '{"ranking":["A","B"],"none_fits":true,"confidence":0.2}'), votes: 3 })
    expect(r.votes).toBe(2)
    expect(r.noneFits).toBe(2)
  })
  it('draws a different sample on different draws', () => {
    const samples = Array.from({ length: 6 }, (_, i) => `sample number ${i} ` + 'word '.repeat(200))
    const a = pickSample(samples, 400, seeded(1))
    const b = pickSample(samples, 400, seeded(99))
    expect(a.split(/\s+/).length).toBeGreaterThan(300)
    expect(a).not.toBe(b)
  })
})
