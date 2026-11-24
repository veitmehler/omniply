import { describe, it, expect } from 'vitest'
import { anchorFactSources, anchorFactSourcesJudged, anchorPairs, figuresOf, type FactSource } from '../source-verify'
import { anchorJudgePrompt, parseAnchorVerdicts } from '../anchor-judge'

/** Sentences from the hyperbaric bench article of 2026-11-24, which stated its sourced facts and got no links at all. */
const HTML = [
  '<p>Ear trouble is the most common downside of HBOT. Middle ear barotrauma shows up in about 9.2% of treatments, and it\'s usually minor and manageable, though people with rhinitis are more prone to it on the way down.</p>',
  '<p>In people given mild pressure at 1.3 ATA for an hour, resting parasympathetic activity rose straight away on heart rate variability measures.</p>',
  '<p>In people with lingering post-concussion symptoms, 40 sessions were followed by better cognitive function and quality of life, even years after the injury.</p>',
  '<p>VO2 max declines by about 10% per decade after 30, and muscle mass and strength fall 3% to 10% per decade.</p>',
  '<p>Pressure shifts toward the front of each disc, and the soft inner material is nudged backward while you sit.</p>',
].join('\n')

const src = (fact: string, n: number): FactSource => ({ fact, url: `https://pubmed.ncbi.nlm.nih.gov/${1000 + n}/`, title: `Paper ${n}`, status: 'retrieved' }) as FactSource

const BAROTRAUMA = src('Middle ear barotrauma is one of the most common side effects of hyperbaric oxygen therapy, occurring in approximately 9.2% of treatments, though it usually presents with only minor, easily managed otoscopic changes.', 1)
const HRV = src('Even mild-dose hyperbaric oxygen interventions (such as 1.3 ATA for 60 minutes) significantly enhance short-term heart rate variability parameters, producing an immediate beneficial effect on resting parasympathetic activity.', 2)
const LONG_COVID = src('In patients suffering from lingering post-COVID symptoms, the significant improvements in sleep quality, cognitive function and quality of life gained from 40 sessions of hyperbaric oxygen therapy are maintained for over a year.', 3)
const DIFFUSION = src('Pulmonary diffusion capacity diminishes by approximately 5% per decade in healthy adults.', 4)
const HERNIA = src('A herniated disc is a condition where the inner disc material is displaced from its normal space.', 5)

describe('figuresOf', () => {
  it('reads decimals and thousands as single figures', () => {
    expect([...figuresOf('about 9.2% of 2,334 patients over 12 weeks')]).toEqual(['9.2', '2334', '12'])
  })
})

describe('anchorPairs: word matching proposes', () => {
  it('proposes a reworded fact that the old rule could not reach, and marks the same figure', () => {
    const pairs = anchorPairs(HTML, [BAROTRAUMA, HRV])
    const baro = pairs.find((p) => p.si === 0)!
    expect(baro.sentence.text).toMatch(/9\.2% of treatments/)
    expect(baro.sameFigure).toBe(true)
    expect(pairs.find((p) => p.si === 1)!.sentence.text).toMatch(/1\.3 ATA/)
  })
  it('never proposes a sentence that states a different figure', () => {
    expect(anchorPairs(HTML, [DIFFUSION])).toHaveLength(0)
  })
})

describe('anchorFactSources: the word rule alone', () => {
  it('links a restated fact with its figure (hyperbaric article: 0 of 23 before)', () => {
    const r = anchorFactSources(HTML, [BAROTRAUMA])
    expect(r.placed).toEqual([BAROTRAUMA.url])
    expect(r.html).toContain(`<a href="${BAROTRAUMA.url}" target="_blank" rel="noopener noreferrer">Middle ear barotrauma shows up in about 9.2% of treatments`)
  })
  it('does not link a definition to a sentence that only shares three words with it', () => {
    expect(anchorFactSources(HTML, [HERNIA]).placed).toHaveLength(0)
  })
})

describe('anchorFactSourcesJudged: a judge confirms', () => {
  it('places only the pairs the judge confirms', async () => {
    const asked: Array<{ fact: string; sentence: string }> = []
    // The judge refuses the long-COVID finding on the concussion sentence: close wording, different condition.
    const judge = async (pairs: Array<{ fact: string; sentence: string }>) => (asked.push(...pairs), pairs.map((p) => !/post-COVID/.test(p.fact)))
    const r = await anchorFactSourcesJudged(HTML, [BAROTRAUMA, HRV, LONG_COVID], judge)
    expect(asked.some((p) => /post-COVID/.test(p.fact) && /post-concussion/.test(p.sentence))).toBe(true)
    expect(r.placed.sort()).toEqual([BAROTRAUMA.url, HRV.url].sort())
    expect(r.unplaced.map((s) => s.url)).toEqual([LONG_COVID.url])
    expect(r.judged).toBe(true)
    expect(r.html).not.toContain(LONG_COVID.url)
  })
  it('falls back to the strict word rule when the judge fails or answers short, and never adds a link for it', async () => {
    const down = await anchorFactSourcesJudged(HTML, [BAROTRAUMA, HERNIA], async () => { throw new Error('down') })
    expect(down.judged).toBe(false)
    expect(down.placed).toEqual([BAROTRAUMA.url])
    const short = await anchorFactSourcesJudged(HTML, [BAROTRAUMA, HRV], async () => [true])
    expect(short.judged).toBe(false)
  })
  it('asks nothing when there is nothing to propose', async () => {
    let calls = 0
    const r = await anchorFactSourcesJudged(HTML, [DIFFUSION], async (p) => (calls++, p.map(() => true)))
    expect(calls).toBe(0)
    expect(r.placed).toHaveLength(0)
  })
})

describe('anchor judge wire format', () => {
  it('numbers the pairs and asks for one verdict each', () => {
    const p = anchorJudgePrompt([{ fact: 'F one', sentence: 'S one' }, { fact: 'F two', sentence: 'S two' }])
    expect(p).toContain('1.\nFACT: F one\nSENTENCE: S one')
    expect(p).toContain('2.\nFACT: F two\nSENTENCE: S two')
    expect(p).toMatch(/different condition, treatment or group/)
  })
  it('reads verdicts by number and refuses a batch with a missing answer', () => {
    expect(parseAnchorVerdicts('[{"n":2,"same":false},{"n":1,"same":"true"}]', 2)).toEqual([true, false])
    expect(parseAnchorVerdicts('[{"n":1,"same":true}]', 2)).toBeNull()
    expect(parseAnchorVerdicts('no json', 1)).toBeNull()
  })
})
