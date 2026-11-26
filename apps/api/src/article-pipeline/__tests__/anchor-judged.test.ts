import { describe, it, expect } from 'vitest'
import { anchorFactSources, anchorFactSourcesJudged, anchorPairs, capAnchors, figuresOf, placeAnchors, MAX_ARTICLE_LINKS, MAX_LINKS_PER_SITE, isOwnPracticeSentence, type AnchorPair, type FactSource } from '../source-verify'
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
  it('does not read a digit inside a name as a figure, and keeps both ends of a range', () => {
    expect([...figuresOf('the L5 nerve root, vitamin B12 and COVID-19 over 6-12 weeks')]).toEqual(['6', '12'])
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

describe('the link cap (Veit, 2026-11-25: at most 12 per article)', () => {
  // Three sections; section 1 holds six plain sentences, sections 2 and 3 two each, one with a figure in each.
  const sentence = (i: number, withFigure: boolean) => `Topic number ${'abcdefghij'[i]} alpha${i} beta${i} gamma${i} delta${i} matters${withFigure ? ` in ${10 + i}% of people` : ' to most people'}.`
  const body = (ids: number[], figureAt: number[]) => ids.map((i) => `<p>${sentence(i, figureAt.includes(i))}</p>`).join('')
  const html = `<h2>One</h2>${body([0, 1, 2, 3, 4, 5], [])}<h2>Two</h2>${body([6, 7], [7])}<h2>Three</h2>${body([8, 9], [9])}`
  const sources = Array.from({ length: 10 }, (_, i) => src(`Topic number ${'abcdefghij'[i]} alpha${i} beta${i} gamma${i} delta${i} matters.`, 50 + i))
  const pairs = (): AnchorPair[] => {
    const all = anchorPairs(html, sources)
    return sources.map((_, si) => all.find((p) => p.si === si && p.sentence.text.includes(`alpha${si} `))!).filter(Boolean)
  }

  it('is twelve, and a ceiling: fewer confirmed links all stay', () => {
    expect(MAX_ARTICLE_LINKS).toBe(12)
    expect(pairs()).toHaveLength(10)
    expect(placeAnchors(html, sources, pairs()).placed).toHaveLength(10)
  })
  it('keeps figure sentences first, then one link per section before a second', () => {
    const kept = capAnchors(html, pairs(), 4).map((p) => p.si)
    // both figure sentences (7 and 9), then the section with none yet (section one, its strongest: 0), then the next least-linked
    expect(kept.slice(0, 2).sort()).toEqual([7, 9])
    expect(kept[2]).toBe(0)
    expect(kept).toHaveLength(4)
  })
  it('counts links the article already carries', () => {
    const withLinks = html.replace('<h2>One</h2>', '<p>See <a href="https://www.mayoclinic.org/x">this</a> and <a href="https://www.nhs.uk/y">that</a>.</p><h2>One</h2>')
    const r = placeAnchors(withLinks, sources, anchorPairs(withLinks, sources).filter((p) => p.sentence.text.includes(`alpha${p.si} `)), 5)
    expect(r.placed).toHaveLength(3)
    expect((r.html.match(/<a\b[^>]*href="https?:/g) ?? []).length).toBe(5)
  })
  it('places nothing when the article is already at the cap', () => {
    expect(capAnchors(html, pairs(), 0)).toEqual([])
  })
})

describe('link variety (Veit, 2026-11-25: at most two links per site)', () => {
  const sentence = (i: number) => `Topic number ${'abcdefghij'[i]} alpha${i} beta${i} gamma${i} delta${i} matters to most people.`
  const html = `<h2>One</h2>${[0, 1, 2, 3, 4].map((i) => `<p>${sentence(i)}</p>`).join('')}`
  const at = (i: number, url: string): FactSource => ({ fact: `Topic number ${'abcdefghij'[i]} alpha${i} beta${i} gamma${i} delta${i} matters.`, url, title: `Page ${i}`, status: 'retrieved' }) as FactSource
  const own = (sources: FactSource[], h = html) => anchorPairs(h, sources).filter((p) => p.sentence.text.includes(`alpha${p.si} `))

  it('keeps two links to one site, its subdomains counted together, and gives the slot to another site', () => {
    const sources = [at(0, 'https://my.clevelandclinic.org/a'), at(1, 'https://health.clevelandclinic.org/b'), at(2, 'https://my.clevelandclinic.org/c'), at(3, 'https://www.mayoclinic.org/d'), at(4, 'https://my.clevelandclinic.org/e')]
    const r = placeAnchors(html, sources, own(sources))
    expect(r.placed.filter((u) => u.includes('clevelandclinic.org'))).toHaveLength(2)
    expect(r.placed).toContain('https://www.mayoclinic.org/d')
    expect(r.placed).toHaveLength(3)
    expect(MAX_LINKS_PER_SITE).toBe(2)
  })
  it('counts a link the article already carries to that site', () => {
    const sources = [at(0, 'https://www.mayoclinic.org/a'), at(1, 'https://www.mayoclinic.org/b')]
    const withLink = html.replace('<h2>One</h2>', '<p>See <a href="https://www.mayoclinic.org/x">this</a>.</p><h2>One</h2>')
    expect(placeAnchors(withLink, sources, own(sources, withLink)).placed).toHaveLength(1)
  })
  it('does not pool the papers of an index: each paper is its own source', () => {
    const sources = [0, 1, 2, 3].map((i) => at(i, `https://pubmed.ncbi.nlm.nih.gov/${100 + i}/`))
    expect(placeAnchors(html, sources, own(sources)).placed).toHaveLength(4)
  })
})

describe('a sentence about the author\'s own work is never linked', () => {
  it('recognises the author speaking about their own practice', () => {
    for (const s of ['I check the hips first.', 'We start every visit with a conversation.', 'In my practice this shows up weekly.', 'Our team runs the sessions.', '“I’ve seen it often.”', 'At our centre people rest afterwards.']) expect(isOwnPracticeSentence(s)).toBe(true)
    for (const s of ['Sitting loads the lumbar discs.', 'Iron levels matter here.', 'Wellness is not a product.', 'Most people I see are surprised by this.']) expect(isOwnPracticeSentence(s)).toBe(false)
  })
  it('places no link on such a sentence even when the words match a fact', () => {
    const html = '<h2>One</h2><p>We find that sitting slouched loads the lumbar discs far more than standing does.</p><p>Sitting slouched loads the lumbar discs far more than standing does over a day.</p>'
    const sources = [{ fact: 'Sitting slouched loads the lumbar discs far more than standing does.', url: 'https://www.hss.edu/a', title: 'A', status: 'retrieved' } as FactSource]
    const r = placeAnchors(html, sources, anchorPairs(html, sources))
    expect(r.html).toContain('<p>We find that sitting slouched loads the lumbar discs far more than standing does.</p>')
    expect(r.placed).toEqual(['https://www.hss.edu/a'])
  })
})

