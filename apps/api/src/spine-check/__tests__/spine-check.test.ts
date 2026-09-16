import { describe, it, expect } from 'vitest'
import { buildSpineCheckFragment, buildSpineCheckHtml, type SpineCheckClinic } from '../template'
import { buildSpineCheckEmbed } from '../generate'
import { parseSpineCapture } from '../../routes/spine-check'

const CLINIC: SpineCheckClinic = {
  accountId: '41eaf1f8-a84d-47b9-b5fc-52c1219d4041',
  practiceName: 'Coast Chiropractic Kawana',
  logoUrl: 'https://example.com/logo.png',
  headerBg: '#0b2545',
  buttonColor: '#2a6f97',
  buttonTextColor: '#ffffff',
  accent: '#2a6f97',
  phone: '+1 480 555 0100',
  bookingUrl: 'https://book.example.com',
  captureUrl: 'https://svc.omniply.io/api/spine-check/capture',
  guideTitles: {
    desk: "The Desk Worker's Survival Guide",
    sleep: 'Better Sleep Without Pills',
    morning: 'Morning Habits for a Healthy Spine',
    niggle: 'Pain: Normal or Warning Sign?',
  },
  firstVisitGuideTitle: 'Your First Chiropractic Visit',
  guidesAvailable: true,
}

/** Eval exactly the SPINE math block that ships in the generated page. */
function loadSpine(html: string) {
  const match = html.match(/\/\*__SPINE_MATH_START__\*\/([\s\S]*?)\/\*__SPINE_MATH_END__\*\//)
  if (!match) throw new Error('SPINE math block markers not found')
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', match[1])(mod)
  return mod.exports as {
    QUESTIONS: { d: string; opts: [string, number][] }[]
    DOMAINS: string[]
    compute: (answers: number[]) => { scores: Record<string, number>; total: number; weakest: string }
  }
}

describe('booking CTA fallback', () => {
  it('renders the online booking button when bookingUrl is set', () => {
    const html = buildSpineCheckFragment(CLINIC)
    expect(html).toContain('https://book.example.com')
    expect(html).not.toContain('tel:')
  })
  it('falls back to a call-to-book tel: button for phone-only clinics', () => {
    const html = buildSpineCheckFragment({ ...CLINIC, bookingUrl: null })
    expect(html).toContain('tel:+14805550100')
    expect(html).toContain('Call Coast Chiropractic Kawana to book')
  })
  it('renders no booking CTA when neither url nor phone exists', () => {
    const html = buildSpineCheckFragment({ ...CLINIC, bookingUrl: null, phone: null })
    expect(html).not.toContain('tel:')
    expect(html).not.toContain('Book a visit')
  })
})

const SPINE = loadSpine(buildSpineCheckHtml(CLINIC))

describe('spine check math', () => {
  it('has 12 questions, 3 per domain', () => {
    expect(SPINE.QUESTIONS).toHaveLength(12)
    for (const d of ['desk', 'sleep', 'morning', 'niggle']) {
      expect(SPINE.QUESTIONS.filter((q) => q.d === d)).toHaveLength(3)
    }
  })

  it('scores best answers 100 across the board', () => {
    const best = SPINE.QUESTIONS.map((q) => Math.max(...q.opts.map((o) => o[1])))
    const r = SPINE.compute(best)
    expect(r.total).toBe(100)
    for (const d of SPINE.DOMAINS) expect(r.scores[d]).toBe(100)
  })

  it('scores worst answers 0 and defaults missing answers to 0', () => {
    expect(SPINE.compute(SPINE.QUESTIONS.map(() => 0)).total).toBe(0)
    expect(SPINE.compute([]).total).toBe(0)
  })

  it('names the lowest domain weakest', () => {
    // best everywhere except sleep (questions 3-5) at 0
    const answers = SPINE.QUESTIONS.map((q, i) => (i >= 3 && i <= 5 ? 0 : Math.max(...q.opts.map((o) => o[1]))))
    expect(SPINE.compute(answers).weakest).toBe('sleep')
  })

  it('breaks ties most-actionable-first (desk)', () => {
    const r = SPINE.compute(SPINE.QUESTIONS.map(() => 0))
    expect(r.weakest).toBe('desk')
  })

  it('normalizes per-domain even with uneven point ladders', () => {
    // morning Q1 has max 10 but options [10,3,3,0]; picking 3 everywhere in
    // morning → 3+3+3 of max 30 → 30
    const answers = SPINE.QUESTIONS.map((q, i) => (q.d === 'morning' ? 3 : Math.max(...q.opts.map((o) => o[1]))))
    expect(SPINE.compute(answers).scores.morning).toBe(30)
  })
})

describe('template injection safety', () => {
  it('escapes hostile practice names and titles in markup and JS strings', () => {
    const hostile = buildSpineCheckHtml({
      ...CLINIC,
      practiceName: `<script>alert('x')</script>`,
      guideTitles: { ...CLINIC.guideTitles, desk: `Bad'); fetch('https://evil')//` },
    })
    expect(hostile).not.toContain(`<script>alert('x')</script>`)
    expect(hostile).not.toContain(`fetch('https://evil')`)
  })

  it('fragment is WP-safe: no doctype/head, all CSS scoped under #sc-app', () => {
    const frag = buildSpineCheckFragment(CLINIC)
    expect(frag).not.toContain('<!doctype')
    expect(frag).not.toContain('<head>')
    for (const line of frag.split('\n')) {
      const t = line.trim()
      if (t.startsWith('#') || t.startsWith('.')) expect(t.startsWith('#sc-app')).toBe(true)
    }
  })

  it('standalone document embeds the fragment', () => {
    const full = buildSpineCheckHtml(CLINIC)
    expect(full).toContain('<!doctype html>')
    expect(full).toContain('id="sc-app"')
  })
})

describe('iframe embed (WP publish content)', () => {
  const embed = buildSpineCheckEmbed(CLINIC)

  it('contains crawlable intro, iframe with hosted src, noscript link, and resizer', () => {
    expect(embed).toContain('<p>How well do your daily habits')
    expect(embed).toContain(`/api/spine-check/p/${CLINIC.accountId}`)
    expect(embed).toContain('<noscript>')
    expect(embed).toContain("e.data.type!=='sc-height'")
    expect(embed).toContain('min-height:980px')
  })

  it('escapes hostile practice names in the embed', () => {
    const hostile = buildSpineCheckEmbed({ ...CLINIC, practiceName: '<img onerror=x>' })
    expect(hostile).not.toContain('<img onerror=x>')
  })

  it('iframe src carries the deterministic embed signal', () => {
    expect(embed).toContain('?embed=1')
  })

  it('quiz hides brand strip + credit when embedded, shows them standalone', () => {
    const frag = buildSpineCheckFragment(CLINIC)
    expect(frag).toContain('#sc-app.sc-embedded .sc-brand, #sc-app.sc-embedded .sc-credit { display: none; }')
    expect(frag).toContain("/[?&]embed=1/.test(window.location.search) || window.parent !== window")
  })

  it('quiz reports its height for the parent resizer', () => {
    const frag = buildSpineCheckFragment(CLINIC)
    expect(frag).toContain("postMessage({ type: 'sc-height'")
  })
})

describe('no-guides degradation', () => {
  it('drops every delivery promise when guides are not live', () => {
    const degraded = buildSpineCheckHtml({ ...CLINIC, guidesAvailable: false, firstVisitGuideTitle: null })
    expect(degraded).not.toContain('and a free guide picked for you')
    expect(degraded).not.toContain('and your free guide')
    expect(degraded).toContain('guidesAvailable: false')
  })

  it('keeps promises when guides are live', () => {
    const full = buildSpineCheckHtml(CLINIC)
    expect(full).toContain('and a free guide picked for you')
    expect(full).toContain('guidesAvailable: true')
  })
})

describe('capture payload parsing', () => {
  const valid = {
    accountId: CLINIC.accountId,
    name: 'Sam',
    email: 'Sam@Example.com',
    phone: '+61 400 000 000',
    weakestDomain: 'sleep',
    scores: { desk: 80, sleep: 33, morning: 66, niggle: 90 },
    total: 67,
  }

  it('accepts a valid payload and lowercases the email', () => {
    const p = parseSpineCapture(valid)
    expect(p).not.toBeNull()
    expect(p!.email).toBe('sam@example.com')
    expect(p!.weakestDomain).toBe('sleep')
  })

  it('clamps forged scores into 0-100', () => {
    const p = parseSpineCapture({ ...valid, scores: { desk: 999, sleep: -5, morning: 'x', niggle: 50 }, total: 4000 })
    expect(p!.scores).toEqual({ desk: 100, sleep: 0, morning: 0, niggle: 50 })
    expect(p!.total).toBe(100)
  })

  it('rejects missing name, bad email, unknown domain, and non-objects', () => {
    expect(parseSpineCapture({ ...valid, name: '  ' })).toBeNull()
    expect(parseSpineCapture({ ...valid, email: 'nope' })).toBeNull()
    expect(parseSpineCapture({ ...valid, weakestDomain: 'spine' })).toBeNull()
    expect(parseSpineCapture('str')).toBeNull()
    expect(parseSpineCapture(null)).toBeNull()
  })

  it('treats empty phone as null', () => {
    expect(parseSpineCapture({ ...valid, phone: '  ' })!.phone).toBeNull()
  })
})
