/**
 * Deterministic sample inputs for the debrief byte-identity guard
 * (wellness-sales-funnel plan, Phase 2). Captured BEFORE the vertical
 * refactor: `pnpm exec tsx src/marketing/__tests__/capture-debrief-fixture.ts`
 * writes xray-debrief-chiro.fixture.html from the pre-refactor template; the
 * test then asserts the refactored template still emits it byte-identically
 * for the chiro vertical.
 */
import type { DebriefTemplateData } from '../xray-debrief-template'

export const FIXTURE_SCORES = { content: 42, speed: 35, reviews: 58, retention: 61 }
export const FIXTURE_WEAKEST = 'speed'

export const FIXTURE_DATA: DebriefTemplateData = {
  preparedFor: 'Dr. Fixture Sample',
  scanDate: '29 OCT 2026',
  totalScore: 49,
  scoreRead: 'A solid practice running on manual effort. The leak below is what manual costs.',
  barsHtml: '', // filled by the capture script via buildBarsHtml
  verdictHtml:
    '<b>The scan shows silence.</b> Your practice goes quiet between visits — and silence reads as absence.',
  totalLeak: '$4,820',
  driftLeak: '$2,900',
  respLeak: '$1,920',
  missBig: '≈ 6',
  missUnit: 'calls a week',
  missLine: 'That is <b>6 conversations</b> nobody answered.',
  missReframe: 'If anything, that number is an underestimate.',
  mult: 12,
  fee: '$65',
  feeYear: '$780',
  aiLine: 'By 2027, <b>1 in 3 new patients</b> will ask an AI assistant first.',
}
