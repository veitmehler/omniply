import { describe, expect, it } from 'vitest'
import { pickStuckTransferLeg } from '../voice-transfer-watchdog'
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
