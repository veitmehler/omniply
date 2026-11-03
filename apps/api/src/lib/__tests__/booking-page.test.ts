import { describe, it, expect } from 'vitest'
import { buildBookingPageHtml, bookingWidgetDomain, bookingWhatsappNumber } from '../booking-page'

describe('bookingWhatsappNumber', () => {
  it('normalizes to digits and bounds the length', () => {
    expect(bookingWhatsappNumber({ whatsapp: '+1 809-348-4444' })).toBe('18093484444')
    expect(bookingWhatsappNumber({ whatsapp: '123' })).toBeNull()
    expect(bookingWhatsappNumber({})).toBeNull()
    expect(bookingWhatsappNumber(null)).toBeNull()
  })
})

describe('bookingWidgetDomain', () => {
  it('accepts a clean https domain and strips trailing slashes', () => {
    expect(bookingWidgetDomain({ widgetDomain: 'https://links.example.com/' })).toBe('https://links.example.com')
  })
  it('rejects missing, non-string, http and malformed values', () => {
    expect(bookingWidgetDomain(null)).toBeNull()
    expect(bookingWidgetDomain({})).toBeNull()
    expect(bookingWidgetDomain({ widgetDomain: 42 })).toBeNull()
    expect(bookingWidgetDomain({ widgetDomain: 'http://links.example.com' })).toBeNull()
    expect(bookingWidgetDomain({ widgetDomain: 'https://links.example.com/widget/x' })).toBeNull()
  })
  it('rejects CRM vendor default domains (white-label rule)', () => {
    expect(bookingWidgetDomain({ widgetDomain: 'https://api.leadconnectorhq.com' })).toBeNull()
    expect(bookingWidgetDomain({ widgetDomain: 'https://x.gohighlevel.com' })).toBeNull()
    expect(bookingWidgetDomain({ widgetDomain: 'https://widgets.msgsndr.com' })).toBeNull()
  })
})

describe('buildBookingPageHtml', () => {
  const base = {
    organizationName: 'Whealth Recovery Center',
    logoUrl: 'https://cdn.example.com/logo.png',
    headerBg: '#0b2545',
    buttonColor: '#5F6243',
    buttonTextColor: '#ffffff',
    accent: '#5F6243',
    services: [
      { label: 'Acupuncture', url: 'https://links.example.com/widget/booking/abc' },
      { label: 'Day Pass', url: 'https://links.example.com/widget/booking/def' },
    ],
    phone: '+1 809-348-4444',
  }
  it('renders one button per service with its widget link', () => {
    const html = buildBookingPageHtml(base)
    expect(html).toContain('https://links.example.com/widget/booking/abc')
    expect(html).toContain('https://links.example.com/widget/booking/def')
    expect(html.match(/display:block;background:#5F6243/g)).toHaveLength(2)
    expect(html).toContain('Acupuncture')
    expect(html).toContain('Day Pass')
  })
  it('escapes HTML in labels and renders the phone CTA with a tel link', () => {
    const html = buildBookingPageHtml({
      ...base,
      services: [{ label: 'A <b>"bold"</b> & risky', url: 'https://links.example.com/widget/booking/x' }],
    })
    expect(html).toContain('A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; risky')
    expect(html).not.toContain('<b>"bold"</b>')
    expect(html).toContain('tel:+18093484444')
  })
  it('falls back to the name block without a logo and omits the phone row without a phone', () => {
    const html = buildBookingPageHtml({ ...base, logoUrl: null, phone: null })
    expect(html).toContain('Whealth Recovery Center')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('tel:')
    expect(html).not.toContain('wa.me')
  })
  it('renders the WhatsApp button below the phone row when a number is given', () => {
    const html = buildBookingPageHtml({ ...base, whatsapp: '18093484444' })
    expect(html).toContain('https://wa.me/18093484444?text=')
    expect(html).toContain('Message us on WhatsApp')
    expect(html.indexOf('wa.me')).toBeGreaterThan(html.indexOf('tel:'))
  })
})
