import { describe, it, expect } from 'vitest'
import { aggregateRecords, type AiActivityRecord } from '../ai-activity-stats'

const NOW = new Date('2026-10-21T18:00:00Z')

function rec(over: Partial<AiActivityRecord>): AiActivityRecord {
  return {
    channel: 'webchat',
    outcome: 'answered',
    bookedSystem: 'none',
    newContact: false,
    coverage: 'in_hours',
    durationSeconds: null,
    startedAt: new Date('2026-10-20T15:00:00Z'),
    ...over,
  }
}

describe('aggregateRecords', () => {
  it('aggregates totals, channels and coverage', () => {
    const stats = aggregateRecords(
      [
        rec({ channel: 'voice', outcome: 'booked', bookedSystem: 'ghl', coverage: 'after_hours', newContact: true, durationSeconds: 180 }),
        rec({ channel: 'voice', outcome: 'booked', bookedSystem: 'cliniko', coverage: 'overflow', durationSeconds: 120 }),
        rec({ outcome: 'booking_link_sent' }),
        rec({ outcome: 'guide_sent', newContact: true }),
        rec({ channel: 'whatsapp', outcome: 'callback' }),
        rec({ channel: 'facebook', outcome: 'human_handoff' }),
      ],
      30,
      'America/New_York',
      NOW,
    )
    expect(stats.totals).toMatchObject({
      conversations: 6,
      booked: 2,
      bookedGhl: 1,
      bookedCliniko: 1,
      bookingLinksSent: 1,
      newContacts: 2,
      afterHours: 1,
      overflow: 1,
      guidesSent: 1,
      callbacks: 1,
      handoffs: 1,
      voiceMinutes: 5,
    })
    expect(stats.byChannel).toMatchObject({ voice: 2, webchat: 2, whatsapp: 1, facebook: 1, instagram: 0 })
  })

  it('zero-fills the day axis in the clinic timezone, oldest first', () => {
    const stats = aggregateRecords(
      // 02:00 UTC on Oct 21 is still Oct 20 in New York.
      [rec({ startedAt: new Date('2026-10-21T02:00:00Z') })],
      7,
      'America/New_York',
      NOW,
    )
    expect(stats.byDay).toHaveLength(7)
    expect(stats.byDay[stats.byDay.length - 1].date).toBe('2026-10-21')
    expect(stats.byDay.find((d) => d.date === '2026-10-20')?.count).toBe(1)
    expect(stats.byDay.reduce((s, d) => s + d.count, 0)).toBe(1)
  })

  it('handles an empty window', () => {
    const stats = aggregateRecords([], 7, 'America/New_York', NOW)
    expect(stats.totals.conversations).toBe(0)
    expect(stats.byDay).toHaveLength(7)
    expect(stats.byDay.every((d) => d.count === 0)).toBe(true)
  })
})
