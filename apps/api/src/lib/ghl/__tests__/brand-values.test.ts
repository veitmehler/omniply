import { describe, it, expect } from 'vitest'
import { computeBrandValues } from '../brand-values'

const BASE = {
  nlHeaderBgColor: null,
  nlFooterBgColor: null,
  nlLinkColor: null,
  nlButtonColor: null,
  nlButtonTextColor: null,
  nlFontColor: null,
  nlFontFamily: null,
  nlLogoWidth: null,
  diagramPrimaryColor: null,
  diagramSecondaryColor: null,
}

describe('computeBrandValues (newsletter-template alignment)', () => {
  it('mirrors the newsletter fallback chain with neutral defaults', () => {
    const v = computeBrandValues(BASE)
    expect(v.omniply_brand_header_color).toBe('#0b2545')
    expect(v.omniply_brand_footer_color).toBe('#011328') // render.ts footer default
    expect(v.omniply_brand_header_ink).toBe('#ffffff') // dark header → white ink
    expect(v.omniply_brand_footer_ink).toBe('#ffffff')
    expect(v.omniply_brand_button_color).toBe('#2a6f97')
    expect(v.omniply_brand_button_text_color).toBe('#ffffff')
    expect(v.omniply_brand_font_family).toBe('Helvetica')
    expect(v.omniply_brand_logo_width).toBe('220')
  })

  it('honors the client-customized newsletter fields, incl. the separate footer', () => {
    const v = computeBrandValues({
      ...BASE,
      nlHeaderBgColor: '#3aa6b9',
      nlFooterBgColor: '#f4ead5', // LIGHT footer with a dark header
      nlLinkColor: '#238191',
      nlButtonColor: '#e8734a',
      nlButtonTextColor: '#111111',
      nlFontColor: '#222831',
      nlFontFamily: 'Georgia',
      nlLogoWidth: 200,
    })
    expect(v.omniply_brand_header_color).toBe('#3aa6b9')
    expect(v.omniply_brand_footer_color).toBe('#f4ead5')
    expect(v.omniply_brand_footer_ink).toBe('#222831') // light footer → their dark font color
    expect(v.omniply_brand_button_color).toBe('#e8734a')
    expect(v.omniply_brand_button_text_color).toBe('#111111') // their explicit pair wins
    expect(v.omniply_brand_font_family).toBe('Georgia')
    expect(v.omniply_brand_logo_width).toBe('200')
  })

  it('clamps the newsletter logo width into the transactional card range', () => {
    expect(computeBrandValues({ ...BASE, nlLogoWidth: 480 }).omniply_brand_logo_width).toBe('280')
    expect(computeBrandValues({ ...BASE, nlLogoWidth: 60 }).omniply_brand_logo_width).toBe('120')
    expect(computeBrandValues({ ...BASE, nlLogoWidth: 320 }).omniply_brand_logo_width).toBe('280')
  })

  it('button text contrast is computed when the client set no explicit pair', () => {
    expect(computeBrandValues({ ...BASE, nlButtonColor: '#f0e9da' }).omniply_brand_button_text_color).toBe('#1f2937')
    expect(computeBrandValues({ ...BASE, nlButtonColor: '#17323f' }).omniply_brand_button_text_color).toBe('#ffffff')
  })
})
