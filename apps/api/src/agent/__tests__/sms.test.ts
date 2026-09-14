import { describe, expect, it } from 'vitest'
import { buildBookingSms, buildGuideSms, SMS_PER_CONVERSATION_CAP } from '../sms'
import { validateAction } from '../tools'

const CTX = { guideSlugs: ['posture-guide'], bookingAvailable: true, hasContact: false }

describe('voice SMS templates (deterministic — never model text)', () => {
  it('guide SMS carries practice, title, link, and the STOP line', () => {
    const s = buildGuideSms('Coast Chiro', 'Posture Guide', 'https://drive.google.com/abc')
    expect(s).toContain('Coast Chiro')
    expect(s).toContain('Posture Guide')
    expect(s).toContain('https://drive.google.com/abc')
    expect(s).toContain('Reply STOP')
  })

  it('booking SMS carries the booking URL and STOP line', () => {
    const s = buildBookingSms('Coast Chiro', 'https://book.example.com')
    expect(s).toContain('https://book.example.com')
    expect(s).toContain('Reply STOP')
  })

  it('cap constant is small', () => {
    expect(SMS_PER_CONVERSATION_CAP).toBeLessThanOrEqual(5)
  })
})

describe('SMS phone fields on actions (voice delivery)', () => {
  it('send_guide_link accepts a valid phone and rejects junk to null', () => {
    expect(validateAction({ type: 'send_guide_link', slug: 'posture-guide', phone: '+61 400 111 222' }, CTX)).toEqual({
      type: 'send_guide_link',
      slug: 'posture-guide',
      phone: '+61 400 111 222',
    })
    expect(validateAction({ type: 'send_guide_link', slug: 'posture-guide', phone: '12' }, CTX)).toEqual({
      type: 'send_guide_link',
      slug: 'posture-guide',
      phone: null,
    })
  })

  it('send_booking_link carries the phone; still gated on bookingAvailable', () => {
    expect(validateAction({ type: 'send_booking_link', phone: '0400111222' }, CTX)).toEqual({
      type: 'send_booking_link',
      phone: '0400111222',
    })
    expect(validateAction({ type: 'send_booking_link', phone: '0400111222' }, { ...CTX, bookingAvailable: false })).toBeNull()
  })

  it('intake_details: name and/or valid phone; empty intake rejected', () => {
    expect(validateAction({ type: 'intake_details', name: 'Tom', phone: '0788953217' }, CTX)).toEqual({
      type: 'intake_details',
      name: 'Tom',
      phone: '0788953217',
    })
    expect(validateAction({ type: 'intake_details', name: 'Tom' }, CTX)).toEqual({
      type: 'intake_details',
      name: 'Tom',
      phone: null,
    })
    expect(validateAction({ type: 'intake_details', phone: '0788953217' }, CTX)).toEqual({
      type: 'intake_details',
      name: null,
      phone: '0788953217',
    })
    // junk phone degrades; with no name left the intake is rejected
    expect(validateAction({ type: 'intake_details', phone: '12' }, CTX)).toBeNull()
    expect(validateAction({ type: 'intake_details' }, CTX)).toBeNull()
  })

  it('request_callback preferredTime: verbatim words, capped, optional', () => {
    const a = validateAction(
      { type: 'request_callback', name: 'Sam', phone: '0400111222', reason: 'x', preferredTime: ' around 10:30 AM ' },
      CTX,
    )
    expect(a).toMatchObject({ preferredTime: 'around 10:30 AM' })
    const b = validateAction({ type: 'request_callback', name: 'Sam', phone: '0400111222', reason: 'x' }, CTX)
    expect(b).toMatchObject({ preferredTime: null })
  })
})
