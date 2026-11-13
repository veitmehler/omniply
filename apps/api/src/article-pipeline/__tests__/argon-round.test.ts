import { describe, expect, it } from 'vitest'
import { isInterrogativeHeading, normalizeH2Questions } from '../approval-service'
import { anchorFactSources } from '../source-verify'
import { looksLikeTableRow, parseFacts, extractionPrompt } from '../research-retrieval'

// Argon (Gemini) round on Dasha's articles, 2026-11-12.
describe('question marks only on headings with interrogative form', () => {
  it('leaves statements that merely start with a wh-word alone', () => {
    for (const h of ['What a Guide-led Assessment Measures', 'Why the Same Week Costs Different People Different Amounts', 'What a Steady Routine Costs and What It Asks of You', 'How Recovery Compounds', 'How Long Adaptation Takes', 'How Often to Use Recovery Tools']) {
      expect(isInterrogativeHeading(h), h).toBe(false)
    }
    const html = '<h2>What a Guide-led Assessment Measures</h2>'
    expect(normalizeH2Questions(html)).toBe(html)
  })
  it('reads a wh-word contraction as a question (ARGON bench 2026-11-13)', () => {
    for (const h of ["What's a Quick Five-minute Routine for a Stiff Back After Sitting", "Where's the Line Between Sore and Injured", "How's the First Session Different", 'How Much Pressure Is Right', 'How Long Does Soreness Last']) {
      expect(isInterrogativeHeading(h), h).toBe(true)
    }
    expect(normalizeH2Questions("<h2>What's a Quick Routine</h2>")).toBe("<h2>What's a Quick Routine?</h2>")
  })
  it('recognises real questions and appends the mark', () => {
    for (const h of ['What Does a Guide-led Assessment Measure', "Why Haven't the Obvious Fixes Worked", 'How Fast Does a New Inquiry Need to Be Answered', 'What Counts as Overtraining', 'Can I Run This Myself', 'Which Treatments Are Worth the Money', 'How Long Does Soreness Last']) {
      expect(isInterrogativeHeading(h), h).toBe(true)
    }
    expect(normalizeH2Questions('<h2 id="x">What Does a Retainer Cost</h2>')).toBe('<h2 id="x">What Does a Retainer Cost?</h2>')
    expect(normalizeH2Questions('<h2>What Does a Retainer Cost?</h2>')).toBe('<h2>What Does a Retainer Cost?</h2>')
  })
})

describe('fact anchor keeps a decimal figure whole', () => {
  it('links the whole sentence around "47.2%"', () => {
    const html = '<p>Rules vary by country. About 47.2% of insurers there require prior authorization for the first course. That is the US picture.</p>'
    const { html: out, placed } = anchorFactSources(html, [
      { fact: 'About 47.2% of insurers require prior authorization for the first course', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 't', status: 'retrieved' } as never,
    ])
    expect(placed).toEqual(['https://pubmed.ncbi.nlm.nih.gov/1/'])
    expect(out).toMatch(/<a [^>]*>About 47\.2% of insurers there require prior authorization for the first course<\/a>\./)
    expect(out).not.toMatch(/47\.<a/)
  })
})

describe('retrieval drops facts outside the reader\'s setting and table rows', () => {
  it('filters applies:false and table-shaped quotes', () => {
    const raw = JSON.stringify([
      { fact: 'Secondary traumatic stress symptoms rise with allostatic load in registered nurses', quote: 'Among registered nurses, higher allostatic load predicted secondary traumatic stress symptoms over twelve months.', setting: 'registered nurses, hospital', applies: false },
      { fact: 'Light bench press at 6 and 30 hours after training restores pectoral thickness faster', quote: 'High VOL BP (8x10x70%1RM), PR or AR (BP, 5x10x10%1RM) 6- & 30-h post; pec MT restored 24 h', setting: 'trained men', applies: true },
      { fact: 'Muscle soreness after unaccustomed exercise peaks between 12 and 48 hours and can last up to 14 days', quote: 'Symptoms of exercise-induced muscle damage typically peak between 12 and 48 hours after exercise and may persist for up to 14 days.', setting: 'healthy adults', applies: true },
    ])
    const facts = parseFacts(raw)
    expect(facts).toHaveLength(1)
    expect(facts[0].fact).toMatch(/12 and 48 hours/)
    expect(facts[0].setting).toBe('healthy adults')
  })
  it('table-row detector', () => {
    expect(looksLikeTableRow('High VOL BP (8x10x70%1RM), PR or AR (BP, 5x10x10%1RM) 6- & 30-h post; pec MT restored 24 h')).toBe(true)
    expect(looksLikeTableRow('Symptoms of exercise-induced muscle damage typically peak between 12 and 48 hours after exercise.')).toBe(false)
  })
  it('the extraction prompt carries the reader check and the applies field', () => {
    const p = extractionPrompt('Recovery', 'wellness', 'SOURCE PAGE: x', 'recovery')
    expect(p).toMatch(/READER CHECK/)
    expect(p).toMatch(/"applies": true\|false/)
  })
})
