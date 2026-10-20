import { describe, expect, it } from 'vitest'
import { parseDmPayload, CHANNEL_TYPES } from '../dm'

describe('parseDmPayload (tolerant GHL workflow webhook shapes)', () => {
  it('reads customData mappings (the documented snapshot shape)', () => {
    const p = parseDmPayload({
      customData: { contact_id: 'c1', message_body: 'hi there', message_type: 'TYPE_INSTAGRAM', direction: 'inbound' },
    })
    expect(p).toEqual({ contactId: 'c1', message: 'hi there', messageType: 'TYPE_INSTAGRAM', direction: 'inbound' })
  })
  it('falls back to standard payload fields', () => {
    const p = parseDmPayload({ contact: { id: 'c2' }, message: { body: 'yo', type: 'FB', direction: 'inbound' } })
    expect(p.contactId).toBe('c2')
    expect(p.message).toBe('yo')
    expect(p.messageType).toBe('FB')
  })
  it('returns nulls on junk without throwing', () => {
    const p = parseDmPayload({ foo: 'bar' })
    expect(p.contactId).toBeNull()
    expect(p.message).toBeNull()
  })
})

describe('CHANNEL_TYPES (messenger channels the DM transport serves)', () => {
  it('maps FB, IG, and WhatsApp inbound types to their send types', () => {
    expect(CHANNEL_TYPES['TYPE_FACEBOOK']).toBe('FB')
    expect(CHANNEL_TYPES['TYPE_INSTAGRAM']).toBe('IG')
    // WhatsApp (wellness plan Phase 2): inbound TYPE_WHATSAPP / resolved
    // 'WhatsApp' both send as 'WhatsApp' (Conversations send-message enum).
    expect(CHANNEL_TYPES['TYPE_WHATSAPP']).toBe('WhatsApp')
    expect(CHANNEL_TYPES['WHATSAPP']).toBe('WhatsApp')
  })

  it('still excludes non-messenger channels (SMS/email/webchat have their own transports)', () => {
    for (const t of ['TYPE_SMS', 'TYPE_EMAIL', 'TYPE_WEBCHAT', 'TYPE_LIVE_CHAT', 'TYPE_CALL']) {
      expect(CHANNEL_TYPES[t]).toBeUndefined()
    }
  })
})

describe('parseDmPayload — reduced Customer Replied payload (2026-09-09)', () => {
  it('parses contact_id + message_body with NO message_type (builder offers none)', () => {
    const p = parseDmPayload({ customData: { contact_id: 'c9', message_body: 'hi there' } })
    expect(p.contactId).toBe('c9')
    expect(p.message).toBe('hi there')
    expect(p.messageType).toBeNull()
    expect(p.direction).toBeNull()
  })
})
