import { describe, it, expect } from 'vitest'
import type { FitnessDeps } from '../source-fitness'
import { buildQueries, buildPubmedQueries, rankCandidates, parseFacts, assembleFeed, runRetrievalResearch, type RetrievalDeps } from '../research-retrieval'
import { researchUnitsFor, batchUnits } from '../research-units'

const TOPIC = 'Sciatica relief: what actually helps'

/** A source card the judge would return for a sound, on-subject source. */
function card(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ about: 'sciatica', doc_type: 'narrative review', population: 'Adults with sciatica', facts_about: 'sciatica recovery', conclusion: 'Most recover.', stance: 'neutral', same_subject: true, reader_match: true, facts: [{ n: 1, own: true, common: false }], ...over })
}
const okFitness: FitnessDeps = {
  paperRecord: async () => ({ pmid: '123', title: 'Sciatica: a review', pubTypes: ['Journal Article', 'Review'], journal: 'Spine', year: 2022 }),
  abstract: async () => null,
  judge: async () => ({ text: card(), cost: 0, tokens: { input: 0, output: 0 } }),
}

describe('research-units', () => {
  it('step 7 units are the quoted questions from step 6', () => {
    const steps = new Map<number, string>([[6, '1. "Can a chiropractor help with sciatica?"\n2. "How long does sciatica take to heal?"\n2b. "How long does sciatica take to heal?"']])
    expect(researchUnitsFor(7, steps)).toEqual(['Can a chiropractor help with sciatica?', 'How long does sciatica take to heal?'])
  })
  it('step 8 units are the outline H2 lines', () => {
    const steps = new Map<number, string>([[4, '# Title\n## What sciatica actually is\nbody\nH2: When to see someone\n### sub']])
    expect(researchUnitsFor(8, steps)).toEqual(['What sciatica actually is', 'When to see someone'])
  })
  it('batches units in pairs', () => {
    expect(batchUnits(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })
})

describe('research-retrieval query building', () => {
  it('builds three site-restricted queries: hospital systems first, then health bodies, then papers', () => {
    const [clinics, bodies, papers] = buildQueries('How long does sciatica take to heal?', TOPIC)
    expect(clinics).toContain('site:mayoclinic.org')
    expect(clinics).toContain('site:clevelandclinic.org')
    expect(clinics).toContain('sciatica')
    expect(bodies).toContain('site:cdc.gov')
    expect(bodies).toContain('site:medlineplus.gov')
    expect(bodies).not.toContain('site:pubmed')
    expect(papers).toContain('site:pubmed.ncbi.nlm.nih.gov')
    // Google reads about 32 words of a query.
    for (const q of [clinics, bodies, papers]) expect(q.split(/\s+/).length).toBeLessThanOrEqual(32)
  })
  it('reads authority pages before papers for a clinic article', () => {
    const results = [
      { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', title: 'Sciatica heal time in a cohort', snippet: 'sciatica heal weeks' },
      { url: 'https://www.mayoclinic.org/sciatica', title: 'Sciatica: how long it takes to heal', snippet: 'sciatica heal weeks' },
      { url: 'https://www.ncbi.nlm.nih.gov/books/NBK507908/', title: 'Sciatica - StatPearls', snippet: 'sciatica heal' },
    ]
    const ranked = rankCandidates(results, 'How long does sciatica take to heal?', TOPIC, new Set())
    expect(ranked.map((r) => new URL(r.url).hostname)).toEqual(['www.mayoclinic.org', 'www.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov'])
  })
  it('pubmed query restricts to reviews and the last decade', () => {
    const qs = buildPubmedQueries('How long does sciatica take to heal?', TOPIC)
    expect(qs.length).toBeGreaterThan(0)
    expect(qs[0]).toMatch(/review\[pt\]/)
    expect(qs[0]).toMatch(/last 10 years/)
    expect(qs[0]).not.toMatch(/\bheal\b|\btake\b/)
    expect(qs[qs.length - 1]).toMatch(/^sciatica/)
  })
  it('ranks primary tier first, drops denied hosts, off-topic and already-seen urls, one page per host', () => {
    const ranked = rankCandidates(
      [
        { url: 'https://www.researchgate.net/x', title: 'sciatica heal time review', snippet: 'sciatica heal' },
        { url: 'https://www.nhs.uk/conditions/sciatica/', title: 'Sciatica', snippet: 'usually gets better in a few weeks' },
        { url: 'https://www.nhs.uk/conditions/sciatica/treatment', title: 'Sciatica treatment', snippet: 'exercise' },
        { url: 'https://www.ncbi.nlm.nih.gov/books/NBK1/', title: 'Sciatica', snippet: 'Most sciatica episodes heal within weeks' },
        { url: 'https://www.cdc.gov/flu', title: 'Flu season', snippet: 'vaccines' },
        { url: 'https://www.mayoclinic.org/sciatica', title: 'Sciatica symptoms', snippet: 'heal' },
      ],
      'How long does sciatica take to heal?',
      TOPIC,
      new Set(['https://www.mayoclinic.org/sciatica']),
    )
    expect(ranked.map((r) => r.url)).toEqual(['https://www.ncbi.nlm.nih.gov/books/NBK1/', 'https://www.nhs.uk/conditions/sciatica/'])
  })
})

describe('research-retrieval extraction + feed', () => {
  it('parses the JSON array and drops thin entries', () => {
    const facts = parseFacts('Here you go:\n[{"fact":"Most episodes of sciatica settle within four to six weeks.","quote":"Most episodes resolve within 4-6 weeks."},{"fact":"short","quote":"x"}]')
    expect(facts).toHaveLength(1)
  })
  it('assembles a step-shaped feed with [Source: title, host, url] tags', () => {
    const feed = assembleFeed(
      [{ fact: 'Most episodes settle within six weeks.', quote: 'q', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Sciatica [review]', unit: 'U1' }],
      ['U1', 'U2'],
    )
    expect(feed).toContain('**U1**')
    expect(feed).not.toContain('**U2**')
    expect(feed).toContain('1. Most episodes settle within six weeks. [Source: Sciatica review, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/123/]')
  })
  it('runs end to end with fake deps and produces supports per fact', async () => {
    const deps: RetrievalDeps = {
      serp: async () => [{ url: 'https://www.cdc.gov/back-pain', title: 'Back pain and sciatica basics', snippet: 'sciatica heal weeks' }],
      pubmedSearch: async () => [{ id: '123', title: 'Sciatica: a review' }],
      pubmedAbstract: async () => 'Most episodes of sciatica resolve within 4-6 weeks without surgery.',
      extractFromText: async () => ({ facts: [{ fact: 'Most episodes of sciatica resolve within four to six weeks without surgery.', quote: 'resolve within 4-6 weeks' }], cost: 0.001, tokens: { input: 100, output: 20 } }),
      extractFromUrl: async () => ({ facts: [{ fact: 'Staying active is recommended over bed rest for sciatica.', quote: 'stay active' }], cost: 0.01, tokens: { input: 5000, output: 30 }, retrieved: true }),
      fitness: okFitness,
    }
    const r = await runRetrievalResearch({ jobId: 'j', stepNumber: 7, units: ['How long does sciatica take to heal?'], topic: TOPIC, industry: 'chiropractic', deps })
    expect(r.facts).toHaveLength(2)
    expect(r.chunkUris).toEqual(['https://pubmed.ncbi.nlm.nih.gov/123/', 'https://www.cdc.gov/back-pain'])
    expect(r.supports[0]).toEqual({ text: r.facts[0].fact, urls: ['https://pubmed.ncbi.nlm.nih.gov/123/'] })
    expect(r.cost).toBeCloseTo(0.011)
    expect(r.stats.pagesRead).toBe(2)
    expect(r.text).toContain('[Source: Sciatica: a review, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/123/]')
  })
})

describe('source vetting inside retrieval (2026-11-24)', () => {
  const unit = 'How long does sciatica take to heal?'
  const base = {
    pubmedSearch: async () => [],
    pubmedAbstract: async () => null,
    extractFromText: async () => ({ facts: [], cost: 0, tokens: { input: 0, output: 0 } }),
  }
  it('never reads a paper whose PubMed record is a case report, and reads the next candidate instead', async () => {
    const read: string[] = []
    const deps: RetrievalDeps = {
      ...base,
      serp: async () => [
        { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4082899/', title: 'Acute sciatic neuritis following lumbar laminectomy', snippet: 'sciatica heal weeks' },
        { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11465477/', title: 'Lumbar disc herniation and sciatica: how long to heal', snippet: 'sciatica heal weeks' },
      ],
      extractFromUrl: async (_u, url) => {
        read.push(url)
        return { facts: [{ fact: 'Three in four people with sciatica improve within a month.', quote: '75% within one month' }], cost: 0, tokens: { input: 0, output: 0 }, retrieved: true }
      },
      fitness: {
        ...okFitness,
        paperRecord: async (url) => (url.includes('PMC4082899') ? { pmid: '1', title: 'Acute sciatic neuritis following lumbar laminectomy', pubTypes: ['Case Reports', 'Journal Article'], journal: null, year: 2014 } : { pmid: '2', title: 'Lumbar disc herniation', pubTypes: ['Journal Article', 'Review'], journal: null, year: 2024 }),
      },
    }
    const r = await runRetrievalResearch({ jobId: 'j', stepNumber: 8, units: [unit], topic: TOPIC, industry: 'Chiropractor', deps })
    expect(read).toEqual(['https://pmc.ncbi.nlm.nih.gov/articles/PMC11465477/'])
    expect(r.facts.map((f) => f.url)).toEqual(['https://pmc.ncbi.nlm.nih.gov/articles/PMC11465477/'])
    expect(r.stats.sourcesRejected).toBe(1)
  })
  it('drops every fact of a source the card calls critical of the profession', async () => {
    const deps: RetrievalDeps = {
      ...base,
      serp: async () => [{ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1905885/', title: 'Adverse effects of spinal manipulation and sciatica: how long to heal', snippet: 'sciatica heal weeks' }],
      extractFromUrl: async () => ({ facts: [{ fact: 'Mild adverse effects follow 30% to 61% of spinal manipulations.', quote: 'mild adverse effects occur in 30% to 61% of all patients' }], cost: 0, tokens: { input: 0, output: 0 }, retrieved: true }),
      fitness: { ...okFitness, judge: async () => ({ text: card({ stance: 'critical' }), cost: 0.0005, tokens: { input: 900, output: 80 } }) },
    }
    const r = await runRetrievalResearch({ jobId: 'j', stepNumber: 8, units: [unit], topic: TOPIC, industry: 'Chiropractor', deps })
    expect(r.facts).toHaveLength(0)
    expect(r.stats.sourcesRejected).toBe(1)
    expect(r.cost).toBeCloseTo(0.0005)
  })
  it('marks a single study with the group it studied and leaves Azavea sources unvetted', async () => {
    const serp = async () => [{ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC777/', title: 'Sciatica heal time in runners', snippet: 'sciatica heal weeks' }]
    const extractFromUrl = async () => ({ facts: [{ fact: 'Runners with sciatica returned to training after six weeks.', quote: 'returned to training after six weeks' }], cost: 0, tokens: { input: 0, output: 0 }, retrieved: true })
    const study = { ...okFitness, paperRecord: async () => ({ pmid: '7', title: 'Sciatica heal time in runners', pubTypes: ['Journal Article'], journal: null, year: 2023 }), judge: async () => ({ text: card({ population: 'Recreational runners.' }), cost: 0, tokens: { input: 0, output: 0 } }) }
    const r = await runRetrievalResearch({ jobId: 'j', stepNumber: 8, units: [unit], topic: TOPIC, industry: 'Chiropractor', deps: { ...base, serp, extractFromUrl, fitness: study } })
    expect(r.facts[0].fact).toBe('Runners with sciatica returned to training after six weeks. (One study, in recreational runners.)')
    expect(r.supports[0].text).toBe(r.facts[0].fact)
    let judged = 0
    const counting = { ...okFitness, judge: async () => (judged++, { text: card({ stance: 'critical' }), cost: 0, tokens: { input: 0, output: 0 } }) }
    await runRetrievalResearch({ jobId: 'j', stepNumber: 8, units: ['What does a marketing retainer include?'], topic: 'Marketing retainers for practices', industry: 'agency', vertical: 'azavea', deps: { ...base, serp: async () => [{ url: 'https://www.ftc.gov/retainer', title: 'marketing retainer rules practices', snippet: 'retainer' }], extractFromUrl, fitness: counting } })
    expect(judged).toBe(0)
  })
})

describe('Azavea vertical sources (business, not clinical)', () => {
  it('builds regulator/business queries and admits business hosts only for azavea', async () => {
    const { isCitable, sourceTier } = await import('../citation-policy')
    const [a, b] = buildQueries('What does a marketing retainer include?', 'Marketing retainers for practices', 'azavea')
    expect(a).toContain('site:ftc.gov')
    expect(a).not.toContain('pubmed')
    expect(b).toContain('site:hbr.org')
    expect(isCitable('https://hbr.org/2024/01/x', 'azavea')).toBe(true)
    expect(isCitable('https://hbr.org/2024/01/x', 'chiro')).toBe(false)
    expect(isCitable('https://hbr.org/2024/01/x')).toBe(false)
    expect(sourceTier('https://www.ftc.gov/business-guidance', 'chiro')).toBe('authority')
    expect(rankCandidates([{ url: 'https://www.pewresearch.org/x', title: 'retainer marketing practice survey', snippet: 'retainer' }], 'marketing retainer', 'practice marketing', new Set(), 'azavea')).toHaveLength(1)
    expect(rankCandidates([{ url: 'https://www.pewresearch.org/x', title: 'retainer marketing practice survey', snippet: 'retainer' }], 'marketing retainer', 'practice marketing', new Set(), 'wellness')).toHaveLength(0)
  })
})

import { extractionPrompt } from '../research-retrieval'

describe('extraction prompt by vertical (2026-11-12)', () => {
  it('adds the practice-measures rule for Azavea only', () => {
    const az = extractionPrompt('Patient retention', 'chiropractic', 'SOURCE PAGE: x', 'retainers', 'azavea')
    expect(az).toMatch(/net revenue retention/)
    expect(az).toMatch(/measures a practice uses/)
    const chiro = extractionPrompt('Back stiffness', 'chiropractic', 'SOURCE PAGE: x', 'stiffness', 'chiro')
    expect(chiro).not.toMatch(/net revenue retention/)
    expect(extractionPrompt('Back stiffness', 'chiropractic', 'SOURCE PAGE: x', 'stiffness')).not.toMatch(/subscription/)
  })
})
