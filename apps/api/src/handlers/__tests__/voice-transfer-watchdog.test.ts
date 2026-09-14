import { describe, expect, it } from 'vitest'
import { findCallerLeg, findInboundCallerLeg, pickStuckTransferLeg } from '../voice-transfer-watchdog'
import type { TwilioCallInfo } from '../../lib/twilio'

const ARMED = '2026-09-09T21:00:00.000Z'

const call = (over: Partial<TwilioCallInfo>): TwilioCallInfo => ({
  sid: 'CAtest',
  status: 'ringing',
  to: '+18297312601',
  direction: 'outbound-api',
  date_created: '2026-09-09T20:59:50.000Z',
  ...over,
})

describe('pickStuckTransferLeg', () => {
  it('finds the still-ringing outbound leg to the transfer number', () => {
    const legs = [call({ sid: 'CAstuck' })]
    expect(pickStuckTransferLeg(legs, '+18297312601', ARMED)?.sid).toBe('CAstuck')
  })

  it('matches numbers across formatting differences', () => {
    const legs = [call({ sid: 'CAfmt', to: '(829) 731-2601' })]
    expect(pickStuckTransferLeg(legs, '+18297312601', ARMED)?.sid).toBe('CAfmt')
  })

  it('ignores answered (in-progress) and completed legs', () => {
    expect(pickStuckTransferLeg([call({ status: 'in-progress' })], '+18297312601', ARMED)).toBeNull()
    expect(pickStuckTransferLeg([call({ status: 'completed' })], '+18297312601', ARMED)).toBeNull()
  })

  it('ignores the caller inbound leg and calls to other numbers', () => {
    expect(pickStuckTransferLeg([call({ direction: 'inbound' })], '+18297312601', ARMED)).toBeNull()
    expect(pickStuckTransferLeg([call({ to: '+15550001111' })], '+18297312601', ARMED)).toBeNull()
  })

  it('ignores stale legs from long before the watchdog was armed', () => {
    const legs = [call({ date_created: '2026-09-09T20:30:00.000Z' })]
    expect(pickStuckTransferLeg(legs, '+18297312601', ARMED)).toBeNull()
  })

  it('accepts queued/initiated as still-unanswered', () => {
    expect(pickStuckTransferLeg([call({ status: 'queued' })], '+18297312601', ARMED)).not.toBeNull()
    expect(pickStuckTransferLeg([call({ status: 'initiated' })], '+18297312601', ARMED)).not.toBeNull()
  })
})

describe('findInboundCallerLeg', () => {
  const CLINIC = '+61870087991'
  const inbound = (over: Partial<TwilioCallInfo>): TwilioCallInfo => ({
    sid: 'CAin',
    status: 'in-progress',
    to: CLINIC,
    from: '+61400111222',
    direction: 'inbound',
    date_created: '2026-09-10T21:00:00.000Z',
    ...over,
  })

  it('finds the single in-progress inbound call to the clinic number', () => {
    const calls = [
      inbound({ sid: 'CAcaller' }),
      inbound({ sid: 'CAdial', direction: 'outbound-api', to: '+18297312601' }),
      inbound({ sid: 'CAdone', status: 'completed' }),
    ]
    expect(findInboundCallerLeg(calls, CLINIC, null)).toBe('CAcaller')
  })

  it('with two concurrent callers, the source callerPhone disambiguates', () => {
    const calls = [
      inbound({ sid: 'CAother', from: '+61400999888' }),
      inbound({ sid: 'CAours', from: '+61400111222' }),
    ]
    expect(findInboundCallerLeg(calls, CLINIC, '+61400111222')).toBe('CAours')
    // trunk-zero form of the same number still matches
    expect(findInboundCallerLeg(calls, CLINIC, '0400 111 222')).toBe('CAours')
  })

  it('two concurrent callers and no phone match → null (no-ambiguity rule)', () => {
    const calls = [
      inbound({ sid: 'CAa', from: 'anonymous' }),
      inbound({ sid: 'CAb', from: 'anonymous' }),
    ]
    expect(findInboundCallerLeg(calls, CLINIC, null)).toBeNull()
  })

  it('ignores calls to other numbers and non-inbound directions', () => {
    expect(findInboundCallerLeg([inbound({ to: '+15550001111' })], CLINIC, null)).toBeNull()
    expect(findInboundCallerLeg([inbound({ direction: 'outbound-dial' })], CLINIC, null)).toBeNull()
  })
})

describe('findCallerLeg', () => {
  it('returns the OTHER participant of the conference containing the stuck leg', () => {
    const confs = [
      { conferenceSid: 'CFother', participants: [{ call_sid: 'CAx' }, { call_sid: 'CAy' }] },
      { conferenceSid: 'CFours', participants: [{ call_sid: 'CAcaller' }, { call_sid: 'CAstuck' }] },
    ]
    expect(findCallerLeg(confs, 'CAstuck')).toBe('CAcaller')
  })

  it('deterministic under concurrent conferences (never picks the wrong room)', () => {
    const confs = [
      { conferenceSid: 'CF1', participants: [{ call_sid: 'CAcallerA' }, { call_sid: 'CAdialA' }] },
      { conferenceSid: 'CF2', participants: [{ call_sid: 'CAcallerB' }, { call_sid: 'CAdialB' }] },
    ]
    expect(findCallerLeg(confs, 'CAdialB')).toBe('CAcallerB')
    expect(findCallerLeg(confs, 'CAdialA')).toBe('CAcallerA')
  })

  it('null when the stuck leg is in no conference or alone', () => {
    expect(findCallerLeg([], 'CAstuck')).toBeNull()
    expect(findCallerLeg([{ conferenceSid: 'CF', participants: [{ call_sid: 'CAstuck' }] }], 'CAstuck')).toBeNull()
    expect(findCallerLeg([{ conferenceSid: 'CF', participants: [{ call_sid: 'CAx' }] }], 'CAstuck')).toBeNull()
  })
})
