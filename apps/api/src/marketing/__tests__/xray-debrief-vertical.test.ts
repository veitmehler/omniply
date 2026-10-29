import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBarsHtml, buildDebriefHtml } from '../xray-debrief-template'
import { scoreRead, verdictHtml, axisLabelsFor, compute, type XrayAnswers } from '../xray-math'
import { FIXTURE_DATA, FIXTURE_SCORES, FIXTURE_WEAKEST } from './xray-debrief-fixture'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// Retention-weakest sample: the retention verdict is the vertical-richest copy.
const SAMPLE_ANSWERS: XrayAnswers = {
  a1: 10, a2: 10, a3: 10, b1: 10, b2: 10, c1: 10, c2: 10, d1: 0, d2: 0,
  inquiriesWeekly: 12, maintRate: 0.1, activePatients: 600, visitFee: 65,
}

describe('debrief vertical parameterization', () => {
  it('chiro render is byte-identical to the pre-refactor fixture', () => {
    const fixture = readFileSync(join(__dirname, 'xray-debrief-chiro.fixture.html'), 'utf8')
    const data = { ...FIXTURE_DATA, barsHtml: buildBarsHtml(FIXTURE_SCORES, FIXTURE_WEAKEST) }
    expect(buildDebriefHtml(data)).toBe(fixture)
    expect(buildDebriefHtml(data, 'chiro')).toBe(fixture)
  })

  it('wellness render carries no chiro/patient wording', () => {
    // Personalized fields replaced with their wellness-vertical equivalents
    // (in production they come from the same vertical-aware builders).
    const data = {
      ...FIXTURE_DATA,
      barsHtml: buildBarsHtml(FIXTURE_SCORES, FIXTURE_WEAKEST, 'wellness'),
      scoreRead: scoreRead(49, 'wellness'),
      verdictHtml: '<b>The scan shows silence.</b> Your center goes quiet between visits.',
      aiLine: 'By 2027, <b>1 in 3 new clients</b> will ask an AI assistant first.',
    }
    const html = buildDebriefHtml(data, 'wellness')
    expect(html).not.toMatch(/chiro/i)
    expect(html).not.toMatch(/patient/i)
    expect(html).toContain('wellness &amp; longevity centers')
    expect(html).toContain('Client Retention & Recall')
    expect(html).toContain("one client's first year, at your fee")
  })

  it('verdict + score copy localize per vertical and stay stable for chiro', () => {
    const r = compute(SAMPLE_ANSWERS)
    for (const v of ['chiro', 'wellness'] as const) {
      const html = verdictHtml(SAMPLE_ANSWERS, r, money, v)
      if (v === 'chiro') {
        expect(html).toContain('patient drift')
        expect(html).toContain('care plan')
      } else {
        expect(html).not.toMatch(/patient|chiro/i)
        expect(html).toContain('client drift')
      }
    }
    expect(scoreRead(60)).toBe('A solid practice running on manual effort. The leak below is what manual costs.')
    expect(scoreRead(60, 'wellness')).toBe('A solid center running on manual effort. The leak below is what manual costs.')
    expect(axisLabelsFor('chiro').retention).toBe('Patient Retention & Recall')
    expect(axisLabelsFor('wellness').retention).toBe('Client Retention & Recall')
  })
})
