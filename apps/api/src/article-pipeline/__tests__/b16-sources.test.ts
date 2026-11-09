import { describe, it, expect } from 'vitest'
import { verifyFactSources, groundedCandidates, parseFactTags, isFigureFactLocal, loadFactSources, pubmedFill, type Resolvers } from '../source-verify'
import { isFigureFact, quoteGrounded, fetchSourceText, checkSupport, type SupportDeps } from '../source-support'
import { cleanCandidates, serpGeoFor, fetchPaaCandidates, formatPaaCandidates } from '../faq-oxylabs'
import { buildCitationsFromUsedSources } from '../approval-service'
import { restoreBoundary, isBoundarySentence } from '../../lib/text/boundary-restore'

const resolvers: Resolvers = {
  pubmedTitle: async (id) => (id === '37559207' ? 'Incidence of Spontaneous Resorption of Lumbar Disc Herniation: A Meta-analysis.' : id === '11111' ? 'Acquired perforating dermatosis' : null),
  pmcTitle: async () => null,
  doiTitle: async () => null,
  pubmedSearch: async (q) => (/review\[pt\]/.test(q) ? [{ id: '555', title: 'Low back pain in adults: a systematic review of sitting and disc load' }] : []),
  pageTitle: async (url) => (/aihw/.test(url) ? 'Back problems - Australian Institute of Health and Welfare' : /racgp.*non-radicular/.test(url) ? 'Non-radicular low back pain: Assessment and evidence-based treatment' : null),
}

describe('grounding supports → fact pairing', () => {
  const feed =
    'Approximately 70% of lumbar disc herniations resorb without surgery under conservative care. [Source: Zou T, Clinical Spine Surgery, 2024, https://pubmed.ncbi.nlm.nih.gov/11111/]\n\n' +
    'Back problems affect about one in six Australians at any time. [Source: AIHW, Australian Government, 2024]'
  const supports = [
    { text: 'Approximately 70% of lumbar disc herniations resorb without surgery under conservative care', urls: ['https://pubmed.ncbi.nlm.nih.gov/37559207/', 'https://someclinic.com/x'] },
    { text: 'Back problems affect about one in six Australians at any time', urls: ['https://www.aihw.gov.au/reports/back-problems'] },
  ]
  it('picks grounded pages for the span that carries the fact', () => {
    const tags = parseFactTags(feed)
    expect(groundedCandidates(tags[0], supports)).toEqual(['https://pubmed.ncbi.nlm.nih.gov/37559207/', 'https://someclinic.com/x'])
    expect(groundedCandidates(tags[1], supports)).toEqual(['https://www.aihw.gov.au/reports/back-problems'])
  })
  it('replaces a wrong identifier with the grounded page and fills a missing URL from grounding', async () => {
    const r = await verifyFactSources(feed, {}, resolvers, { supports })
    expect(r.stats.grounded).toBe(2)
    expect(r.sources.map((s) => s.url)).toEqual(['https://pubmed.ncbi.nlm.nih.gov/37559207/', 'https://www.aihw.gov.au/reports/back-problems'])
    expect(r.text).toContain('[Source: AIHW, Australian Government, 2024, https://www.aihw.gov.au/reports/back-problems]')
  })
})

describe('support check rulings', () => {
  const feed =
    '**1. Resorption**\nApproximately 70% of lumbar disc herniations resorb without surgery. [Source: Zou T, Clinical Spine Surgery, 2024, https://pubmed.ncbi.nlm.nih.gov/37559207/]\n\n' +
    '**2. Staying active**\nStaying active resolves acute lumbar radicular pain better than bed rest. [Source: RACGP, AJGP, 2020, https://www1.racgp.org.au/ajgp/2020/november/non-radicular-low-back-pain]\n\n' +
    '**3. Prevalence**\nBack problems affect about one in six Australians at any time. [Source: AIHW, Australian Government, 2024, https://www.aihw.gov.au/reports/back-problems]'
  it('drops an unsupported figure fact, unlinks an unsupported qualitative claim, keeps the supported one with its quote', async () => {
    const support = async (fact: string, url: string) => {
      if (/70%/.test(fact)) return { verdict: 'partial' as const, quote: '', cost: 0.001 }
      if (/radicular/.test(fact)) return { verdict: 'unsupported' as const, quote: '', cost: 0.001 }
      return { verdict: 'supported' as const, quote: 'About one in six Australians (16%) had back problems in 2022.', cost: 0.001 }
    }
    const r = await verifyFactSources(feed, {}, resolvers, { support })
    expect(r.stats).toMatchObject({ supportChecked: 3, figureDropped: 1, unlinkedQualitative: 1 })
    expect(r.text).not.toContain('70%')
    expect(r.text).not.toContain('**1. Resorption**')
    expect(r.text).toContain('Staying active resolves acute lumbar radicular pain better than bed rest. [Source: RACGP, AJGP, 2020]')
    expect(r.sources).toHaveLength(1)
    expect(r.sources[0].quote).toMatch(/one in six/)
  })
  it('classifies figure facts', () => {
    expect(isFigureFactLocal('About 70% of herniations resorb.')).toBe(true)
    expect(isFigureFactLocal('One in six adults has back problems.')).toBe(true)
    expect(isFigureFactLocal('In 2023 the guideline was updated to favour staying active.')).toBe(false)
    expect(isFigureFact('Walking programs reduce recurrence.')).toBe(false)
  })
})

describe('source-support plumbing', () => {
  const deps: SupportDeps = {
    pubmedAbstract: async (id) => (id === '37559207' ? 'Spontaneous resorption of lumbar disc herniation occurred in approximately 70% of patients treated conservatively.' : null),
    pageHtml: async (url) => (/aihw/.test(url) ? '<html><title>Back problems - AIHW</title><body>' + 'About one in six Australians (16%) had back problems in 2022. '.repeat(20) + '</body></html>' : /books/.test(url) ? '<html><title>Checking your browser - reCAPTCHA</title><body>x</body></html>' : null),
    scrape: async (url) => (/books/.test(url) ? '<html><body>' + 'Sciatica describes pain along the sciatic nerve. '.repeat(30) + '</body></html>' : null),
    judge: async (fact, source) => ({ text: `{"verdict":"supported","quote":"${source.slice(0, 60)}"}`, cost: 0.0005 }),
  }
  it('reads the abstract for PubMed, the page for others, the scraper on a bot wall', async () => {
    expect((await fetchSourceText('https://pubmed.ncbi.nlm.nih.gov/37559207/', deps)).via).toBe('abstract')
    expect((await fetchSourceText('https://www.aihw.gov.au/reports/back-problems', deps)).via).toBe('page')
    expect((await fetchSourceText('https://www.ncbi.nlm.nih.gov/books/NBK507908/', deps)).via).toBe('scraper')
  })
  it('downgrades a quote that is not in the source', () => {
    expect(quoteGrounded('About one in six Australians had back problems', 'about one in six australians (16%) had back problems in 2022.')).toBe(true)
    expect(quoteGrounded('Seventy percent resorb within six months', 'about one in six australians had back problems.')).toBe(false)
  })
  it('returns a verdict with a grounded quote', async () => {
    const r = await checkSupport('About one in six Australians have back problems.', 'https://www.aihw.gov.au/reports/back-problems', {}, deps)
    expect(r.verdict).toBe('supported')
    expect(r.quote).toMatch(/one in six/)
  })
})

describe('step 6 via Oxylabs', () => {
  it('maps geolocation and cleans candidates', () => {
    expect(serpGeoFor('Australia, Queensland')).toEqual({ geo: 'Australia', domain: 'com.au' })
    expect(serpGeoFor('Miami, Florida, USA')).toEqual({ geo: 'United States', domain: 'com' })
    expect(cleanCandidates(['Why does my lower back hurt when I get up after sitting?', 'why does my lower back hurt when i get up after sitting', 'Chiropractor near me', 'Short'], ['How to fix lower back pain?'])).toEqual(['Why does my lower back hurt when I get up after sitting?'])
  })
  it('fetches, dedupes and formats candidates from three queries', async () => {
    const fetcher = async (q: string) => ({ questions: [`What causes ${q}?`, 'Why can I barely walk after sitting?'], relatedSearches: ['Lower back pain when sitting but not standing'] })
    const c = await fetchPaaCandidates(['lower back pain after sitting', 'lumbar disc', 'hip flexors'], 'Australia, Queensland', [], {}, fetcher)
    expect(c.questions).toHaveLength(4)
    expect(c.relatedSearches).toEqual(['Lower back pain when sitting but not standing'])
    expect(formatPaaCandidates(c)).toContain('People Also Ask (verbatim from Google):')
  })
})

describe('references from used sources', () => {
  it('lists the links in order of appearance, then unanchored verified sources, never a model-typed list', () => {
    const html = '<p>A <a href="https://www.aihw.gov.au/reports/back-problems">fact</a>. B <a href="https://pubmed.ncbi.nlm.nih.gov/37559207/">fact</a>.</p>'
    const r = buildCitationsFromUsedSources(
      html,
      [
        { url: 'https://pubmed.ncbi.nlm.nih.gov/37559207/', title: 'Incidence of Spontaneous Resorption', status: 'verified' },
        { url: 'https://www1.racgp.org.au/ajgp/2024/september/best-practice-care-for-acute-low-back-pain', title: 'Best practice care for acute low back pain', status: 'grounded' },
      ],
      JSON.stringify([{ title: 'aihw.gov.au', url: 'https://www.aihw.gov.au/reports/back-problems', step: 8 }]),
    )!
    expect(r.resource_links.map((x) => x.link_url)).toEqual([
      'https://www.aihw.gov.au/reports/back-problems',
      'https://pubmed.ncbi.nlm.nih.gov/37559207/',
      'https://www1.racgp.org.au/ajgp/2024/september/best-practice-care-for-acute-low-back-pain',
    ])
    expect(r.resource_links[0].link_title).toBe('aihw.gov.au')
    expect(r.resource_links[1].link_title).toBe('Incidence of Spontaneous Resorption')
  })
  it('loads fact sources from the synthetic steps, falling back to tags', () => {
    const m = new Map<number, string>([[121, JSON.stringify([{ fact: 'f', url: 'https://a.gov/x', title: 'A', status: 'verified' }])], [122, JSON.stringify([{ fact: 'h', url: 'https://pubmed.ncbi.nlm.nih.gov/5/', title: 'B', status: 'fill' }])]])
    expect(loadFactSources(m).map((s) => s.url)).toEqual(['https://a.gov/x', 'https://pubmed.ncbi.nlm.nih.gov/5/'])
    const legacy = new Map<number, string>([[8, 'Fact. [Source: AIHW, Gov, 2024, https://www.aihw.gov.au/reports/x]']])
    expect(loadFactSources(legacy)[0].url).toBe('https://www.aihw.gov.au/reports/x')
  })
})

describe('pubmed fill and boundary restore', () => {
  it('fills from PubMed reviews per heading', async () => {
    const fill = await pubmedFill(['Why does my lower back hurt when sitting?', 'When is it time to stop managing this alone?'], 'lower back pain after sitting', 3, resolvers)
    expect(fill).toHaveLength(1)
    expect(fill[0]).toMatchObject({ status: 'fill', url: 'https://pubmed.ncbi.nlm.nih.gov/555/' })
  })
  it('restores a boundary sentence the edit dropped', () => {
    const draft = '## When to come in\n\nNight pain that wakes you is the sign that matters. When you come in, I check how the pelvis and hips move under load, and that decides whether we treat the back or investigate first.\n\nOther text.'
    const edited = '<h2>When to come in</h2>\n<p>Night pain that wakes you is the sign that matters, and numbness that spreads is the other one.</p>\n<p>Other text here.</p>'
    expect(isBoundarySentence('When you come in, I check how the pelvis and hips move under load, and that decides whether we treat the back or investigate first.')).toBe(true)
    const r = restoreBoundary(draft, edited)
    expect(r).toMatchObject({ draftHad: 1, editedHad: 0, lost: true, changed: true })
    expect(r.text).toContain('is the other one. When you come in, I check how the pelvis')
    const kept = restoreBoundary(draft, '<p>When you come in, I check how the pelvis and hips move under load, and that decides the plan.</p>')
    expect(kept.changed).toBe(false)
  })
})
