import { describe, it, expect } from 'vitest'
import { buildQueries, buildPubmedQueries, rankCandidates, parseFacts, assembleFeed, runRetrievalResearch, type RetrievalDeps } from '../research-retrieval'
import { researchUnitsFor, batchUnits } from '../research-units'

const TOPIC = 'Sciatica relief: what actually helps'

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
  it('builds a papers query and a bodies query with site restrictions', () => {
    const [papers, bodies] = buildQueries('How long does sciatica take to heal?', TOPIC)
    expect(papers).toContain('site:pubmed.ncbi.nlm.nih.gov')
    expect(papers).toContain('sciatica')
    expect(bodies).toContain('site:cdc.gov')
    expect(bodies).not.toContain('site:pubmed')
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
