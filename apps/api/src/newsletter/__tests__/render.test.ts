import { describe, it, expect } from 'vitest'
import { renderNewsletterHtml, renderPromoEmail, type RenderInput, type RenderBrand } from '../render'

const brand: RenderBrand = {
  organizationName: 'Acme Wellness',
  nlLogoUrl: 'https://cdn.example.com/logo.png',
  nlLogoWidth: 280,
  organizationAddress: '123 Main St, Springfield',
  organizationEmail: 'hello@acme.test',
  organizationPhone: '+1 555 0100',
  organizationLogoUrl: 'https://cdn.example.com/orglogo.png',
  nlLogoLightUrl: 'https://cdn.example.com/logo-light.png',
  nlLogoDarkUrl: 'https://cdn.example.com/logo-dark.png',
  socialMediaLinks: [
    { platform: 'instagram', url: 'https://instagram.com/acme' },
    { platform: 'twitter', url: 'https://x.com/acme' },
    { platform: 'unknownnet', url: 'https://u.test' },
  ],
  nlHeaderBgColor: '#0d1b2a',
  nlFooterBgColor: '#eef2f7',
  nlSectionColor1: '#aa0011',
  nlSectionColor2: '#0022bb',
  nlSectionColor3: '#113322',
  nlSectionColor4: '#445566',
  nlFontFamily: 'Georgia',
  nlFontColor: '#222222',
  nlLinkColor: '#cc3344',
}

const teaser = (headline: string, link: string) => ({
  headline,
  title: 't',
  body: `<p>blurb for ${headline}</p>`,
  cta: '<p>cta</p>',
  link,
})

const full: RenderInput = {
  previewText: 'This month: back pain myths busted',
  featureArticle: { title: 'Back Pain Myths', teaser: '', tldr: 'The summary', body: '<h2>Sec</h2><p>Body</p>', imageUrl: 'https://cdn.example.com/feature.jpg' },
  secondaryArticle: { title: 'Sports Recovery', teaser: 't', tldr: '', body: '<p>secondary body</p>', imageUrl: null },
  teasers: [teaser('Real Source Headline A', 'https://a.com/x'), teaser('Real Source Headline B', 'https://b.com/y'), teaser('Real Source Headline C', 'https://c.com/z')],
  quickHits: { tips: ['tip one', 'tip two'], facts: ['fact one'] },
  fun: { triviaQuestion: 'Q?', triviaAnswer: 'A.', joke: '<p>setup</p><p>punchline</p>' },
  modules: {
    recipe: { intro: '<h2>Quinoa</h2><p>intro</p>', ingredients: '<ul><li>quinoa</li></ul>', instructions: '<ol><li>mix</li></ol>', imageUrl: 'https://cdn.example.com/recipe.jpg' },
    recipe2: { intro: '<h2>Bites</h2>', ingredients: '<ul><li>oats</li></ul>', instructions: '<ol><li>roll</li></ol>', imageUrl: null },
  },
  video: { url: 'https://youtu.be/abc', title: 'Great video', thumbnailUrl: 'https://img/abc.jpg', s3Url: 'https://cdn.example.com/thumb.jpg', manual: false },
  summaryImageUrl: 'https://cdn.example.com/cover.png',
  editionDate: '2026-07-01T00:00:00.000Z',
}

describe('renderNewsletterHtml', () => {
  it('renders all sections in the redesigned order with brand theme', () => {
    const html = renderNewsletterHtml(full, brand)
    expect(html).toContain('<!DOCTYPE html')
    // preheader + cover image + logo
    expect(html).toContain('This month: back pain myths busted')
    expect(html).toContain('https://cdn.example.com/cover.png')
    expect(html).toContain('https://cdn.example.com/logo-light.png') // header logo (dark header bg → light variant)
    // brand colors
    expect(html).toContain('#0d1b2a') // header bg
    expect(html).toContain('#eef2f7') // footer bg
    expect(html).toContain('Georgia')
    expect(html).toContain('#cc3344') // link color
    // at least one section band color is used
    expect(html).toContain('#aa0011')
    // teaser headings use the REAL source headline, not "Around the web"
    expect(html).toContain('Real Source Headline A')
    expect(html).toContain('Real Source Headline C')
    expect(html).not.toContain('Around the web')
    // standard bands + content
    expect(html).toContain('Trivia Question')
    expect(html).toContain('Trivia Answer')
    expect(html).toContain('Did You Know?')
    expect(html).toContain('Tips Of The Day')
    expect(html).toContain('Article Of The Day')
    expect(html).toContain('Sports Recovery') // secondary band = its own title
    expect(html).not.toContain('Also In This Issue')
    expect(html).toContain('Recipe Of The Day')
    expect(html).toContain('Another Recipe')
    expect(html).toContain('https://youtu.be/abc')
  })

  it('orders the cover image after the trivia question and before the video', () => {
    const html = renderNewsletterHtml(full, brand)
    const q = html.indexOf('Trivia Question')
    const cover = html.indexOf('cover.png')
    const video = html.indexOf('youtu.be/abc')
    const answer = html.indexOf('Trivia Answer')
    expect(q).toBeGreaterThan(0)
    expect(q).toBeLessThan(cover)
    expect(cover).toBeLessThan(video)
    expect(answer).toBeGreaterThan(video) // answer is last
  })

  it('renders the cover masthead band with the UTC-formatted publishing date', () => {
    const html = renderNewsletterHtml(full, brand)
    expect(html).toContain("In Today's Edition")
    // 2026-07-01T00:00:00Z must render as July 1 (UTC), never June 30 (off-by-one).
    expect(html).toContain('July 1, 2026')
    expect(html).not.toContain('June 30, 2026')
    // Masthead sits directly above the cover image.
    expect(html.indexOf("In Today's Edition")).toBeLessThan(html.indexOf('cover.png'))
  })

  it('omits the masthead band when no edition date is provided', () => {
    const html = renderNewsletterHtml({ ...full, editionDate: null }, brand)
    expect(html).toContain('cover.png')
    expect(html).not.toContain("In Today's Edition")
  })

  it('auto-picks logo variant by background luminance (header dark → light, footer light → dark)', () => {
    const html = renderNewsletterHtml(full, brand) // header bg #0d1b2a (dark), footer bg #eef2f7 (light)
    const headerEnd = html.indexOf('In this issue')
    expect(html.slice(0, headerEnd)).toContain('logo-light.png') // dark header → white logo
    expect(html).toContain('logo-dark.png') // light footer → dark logo
  })

  it('syncs social icon colour with the footer (dark footer → white icons)', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlFooterBgColor: '#011328' }) // dark footer
    expect(html).toContain('/newsletter/social/instagram.png') // white (no -dark suffix)
    expect(html).not.toContain('/newsletter/social/instagram-dark.png')
  })

  it('honors an explicit logo variant override', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlHeaderLogoVariant: 'dark' })
    const headerEnd = html.indexOf('In this issue')
    expect(html.slice(0, headerEnd)).toContain('logo-dark.png')
  })

  it('stacks the address (street / city-state-zip-country / phone) from structured fields', () => {
    const html = renderNewsletterHtml(full, {
      ...brand,
      addressLine1: '12 Ocean Rd',
      addressLocality: 'Buddina',
      addressRegion: 'QLD',
      postalCode: '4575',
      addressCountryName: 'Australia',
    })
    expect(html).toContain('12 Ocean Rd')
    expect(html).toContain('Buddina, QLD 4575 Australia')
  })

  it('uses a custom footer disclaimer when set', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlFooterDisclaimer: 'Custom disclaimer XYZ.' })
    expect(html).toContain('Custom disclaimer XYZ.')
  })

  it('renders a full footer: contact, social icons, unsubscribe merge field', () => {
    const html = renderNewsletterHtml(full, brand)
    expect(html).toContain('mailto:hello@acme.test')
    expect(html).toContain('+1 555 0100')
    expect(html).toContain('123 Main St, Springfield')
    expect(html).toContain('https://cdn.example.com/logo-dark.png') // footer logo (light footer bg → dark variant)
    // social icons: instagram + x (twitter→x alias); unknown platform skipped.
    // Light footer bg (#eef2f7) → dark icon variant (synced with footer logo).
    expect(html).toContain('/newsletter/social/instagram-dark.png')
    expect(html).toContain('/newsletter/social/x-dark.png')
    expect(html).toContain('https://instagram.com/acme')
    expect(html).not.toContain('u.test')
    // unsubscribe as a merge field with our own wording
    expect(html).toContain('{{email.unsubscribe_link}}')
    expect(html).toContain('Unsubscribe here')
    expect(html).toContain('Have questions? Just reply to this email.')
  })

  it('places seasonal offer after Tips and evergreen offer after the feature article', () => {
    const html = renderNewsletterHtml(
      {
        ...full,
        seasonalOffer: { title: 'Mothers Day Special', body: '20% off massage', ctaLabel: 'Claim', ctaUrl: 'https://x.test/claim', imageUrl: 'https://cdn.example.com/offer-seasonal.jpg' },
        evergreenOffer: { title: 'Book an Adjustment', body: 'Come in today', ctaLabel: 'Book Now', ctaUrl: 'https://x.test/book', imageUrl: null },
      },
      brand,
    )
    expect(html).toContain('Mothers Day Special')
    expect(html).toContain('Book an Adjustment')
    expect(html).toContain('https://x.test/book')
    expect(html).toContain('offer-seasonal.jpg')
    expect(html).toContain('Special Offer') // seasonal band
    expect(html).toContain('Remember') // evergreen band (call-to-action, not "Special Offer")
    expect(html.match(/Special Offer/g)?.length).toBe(1)
    const tips = html.indexOf('Tips Of The Day')
    const seasonal = html.indexOf('Mothers Day Special')
    const feature = html.indexOf('Article Of The Day')
    const evergreen = html.indexOf('Book an Adjustment')
    expect(tips).toBeLessThan(seasonal)
    expect(seasonal).toBeLessThan(feature)
    expect(feature).toBeLessThan(evergreen)
  })

  it('renders no offer cards when none provided', () => {
    const html = renderNewsletterHtml(full, brand)
    expect(html).not.toContain('Special Offer')
  })

  it('falls back to a voiced title when a teaser has no real headline', () => {
    const html = renderNewsletterHtml(
      { teasers: [{ headline: null, title: 'Voiced Fallback Title', body: '<p>x</p>', cta: '<p>y</p>', link: 'https://z.com' }] },
      {},
    )
    expect(html).toContain('Voiced Fallback Title')
  })

  it('omits sections with no data and uses example-palette defaults', () => {
    const html = renderNewsletterHtml({ featureArticle: full.featureArticle }, {})
    expect(html).not.toContain('Recipe Of The Day')
    expect(html).not.toContain('Did You Know?')
    expect(html).toContain('#fa00bb') // default header / section color 1
    expect(html).toContain('#011328') // default footer
  })

  it('escapes plain-text headings/answers', () => {
    const html = renderNewsletterHtml(
      { fun: { triviaQuestion: 'A & B <x>?', triviaAnswer: null, joke: null } },
      {},
    )
    expect(html).toContain('A &amp; B &lt;x&gt;?')
  })
})

describe('renderPromoEmail', () => {
  it('wraps promo content in the branded chrome (header logo + footer), no offers', () => {
    const html = renderPromoEmail(
      '<p>Our latest article is live.</p><a href="https://acme.test/article">Read more</a>',
      { ...brand, defaultAuthorName: 'Dr. Jane Smith' },
    )
    // promo content preserved as-is (including the plain text link)
    expect(html).toContain('Our latest article is live.')
    expect(html).toContain('https://acme.test/article')
    // personalised greeting (merge field, not escaped) + author sign-off + focus padding
    expect(html).toContain('Hey {{contact.first_name}},')
    expect(html).toContain('Best wishes,')
    expect(html).toContain('Dr. Jane Smith')
    expect(html).toContain('padding:32px 28px 200px')
  })

  it('strips a leading headline from the promo body (greeting leads)', () => {
    const html = renderPromoEmail('<h2>Big Headline</h2><p>Body text here.</p>', brand)
    expect(html).not.toContain('Big Headline')
    expect(html).toContain('Body text here.')
    expect(html.indexOf('Hey {{contact.first_name}}')).toBeLessThan(html.indexOf('Body text here.'))
    // shared chrome: header logo (dark header bg → light variant) + footer unsubscribe
    expect(html).toContain('https://cdn.example.com/logo-light.png')
    expect(html).toContain('{{email.unsubscribe_link}}')
    expect(html).toContain('supported-color-schemes')
    // no offer cards in promos
    expect(html).not.toContain('Special Offer')
    expect(html).not.toContain('Remember')
  })
})

describe('header layout + label rules (polish batch 2026-09-14)', () => {
  it('replace layout (default): logo only, no org-name heading in the header band', () => {
    const html = renderNewsletterHtml(full, brand)
    const headerBand = html.slice(0, html.indexOf('Back Pain Myths'))
    expect(headerBand).toContain('logo-light.png')
    expect(headerBand).not.toContain('>Acme Wellness</div>')
  })

  it('beside layout: logo and org name share a table row', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlHeaderLogoLayout: 'beside' })
    const headerBand = html.slice(0, html.indexOf('Back Pain Myths'))
    expect(headerBand).toContain('logo-light.png')
    expect(headerBand).toContain('Acme Wellness')
    expect(headerBand).toContain('padding-right:16px')
  })

  it('above layout: logo, then the org name beneath', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlHeaderLogoLayout: 'above' })
    const headerBand = html.slice(0, html.indexOf('Back Pain Myths'))
    const logoIdx = headerBand.indexOf('logo-light.png')
    const nameIdx = headerBand.indexOf('Acme Wellness')
    expect(logoIdx).toBeGreaterThan(-1)
    expect(nameIdx).toBeGreaterThan(logoIdx)
  })

  it('nlHeaderTextColor drives the header name color (beside layout)', () => {
    const html = renderNewsletterHtml(full, {
      ...brand,
      nlHeaderLogoLayout: 'beside',
      nlHeaderTextColor: '#ffee00',
    })
    expect(html).toContain('color:#ffee00')
  })

  it('button label prefers WHITE on a mid-luminance fill (teal) without a stored override', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlButtonColor: '#3aa6b9', nlButtonTextColor: null })
    expect(html).toMatch(/background-color:#3aa6b9;[^"]*color:#ffffff|color:#ffffff;[^"]*background-color:#3aa6b9/)
  })

  it('button label falls back to dark ink on a genuinely light fill', () => {
    const html = renderNewsletterHtml(full, { ...brand, nlButtonColor: '#e8e8e8', nlButtonTextColor: null })
    expect(html).toContain('#1c2b33')
  })
})

describe('toRenderBrand completeness (run-3 finding: silently dropped nl* fields)', () => {
  it('maps EVERY nl* BrandSettings column — a new unmapped column fails here', async () => {
    const { Prisma } = await import('@prisma/client')
    const { toRenderBrand } = await import('../generate')
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'BrandSettings')!
    // Render-irrelevant nl* columns, each with a reason — additions here
    // require the same justification.
    const EXCLUDED = new Set([
      'nlLogoSourceUrl', // original upload archive for re-processing; never rendered
    ])
    const nlFields = model.fields
      .filter((f) => f.name.startsWith('nl') && !EXCLUDED.has(f.name))
      .map((f) => f.name)
    expect(nlFields.length).toBeGreaterThan(15)
    // Fixture: every nl* field set to a sentinel its type allows.
    const fixture: Record<string, unknown> = {}
    for (const f of model.fields.filter((f) => f.name.startsWith('nl'))) {
      fixture[f.name] = f.type === 'Int' ? 7 : 'sentinel'
    }
    const out = toRenderBrand(fixture as never) as Record<string, unknown>
    const dropped = nlFields.filter((name) => out[name] === undefined)
    expect(dropped).toEqual([])
  })
})
