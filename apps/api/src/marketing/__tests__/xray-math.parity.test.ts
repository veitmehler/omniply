import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compute, missedCallsPhrase, type XrayAnswers } from '../xray-math'
import { parseReportPayload } from '../../routes/xray-report'

/**
 * Parity guard: the server-side math port MUST produce identical numbers to
 * the canonical client-side block in apps/web/public/x-ray/index.html.
 * If the quiz math changes without this port, this test fails CI.
 */
function loadWebXray() {
  const html = readFileSync(
    join(__dirname, '../../../../web/public/x-ray/index.html'),
    'utf8',
  )
  const match = html.match(/\/\*__XRAY_MATH_START__\*\/([\s\S]*?)\/\*__XRAY_MATH_END__\*\//)
  if (!match) throw new Error('XRAY math block markers not found in web x-ray page')
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', match[1])(mod)
  return mod.exports as { compute: (a: XrayAnswers) => ReturnType<typeof compute> }
}

const web = loadWebXray()

const FIXTURES: Array<[string, XrayAnswers]> = [
  ['plan example', { a1: 3, a2: 3, a3: 0, b1: 3, b2: 3, c1: 3, c2: 3, d1: 3, d2: 3, inquiriesWeekly: 10, maintRate: 0.2, activePatients: 800, visitFee: 65 }],
  ['best path', { a1: 10, a2: 10, a3: 10, b1: 10, b2: 10, c1: 10, c2: 10, d1: 10, d2: 10, inquiriesWeekly: 25, maintRate: 0.35, activePatients: 2000, visitFee: 90 }],
  ['worst path', { a1: 0, a2: 0, a3: 0, b1: 0, b2: 0, c1: 0, c2: 0, d1: 0, d2: 0, inquiriesWeekly: 0, maintRate: 0, activePatients: 100, visitFee: 40 }],
  ['mixed d2=5', { a1: 7, a2: 3, a3: 7, b1: 10, b2: 0, c1: 7, c2: 7, d1: 7, d2: 5, inquiriesWeekly: 33, maintRate: 0.45, activePatients: 3550, visitFee: 115 }],
]

describe('server math parity with web quiz', () => {
  for (const [name, answers] of FIXTURES) {
    it(`matches on: ${name}`, () => {
      const server = compute(answers)
      const client = web.compute(answers)
      expect(server.scores).toEqual(client.scores)
      expect(server.total).toBe(client.total)
      expect(server.weakest).toBe(client.weakest)
      expect(server.driftLeak).toBe(client.driftLeak)
      expect(server.responseLeak).toBe(client.responseLeak)
      expect(server.totalLeak).toBe(client.totalLeak)
      expect(server.priceMultiple).toBe(client.priceMultiple)
      expect(server.missedCallsWeekly).toBe(client.missedCallsWeekly)
      expect(server.aiResearchedWeekly).toBe(client.aiResearchedWeekly)
      expect(server.aiInvisibleShare).toBe(client.aiInvisibleShare)
      expect(server.aiLeak).toBe(client.aiLeak)
    })
  }
})

describe('AI-era projection bounds', () => {
  it('caps invisibility at 85% for a zero-visibility practice', () => {
    const r = compute(FIXTURES[2][1]) // worst path: all-zero scores
    expect(r.aiInvisibleShare).toBe(0.85)
    expect(r.aiLeak).toBe(0) // zero weekly inquiries → zero projection
  })
  it('floors invisibility at 15% for a perfect-visibility practice', () => {
    const r = compute(FIXTURES[1][1]) // best path: all-100 scores
    expect(r.aiInvisibleShare).toBeCloseTo(0.15, 10)
    expect(r.aiLeak).toBeGreaterThan(0) // even strong practices see a nonzero projection
  })
  it('keeps the projection OUT of totalLeak by design', () => {
    const r = compute(FIXTURES[0][1])
    expect(r.totalLeak).toBe(r.driftLeak + r.responseLeak)
  })
})

describe('missedCallsPhrase', () => {
  it('phrases the derived count like the quiz page', () => {
    expect(missedCallsPhrase(0)).toEqual({ big: '0', unit: 'calls a week' })
    expect(missedCallsPhrase(0.4)).toEqual({ big: '≈ 1', unit: 'call most weeks' })
    expect(missedCallsPhrase(1.2)).toEqual({ big: '≈ 1', unit: 'call a week' })
    expect(missedCallsPhrase(5.5)).toEqual({ big: '≈ 6', unit: 'calls a week' })
    expect(missedCallsPhrase(10 * 0.25)).toEqual({ big: '≈ 3', unit: 'calls a week' })
  })
})

describe('report payload parsing', () => {
  const valid = {
    v: 1,
    n: 'Dr. Jane Doe',
    p: 'Coast Chiropractic',
    c: 'AUD',
    a: FIXTURES[0][1],
  }
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

  it('accepts a valid payload and prefers the practice name', () => {
    const parsed = parseReportPayload(enc(valid))
    expect(parsed).not.toBeNull()
    expect(parsed!.preparedFor).toBe('Coast Chiropractic')
    expect(parsed!.currency).toBe('AUD')
  })

  it('falls back to the lead name when practice name is missing', () => {
    const parsed = parseReportPayload(enc({ ...valid, p: null }))
    expect(parsed!.preparedFor).toBe('Dr. Jane Doe')
  })

  it('escapes HTML in names', () => {
    const parsed = parseReportPayload(enc({ ...valid, p: '<script>x</script>' }))
    expect(parsed!.preparedFor).not.toContain('<script>')
    expect(parsed!.preparedFor).toContain('&lt;script&gt;')
  })

  it('clamps forged numeric inputs to quiz slider ranges', () => {
    const parsed = parseReportPayload(enc({ ...valid, a: { ...valid.a, visitFee: 99999, activePatients: 1, inquiriesWeekly: -5, maintRate: 9 } }))
    expect(parsed!.answers.visitFee).toBe(150)
    expect(parsed!.answers.activePatients).toBe(100)
    expect(parsed!.answers.inquiriesWeekly).toBe(0)
    expect(parsed!.answers.maintRate).toBe(0.8)
  })

  it('rejects garbage, wrong version, and off-scale choice points', () => {
    expect(parseReportPayload('not-base64!!')).toBeNull()
    expect(parseReportPayload(enc({ ...valid, v: 2 }))).toBeNull()
    expect(parseReportPayload(enc({ ...valid, a: { ...valid.a, b1: 6 } }))).toBeNull()
  })

  it('defaults unknown currency to USD', () => {
    const parsed = parseReportPayload(enc({ ...valid, c: 'XYZ' }))
    expect(parsed!.currency).toBe('USD')
  })
})
