import { describe, it, expect } from 'vitest'
import { sourceTier, isCitable, rankCitationPool, stripUnpooledLinks, titleLooksLikeDomain, MIN_CURATED_AUTHORITY } from '../citation-policy'
import { extractCitationsForValidation } from '../citation-validator'

describe('sourceTier (default deny)', () => {
  it('passes journals, PubMed, DOI as primary', () => {
    for (const u of [
      'https://pubmed.ncbi.nlm.nih.gov/12345/',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/',
      'https://doi.org/10.1000/xyz',
      'https://ard.bmj.com/content/1',
      'https://www.thelancet.com/journals/lancet/article',
      'https://jamanetwork.com/journals/jamanetworkopen/x',
      'https://link.springer.com/article/1',
      'https://www.jospt.org/doi/1',
    ])
      expect(sourceTier(u), u).toBe('primary')
  })
  it('passes government, universities, colleges and major health bodies as authority', () => {
    for (const u of [
      'https://www.aihw.gov.au/reports/x',
      'https://www.racgp.org.au/clinical-resources',
      'https://www.safetyandquality.gov.au/standards',
      'https://health.harvard.edu/x',
      'https://www.mayoclinic.org/x',
      'https://www.ahpra.gov.au/register',
      'https://australian.physio/x',
      'https://www.theguardian.com/science/x',
      'https://www.ox.ac.uk/news',
    ])
      expect(sourceTier(u), u).toBe('authority')
  })
  it('rejects clinics, product sites, aggregators and everything unknown', () => {
    for (const u of [
      'https://livealignedwi.com/blog/taller-in-the-morning',
      'https://backbonechiropractic.nl/x',
      'https://nyboneandjoint.com/synovial-fluid',
      'https://chirocaremattresses.com.au/x',
      'https://articles.mercola.com/x',
      'https://studyfinds.com/x',
      'https://www.healthline.com/x',
      'https://en.wikipedia.org/wiki/Spine',
      'https://ckphysio.co.uk/x',
      'https://pogophysio.com.au/x',
      'not a url',
    ])
      expect(isCitable(u), u).toBe(false)
  })
})

describe('rankCitationPool', () => {
  it('puts curated authority ≥ 7 first, then policy-passing grounding, dedupes and caps', () => {
    const curated = [
      { title: 'AIHW back problems', url: 'https://www.aihw.gov.au/reports/back', authority: 9 },
      { title: 'Low-authority blog', url: 'https://someclinic.com/post', authority: 9 },
      { title: 'Weak journal entry', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', authority: 5 },
      { title: 'RACGP guidance', url: 'https://www.racgp.org.au/x', authority: 8 },
    ]
    const grounding = [
      { title: 'nih.gov', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9/' },
      { title: 'mercola.com', url: 'https://articles.mercola.com/x' },
      { title: 'aihw.gov.au', url: 'https://www.aihw.gov.au/reports/back/' },
      { title: 'theguardian.com', url: 'https://www.theguardian.com/x' },
    ]
    const { pool, rejected } = rankCitationPool(curated, grounding, 3)
    expect(pool.map((p) => p.url)).toEqual([
      'https://www.aihw.gov.au/reports/back',
      'https://www.racgp.org.au/x',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC9/',
    ])
    expect(pool.every((p) => p.origin === 'curated' || p.tier !== 'rejected')).toBe(true)
    expect(rejected.map((r) => r.url)).toEqual(expect.arrayContaining(['https://someclinic.com/post', 'https://pubmed.ncbi.nlm.nih.gov/1/', 'https://articles.mercola.com/x']))
    expect(MIN_CURATED_AUTHORITY).toBe(7)
  })

  it('accepts curated sources that carry no rating at all (the live step-12 shape)', () => {
    const curated = [
      { title: 'Sciatica - StatPearls', url: 'https://www.ncbi.nlm.nih.gov/books/NBK507908/' },
      { title: 'RACGP cauda equina', url: 'https://www1.racgp.org.au/ajgp/x' },
      { title: 'Some clinic', url: 'https://someclinic.com.au/x' },
    ]
    const { pool, rejected } = rankCitationPool(curated, [])
    expect(pool.map((p) => p.url)).toEqual(['https://www.ncbi.nlm.nih.gov/books/NBK507908/', 'https://www1.racgp.org.au/ajgp/x'])
    expect(rejected.map((r) => r.url)).toEqual(['https://someclinic.com.au/x'])
  })
})

describe('stripUnpooledLinks', () => {
  it('unwraps links outside the pool, keeps pooled and internal links', () => {
    const html =
      '<p>Discs <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9/" target="_blank">rehydrate overnight</a>, and ' +
      '<a href="https://livealignedwi.com/taller">people are taller in the morning</a>. See <a href="#faq">the FAQ</a>.</p>'
    const r = stripUnpooledLinks(html, ['https://pmc.ncbi.nlm.nih.gov/articles/PMC9'])
    expect(r.stripped).toBe(1)
    expect(r.strippedHosts).toEqual(['livealignedwi.com'])
    expect(r.html).toContain('<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9/" target="_blank">rehydrate overnight</a>')
    expect(r.html).toContain(', and people are taller in the morning.')
    expect(r.html).toContain('<a href="#faq">the FAQ</a>')
  })
})

describe('titles and authority parsing', () => {
  it('recognises host-only titles', () => {
    expect(titleLooksLikeDomain('nih.gov')).toBe(true)
    expect(titleLooksLikeDomain('')).toBe(true)
    expect(titleLooksLikeDomain('Low back pain in Australia - AIHW')).toBe(false)
  })
  it('carries the step-12 authority rating through extraction', () => {
    const raw = JSON.stringify([{ sourceTitle: 'A', sourceUrl: 'https://a.gov/x', authority: 8 }, { sourceTitle: 'B', sourceUrl: 'https://b.org/y', authority: '6' }, { sourceTitle: 'C', sourceUrl: 'https://c.org/z' }])
    expect(extractCitationsForValidation(raw)).toEqual([
      { title: 'A', url: 'https://a.gov/x', authority: 8 },
      { title: 'B', url: 'https://b.org/y', authority: 6 },
      { title: 'C', url: 'https://c.org/z' },
    ])
  })
})
