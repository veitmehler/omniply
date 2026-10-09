/**
 * Server-side port of the Practice X-Ray scoring + leak math.
 *
 * CANONICAL SOURCE: the marker-delimited XRAY block in
 * apps/web/public/x-ray/index.html — the quiz computes client-side with that
 * code. This port must stay numerically identical; the parity test
 * (__tests__/xray-math.parity.test.ts) evals the web block and asserts equal
 * outputs, so any drift fails CI.
 */

export const XRAY_CONFIG = {
  PRICE_MONTHLY: 397,
  TARGET_MAINT_RATE: 0.35,
  REALIZATION: 0.5,
  MAINT_VISITS_PER_YEAR: 8,
  NO_CALLBACK_LOSS: 0.6,
  WOULD_CONVERT: 0.6,
  FIRST_YEAR_VISITS: 12,
  WEEKS_PER_MONTH: 4.33,
  ROUND_TO: 50,
  // AI-inquiry projection (angle sweep 2026-10-09) — a stated, adjustable
  // PROJECTION rendered separately, never folded into totalLeak.
  AI_RESEARCH_SHARE: 0.22,
  AI_INVISIBLE_MAX: 0.85,
  AI_INVISIBLE_MIN: 0.15,
} as const

export interface XrayAnswers {
  a1: number
  a2: number
  a3: number
  b1: number
  b2: number
  c1: number
  c2: number
  d1: number
  d2: number
  inquiriesWeekly: number
  maintRate: number
  activePatients: number
  visitFee: number
}

export interface XrayResult {
  scores: { content: number; speed: number; reviews: number; retention: number }
  total: number
  weakest: 'content' | 'speed' | 'reviews' | 'retention'
  driftLeak: number
  responseLeak: number
  totalLeak: number
  priceMultiple: number
  missedShare: number
  /** Derived weekly count of inquiries that get no live answer (raw, unrounded). */
  missedCallsWeekly: number
  /** AI-era projection (raw weekly count of AI-started inquiries, unrounded). */
  aiResearchedWeekly: number
  /** Share of AI-started inquiries the practice is invisible to (0.15–0.85). */
  aiInvisibleShare: number
  /** Projected monthly dollars lost to AI invisibility — separate from totalLeak. */
  aiLeak: number
}

const TIEBREAK = ['retention', 'speed', 'reviews', 'content'] as const
const MISSED_SHARE_BY_PTS: Record<number, number> = { 10: 0.05, 7: 0.15, 3: 0.25, 0: 0.35 }

export function axisScores(a: XrayAnswers): XrayResult['scores'] {
  const content = ((a.a1 + a.a2 + a.a3) / 30) * 100
  const speed = ((a.b1 + a.b2) / 20) * 100
  const reviews = ((a.c1 + a.c2) / 20) * 100
  const d3pts = Math.max(0, Math.min(10, (a.maintRate / XRAY_CONFIG.TARGET_MAINT_RATE) * 10))
  const retention = ((a.d1 + a.d2 + d3pts) / 30) * 100
  return {
    content: Math.round(content),
    speed: Math.round(speed),
    reviews: Math.round(reviews),
    retention: Math.round(retention),
  }
}

export function missedShare(b1pts: number, b2pts: number): number {
  const m1 = MISSED_SHARE_BY_PTS[b1pts] !== undefined ? MISSED_SHARE_BY_PTS[b1pts] : 0.35
  const m2 = MISSED_SHARE_BY_PTS[b2pts] !== undefined ? MISSED_SHARE_BY_PTS[b2pts] : 0.35
  return (m1 + m2) / 2
}

export function driftLeak(a: XrayAnswers): number {
  const gap = Math.max(0, XRAY_CONFIG.TARGET_MAINT_RATE - a.maintRate)
  return (a.activePatients * gap * XRAY_CONFIG.REALIZATION * a.visitFee * XRAY_CONFIG.MAINT_VISITS_PER_YEAR) / 12
}

export function responseLeak(a: XrayAnswers): number {
  const firstYearValue = a.visitFee * XRAY_CONFIG.FIRST_YEAR_VISITS
  return (
    a.inquiriesWeekly *
    XRAY_CONFIG.WEEKS_PER_MONTH *
    missedShare(a.b1, a.b2) *
    XRAY_CONFIG.NO_CALLBACK_LOSS *
    XRAY_CONFIG.WOULD_CONVERT *
    firstYearValue
  )
}

// AI visibility derives from the signals the answer engines actually read —
// reviews + real content (our own copy's claim) — NOT from a new question;
// "12 questions · 2 minutes" stays true.
export function aiInvisibleShare(scores: XrayResult['scores']): number {
  const visibility = (scores.reviews + scores.content) / 200
  return (
    XRAY_CONFIG.AI_INVISIBLE_MAX -
    (XRAY_CONFIG.AI_INVISIBLE_MAX - XRAY_CONFIG.AI_INVISIBLE_MIN) * visibility
  )
}

export function aiLeak(a: XrayAnswers): number {
  const firstYearValue = a.visitFee * XRAY_CONFIG.FIRST_YEAR_VISITS
  return (
    a.inquiriesWeekly *
    XRAY_CONFIG.AI_RESEARCH_SHARE *
    XRAY_CONFIG.WEEKS_PER_MONTH *
    aiInvisibleShare(axisScores(a)) *
    XRAY_CONFIG.WOULD_CONVERT *
    firstYearValue
  )
}

function roundDollars(x: number): number {
  return Math.round(x / XRAY_CONFIG.ROUND_TO) * XRAY_CONFIG.ROUND_TO
}

export function compute(a: XrayAnswers): XrayResult {
  const scores = axisScores(a)
  let weakest: XrayResult['weakest'] = TIEBREAK[0]
  for (const axis of TIEBREAK) {
    if (scores[axis] < scores[weakest]) weakest = axis
  }
  const drift = driftLeak(a)
  const resp = responseLeak(a)
  const total = drift + resp
  return {
    scores,
    total: Math.round((scores.content + scores.speed + scores.reviews + scores.retention) / 4),
    weakest,
    driftLeak: roundDollars(drift),
    responseLeak: roundDollars(resp),
    totalLeak: roundDollars(total),
    priceMultiple: Math.max(1, Math.round(total / XRAY_CONFIG.PRICE_MONTHLY)),
    missedShare: missedShare(a.b1, a.b2),
    missedCallsWeekly: a.inquiriesWeekly * missedShare(a.b1, a.b2),
    aiResearchedWeekly: a.inquiriesWeekly * XRAY_CONFIG.AI_RESEARCH_SHARE,
    aiInvisibleShare: aiInvisibleShare(scores),
    aiLeak: roundDollars(aiLeak(a)),
  }
}

/**
 * The headline call-count phrasing (missed-call sweep Part 1). Mirrors the
 * quiz page's display logic — update both together.
 *  - ≥1   → "≈ N calls a week" (singular at 1)
 *  - <1   → "about 1 call most weeks" (a 5% share still loses the odd patient)
 *  - 0 inquiries → "0 calls a week"
 */
export function missedCallsPhrase(raw: number): { big: string; unit: string } {
  if (raw <= 0) return { big: '0', unit: 'calls a week' }
  if (raw < 1) return { big: '≈ 1', unit: 'call most weeks' }
  const n = Math.round(raw)
  return { big: '≈ ' + n, unit: n === 1 ? 'call a week' : 'calls a week' }
}

// ── Copy builders (mirror the app's results screen) ───────────────────────────

export const AXIS_LABEL: Record<XrayResult['weakest'], string> = {
  content: 'Content & Visibility',
  speed: 'Speed-to-Lead & After-Hours',
  reviews: 'Google Review Engine',
  retention: 'Patient Retention & Recall',
}

export function scoreRead(total: number): string {
  if (total >= 80) return 'Strong systems. The leak below shows what tightening the last gaps is worth.'
  if (total >= 55) return 'A solid practice running on manual effort. The leak below is what manual costs.'
  if (total >= 30) return 'Your care is likely excellent — your follow-up systems aren’t. That gap has a monthly price.'
  return 'Almost everything here depends on someone remembering to do it. Nobody can remember this much.'
}

export function reviewBandText(c1pts: number): string {
  return c1pts === 10 ? '300+' : c1pts === 7 ? '100–299' : c1pts === 3 ? '30–99' : 'under 30'
}

/** money() must match the quiz page's formatting (symbol + en-US grouping). */
export function verdictHtml(a: XrayAnswers, r: XrayResult, money: (n: number) => string): string {
  const maintPct = Math.round((a.maintRate || 0) * 100)
  const active = (a.activePatients || 0).toLocaleString('en-US')
  switch (r.weakest) {
    case 'retention':
      return (
        '<b>The scan shows patient drift.</b> Only ' + maintPct + '% of your ~' + active +
        ' active patients are on a regular schedule. The rest finished a care plan, felt fine, and drifted — until the next flare-up, at whichever clinic answers first. That drift alone is costing you an estimated <b>' +
        money(r.driftLeak) + '/month</b>.'
      )
    case 'speed':
      return (
        '<b>The scan shows missed connections.</b> Based on how calls and messages are handled, roughly ' +
        Math.round(r.missedShare * 100) + '% of your ' + (a.inquiriesWeekly || 0) +
        ' weekly inquiries slip through — and most people who miss you once never try twice. They book with whoever answers. That’s an estimated <b>' +
        money(r.responseLeak) + '/month</b> walking to competitors.'
      )
    case 'reviews':
      return (
        '<b>The scan shows an invisible practice.</b> With ' + reviewBandText(a.c1) +
        ' Google reviews, you’re outranked by clinics that are no better than you — just louder. Reviews are the first thing a new patient judges you on, and yours aren’t compounding. And it’s no longer just people reading them: AI assistants weigh the same reviews when they decide which practice to name.'
      )
    default:
      return (
        '<b>The scan shows silence.</b> Your practice goes quiet between visits — and silence reads as absence. Patients can’t stay loyal to a practice they never hear from, and prospects can’t find one that never shows up.'
      )
  }
}
