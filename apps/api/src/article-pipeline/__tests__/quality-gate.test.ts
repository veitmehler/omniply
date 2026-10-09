import { describe, it, expect } from 'vitest'
import { parseVerdict, validateSchemaJsonLd } from '../quality-gate'

describe('parseVerdict', () => {
  it('parses a clean pass verdict', () => {
    const v = parseVerdict('{"verdict":"pass","severity":"none","reasons":[]}', 'great article')
    expect(v.verdict).toBe('pass')
    expect(v.severity).toBe('none')
    expect(v.reasons).toEqual([])
    expect(v.geminiSummary).toBe('great article')
  })

  it('parses revise/fail with reasons', () => {
    const v = parseVerdict('{"verdict":"revise","severity":"major","reasons":["thin content","off-topic"]}', 's')
    expect(v.verdict).toBe('revise')
    expect(v.reasons).toHaveLength(2)
  })

  it('coerces revise+minor to pass (judge rubric: minor must not fail)', () => {
    const v = parseVerdict('{"verdict":"revise","severity":"minor","reasons":["formatting"]}', 's')
    expect(v.verdict).toBe('pass')
    expect(v.severity).toBe('minor')
    expect(v.reasons).toEqual(['formatting'])
  })

  it('never coerces fail verdicts, even with minor severity', () => {
    const v = parseVerdict('{"verdict":"fail","severity":"minor","reasons":["x"]}', 's')
    expect(v.verdict).toBe('fail')
  })

  it('revise with missing severity stays revise (defaults to major)', () => {
    const v = parseVerdict('{"verdict":"revise","reasons":["thin content"]}', 's')
    expect(v.verdict).toBe('revise')
    expect(v.severity).toBe('major')
  })

  it('extracts JSON embedded in prose', () => {
    const v = parseVerdict('Here is my answer: {"verdict":"pass","severity":"minor","reasons":["typo"]} done', 's')
    expect(v.verdict).toBe('pass')
    expect(v.severity).toBe('minor')
  })

  it('falls back to revise on unparseable output (never silently passes)', () => {
    const v = parseVerdict('the article is fine I think', 's')
    expect(v.verdict).toBe('revise')
    expect(v.severity).toBe('major')
  })

  it('falls back to revise on empty output', () => {
    expect(parseVerdict('', 's').verdict).toBe('revise')
  })

  it('coerces an unknown verdict to revise', () => {
    expect(parseVerdict('{"verdict":"maybe"}', 's').verdict).toBe('revise')
  })

  it('defaults severity to none for a pass with no severity', () => {
    const v = parseVerdict('{"verdict":"pass"}', 's')
    expect(v.verdict).toBe('pass')
    expect(v.severity).toBe('none')
  })

  it('caps reasons at 10', () => {
    const reasons = Array.from({ length: 20 }, (_, i) => `r${i}`)
    const v = parseVerdict(JSON.stringify({ verdict: 'fail', reasons }), 's')
    expect(v.reasons.length).toBe(10)
  })
})

describe('validateSchemaJsonLd', () => {
  const valid = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How posture affects sleep',
    author: { '@type': 'Person', name: 'Dr X' },
  }

  it('accepts a valid Article object', () => {
    expect(validateSchemaJsonLd(valid)).toEqual({ ok: true, errors: [] })
  })

  it('accepts a JSON string', () => {
    expect(validateSchemaJsonLd(JSON.stringify(valid)).ok).toBe(true)
  })

  it('accepts an @graph with an article node', () => {
    const g = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Brand' },
        { '@type': 'BlogPosting', headline: 'Title' },
      ],
    }
    expect(validateSchemaJsonLd(g).ok).toBe(true)
  })

  it('flags a missing headline', () => {
    const r = validateSchemaJsonLd({ '@context': 'https://schema.org', '@type': 'Article' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/headline/i)
  })

  it('flags a missing @context', () => {
    const r = validateSchemaJsonLd({ '@type': 'Article', headline: 'x' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/@context/)
  })

  it('rejects invalid JSON', () => {
    expect(validateSchemaJsonLd('{ not json').ok).toBe(false)
  })

  it('rejects an empty/non-object value', () => {
    expect(validateSchemaJsonLd(null).ok).toBe(false)
  })
})

describe('prepareEvalText (truncation bug, live test 2026-10-09)', () => {
  it('passes a normal-length article through untouched', async () => {
    const { prepareEvalText } = await import('../quality-gate')
    const html = '<p>' + 'Strong spine content. '.repeat(1500) + 'The end.</p>'
    const out = prepareEvalText(html)
    expect(out.endsWith('The end.')).toBe(true)
    expect(out).not.toContain('omitted for length')
  })

  it('a 34k-char article (the osteoporosis case) is NOT truncated', async () => {
    const { prepareEvalText } = await import('../quality-gate')
    const html = '<p>' + 'x'.repeat(34_000) + ' FINAL SENTENCE.</p>'
    const out = prepareEvalText(html)
    expect(out.endsWith('FINAL SENTENCE.')).toBe(true)
    expect(out).not.toContain('omitted for length')
  })

  it('an over-cap article keeps its true ending and declares the cut', async () => {
    const { prepareEvalText, EVAL_INPUT_CAP } = await import('../quality-gate')
    const html = '<p>' + 'y'.repeat(EVAL_INPUT_CAP + 50_000) + ' THE REAL ENDING.</p>'
    const out = prepareEvalText(html)
    expect(out.endsWith('THE REAL ENDING.')).toBe(true)
    expect(out).toContain('omitted for length')
    expect(out.length).toBeLessThan(EVAL_INPUT_CAP + 500)
  })
})
