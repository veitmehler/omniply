import { describe, it, expect } from 'vitest'
import {
  parseFactTags,
  isRootUrl,
  contentTerms,
  titleCoversFact,
  identifyUrl,
  looksLikePaper,
  verifyFactSources,
  verifyCuratedIdentity,
  anchorFactSources,
  type Resolvers,
} from '../source-verify'

const FEED = `Here are 8 facts.

**1. Spontaneous resorption**
The overall incidence of spontaneous resorption of a herniated lumbar disc following conservative treatment is approximately seventy percent. [Source: Zou T, Clinical Spine Surgery, 2024, https://pubmed.ncbi.nlm.nih.gov/37523522/]

**2. Staying active**
Staying active and continuing normal daily movements is more effective for resolving acute lumbar radicular pain than resting in bed. [Source: Royal Australian College of General Practitioners, RACGP, 2024, https://www.racgp.org.au/]

**3. Sitting time**
Older adults typically sit for about 65% to 80% of their waking hours, which weakens the gluteus medius. [Source: Matthew Solan, Harvard Health Publishing, 2024, https://www.health.harvard.edu/pain/the-end-of-painful-sitting]

4. In my clinic most desk workers describe the same first-minute stiffness on standing. [OBS]
`

const fake: Resolvers = {
  pubmedTitle: async (id) => (id === '37523522' ? 'Assessing continuum plasticity postulates in triaxially compressed sand.' : id === '36864587' ? 'Incidence of Spontaneous Resorption of Lumbar Disc Herniation: A Meta-analysis' : null),
  pmcTitle: async () => null,
  doiTitle: async () => null,
  pubmedSearch: async (q) => (/resorption/.test(q) ? [{ id: '36864587', title: 'Incidence of Spontaneous Resorption of Lumbar Disc Herniation: A Meta-analysis' }, { id: '1', title: 'Complications following operation of herniated lumbar discs' }] : []),
  pageTitle: async (url) => (/harvard/.test(url) ? 'The end of painful sitting - Harvard Health' : null),
}

describe('parseFactTags', () => {
  it('pairs each fact with its tag and fields', () => {
    const tags = parseFactTags(FEED)
    expect(tags).toHaveLength(3)
    expect(tags[0].fact).toMatch(/^The overall incidence of spontaneous resorption/)
    expect(tags[0].url).toBe('https://pubmed.ncbi.nlm.nih.gov/37523522/')
    expect(tags[0].institution).toBe('Zou T')
    expect(tags[0].publisher).toBe('Clinical Spine Surgery')
    expect(tags[0].year).toBe('2024')
    expect(tags[1].fact).toMatch(/^Staying active/)
    expect(tags[2].fact).not.toMatch(/Staying active/)
  })
})

describe('helpers', () => {
  it('detects root urls and identifiers', () => {
    expect(isRootUrl('https://www.racgp.org.au/')).toBe(true)
    expect(isRootUrl('https://www.racgp.org.au')).toBe(true)
    expect(isRootUrl('https://www1.racgp.org.au/ajgp/2020/november/non-radicular-low-back-pain')).toBe(false)
    expect(identifyUrl('https://pubmed.ncbi.nlm.nih.gov/37523522/')).toEqual({ kind: 'pubmed', id: '37523522' })
    expect(identifyUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC12166487/')).toEqual({ kind: 'pmc', id: '12166487' })
    expect(identifyUrl('https://doi.org/10.1371/journal.pone.0338730')).toEqual({ kind: 'doi', id: '10.1371/journal.pone.0338730' })
    expect(identifyUrl('https://www.health.harvard.edu/pain/x')).toBeNull()
  })
  it('matches titles to facts by content terms', () => {
    const fact = 'The overall incidence of spontaneous resorption of a herniated lumbar disc following conservative treatment is approximately seventy percent.'
    expect(titleCoversFact('Incidence of Spontaneous Resorption of Lumbar Disc Herniation: A Meta-analysis', fact)).toBe(true)
    expect(titleCoversFact('Acquired perforating dermatosis: A clinicopathologic study of 37 cases', fact)).toBe(false)
    expect([...contentTerms('Lumbar discs and herniations')]).toEqual(['lumbar', 'disc', 'herniation'])
  })
  it('recognises paper-like tags', () => {
    const tags = parseFactTags(FEED)
    expect(looksLikePaper(tags[0])).toBe(true)
    expect(looksLikePaper(tags[1])).toBe(false)
  })
})

describe('verifyFactSources', () => {
  it('repairs a wrong PubMed id, drops a homepage, verifies a page title, leaves [OBS] alone', async () => {
    const r = await verifyFactSources(FEED, {}, fake)
    expect(r.stats).toMatchObject({ tags: 3, repaired: 1, verified: 1, dropped: 1, root: 1, obs: 0 })
    expect(r.text).toContain('[Source: Zou T, Clinical Spine Surgery, 2024, https://pubmed.ncbi.nlm.nih.gov/36864587/]')
    expect(r.text).toContain('[Source: Royal Australian College of General Practitioners, RACGP, 2024]')
    expect(r.text).not.toContain('https://www.racgp.org.au/')
    expect(r.text).toContain('[OBS]')
    expect(r.sources.map((s) => s.url)).toEqual(['https://pubmed.ncbi.nlm.nih.gov/36864587/', 'https://www.health.harvard.edu/pain/the-end-of-painful-sitting'])
    expect(r.sources[0].status).toBe('repaired')
    expect(r.sources[1].status).toBe('verified')
  })
  it('keeps a bot-blocked page as unchecked', async () => {
    const r = await verifyFactSources('Walking helps. [Source: AIHW, Australian Government, 2023, https://www.aihw.gov.au/reports/back-problems]', {}, { ...fake, pageTitle: async () => null })
    expect(r.stats.unchecked).toBe(1)
    expect(r.text).toContain('https://www.aihw.gov.au/reports/back-problems')
  })
})

describe('verifyCuratedIdentity', () => {
  it('rejects an identifier whose real title does not match the claimed one', async () => {
    const pairs = [
      { title: 'Incidence of Spontaneous Resorption of Lumbar Disc Herniation: A Meta-analysis', url: 'https://pubmed.ncbi.nlm.nih.gov/37523522/' },
      { title: 'Non-radicular low back pain', url: 'https://www1.racgp.org.au/ajgp/2020/november/non-radicular-low-back-pain' },
      { title: 'RACGP', url: 'https://www.racgp.org.au/' },
    ]
    const r = await verifyCuratedIdentity(pairs, {}, fake)
    expect(r.kept.map((k) => k.url)).toEqual(['https://www1.racgp.org.au/ajgp/2020/november/non-radicular-low-back-pain'])
    expect(r.rejected.map((x) => x.reason)).toEqual([expect.stringMatching(/^resolves to/), 'root url'])
  })
})

describe('anchorFactSources', () => {
  it('links each source to the sentence stating its fact, once, leaving marked-up paragraphs alone', () => {
    const html =
      '<h2>How long does it last?</h2>\n' +
      '<p>Most acute episodes settle within four to six weeks. Where a disc herniation is the cause, approximately seventy percent resorb on their own with conservative care, and most of that happens within six months.</p>\n' +
      '<p>Older adults sit for most of their waking hours, and the <span class="plain-gloss">gluteus medius</span> weakens.</p>\n' +
      '<p>Ice usually wins in the first two days.</p>'
    const r = anchorFactSources(html, [
      { fact: 'The overall incidence of spontaneous resorption of a herniated lumbar disc following conservative treatment is approximately seventy percent.', url: 'https://pubmed.ncbi.nlm.nih.gov/36864587/', title: 'x', status: 'repaired' },
      { fact: 'Older adults typically sit for about 65% to 80% of their waking hours, which weakens the gluteus medius.', url: 'https://www.health.harvard.edu/pain/the-end-of-painful-sitting', title: 'y', status: 'verified' },
    ])
    expect(r.placed).toEqual(['https://pubmed.ncbi.nlm.nih.gov/36864587/'])
    expect(r.unplaced.map((u) => u.url)).toEqual(['https://www.health.harvard.edu/pain/the-end-of-painful-sitting'])
    expect(r.html).toContain('<a href="https://pubmed.ncbi.nlm.nih.gov/36864587/" target="_blank" rel="noopener noreferrer">Where a disc herniation is the cause, approximately seventy percent resorb on their own with conservative care, and most of that happens within six months</a>.')
    expect(r.html).toContain('<p>Most acute episodes settle within four to six weeks. <a href=')
  })
})
