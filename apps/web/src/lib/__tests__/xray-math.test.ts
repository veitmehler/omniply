import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The Practice X-Ray page keeps its scoring + leak math in a marker-delimited
// pure-function block so this suite can test EXACTLY what ships, no duplicate
// implementation to drift.
function loadXray() {
  const html = readFileSync(join(__dirname, '../../../public/x-ray/index.html'), 'utf8')
  const match = html.match(/\/\*__XRAY_MATH_START__\*\/([\s\S]*?)\/\*__XRAY_MATH_END__\*\//)
  if (!match) throw new Error('XRAY math block markers not found in x-ray/index.html')
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', match[1])(mod)
  return mod.exports as {
    CONFIG: Record<string, number | string>
    compute: (a: Record<string, number>, o?: Record<string, number>) => {
      scores: Record<string, number>
      total: number
      weakest: string
      driftLeak: number
      responseLeak: number
      totalLeak: number
      priceMultiple: number
      missedShare: number
      aiResearchedWeekly: number
      aiInvisibleShare: number
      aiLeak: number
    }
    missedShare: (b1: number, b2: number) => number
    driftLeak: (a: Record<string, number>) => number
    responseLeak: (a: Record<string, number>) => number
    aiLeak: (a: Record<string, number>, o?: Record<string, number>) => number
  }
}

const XRAY = loadXray()

// The plan's canonical example answers (§3 of the implementation plan)
const planExample = {
  a1: 3, a2: 3, a3: 0,          // content: sporadic
  b1: 3, b2: 3,                 // speed: voicemail-when-we-can → missedShare 0.25
  c1: 3, c2: 3,                 // reviews: 30-99, ask-when-remember
  d1: 3, d2: 3,                 // retention: come-back-if-it-hurts
  inquiriesWeekly: 10,
  maintRate: 0.2,
  activePatients: 800,
  visitFee: 65,
}

describe('drift leak', () => {
  it('matches the plan worked example (~$2,600/mo)', () => {
    // 800 × (0.35−0.20) × 0.5 × 65 × 8/12 = 2600
    expect(XRAY.driftLeak(planExample)).toBeCloseTo(2600, 0)
  })

  it('is zero when maintenance rate meets or exceeds the target', () => {
    expect(XRAY.driftLeak({ ...planExample, maintRate: 0.35 })).toBe(0)
    expect(XRAY.driftLeak({ ...planExample, maintRate: 0.6 })).toBe(0)
  })

  it('scales linearly with active patients', () => {
    const base = XRAY.driftLeak(planExample)
    expect(XRAY.driftLeak({ ...planExample, activePatients: 1600 })).toBeCloseTo(base * 2, 6)
  })
})

describe('response leak', () => {
  it('matches the plan worked example (~$3,040/mo)', () => {
    // 10 × 4.33 × 0.25 × 0.6 × 0.6 × (65×12) = 3039.66
    expect(XRAY.responseLeak(planExample)).toBeCloseTo(3039.66, 1)
  })

  it('is zero with zero inquiries', () => {
    expect(XRAY.responseLeak({ ...planExample, inquiriesWeekly: 0 })).toBe(0)
  })

  it('shrinks with best-practice call handling', () => {
    const best = XRAY.responseLeak({ ...planExample, b1: 10, b2: 10 })
    expect(best).toBeLessThan(XRAY.responseLeak(planExample) / 4)
    expect(best).toBeGreaterThan(0) // 0.05 floor: nobody catches everything
  })
})

describe('missedShare mapping', () => {
  it('maps best answers to 5% and worst to 35%', () => {
    expect(XRAY.missedShare(10, 10)).toBe(0.05)
    expect(XRAY.missedShare(0, 0)).toBe(0.35)
  })
  it('averages mixed answers and tolerates off-scale points', () => {
    expect(XRAY.missedShare(10, 0)).toBeCloseTo(0.2, 6)
    expect(XRAY.missedShare(5 as number, 10)).toBeCloseTo(0.2, 6) // unknown pts → worst-case 0.35 avg 0.05
  })
})

describe('axis scores & verdict', () => {
  it('scores perfect answers at 100 on every axis', () => {
    const r = XRAY.compute({
      a1: 10, a2: 10, a3: 10, b1: 10, b2: 10, c1: 10, c2: 10, d1: 10, d2: 10,
      inquiriesWeekly: 10, maintRate: 0.35, activePatients: 800, visitFee: 65,
    })
    expect(r.scores).toEqual({ content: 100, speed: 100, reviews: 100, retention: 100 })
    expect(r.total).toBe(100)
  })

  it('scores worst-path answers at 0 and totals 0', () => {
    const r = XRAY.compute({
      a1: 0, a2: 0, a3: 0, b1: 0, b2: 0, c1: 0, c2: 0, d1: 0, d2: 0,
      inquiriesWeekly: 0, maintRate: 0, activePatients: 100, visitFee: 40,
    })
    expect(r.total).toBe(0)
    expect(r.scores.retention).toBe(0)
  })

  it('caps the maintenance slider contribution at target rate', () => {
    const r = XRAY.compute({ ...planExample, d1: 0, d2: 0, maintRate: 0.8 })
    expect(r.scores.retention).toBe(33) // 10/30 pts from capped slider only
  })

  it('names the lowest axis as weakest', () => {
    const r = XRAY.compute({ ...planExample, c1: 0, c2: 0 })
    expect(r.weakest).toBe('reviews')
  })

  it('breaks ties in product-strength order (retention first)', () => {
    const r = XRAY.compute({
      a1: 0, a2: 0, a3: 0, b1: 0, b2: 0, c1: 0, c2: 0, d1: 0, d2: 0,
      inquiriesWeekly: 10, maintRate: 0, activePatients: 800, visitFee: 65,
    })
    expect(r.weakest).toBe('retention')
  })
})

describe('compute output', () => {
  it('rounds dollar outputs to $50 and computes the price multiple', () => {
    const r = XRAY.compute(planExample)
    expect(r.driftLeak % 50).toBe(0)
    expect(r.responseLeak % 50).toBe(0)
    expect(r.totalLeak % 50).toBe(0)
    // 2600 + 3039.66 ≈ 5650 rounded; 5640/397 ≈ 14
    expect(r.totalLeak).toBe(5650)
    expect(r.priceMultiple).toBe(14)
  })

  it('honors assumption overrides from the "check our math" panel', () => {
    const strict = XRAY.compute(planExample, { REALIZATION: 0.25, WOULD_CONVERT: 0.3 })
    const def = XRAY.compute(planExample)
    expect(strict.driftLeak).toBeLessThan(def.driftLeak)
    expect(strict.responseLeak).toBeLessThan(def.responseLeak)
    expect(strict.totalLeak).toBeGreaterThan(0)
  })

  it('keeps priceMultiple at a minimum of 1', () => {
    const r = XRAY.compute({
      ...planExample, inquiriesWeekly: 0, maintRate: 0.35,
    })
    expect(r.totalLeak).toBe(0)
    expect(r.priceMultiple).toBe(1)
  })
})

describe('AI-era projection', () => {
  it('matches the worked example at the 22% default', () => {
    // visibility = (reviews 30 + content 20) / 200 = 0.25
    // invisible = 0.85 − 0.70 × 0.25 = 0.675
    // 10 × 0.22 × 4.33 × 0.675 × 0.6 × (65×12) = 3010.4…
    const r = XRAY.compute(planExample)
    expect(r.aiResearchedWeekly).toBeCloseTo(2.2, 6)
    expect(r.aiInvisibleShare).toBeCloseTo(0.675, 6)
    expect(r.aiLeak).toBe(3000) // rounded to $50
  })

  it('bounds invisibility to [0.15, 0.85] and never reaches 0 or 1', () => {
    const worst = XRAY.compute({
      a1: 0, a2: 0, a3: 0, b1: 0, b2: 0, c1: 0, c2: 0, d1: 0, d2: 0,
      inquiriesWeekly: 10, maintRate: 0, activePatients: 100, visitFee: 40,
    })
    expect(worst.aiInvisibleShare).toBe(0.85)
    const best = XRAY.compute({
      a1: 10, a2: 10, a3: 10, b1: 10, b2: 10, c1: 10, c2: 10, d1: 10, d2: 10,
      inquiriesWeekly: 10, maintRate: 0.35, activePatients: 800, visitFee: 65,
    })
    expect(best.aiInvisibleShare).toBeCloseTo(0.15, 10)
    expect(best.aiLeak).toBeGreaterThan(0)
  })

  it('honors the AI_RESEARCH_SHARE slider override', () => {
    const low = XRAY.compute(planExample, { AI_RESEARCH_SHARE: 0.1 })
    const high = XRAY.compute(planExample, { AI_RESEARCH_SHARE: 0.5 })
    expect(low.aiLeak).toBeLessThan(high.aiLeak)
    expect(low.aiResearchedWeekly).toBeCloseTo(1, 6)
  })

  it('stays OUT of totalLeak by design', () => {
    const r = XRAY.compute(planExample)
    expect(r.totalLeak).toBe(r.driftLeak + r.responseLeak)
  })
})
