import { describe, it, expect } from 'vitest'
import { renderNewsletterHtml, type RenderBrand, type RenderInput } from '../render'

/**
 * Font-size invariant (drift-killer, same philosophy as the toRenderBrand
 * completeness test): render a full edition at a deliberately odd body size
 * and assert every font-size in the output belongs to the derived set. A new
 * hardcoded body-tier size fails here with the rogue value named.
 */
const BODY = 23
const BRAND: RenderBrand = {
  organizationName: 'Test Clinic',
  nlBodyFontSize: BODY,
  addressLine1: '1 Main St',
  addressLocality: 'Mesa',
  organizationPhone: '+15550001111',
  organizationEmail: 'hi@example.com',
} as RenderBrand

const INPUT: RenderInput = {
  featureArticle: {
    title: 'Feature title',
    body: '<p>Body text.</p><h2>Sub</h2><p>More.</p><ul><li>a</li><li>b</li></ul><div data-pl-box data-pl-label="Think of it This Way"><p>Metaphor text.</p></div>',
    tldr: 'Short summary.',
    link: 'https://example.com',
  },
  secondaryArticle: { title: 'Secondary', body: '<p>Second body.</p>', link: 'https://example.com' },
  teasers: [
    { headline: 'Teaser One', body: '<p>Teaser body.</p>', cta: '<p>Read it now.</p>', link: 'https://example.com' },
  ],
  quickHits: { tips: ['Tip one', 'Tip two'], facts: ['Fact one'] },
  fun: { joke: '<p>Setup.</p><p>Punchline.</p>', triviaQuestion: 'Why?', triviaAnswer: 'Because.' },
  modules: {
    recipe: { title: 'Soup', intro: '<p>Intro.</p>', ingredients: '<ul><li>1 cup water</li><li>For the Drizzle:</li></ul>', instructions: '<ol><li>Boil.</li></ol>' },
  },
  previewText: 'Preview',
  video: { url: 'https://youtube.com/watch?v=x', title: 'Video', thumbnailUrl: null, s3Url: null },
} as unknown as RenderInput

// Derived set: body, box label (body-4), inline subheads 22, article titles 24,
// bands 30, video title 18, offer/date/footer-name 16, footer 13/12/11, misc 10/20.
// 26 = header practice-name + cover title (fixed heading tier between 24 and 30).
const ALLOWED = new Set([BODY, BODY - 4, 22, 24, 26, 30, 18, 16, 13, 12, 11, 10, 20])

describe('newsletter font-size invariant', () => {
  it(`every rendered font-size derives from the ${BODY}px body setting or the fixed chrome set`, () => {
    const html = renderNewsletterHtml(INPUT, BRAND)
    const sizes = [...html.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(10)
    const rogue = [...new Set(sizes.filter((v) => !ALLOWED.has(v)))]
    expect(rogue, `hardcoded body-tier font sizes found: ${rogue.join(', ')}px`).toEqual([])
    // The body size must actually appear (the setting is honored).
    expect(sizes).toContain(BODY)
  })
})
