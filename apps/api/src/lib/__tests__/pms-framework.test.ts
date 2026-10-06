import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeBookingMode, isDirectMode } from '../booking/providers'
import { providerFor } from '../booking'
import { clinikoBaseUrl, fetchChangedPatients } from '../booking/cliniko'
import { parseCsv, mapCsvToRows } from '../contacts/intake'

describe('booking modes', () => {
  it('normalizes and classifies modes', () => {
    expect(normalizeBookingMode('direct-ghl')).toBe('direct-ghl')
    expect(normalizeBookingMode('advisory-gcal')).toBe('advisory-gcal')
    expect(normalizeBookingMode('patterns')).toBe('patterns')
    expect(normalizeBookingMode('garbage')).toBe('off')
    expect(normalizeBookingMode(null)).toBe('off')
    expect(isDirectMode('direct-cliniko')).toBe(true)
    expect(isDirectMode('advisory-gcal')).toBe(false)
  })

  it('nookal stays a loud stub until trial-account verification', async () => {
    await expect(providerFor('direct-nookal').freeSlots({ accountId: 'a', ownerUserId: 'u', config: null, calendarId: null }, 0, 1)).rejects.toThrow(
      /not yet verified/,
    )
  })
})

describe('cliniko client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('derives the API shard from the key suffix', () => {
    expect(clinikoBaseUrl('MS-abc123-au2')).toBe('https://api.au2.cliniko.com/v1')
    expect(clinikoBaseUrl('MS-abc123-uk1')).toBe('https://api.uk1.cliniko.com/v1')
  })

  it('parses changed patients with updated_since filtering', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      calls.push(String(url))
      return new Response(
        JSON.stringify({
          patients: [
            { id: 42, first_name: 'Jane', last_name: 'Doe', email: 'j@x.com', updated_at: '2026-10-06T01:00:00Z', patient_phone_numbers: [{ number: '0400 111 222' }] },
          ],
        }),
        { status: 200 },
      )
    }))
    const since = new Date('2026-10-05T00:00:00Z')
    const out = await fetchChangedPatients('MS-k-au2', since)
    expect(out).toEqual([
      { externalId: '42', firstName: 'Jane', lastName: 'Doe', email: 'j@x.com', phone: '0400 111 222', updatedAt: '2026-10-06T01:00:00Z' },
    ])
    expect(calls[0]).toContain('api.au2.cliniko.com')
    expect(decodeURIComponent(calls[0])).toContain('updated_at:>2026-10-05')
  })
})

describe('csv intake', () => {
  it('parses quoted CSV and auto-maps common PMS headers', () => {
    const csv = 'First Name,Last Name,Mobile Phone,Email\n"Smith, Jr",John,0400123123,js@x.com\nAda,,,"ada@y.com"\n,,,'
    const mapped = mapCsvToRows(parseCsv(csv))
    expect(mapped).not.toBeNull()
    expect(mapped!.rows[0]).toEqual({ name: 'Smith, Jr John', phone: '0400123123', email: 'js@x.com' })
    expect(mapped!.rows[1]).toEqual({ name: 'Ada', phone: null, email: 'ada@y.com' })
  })

  it('maps full-name exports too and rejects files without phone/email columns', () => {
    const mapped = mapCsvToRows(parseCsv('Patient Name,Phone\nJane Doe,555-1234'))
    expect(mapped!.rows[0]).toEqual({ name: 'Jane Doe', phone: '555-1234', email: null })
    expect(mapCsvToRows(parseCsv('Name,DOB\nJane,1980'))).toBeNull()
  })
})
