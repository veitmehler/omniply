import { describe, expect, it, vi } from 'vitest'
import {
  channelKeyForSendType,
  gateDmTurn,
  isReactionOnly,
  ownerActiveInThread,
  parseDmChannelModes,
  parseDmIntent,
  resolveDmChannelModes,
} from '../dm-gate'

describe('channel modes', () => {
  it('fills defaults: WhatsApp all, Instagram/Facebook inquiries', () => {
    expect(resolveDmChannelModes(null)).toEqual({ whatsapp: 'all', instagram: 'inquiries', facebook: 'inquiries' })
    expect(resolveDmChannelModes({ instagram: 'off' })).toEqual({ whatsapp: 'all', instagram: 'off', facebook: 'inquiries' })
    expect(resolveDmChannelModes({ instagram: 'bogus', whatsapp: 42 })).toEqual(resolveDmChannelModes(null))
  })
  it('rejects invalid settings bodies', () => {
    expect(parseDmChannelModes({ instagram: 'sometimes' })).toBeNull()
    expect(parseDmChannelModes([])).toBeNull()
    expect(parseDmChannelModes({ facebook: 'off' })).toEqual({ whatsapp: 'all', instagram: 'inquiries', facebook: 'off' })
  })
  it('maps send types to settings keys', () => {
    expect(channelKeyForSendType('IG')).toBe('instagram')
    expect(channelKeyForSendType('FB')).toBe('facebook')
    expect(channelKeyForSendType('WhatsApp')).toBe('whatsapp')
    expect(channelKeyForSendType('SMS')).toBeNull()
  })
})

describe('layer 1: reaction-only messages', () => {
  // Dasha's inbox 2026-11-09 / 2026-11-06: these got a sales reply.
  it('treats reactions, emoji and thanks as nothing to answer', () => {
    for (const m of ['Wowwwwww yesss', 'Thank you!!', '❤️🙏', 'haha ok', 'Hahaha', 'Love it 😍', 'gracias!!', 'спасибо', '👍']) {
      expect(isReactionOnly(m), m).toBe(true)
    }
  })
  it('keeps anything with a question, a number or a real word', () => {
    for (const m of [
      'Thanks! Do you have anything for lower back tightness?',
      'What is pemf?',
      'I did pressure therapy a long time ago',
      'Hi, are you open Saturday',
      '$70 for a session?',
      'Higherdose https://go.shopmy.us/p-51888140 Code JASYRA15',
    ]) {
      expect(isReactionOnly(m), m).toBe(false)
    }
  })
})

describe('layer 2: owner-active thread', () => {
  const now = new Date('2026-11-09T21:09:00Z')
  const agentReplies = ['Hey! Happy to help, what brings you to Whealth today?']

  it('flags a thread the owner wrote in by hand within 7 days', () => {
    // _dashofhealth thread: Dasha's Russian message 3 days earlier.
    const r = ownerActiveInThread({
      now,
      agentReplies,
      thread: [
        { direction: 'outbound', body: 'Тебе надо обязательно такие записывать для whealth', dateAdded: '2026-11-06T00:07:10Z' },
        { direction: 'inbound', body: 'Wowwwwww yesss', dateAdded: '2026-11-09T21:09:23Z' },
      ],
    })
    expect(r.active).toBe(true)
    expect(r.lastOwnerMessageAt?.toISOString()).toBe('2026-11-06T00:07:10.000Z')
  })
  it('counts empty outbound bodies (shared reels, stickers) as the owner', () => {
    const r = ownerActiveInThread({ now, agentReplies, thread: [{ direction: 'outbound', body: '', dateAdded: '2026-11-08T03:00:00Z' }] })
    expect(r.active).toBe(true)
  })
  it('does not count the agent\'s own replies, even with a link appended', () => {
    const r = ownerActiveInThread({
      now,
      agentReplies,
      thread: [
        { direction: 'outbound', body: 'Hey! Happy to help, what brings you to Whealth today?\n\nhttps://cabaretehealth.com/book-online', dateAdded: '2026-11-08T03:00:00Z' },
        { direction: 'inbound', body: 'hi', dateAdded: '2026-11-09T21:00:00Z' },
      ],
    })
    expect(r.active).toBe(false)
  })
  it('expires after the window', () => {
    const r = ownerActiveInThread({ now, agentReplies, thread: [{ direction: 'outbound', body: 'see you soon', dateAdded: '2026-10-30T00:00:00Z' }] })
    expect(r.active).toBe(false)
  })
  it('is inactive on an unreadable thread', () => {
    expect(ownerActiveInThread({ now, agentReplies, thread: [] }).active).toBe(false)
  })
})

describe('layer 3: intent verdict parsing', () => {
  it('accepts the documented JSON and nothing else', () => {
    expect(parseDmIntent({ intent: 'not_inquiry', reason: 'promo code' })).toEqual({ intent: 'not_inquiry', reason: 'promo code' })
    expect(parseDmIntent({ intent: 'INQUIRY' })).toEqual({ intent: 'inquiry', reason: null })
    expect(parseDmIntent({ intent: 'maybe' })).toBeNull()
    expect(parseDmIntent('inquiry')).toBeNull()
  })
})

describe('gateDmTurn orchestration', () => {
  const loadThread = vi.fn(async () => ({ thread: [], agentReplies: [] }))
  const classify = vi.fn(async () => ({ intent: 'not_inquiry' as const, reason: 'creator pitch' }))

  it('off never replies and runs nothing', async () => {
    loadThread.mockClear()
    classify.mockClear()
    expect(await gateDmTurn({ mode: 'off', message: 'Do you have HBOT?', loadThread, classify })).toEqual({ reply: false, reason: 'channel-off' })
    expect(loadThread).not.toHaveBeenCalled()
    expect(classify).not.toHaveBeenCalled()
  })
  it('all replies to everything without lookups (pre-gate behaviour)', async () => {
    loadThread.mockClear()
    expect(await gateDmTurn({ mode: 'all', message: 'Wowwwwww yesss', loadThread, classify })).toEqual({ reply: true })
    expect(loadThread).not.toHaveBeenCalled()
  })
  it('inquiries: reaction → silent before any lookup', async () => {
    loadThread.mockClear()
    expect(await gateDmTurn({ mode: 'inquiries', message: 'Thank you!!', loadThread, classify })).toEqual({ reply: false, reason: 'reaction-only' })
    expect(loadThread).not.toHaveBeenCalled()
  })
  it('inquiries: owner-active thread → silent before the classifier', async () => {
    classify.mockClear()
    const v = await gateDmTurn({
      mode: 'inquiries',
      message: 'loll aw i can repost!',
      now: new Date('2026-11-02T15:32:00Z'),
      loadThread: async () => ({ thread: [{ direction: 'outbound', body: 'thanks love!', dateAdded: '2026-11-01T10:00:00Z' }], agentReplies: [] }),
      classify,
    })
    expect(v).toMatchObject({ reply: false, reason: 'owner-active' })
    expect(classify).not.toHaveBeenCalled()
  })
  it('inquiries: cold non-inquiry → silent with the classifier reason', async () => {
    const v = await gateDmTurn({ mode: 'inquiries', message: 'Higherdose https://go.shopmy.us/p-1 Code JASYRA15', loadThread, classify })
    expect(v).toEqual({ reply: false, reason: 'not-inquiry', detail: 'creator pitch' })
  })
  it('inquiries: cold inquiry → reply; classifier outage fails open', async () => {
    expect(await gateDmTurn({ mode: 'inquiries', message: 'Do you offer compression boots?', loadThread, classify: async () => ({ intent: 'inquiry', reason: null }) })).toEqual({ reply: true })
    expect(await gateDmTurn({ mode: 'inquiries', message: 'Do you offer compression boots?', loadThread, classify: async () => null })).toEqual({ reply: true })
  })
})
