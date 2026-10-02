import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { placeRefsFromUrl, expandGoogleShortLink, isGoogleHost, resolvePlaceId } from '../google/places'

describe('placeRefsFromUrl', () => {
  it('extracts place_id and placeid params', () => {
    expect(placeRefsFromUrl('https://example.com/?place_id=ChIJabcdefghijklmnopqrstuv').placeId).toBe(
      'ChIJabcdefghijklmnopqrstuv',
    )
    expect(
      placeRefsFromUrl('https://search.google.com/local/writereview?placeid=ChIJabcdefghijklmnopqrstuv').placeId,
    ).toBe('ChIJabcdefghijklmnopqrstuv')
  })

  it('extracts ftid from the data blob and the ftid param', () => {
    const url =
      'https://www.google.com/maps/place/Simon+Chiropractic/@33.3,-111.6,17z/data=!3m1!4b1!4m6!3m5!1s0x872b1e8f00000000:0x1234abcd5678ef90!8m2'
    expect(placeRefsFromUrl(url).ftid).toBe('0x872b1e8f00000000:0x1234abcd5678ef90')
    expect(placeRefsFromUrl('https://maps.google.com/?ftid=0xabc:0xdef').ftid).toBe('0xabc:0xdef')
  })

  it('extracts cid', () => {
    expect(placeRefsFromUrl('https://maps.google.com/?cid=12345678901234').cid).toBe('12345678901234')
  })

  it('extracts name + coordinates from /maps/place/ URLs', () => {
    const refs = placeRefsFromUrl('https://www.google.com/maps/place/Simon+Chiropractic+Center/@33.3456,-111.6789,17z/')
    expect(refs.nameAtPoint).toEqual({ name: 'Simon Chiropractic Center', lat: 33.3456, lng: -111.6789 })
  })

  it('returns empty refs for a plain URL', () => {
    expect(placeRefsFromUrl('https://g.page/some-slug')).toEqual({})
  })
})

describe('isGoogleHost', () => {
  it('accepts Google hosts and rejects everything else', () => {
    for (const h of ['maps.app.goo.gl', 'g.co', 'www.google.com', 'maps.google.com', 'google.com.au', 'www.google.de'])
      expect(isGoogleHost(h), h).toBe(true)
    for (const h of ['evil.com', 'google.evil.com', 'notgoogle.com', 'goo.gl.evil.net']) expect(isGoogleHost(h), h).toBe(false)
  })
})

describe('expandGoogleShortLink / resolvePlaceId ladder', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key'
  })
  afterEach(() => {
    global.fetch = realFetch
    delete process.env.GOOGLE_MAPS_API_KEY
    vi.restoreAllMocks()
  })

  function redirectTo(location: string): Response {
    return new Response(null, { status: 302, headers: { location } })
  }

  it('follows a short link to a full maps URL', async () => {
    global.fetch = vi.fn(async () =>
      redirectTo('https://www.google.com/maps/place/Simon+Chiro/@33.3,-111.6,17z/'),
    ) as unknown as typeof fetch
    const out = await expandGoogleShortLink('https://maps.app.goo.gl/AbCdEf123')
    expect(out).toContain('google.com/maps/place/Simon+Chiro')
  })

  it('aborts when a hop leaves Google', async () => {
    global.fetch = vi.fn(async () => redirectTo('https://evil.example.com/steal')) as unknown as typeof fetch
    expect(await expandGoogleShortLink('https://maps.app.goo.gl/AbCdEf123')).toBeNull()
  })

  it('refuses to expand non-short-link hosts at all', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    expect(await expandGoogleShortLink('https://my-clinic.com/anything')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves a /maps/place URL via coordinate-biased Find Place as source link', async () => {
    const calls: string[] = []
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      return new Response(JSON.stringify({ status: 'OK', candidates: [{ place_id: 'ChIJlinkresolved000000000' }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch
    const out = await resolvePlaceId('https://www.google.com/maps/place/Simon+Chiro/@33.3,-111.6,17z/', 'Simon Chiro Mesa AZ')
    expect(out).toEqual({ placeId: 'ChIJlinkresolved000000000', source: 'link' })
    expect(calls[0]).toContain('locationbias=point:33.3,-111.6')
  })

  it('falls back to text search as source search', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'OK', candidates: [{ place_id: 'ChIJsearchresolved0000000' }] }), { status: 200 }),
    ) as unknown as typeof fetch
    const out = await resolvePlaceId(null, 'Simon Chiro Mesa AZ')
    expect(out).toEqual({ placeId: 'ChIJsearchresolved0000000', source: 'search' })
  })

  it('a direct place_id link never hits the network', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    const out = await resolvePlaceId('https://x.google.com/?place_id=ChIJdirectlink00000000000', 'whatever')
    expect(out).toEqual({ placeId: 'ChIJdirectlink00000000000', source: 'link' })
    expect(spy).not.toHaveBeenCalled()
  })
})
