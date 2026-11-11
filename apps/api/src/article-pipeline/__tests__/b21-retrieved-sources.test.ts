import { describe, it, expect } from 'vitest'
import { verifyFactSources, loadFactSources, type Resolvers, type RetrievedFactRecord } from '../source-verify'
import { rankCandidates } from '../research-retrieval'

/** Resolvers that would fail every grounded-path gate: no titles, no search hits. */
const blind: Resolvers = {
  pubmedTitle: async () => null,
  pmcTitle: async () => null,
  doiTitle: async () => null,
  pubmedSearch: async () => [],
  pageTitle: async () => 'Myofascial Pain Syndrome - StatPearls',
}

const URL = 'https://www.ncbi.nlm.nih.gov/books/NBK499882/'
const FEED =
  '1. Compression of neural structures within the fascia lowers the threshold of local pain. [Source: Myofascial Pain Syndrome - StatPearls, ncbi.nlm.nih.gov, https://www.ncbi.nlm.nih.gov/books/NBK499882/]\n' +
  '2. In a survey of 50 patients, 80% reported morning stiffness. [Source: Myofascial Pain Syndrome - StatPearls, ncbi.nlm.nih.gov, https://www.ncbi.nlm.nih.gov/books/NBK499882/]'
const retrieved: RetrievedFactRecord[] = [
  { fact: 'Compression of neural structures within the fascia lowers the threshold of local pain.', url: URL, title: 'Myofascial Pain Syndrome - StatPearls', quote: 'compression of neural structures lowers the threshold' },
  { fact: 'In a survey of 50 patients, 80% reported morning stiffness.', url: URL, title: 'Myofascial Pain Syndrome - StatPearls', quote: '80% reported morning stiffness' },
]

describe('B21 retrieval facts in the verifier', () => {
  it('keeps retrieval facts on their own provenance: no title gate, no LLM judge, one pool entry per fact', async () => {
    let judged = 0
    const r = await verifyFactSources(FEED, {}, blind, {
      retrieved,
      support: async () => {
        judged++
        return { verdict: 'unsupported', quote: '', cost: 0 }
      },
      quoteCheck: async () => null, // page unreadable → kept
    })
    expect(judged).toBe(0)
    expect(r.sources).toHaveLength(2)
    expect(r.sources.every((s) => s.status === 'retrieved' && s.url === URL)).toBe(true)
    expect(r.sources[1].quote).toBe('80% reported morning stiffness')
    expect(r.stats.retrieved).toBe(2)
    expect(r.text).toContain(URL)
  })

  it('a quote demonstrably absent from a readable page applies the rulings: figure fact removed, qualitative unlinked', async () => {
    const r = await verifyFactSources(FEED, {}, blind, { retrieved, quoteCheck: async () => false })
    expect(r.sources).toHaveLength(0)
    expect(r.stats.figureDropped).toBe(1)
    expect(r.stats.unlinkedQualitative).toBe(1)
    expect(r.text).not.toContain('80% reported')
    expect(r.text).toContain('Compression of neural structures')
    expect(r.text).not.toContain(URL)
  })

  it('a quote found in the page marks the fact supported', async () => {
    const r = await verifyFactSources(FEED, {}, blind, { retrieved, quoteCheck: async () => true })
    expect(r.sources.map((s) => s.verdict)).toEqual(['supported', 'supported'])
  })

  it('tags without a retrieval record still go through the grounded gates', async () => {
    const r = await verifyFactSources(FEED, {}, { ...blind, pageTitle: async () => 'Something else entirely' }, { retrieved: [] })
    expect(r.stats.retrieved).toBe(0)
    expect(r.sources).toHaveLength(0)
  })

  it('the pool keeps several facts from the same URL', () => {
    const steps = new Map<number, string>([
      [121, JSON.stringify([{ fact: 'A', url: URL, title: 't', status: 'retrieved' }, { fact: 'B', url: URL, title: 't', status: 'retrieved' }, { fact: 'A', url: URL, title: 't', status: 'retrieved' }])],
    ])
    expect(loadFactSources(steps).map((s) => s.fact)).toEqual(['A', 'B'])
  })
})

describe('B21 ranking requires a topic term', () => {
  it('drops a page that shares a unit word but nothing with the topic', () => {
    const ranked = rankCandidates(
      [
        { url: 'https://www.ncbi.nlm.nih.gov/books/NBK2/', title: 'Waking up rigid after anaesthesia', snippet: 'ready for discharge' },
        { url: 'https://www.ncbi.nlm.nih.gov/books/NBK1/', title: 'Morning stiffness and back pain', snippet: 'waking up stiff' },
      ],
      'The Waking Reality: Waking Up Rigid vs. Waking Up Ready',
      'Morning stiffness: what it means and when it is worth getting checked',
      new Set(),
    )
    expect(ranked.map((r) => r.url)).toEqual(['https://www.ncbi.nlm.nih.gov/books/NBK1/'])
  })
})

describe('B21b quote check', () => {
  it('reads the whole page and lets an abstract-only view stay undecided', async () => {
    const { quoteInPage } = await import('../source-support')
    const long = 'x '.repeat(4000) + 'Morning stiffness lasting over an hour points to inflammation. ' + 'y '.repeat(10)
    const deps = {
      pubmedAbstract: async () => 'Short abstract about something else.',
      bookshelfAbstract: async () => 'Short abstract about something else.',
      pageHtml: async () => `<html><title>Page</title><body><p>${long}</p></body></html>`,
      scrape: async () => null,
      judge: async () => ({ text: '', cost: 0 }),
      judgeViaGoogle: async () => null,
    } as unknown as import('../source-support').SupportDeps
    expect(await quoteInPage('Morning stiffness lasting over an hour points to inflammation', 'https://www.hopkinsmedicine.org/x', deps)).toBe(true)
    expect(await quoteInPage('nowhere in this page at all', 'https://www.hopkinsmedicine.org/x', deps)).toBe(false)
    const stub = { ...deps, pageHtml: async () => `<html><title>Page</title><body><p>${'short shell '.repeat(50)}</p></body></html>` }
    expect(await quoteInPage('nowhere in this page at all', 'https://www.hopkinsmedicine.org/x', stub)).toBe(null)
    expect(await quoteInPage('from the full chapter', 'https://www.ncbi.nlm.nih.gov/books/NBK1/', deps)).toBe(null)
    expect(await quoteInPage('from the full chapter', 'https://pubmed.ncbi.nlm.nih.gov/123/', deps)).toBe(false)
  })
})
