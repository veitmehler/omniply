import { describe, it, expect } from 'vitest'
import { buildAgeCheckFragment, buildAgeCheckHtml, type AgeCheckStudio } from '../template'
import { buildAgeCheckEmbed } from '../generate'
import { parseAgeCapture } from '../../routes/age-check'

const STUDIO: AgeCheckStudio = {
  accountId: '41eaf1f8-a84d-47b9-b5fc-52c1219d4041',
  practiceName: 'Whealth Recovery Center',
  logoUrl: 'https://example.com/logo.png',
  headerBg: '#0b2545',
  buttonColor: '#2a6f97',
  buttonTextColor: '#ffffff',
  accent: '#2a6f97',
  phone: '+1 480 555 0100',
  bookingUrl: 'https://book.example.com',
  captureUrl: 'https://svc.omniply.io/api/age-check/capture',
  guideTitles: {
    move: 'Everyday Strength',
    sleep: 'Better Sleep, Night After Night',
    unwind: 'The Art of Switching Off',
    fuel: 'Everyday Fuel',
  },
  guidesAvailable: false,
}

/** Eval exactly the AGE math block that ships in the generated page. */
function loadAgeCheck(html: string) {
  const match = html.match(/\/\*__AGE_MATH_START__\*\/([\s\S]*?)\/\*__AGE_MATH_END__\*\//)
  if (!match) throw new Error('AGE math block markers not found')
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', match[1])(mod)
  return mod.exports as {
    QUESTIONS: { p: string; opts: [string, number][] }[]
    PILLARS: string[]
    MIN_AGE: number
    MAX_AGE: number
    compute: (
      calendarAge: number,
      answers: number[],
    ) => { bodyAge: number; delta: number; scores: Record<string, number>; weakest: string }
  }
}

describe('booking CTA fallback', () => {
  it('renders the online booking button when bookingUrl is set', () => {
    const html = buildAgeCheckFragment(STUDIO)
    expect(html).toContain('https://book.example.com')
    expect(html).not.toContain('tel:')
  })
  it('falls back to a call-to-book tel: button for phone-only studios', () => {
    const html = buildAgeCheckFragment({ ...STUDIO, bookingUrl: null })
    expect(html).toContain('tel:+14805550100')
    expect(html).toContain('Call Whealth Recovery Center to book')
  })
  it('renders no booking CTA when neither url nor phone exists', () => {
    const html = buildAgeCheckFragment({ ...STUDIO, bookingUrl: null, phone: null })
    expect(html).not.toContain('tel:')
    expect(html).not.toContain('Book a visit')
  })
})

const AGE = loadAgeCheck(buildAgeCheckHtml(STUDIO))

function answersWhere(pick: (opts: [string, number][]) => number): number[] {
  return AGE.QUESTIONS.map((q) => pick(q.opts))
}
const best = (opts: [string, number][]) => Math.min(...opts.map((o) => o[1]))
const worst = (opts: [string, number][]) => Math.max(...opts.map((o) => o[1]))

describe('age check math', () => {
  it('ships 12 habit questions across 4 pillars, 3 each', () => {
    expect(AGE.QUESTIONS).toHaveLength(12)
    for (const p of AGE.PILLARS) {
      expect(AGE.QUESTIONS.filter((q) => q.p === p)).toHaveLength(3)
    }
  })

  it('best habits land YOUNGER than calendar age, worst land OLDER', () => {
    const young = AGE.compute(45, answersWhere(best))
    const old = AGE.compute(45, answersWhere(worst))
    expect(young.delta).toBeLessThan(0)
    expect(young.bodyAge).toBe(45 + young.delta)
    expect(old.delta).toBeGreaterThan(0)
    expect(old.bodyAge).toBe(45 + old.delta)
    // The genre's plausibility window: single digits to low teens, not 40.
    expect(young.delta).toBeGreaterThanOrEqual(-15)
    expect(old.delta).toBeLessThanOrEqual(20)
  })

  it('pillar scores: best habits = 100, worst = 0, and the bars bound [0,100]', () => {
    const young = AGE.compute(45, answersWhere(best))
    const old = AGE.compute(45, answersWhere(worst))
    for (const p of AGE.PILLARS) {
      expect(young.scores[p]).toBe(100)
      expect(old.scores[p]).toBe(0)
    }
  })

  it('weakest pillar follows the worst-scored pillar', () => {
    // Best everywhere except fuel (worst) → weakest must be fuel.
    const answers = AGE.QUESTIONS.map((q) => (q.p === 'fuel' ? worst(q.opts) : best(q.opts)))
    expect(AGE.compute(45, answers).weakest).toBe('fuel')
  })

  it('a young calendar age with perfect habits never drops below the floor', () => {
    const r = AGE.compute(18, answersWhere(best))
    expect(r.bodyAge).toBeGreaterThanOrEqual(18)
    expect(r.bodyAge).toBe(18 + r.delta)
  })

  it('unanswered questions count as zero delta, not NaN', () => {
    const r = AGE.compute(40, [])
    expect(Number.isFinite(r.bodyAge)).toBe(true)
    expect(r.bodyAge).toBe(40)
  })
})

describe('claims guardrails baked into the template', () => {
  const html = buildAgeCheckHtml(STUDIO)
  it('carries the estimate disclaimer verbatim', () => {
    expect(html).toContain('not a medical measurement, assessment or diagnosis')
    expect(html).toContain('True biological age can only be measured clinically')
  })
  it('asks about habits only — no condition or treatment language', () => {
    for (const word of ['diagnos', 'cure', 'treat', 'disease', 'therapy for']) {
      const mathBlock = html.match(/\/\*__AGE_MATH_START__\*\/([\s\S]*?)\/\*__AGE_MATH_END__\*\//)![1]
      expect(mathBlock.toLowerCase()).not.toContain(word)
    }
  })
  it('without live guides it promises nothing to deliver', () => {
    expect(html).toContain('guidesAvailable: false')
  })
})

describe('embed snippet', () => {
  it('iframes the hosted route with the resizer listening for ac-height', () => {
    const embed = buildAgeCheckEmbed(STUDIO)
    expect(embed).toContain(`/api/age-check/p/${STUDIO.accountId}?embed=1`)
    expect(embed).toContain("'ac-height'")
    expect(embed).toContain('<noscript>')
  })
})

describe('parseAgeCapture', () => {
  const good = {
    accountId: 'acct_123456789012',
    name: 'Jane',
    email: 'JANE@Example.com',
    phone: '+1 809 555 0100',
    calendarAge: 45,
    bodyAge: 51,
    delta: 6,
    weakestPillar: 'unwind',
    scores: { move: 70, sleep: 55, unwind: 30, fuel: 62 },
  }
  it('accepts a well-formed submission and normalizes the email', () => {
    const p = parseAgeCapture(good)!
    expect(p.email).toBe('jane@example.com')
    expect(p.weakestPillar).toBe('unwind')
    expect(p.bodyAge).toBe(51)
    expect(p.scores.unwind).toBe(30)
  })
  it('rejects bad ages, pillars and emails', () => {
    expect(parseAgeCapture({ ...good, calendarAge: 12 })).toBeNull()
    expect(parseAgeCapture({ ...good, calendarAge: 140 })).toBeNull()
    expect(parseAgeCapture({ ...good, weakestPillar: 'niggle' })).toBeNull()
    expect(parseAgeCapture({ ...good, email: 'not-an-email' })).toBeNull()
    expect(parseAgeCapture({ ...good, name: '' })).toBeNull()
    expect(parseAgeCapture(null)).toBeNull()
  })
  it('clamps out-of-range numbers instead of trusting the client', () => {
    const p = parseAgeCapture({ ...good, bodyAge: 400, delta: 99, scores: { move: 700, sleep: -5, unwind: 30, fuel: 62 } })!
    expect(p.bodyAge).toBe(110)
    expect(p.delta).toBe(30)
    expect(p.scores.move).toBe(100)
    expect(p.scores.sleep).toBe(0)
  })
})
