import { describe, it, expect, vi } from 'vitest'

vi.mock('@omniply/shared', () => ({ prisma: {} }))
vi.mock('../../agent/actions', () => ({
  executeBooking: vi.fn(),
  executeCallback: vi.fn(),
  executeAddEmail: vi.fn(),
}))
vi.mock('../../agent/booking', () => ({ bookingInfoFor: vi.fn() }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { toolDefsFor, bookingAllowed } from '../routes'

describe('MCP tool surface honesty (mode gating)', () => {
  it('bookable clinics expose all four tools', () => {
    const names = toolDefsFor(true).map((t) => t.name)
    expect(names).toEqual(['get_clinic_info', 'get_availability', 'book_appointment', 'request_callback'])
  })
  it('phone-only clinics expose info + callback only', () => {
    const names = toolDefsFor(false).map((t) => t.name)
    expect(names).toEqual(['get_clinic_info', 'request_callback'])
  })
  it('book_appointment schema requires name/phone/slotStart', () => {
    const book = toolDefsFor(true).find((t) => t.name === 'book_appointment') as { inputSchema: { required: string[] } }
    expect(book.inputSchema.required).toEqual(['name', 'phone', 'slotStart'])
  })
})

describe('booking throttle (3/hour per clinic+IP)', () => {
  it('allows three bookings then blocks within the hour', () => {
    const key = 'acct:1.2.3.4'
    const t0 = 1_000_000
    expect(bookingAllowed(key, t0)).toBe(true)
    expect(bookingAllowed(key, t0 + 1000)).toBe(true)
    expect(bookingAllowed(key, t0 + 2000)).toBe(true)
    expect(bookingAllowed(key, t0 + 3000)).toBe(false)
  })
  it('window slides: old hits expire after an hour', () => {
    const key = 'acct:5.6.7.8'
    const t0 = 2_000_000
    bookingAllowed(key, t0); bookingAllowed(key, t0); bookingAllowed(key, t0)
    expect(bookingAllowed(key, t0 + 61 * 60 * 1000)).toBe(true)
  })
})
