import { describe, it, expect } from 'vitest'
import { assessSource, cardPrompt, classifyPaper, factUse, parseCard, quoteCitesOthers, sourceFamily, sourceRejection, type FitnessDeps, type SourceCard, type SourceMeta } from '../source-fitness'

/**
 * The cases are the sources Gemini's read of the GEMINI2 bench (2026-11-24)
 * called out, with the publication types PubMed returned for them in the replay.
 */

const meta = (over: Partial<SourceMeta> = {}): SourceMeta => ({ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', family: 'paper', title: 'Sciatica: a review', pubTypes: ['Journal Article', 'Review'], journal: null, year: 2022, pmid: '1', ...over })
const cardOf = (over: Partial<SourceCard> = {}): SourceCard => ({ about: 'sciatica', docType: 'narrative review', population: 'adults with sciatica', conclusion: '', stance: 'neutral', factsAbout: 'sciatica', sameSubject: true, readerMatch: true, facts: [{ own: true, common: false }], ...over })

describe('sourceFamily', () => {
  it('tells papers, reference texts and authority pages apart', () => {
    expect(sourceFamily('https://pmc.ncbi.nlm.nih.gov/articles/PMC4082899/')).toBe('paper')
    expect(sourceFamily('https://pubmed.ncbi.nlm.nih.gov/33565921/')).toBe('paper')
    expect(sourceFamily('https://www.bmj.com/content/1/2')).toBe('paper')
    expect(sourceFamily('https://www.ncbi.nlm.nih.gov/books/NBK507908/')).toBe('reference')
    expect(sourceFamily('https://www.mayoclinic.org/diseases-conditions/sciatica/symptoms-causes/syc-20377435')).toBe('page')
    expect(sourceFamily('https://www.nhs.uk/conditions/sciatica/')).toBe('page')
  })
})

describe('classifyPaper: the type check, no model involved', () => {
  it('rejects case reports by PubMed type', () => {
    expect(classifyPaper(['Case Reports', 'Journal Article'], 'Severe muscle pain and stiffness due to dexmethylphenidate.').reject).toBe('a case report')
    expect(classifyPaper(['Case Reports', 'Journal Article'], 'Recognition of Juvenile Ankylosing Spondylitis in an Adolescent Female').reject).toBe('a case report')
  })
  it('rejects a trial plan that PubMed files as a randomized controlled trial, by its title', () => {
    const r = classifyPaper(['Journal Article', 'Multicenter Study', 'Randomized Controlled Trial'], 'The clinical and cost-effectiveness of stratified care for patients with sciatica: the SCOPiC randomised controlled trial protocol')
    expect(r.reject).toMatch(/trial plan/)
  })
  it('rejects editorials, comments, letters, retractions and preprints', () => {
    expect(classifyPaper(['Editorial', 'Comment'], 'Deep gluteal syndrome: an overlooked cause of sciatica.').reject).toBe('an editorial')
    expect(classifyPaper(['Letter'], 'Re: spinal manipulation').reject).toBe('a letter')
    expect(classifyPaper(['Journal Article', 'Retracted Publication'], 'A trial').reject).toBe('retracted')
    expect(classifyPaper(['Preprint'], 'A trial').reject).toMatch(/preprint/)
  })
  it('rejects case reports and animal work that carry no telling type, by title', () => {
    expect(classifyPaper(['Journal Article'], 'Assessing the Efficacy of Hyperbaric Oxygen Therapy on Facelift Outcomes: A Case Series').reject).toBe('a case report')
    expect(classifyPaper(['Journal Article'], 'Hyperbaric oxygen reduces inflammation in a rat model of colitis').reject).toMatch(/animal/)
  })
  it('accepts reviews and trials, and tells them apart', () => {
    expect(classifyPaper(['Journal Article', 'Systematic Review'], 'Adverse effects of spinal manipulation: a systematic review.')).toEqual({ cls: 'synthesis', reject: null })
    expect(classifyPaper(['Journal Article', 'Randomized Controlled Trial'], 'Massage after exercise')).toEqual({ cls: 'study', reject: null })
    // PubMed files this meta-analysis as a plain journal article; the title says what it is.
    expect(classifyPaper(['Journal Article'], 'An Evidence-Based Approach for Choosing Post-exercise Recovery Techniques: A Systematic Review With Meta-Analysis').cls).toBe('synthesis')
  })
  it('does not mistake ordinary titles for plans or case reports', () => {
    expect(classifyPaper(['Journal Article', 'Review'], 'Hyperbaric oxygen treatment protocols and outcomes in wound care: a review').reject).toBeNull()
    expect(classifyPaper(['Journal Article'], 'Massage impairs postexercise muscle blood flow and "lactic acid" removal.').reject).toBeNull()
  })
})

describe('quoteCitesOthers: the source is reporting someone else', () => {
  it('catches reference markers and reported-speech wording', () => {
    expect(quoteCitesOthers('It is believed that many patients with sciatica have a favourable outcome and experience resolution of symptoms within 12 weeks from onset [2, 4].')).toBe(true)
    expect(quoteCitesOthers('Sleep under seven hours raises cortisol (Smith et al., 2019).')).toBe(true)
    expect(quoteCitesOthers('Four clinical features of DGS have been reported most frequently in the literature')).toBe(true)
    expect(quoteCitesOthers('Previous studies showed that massage reduces soreness.')).toBe(true)
  })
  it('leaves a study’s own results alone', () => {
    expect(quoteCitesOthers('According to the multivariable analyses, prolonged sitting (OR: 3.0, 95% CI: 1.7-5.5) was significantly associated with flare-ups.')).toBe(false)
    expect(quoteCitesOthers('43% of patients with less than one hour of morning stiffness considered their stiffness severe.')).toBe(false)
    expect(quoteCitesOthers('The two prospective reports suggested that relatively mild adverse effects occur in 30% to 61% of all patients.')).toBe(false)
  })
})

describe('parseCard', () => {
  it('reads the judge’s JSON and fills in facts it did not rate', () => {
    const c = parseCard('{"about":"sensor gloves","doc_type":"Engineering or technology paper","population":"RA patients","facts_about":"morning stiffness","conclusion":"x","stance":"neutral","same_subject":false,"reader_match":"true","facts":[{"n":1,"own":false,"common":true}]}', 2)!
    expect(c.docType).toBe('engineering or technology paper')
    expect(c.sameSubject).toBe(false)
    expect(c.readerMatch).toBe(true)
    expect(c.facts).toEqual([{ own: false, common: true }, { own: true, common: false }])
  })
  it('treats an unknown stance as neutral and garbage as no card', () => {
    expect(parseCard('{"stance":"mixed","same_subject":true,"reader_match":true,"facts":[]}', 0)!.stance).toBe('neutral')
    expect(parseCard('sorry, I cannot', 1)).toBeNull()
  })
})

describe('sourceRejection: may the source be cited at all', () => {
  it('rejects a source critical of the practice’s own profession, even a systematic review stating its own finding', () => {
    const ernst = meta({ title: 'Adverse effects of spinal manipulation: a systematic review.', pubTypes: ['Journal Article', 'Systematic Review'] })
    expect(sourceRejection(ernst, cardOf({ stance: 'critical' }))).toMatch(/critical of the practice/)
  })
  it('rejects a source about something else, and one covering a different group', () => {
    expect(sourceRejection(meta(), cardOf({ sameSubject: false, about: 'wearable sensor gloves' }))).toBe('about something else (wearable sensor gloves)')
    expect(sourceRejection(meta(), cardOf({ readerMatch: false, population: 'patients with rheumatoid arthritis undergoing arthroplasty' }))).toMatch(/different group/)
  })
  it('rejects what the model recognises as a case report or engineering paper when PubMed’s record does not say so', () => {
    expect(sourceRejection(meta({ pubTypes: ['Journal Article'], title: 'Acute Sciatic Neuritis following Lumbar Laminectomy.' }), cardOf({ docType: 'case report' }))).toBe('a case report')
    expect(sourceRejection(meta({ pubTypes: ['Journal Article', 'Review'], title: 'Review of Wearable Sensor-Based Health Monitoring Glove Devices for Rheumatoid Arthritis' }), cardOf({ docType: 'engineering or technology paper' }))).toMatch(/engineering/)
  })
  it('keeps a neutral, on-subject source, and never applies paper types to an authority page', () => {
    expect(sourceRejection(meta(), cardOf())).toBeNull()
    const page = meta({ family: 'page', url: 'https://health.harvard.edu/blog/x', title: 'Stretching studios: do you need what they offer?', pubTypes: [] })
    expect(sourceRejection(page, cardOf({ docType: 'news, blog or opinion' }))).toBeNull()
    expect(sourceRejection(page, cardOf({ stance: 'critical' }))).toMatch(/critical/)
  })
})

describe('factUse: what a fact from an accepted source may be used for', () => {
  const study = meta({ pubTypes: ['Journal Article'], title: 'Differences in risk factors for flare-ups in patients with lumbar radicular pain' })
  it('a single study is cited only for its own finding, as that finding', () => {
    expect(factUse(study, cardOf(), 0, 'prolonged sitting (OR: 3.0) was significantly associated').use).toBe('cite-as-finding')
    expect(factUse(study, cardOf({ facts: [{ own: false, common: false }] }), 0, 'x').use).toBe('drop')
    expect(factUse(study, cardOf({ facts: [{ own: true, common: true }] }), 0, 'x').use).toBe('drop')
    expect(factUse(study, cardOf(), 0, 'Sciatica resolves within 12 weeks [2, 4].').use).toBe('drop')
  })
  it('a review, a reference text and an authority page may state common knowledge and report the literature', () => {
    const background = cardOf({ facts: [{ own: false, common: true }] })
    expect(factUse(meta(), background, 0, 'Massage is widely used [3].').use).toBe('cite')
    expect(factUse(meta({ family: 'reference', url: 'https://www.ncbi.nlm.nih.gov/books/NBK507908/', pubTypes: [] }), background, 0, 'x').use).toBe('cite')
    expect(factUse(meta({ family: 'page', url: 'https://www.mayoclinic.org/x', pubTypes: [] }), background, 0, 'x').use).toBe('cite')
  })
})

describe('cardPrompt', () => {
  it('names the practice, the article, the source and every fact', () => {
    const p = cardPrompt({ practice: 'Chiropractor', topic: 'Sciatica flare-ups', sections: ['What does a chiropractor do?'], meta: meta({ journal: 'J R Soc Med', year: 2007 }), text: 'Abstract text', facts: [{ fact: 'Fact one.', quote: 'quote one' }, { fact: 'Fact two.', quote: 'quote two' }] })
    expect(p).toContain('Practice: Chiropractor.')
    expect(p).toContain('"Sciatica flare-ups"')
    expect(p).toContain('J R Soc Med (2007)')
    expect(p).toContain('1. Fact one.')
    expect(p).toContain('2. Fact two.')
    expect(p).toMatch(/catalogue its harms/)
    expect(p).toMatch(/never with the article/)
  })
})

describe('assessSource', () => {
  const judgeOk = async () => ({ text: JSON.stringify({ about: 'a', doc_type: 'narrative review', population: 'adults', facts_about: 'a', conclusion: 'c', stance: 'neutral', same_subject: true, reader_match: true, facts: [{ n: 1, own: true, common: false }] }), cost: 0.0004, tokens: { input: 800, output: 90 } })
  const fact = [{ fact: 'A fact.', quote: 'a quote' }]

  it('a case report costs nothing: the model is never asked', async () => {
    let judged = 0
    const deps: FitnessDeps = { paperRecord: async () => ({ pmid: '9', title: 'A case', pubTypes: ['Case Reports'], journal: null, year: 2020 }), abstract: async () => 'x', judge: async () => (judged++, judgeOk()) }
    const a = await assessSource({ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7069845/', title: 't', practice: 'Chiropractor', topic: 'x', facts: fact }, deps)
    expect(a.rejected).toBe('a case report')
    expect(a.facts).toEqual([{ use: 'drop', reason: 'a case report' }])
    expect(a.cost).toBe(0)
    expect(judged).toBe(0)
  })
  it('a PubMed paper whose record cannot be read is not cited', async () => {
    const deps: FitnessDeps = { paperRecord: async () => null, abstract: async () => null, judge: judgeOk }
    const a = await assessSource({ url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', title: 't', practice: 'Chiropractor', topic: 'x', facts: fact }, deps)
    expect(a.rejected).toBe('could not be vetted')
  })
  it('an authority page survives a failed judge; a paper does not', async () => {
    const failing: FitnessDeps = { paperRecord: async () => ({ pmid: '9', title: 'A review', pubTypes: ['Review'], journal: null, year: 2020 }), abstract: async () => 'x', judge: async () => { throw new Error('down') } }
    expect((await assessSource({ url: 'https://www.mayoclinic.org/sciatica', title: 'Sciatica', practice: 'Chiropractor', topic: 'x', facts: fact }, failing)).rejected).toBeNull()
    expect((await assessSource({ url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', title: 't', practice: 'Chiropractor', topic: 'x', facts: fact }, failing)).rejected).toBe('could not be vetted')
  })
  it('reads the abstract for a paper found by search, where only a snippet is held', async () => {
    let prompt = ''
    const deps: FitnessDeps = { paperRecord: async () => ({ pmid: '9', title: 'A review', pubTypes: ['Review'], journal: null, year: 2020 }), abstract: async () => 'THE ABSTRACT', judge: async (p) => ((prompt = p), judgeOk()) }
    const a = await assessSource({ url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', title: 't', practice: 'Chiropractor', topic: 'x', facts: fact, text: 'short snippet' }, deps)
    expect(prompt).toContain('THE ABSTRACT')
    expect(a.rejected).toBeNull()
    expect(a.facts[0].use).toBe('cite')
    expect(a.cost).toBeCloseTo(0.0004)
  })
})
