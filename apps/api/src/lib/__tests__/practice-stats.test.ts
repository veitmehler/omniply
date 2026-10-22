import { describe, it, expect } from 'vitest'
import { computeReviewGrowth } from '../practice-stats'

describe('computeReviewGrowth', () => {
  const snaps = [
    { day: '2026-10-01', count: 200 },
    { day: '2026-10-10', count: 205 },
    { day: '2026-10-20', count: 210 },
  ]

  it('uses the latest snapshot at/before the range start as baseline', () => {
    expect(computeReviewGrowth(213, snaps, '2026-10-12')).toEqual({ reviewGrowth: 8, growthSince: null })
    expect(computeReviewGrowth(213, snaps, '2026-10-10')).toEqual({ reviewGrowth: 8, growthSince: null })
  })

  it('falls back to the earliest snapshot with growthSince on partial history', () => {
    expect(computeReviewGrowth(213, snaps, '2026-09-15')).toEqual({ reviewGrowth: 13, growthSince: '2026-10-01' })
  })

  it('returns null without a live count or any snapshots', () => {
    expect(computeReviewGrowth(null, snaps, '2026-10-12')).toEqual({ reviewGrowth: null, growthSince: null })
    expect(computeReviewGrowth(213, [], '2026-10-12')).toEqual({ reviewGrowth: null, growthSince: null })
  })
})
