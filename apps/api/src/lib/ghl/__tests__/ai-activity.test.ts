import { describe, it, expect } from 'vitest'
import { rollupConversation, type RollupInput } from '../ai-activity'

const BASE: RollupInput = {
  channel: 'web',
  dmPlatform: null,
  contactWasCreated: false,
  startedAfterHours: null,
  actions: [],
  appointmentProviders: [],
  firstMessageAt: new Date('2026-10-21T10:00:00Z'),
  lastMessageAt: new Date('2026-10-21T10:04:00Z'),
}

describe('rollupConversation (AI Activity dashboard record)', () => {
  it('maps channels: web/voice/mcp and the resolved DM platforms', () => {
    expect(rollupConversation(BASE).channel).toBe('webchat')
    expect(rollupConversation({ ...BASE, channel: 'voice' }).channel).toBe('voice')
    expect(rollupConversation({ ...BASE, channel: 'mcp' }).channel).toBe('agent-protocol')
    expect(rollupConversation({ ...BASE, channel: 'ghl-dm', dmPlatform: 'IG' }).channel).toBe('instagram')
    expect(rollupConversation({ ...BASE, channel: 'ghl-dm', dmPlatform: 'WhatsApp' }).channel).toBe('whatsapp')
    expect(rollupConversation({ ...BASE, channel: 'ghl-dm', dmPlatform: null }).channel).toBe('facebook')
  })

  it('outcome priority: booked beats callback beats guide beats link beats handoff beats answered', () => {
    const acts = [{ type: 'request_callback' }, { type: 'send_guide_link' }, { type: 'send_booking_link' }, { type: 'request_human' }]
    expect(rollupConversation({ ...BASE, appointmentProviders: ['ghl'], actions: acts }).outcome).toBe('booked')
    expect(rollupConversation({ ...BASE, actions: acts }).outcome).toBe('callback')
    expect(rollupConversation({ ...BASE, actions: acts.slice(1) }).outcome).toBe('guide_sent')
    expect(rollupConversation({ ...BASE, actions: acts.slice(2) }).outcome).toBe('booking_link_sent')
    expect(rollupConversation({ ...BASE, actions: acts.slice(3) }).outcome).toBe('human_handoff')
    expect(rollupConversation(BASE).outcome).toBe('answered')
  })

  it('booked_system reflects the appointment provider (GHL or Cliniko)', () => {
    expect(rollupConversation({ ...BASE, appointmentProviders: ['ghl'] }).bookedSystem).toBe('ghl')
    expect(rollupConversation({ ...BASE, appointmentProviders: ['cliniko'] }).bookedSystem).toBe('cliniko')
    expect(rollupConversation(BASE).bookedSystem).toBe('none')
  })

  it('coverage: after-hours anywhere; in-hours VOICE counts as overflow', () => {
    expect(rollupConversation({ ...BASE, startedAfterHours: true }).coverage).toBe('after_hours')
    expect(rollupConversation({ ...BASE, channel: 'voice', startedAfterHours: true }).coverage).toBe('after_hours')
    expect(rollupConversation({ ...BASE, channel: 'voice', startedAfterHours: false }).coverage).toBe('overflow')
    expect(rollupConversation({ ...BASE, startedAfterHours: false }).coverage).toBe('in_hours')
    expect(rollupConversation(BASE).coverage).toBe('unknown')
  })

  it('duration only for voice, from first to last message', () => {
    expect(rollupConversation({ ...BASE, channel: 'voice' }).durationSeconds).toBe(240)
    expect(rollupConversation(BASE).durationSeconds).toBeNull()
    expect(rollupConversation({ ...BASE, channel: 'voice', firstMessageAt: null }).durationSeconds).toBeNull()
  })

  it('new_contact mirrors the upsert-created flag', () => {
    expect(rollupConversation({ ...BASE, contactWasCreated: true }).newContact).toBe(true)
    expect(rollupConversation(BASE).newContact).toBe(false)
  })

  it('malformed action payloads never throw', () => {
    const r = rollupConversation({ ...BASE, actions: [null, {}, { type: 42 } as never, { type: 'request_callback' }] })
    expect(r.outcome).toBe('callback')
  })
})
