/**
 * Magazine newsletter email renderer.
 *
 * Pure function (no DB) → an email-safe HTML string used as both the on-app
 * preview and the body sent to GHL. Table-based, ~680px centered, critical CSS
 * inlined. Visual hierarchy = full-width colored heading bands (cycling 4 brand
 * "section" colors) separating white content blocks.
 *
 * Section order (redesign): header → trivia question → cover summary image →
 * video → facts → teaser 1 → tips → teaser 2 → joke → recipe → feature →
 * teaser 3 → secondary article → recipe 2 → trivia answer → footer. Sections
 * with no data drop out. The two recipes are deliberately split (one
 * mid-edition, one near the end) so the green bands never stack back-to-back.
 */

export interface RenderArticle {
  title: string
  teaser: string
  tldr: string
  body: string // HTML
  imageUrl: string | null
}

export interface RenderTeaser {
  headline: string | null // the real source article title (preferred heading)
  title: string // voiced teaser title (fallback heading)
  body: string // HTML
  cta: string // HTML
  link: string
}

export interface RenderVideo {
  url: string | null
  title: string | null
  thumbnailUrl: string | null
  s3Url: string | null
  manual: boolean
}

export interface RenderRecipe {
  intro: string
  ingredients: string
  instructions: string
  imageUrl: string | null
}

export interface RenderModules {
  recipe?: RenderRecipe
  recipe2?: RenderRecipe
}

export interface RenderBrand {
  organizationName?: string | null
  defaultAuthorName?: string | null // promo email sign-off
  organizationAddress?: string | null
  organizationEmail?: string | null
  organizationPhone?: string | null
  socialMediaLinks?: Array<{ platform?: string | null; url?: string | null }> | null
  // Structured address (stacked footer lines); falls back to organizationAddress
  addressLine1?: string | null
  addressLine2?: string | null
  addressLocality?: string | null
  addressRegion?: string | null
  postalCode?: string | null
  addressCountryName?: string | null
  nlLogoUrl?: string | null
  organizationLogoUrl?: string | null
  // Auto-generated light/dark logo variants + per-placement assignment
  nlLogoLightUrl?: string | null
  nlLogoDarkUrl?: string | null
  nlLogoColorUrl?: string | null
  nlLogoColorLuminance?: number | null
  nlHeaderLogoVariant?: string | null // 'auto' | 'light' | 'dark' | 'original'
  nlHeaderTextColor?: string | null // header band text (org name); default white
  nlHeaderLogoLayout?: string | null // 'replace' (default) | 'beside' | 'above'
  nlFooterLogoVariant?: string | null
  nlFooterTextColor?: string | null
  nlSectionsDisabled?: unknown
  nlFooterLogoWidth?: number | null
  nlFooterDisclaimer?: string | null
  nlLogoWidth?: number | null
  nlHeaderBgColor?: string | null
  nlFooterBgColor?: string | null
  nlSectionColor1?: string | null
  nlSectionColor2?: string | null
  nlSectionColor3?: string | null
  nlSectionColor4?: string | null
  nlBandTextColor?: string | null
  nlFontFamily?: string | null
  nlFontColor?: string | null
  nlHeadingFontWeight?: string | null
  nlBodyFontWeight?: string | null
  nlLinkColor?: string | null
  nlButtonColor?: string | null
  nlButtonTextColor?: string | null
}

export interface RenderOffer {
  title: string
  body: string
  ctaLabel?: string | null
  ctaUrl?: string | null
  imageUrl?: string | null
}

export interface RenderInput {
  featureArticle?: RenderArticle | null
  secondaryArticle?: RenderArticle | null
  evergreenOffer?: RenderOffer | null // after the feature article
  seasonalOffer?: RenderOffer | null // after Tips Of The Day
  disabledSections?: string[] | null
  teasers?: RenderTeaser[] | null
  quickHits?: { tips: string[]; facts: string[] } | null
  fun?: { triviaQuestion: string | null; triviaAnswer: string | null; joke: string | null } | null
  modules?: RenderModules | null
  previewText?: string | null
  video?: RenderVideo | null
  summaryImageUrl?: string | null
  /** The edition's publishing date — shown in the cover masthead band. */
  editionDate?: Date | string | null
}

interface Theme {
  headerBg: string
  footerBg: string
  sections: string[] // 4 band colors, cycled
  fontFamily: string
  fontStack: string
  fontColor: string
  headingWeight: string
  bandTextColor: string
  /** Edit-mode render: stamp data-nl-section anchors on prose blocks. */
  editAnchors?: boolean
  bodyWeight: string
  linkColor: string
  buttonColor: string // CTA/read-more buttons; falls back to linkColor
  buttonTextColor: string // label on the button fill, contrast-computed
  headerTextColor: string // header band text (org name in beside/above/no-logo renders)
  headerLogoLayout: 'replace' | 'beside' | 'above' // logo vs org name in the header band
  headerLogoUrl: string | null
  headerLogoWidth: number
  footerLogoUrl: string | null
  footerLogoWidth: number
  footerIconVariant: 'light' | 'dark' // social icon colour, synced with the footer logo
}

const FALLBACK_FONTS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const DEFAULT_FONT = 'Open Sans'
// Google Fonts we offer in the editor — emails get a <link> import so supporting
// clients (Apple Mail, etc.) render them; others fall back to the stack.
const GOOGLE_FONTS = new Set([
  'Open Sans', 'Roboto', 'Lato', 'Montserrat', 'Poppins', 'Merriweather', 'Playfair Display',
])
const HEADING_STACK = "'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif"

/** Perceived luminance of a #rrggbb colour (0–255); < 140 ≈ a dark background. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 255
  const n = parseInt(m[1], 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

/**
 * Pick the logo variant for a band: explicit light/dark, or auto by the band's
 * background luminance (dark bg → white logo, light bg → navy logo). Falls back
 * through the chosen variant → other variant → legacy single logo.
 */
/** Whether a band should use the LIGHT (white) asset: explicit, else by bg luminance. */
function wantLight(variant: string | null | undefined, bg: string): boolean {
  const v = (variant ?? 'auto').toLowerCase()
  return v === 'light' ? true : v === 'dark' ? false : luminance(bg) < 140
}

function pickLogo(brand: RenderBrand, variant: string | null | undefined, bg: string): string | null {
  const light = brand.nlLogoLightUrl?.trim() || null
  const dark = brand.nlLogoDarkUrl?.trim() || null
  const color = brand.nlLogoColorUrl?.trim() || null
  const legacy = brand.nlLogoUrl?.trim() || brand.organizationLogoUrl?.trim() || null
  // Explicit client choice: the real logo.
  if ((variant === 'original' || variant === 'color') && color) return color
  // Auto: prefer the real logo when it reads against the band (>= 2.5 lum contrast).
  if ((!variant || variant === 'auto') && color && typeof brand.nlLogoColorLuminance === 'number') {
    const bgLum = hexLum(bg)
    const [hi, lo] =
      brand.nlLogoColorLuminance >= bgLum ? [brand.nlLogoColorLuminance, bgLum] : [bgLum, brand.nlLogoColorLuminance]
    if ((hi + 0.05) / (lo + 0.05) >= 2.5) return color
  }
  return wantLight(variant, bg) ? light ?? dark ?? legacy : dark ?? light ?? legacy
}

/** WCAG relative luminance of a hex color (module stays import-free). */
function hexLum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.5
  const n = parseInt(m[1], 16)
  const ch = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}

/** WCAG contrast (module stays import-free — mirrors onboarding/palette-compose). */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
  }
  const la = lum(a)
  const lb = lum(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function resolveTheme(brand: RenderBrand): Theme {
  const primary = brand.nlFontFamily?.trim() || DEFAULT_FONT
  const headerBg = brand.nlHeaderBgColor?.trim() || '#fa00bb'
  const footerBg = brand.nlFooterBgColor?.trim() || '#011328'
  const buttonColor = brand.nlButtonColor?.trim() || brand.nlLinkColor?.trim() || '#fa00bb'
  return {
    headerBg,
    footerBg,
    sections: [
      brand.nlSectionColor1?.trim() || '#fa00bb',
      brand.nlSectionColor2?.trim() || '#00bbf9',
      brand.nlSectionColor3?.trim() || '#00142b',
      brand.nlSectionColor4?.trim() || '#00dd81',
    ],
    fontFamily: primary,
    fontStack: `'${primary}', ${FALLBACK_FONTS}`,
    fontColor: brand.nlFontColor?.trim() || '#00142b',
    headingWeight: brand.nlHeadingFontWeight?.trim() || '700',
    bandTextColor: brand.nlBandTextColor?.trim() || '#ffffff',
    bodyWeight: brand.nlBodyFontWeight?.trim() || '400',
    linkColor: brand.nlLinkColor?.trim() || '#fa00bb',
    buttonColor,
    buttonTextColor:
      brand.nlButtonTextColor?.trim() ||
      // Design rule (2026-09-14): white label on mid/dark brand fills — pure
      // WCAG math picked black-on-teal, which reads as a broken button.
      (luminance(buttonColor) < 150 ? '#ffffff' : '#1c2b33'),
    headerTextColor: brand.nlHeaderTextColor?.trim() || '#ffffff',
    headerLogoLayout:
      brand.nlHeaderLogoLayout === 'beside' || brand.nlHeaderLogoLayout === 'above'
        ? brand.nlHeaderLogoLayout
        : 'replace',
    headerLogoUrl: pickLogo(brand, brand.nlHeaderLogoVariant, headerBg),
    headerLogoWidth: brand.nlLogoWidth && brand.nlLogoWidth > 0 ? brand.nlLogoWidth : 320,
    footerLogoUrl: pickLogo(brand, brand.nlFooterLogoVariant, footerBg),
    footerLogoWidth: brand.nlFooterLogoWidth && brand.nlFooterLogoWidth > 0 ? brand.nlFooterLogoWidth : 200,
    footerIconVariant: wantLight(brand.nlFooterLogoVariant, footerBg) ? 'light' : 'dark',
  }
}

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A full-width colored heading band. */
function band(title: string, bg: string, theme: Theme, anchor?: string): string {
  return `<tr><td style="background-color:${bg};padding:22px 24px;text-align:center;">
    <h1${anchorAttr(theme, anchor)} style="margin:0;font-family:${HEADING_STACK};font-size:30px;font-weight:${theme.headingWeight};color:${theme.bandTextColor};letter-spacing:0.5px;line-height:1.2;">${esc(decodeEntities(title))}</h1>
  </td></tr>`
}

// ── Footer: social icons + unsubscribe ───────────────────────────────────────

/** White monochrome platform icons live at a stable S3/CDN path. */
const SOCIAL_ICON_BASE = 'https://cdn.omniply.io/newsletter/social'
const SOCIAL_ICONS = new Set([
  'facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'pinterest', 'threads',
])
const SOCIAL_ALIASES: Record<string, string> = {
  fb: 'facebook', ig: 'instagram', insta: 'instagram', twitter: 'x', 'twitter/x': 'x',
  yt: 'youtube', 'youtube.com': 'youtube', 'linked-in': 'linkedin',
}

/** Map a stored platform label to a known icon slug, or null if unsupported. */
function socialSlug(platform?: string | null): string | null {
  const p = (platform ?? '').trim().toLowerCase()
  const slug = SOCIAL_ALIASES[p] ?? p
  return SOCIAL_ICONS.has(slug) ? slug : null
}

// GHL/Omniply unsubscribe URL merge field.
const UNSUBSCRIBE_MERGE = '{{email.unsubscribe_link}}'

/** A white content row. */
function content(inner: string): string {
  return `<tr><td style="background-color:#ffffff;padding:32px 28px;">${inner}</td></tr>`
}

/** 30px vertical spacer between sections. */
function spacer(): string {
  return `<tr><td style="height:30px;line-height:30px;font-size:0;background-color:#ffffff;">&nbsp;</td></tr>`
}

/** A large plain heading (no colored band) on white — used for the trivia question. */
function plainHeading(title: string, theme: Theme): string {
  return `<tr><td style="background-color:#ffffff;padding:8px 24px 0;text-align:center;">
    <h1 style="margin:0;font-family:${HEADING_STACK};font-size:30px;font-weight:${theme.headingWeight};color:${theme.fontColor};letter-spacing:0.3px;line-height:1.2;">${esc(title)}</h1>
  </td></tr>`
}

function para(html: string, theme: Theme, align: 'left' | 'center' = 'left', anchor?: string): string {
  return `<div${anchorAttr(theme, anchor)} style="font-family:${theme.fontStack};font-size:16px;font-weight:${theme.bodyWeight};color:${theme.fontColor};line-height:1.6;text-align:${align};">${html}</div>`
}

/** data-nl-section stamp — only in edit-mode renders. */
function anchorAttr(theme: Theme, anchor?: string): string {
  return theme.editAnchors && anchor ? ` data-nl-section="${anchor}"` : ''
}

function bulletList(items: string[], theme: Theme, anchor?: string): string {
  // Explicit glyph bullets — native <ul> markers render inconsistently (or not
  // at all) across email clients (run-5 finding). Hanging indent keeps
  // wrapped lines aligned under the text, not the dot.
  const lines = items
    .map(
      (i) =>
        `<div data-nl-line style="margin:0 0 12px;padding-left:20px;text-indent:-20px;font-family:${theme.fontStack};font-size:16px;font-weight:${theme.bodyWeight};color:${theme.fontColor};line-height:1.5;"><span contenteditable="false" style="color:${theme.linkColor};font-weight:700;">&bull;</span>&nbsp;&nbsp;<span data-nl-line-text>${esc(i)}</span></div>`,
    )
    .join('')
  return `<div${anchorAttr(theme, anchor)}>${lines}</div>`
}

/** Give unstyled <p> tags an explicit bottom margin — email clients strip
 *  default margins, collapsing all paragraph whitespace (run-5 finding). */
function spacedParagraphs(html: string): string {
  return html.replace(/<p(?![^>]*style=)/gi, '<p style="margin:0 0 16px;"')
}

/** Decode HTML entities that arrive pre-encoded from scraped sources (run-5:
 *  "I&#039;m" showed literally). Runs twice to unwrap double-encoding. */
export function decodeEntities(s: string): string {
  const once = (x: string) =>
    x
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  return once(once(s))
}

/** Inline-style body headings — email clients strip default h2/h3 CSS, so an
 *  unstyled <h2>Your Practical Takeaway</h2> renders as flat text (run-5). */
function styleInlineHeadings(html: string, theme: Theme): string {
  return html
    .replace(
      /<h2(?![^>]*style=)/gi,
      `<h2 style="margin:26px 0 12px;font-family:${HEADING_STACK};font-size:21px;font-weight:${theme.headingWeight};color:${theme.fontColor};line-height:1.3;"`,
    )
    .replace(
      /<h3(?![^>]*style=)/gi,
      `<h3 style="margin:22px 0 10px;font-family:${HEADING_STACK};font-size:18px;font-weight:${theme.headingWeight};color:${theme.fontColor};line-height:1.3;"`,
    )
}

/** Convert native <ul>/<ol> lists in generated bodies to explicit glyph /
 *  numbered lines — native list markers are unreliable in email clients. */
function normalizeBodyLists(html: string, theme: Theme): string {
  const dot = `<span style="color:${theme.linkColor};font-weight:700;">&bull;</span>&nbsp;&nbsp;`
  const line = (inner: string, prefix: string) =>
    `<div style="margin:0 0 12px;padding-left:22px;text-indent:-22px;line-height:1.5;">${prefix}${inner}</div>`
  let out = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, body: string) =>
    `<div style="margin:0 0 16px;">` +
    body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m2, inner: string) => line(inner.trim(), dot)) +
    `</div>`,
  )
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, body: string) => {
    let n = 0
    return (
      `<div style="margin:0 0 16px;">` +
      body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m2, inner: string) => {
        n++
        return line(inner.trim(), `<span style="color:${theme.linkColor};font-weight:700;">${n}.</span>&nbsp;&nbsp;`)
      }) +
      `</div>`
    )
  })
  return out
}

/** Full body normalization for generated article/teaser HTML. */
function normalizeBody(html: string, theme: Theme): string {
  return normalizeBodyLists(styleInlineHeadings(spacedParagraphs(html), theme), theme)
}

/** Bullet-glyph treatment for research-sourced ingredient lists (they arrive
 *  as <li> items or plain <br>/<p>-separated lines with no list styling). */
function bulletizeLines(html: string, theme: Theme): string {
  const dot = `<span style="color:${theme.linkColor};font-weight:700;">&bull;</span>&nbsp;&nbsp;`
  // Group headers inside ingredient lists ("For the Creamy Herb Drizzle:")
  // are sub-headings, not items (run-5 finding).
  const isHeader = (t: string) => /^[^.!?]{2,60}:$/.test(t.replace(/<[^>]+>/g, '').trim())
  const wrap = (inner: string) =>
    isHeader(inner)
      ? `<div style="margin:14px 0 8px;font-weight:700;">${inner}</div>`
      : `<div style="margin:0 0 10px;padding-left:20px;text-indent:-20px;line-height:1.5;">${dot}${inner}</div>`
  if (/<li[\s>]/i.test(html)) {
    return html
      .replace(/<\/?[uo]l[^>]*>/gi, '')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => wrap(inner.trim()))
  }
  const lines = html
    .split(/<br\s*\/?>(?:\s*)|<\/p>\s*<p[^>]*>|<\/?p[^>]*>/gi)
    .map((l) => l.replace(/<\/?p[^>]*>/gi, '').trim())
    .filter(Boolean)
  if (lines.length < 2) return html
  return lines.map(wrap).join('')
}

function readMoreButton(link: string, theme: Theme, label = 'Read full article →'): string {
  // Filled, not outlined: an email CTA must pop off the screen (user rule
  // 2026-07-24); the label color is contrast-computed against the fill.
  return `<div style="margin-top:20px;"><a href="${esc(link || '#')}" target="_blank" style="display:inline-block;font-family:${theme.fontStack};font-size:16px;font-weight:${theme.headingWeight};color:${theme.buttonTextColor};background-color:${theme.buttonColor};text-decoration:none;border-radius:6px;padding:12px 24px;">${esc(label)}</a></div>`
}

/** A promotional offer card: accent band + optional 16:9 banner + headline + pitch + filled CTA. */
function offerCard(offer: RenderOffer, theme: Theme, accent: string, label: string): string {
  const img = offer.imageUrl
    ? `<img src="${esc(offer.imageUrl)}" width="624" alt="${esc(offer.title)}" style="display:block;width:100%;max-width:624px;height:auto;border-radius:6px;margin:0 0 18px;" />`
    : ''
  const cta = offer.ctaUrl
    ? `<div style="margin-top:18px;"><a href="${esc(offer.ctaUrl)}" target="_blank" style="display:inline-block;font-family:${theme.fontStack};font-size:16px;font-weight:${theme.headingWeight};color:#ffffff;background-color:${accent};text-decoration:none;border-radius:6px;padding:12px 28px;">${esc(offer.ctaLabel || 'Learn More')}</a></div>`
    : ''
  const inner = `${img}<h2 style="margin:0 0 12px;font-family:${HEADING_STACK};font-size:24px;font-weight:${theme.headingWeight};color:${theme.fontColor};line-height:1.3;">${esc(offer.title)}</h2>${para(`<p style="margin:0;">${esc(offer.body)}</p>`, theme, 'center')}${cta}`
  return (
    band(label, accent, theme) +
    `<tr><td style="background-color:#ffffff;padding:32px 28px;text-align:center;">${inner}</td></tr>` +
    spacer()
  )
}

/**
 * Swap plain-language box markers (emitted by runNewsletterPlainLanguage into the
 * article body) for fully-styled, email-safe blocks. Styling lives here so it
 * follows the edition's theme; label/text were HTML-escaped at marker build time.
 * Bodies without markers pass through untouched.
 */
export function stylePlainLanguageBoxes(html: string, theme: Theme): string {
  return html.replace(
    /<div data-pl-box data-pl-label="([^"]*)">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/gi,
    (_m, label: string, text: string) =>
      `<div style="border-left:4px solid ${theme.linkColor};background-color:#f4f7f9;padding:14px 18px;margin:16px 0;border-radius:6px;">` +
      `<p style="margin:0 0 6px;font-family:${theme.fontStack};font-size:14px;font-weight:700;color:${theme.fontColor};">${label}</p>` +
      `<p style="margin:0;font-family:${theme.fontStack};font-size:16px;font-weight:${theme.bodyWeight};color:${theme.fontColor};line-height:1.6;">${text}</p></div>`,
  )
}

function articleBlock(a: RenderArticle, theme: Theme, showTitle = true, anchor?: string): string {
  const img = a.imageUrl
    ? `<img src="${esc(a.imageUrl)}" width="624" alt="${esc(a.title)}" style="display:block;width:100%;max-width:624px;height:auto;border-radius:6px;margin:0 0 18px;" />`
    : ''
  // When the band already shows the article title (secondary), skip the inner h2.
  const h2 = showTitle
    ? `<h2${anchorAttr(theme, anchor ? `${anchor}.title` : undefined)} style="margin:0 0 14px;font-family:${theme.fontStack};font-size:24px;font-weight:${theme.headingWeight};color:${theme.fontColor};line-height:1.3;">${esc(a.title)}</h2>`
    : ''
  const tldr = a.tldr
    ? `<p${anchorAttr(theme, anchor ? `${anchor}.tldr` : undefined)} style="margin:0 0 14px;font-family:${theme.fontStack};font-size:15px;color:${theme.fontColor};"><u>TL;DR:</u> ${esc(a.tldr)}</p>`
    : ''
  return `${img}${h2}${tldr}${para(normalizeBody(stylePlainLanguageBoxes(a.body, theme), theme), theme, 'left', anchor ? `${anchor}.body` : undefined)}`
}

function teaserBlock(t: RenderTeaser, theme: Theme, index?: number): string {
  const a = typeof index === 'number' ? `teasers.${index}.body` : undefined
  return `${para(normalizeBody(t.body, theme), theme, 'left', a)}<div style="margin-top:14px;">${para(t.cta, theme)}</div>${readMoreButton(t.link, theme)}`
}

function videoCard(v: RenderVideo, theme: Theme): string {
  const thumb = v.s3Url || v.thumbnailUrl
  const title = v.title || 'Watch the video'
  const img = thumb
    ? `<img src="${esc(thumb)}" width="624" alt="${esc(title)}" style="display:block;width:100%;max-width:624px;height:auto;border-radius:6px;" />`
    : ''
  // The play button is composited onto the thumbnail server-side, so no glyph here.
  return `<a href="${esc(v.url || '#')}" target="_blank" style="text-decoration:none;">${img}<div style="font-family:${theme.fontStack};font-size:18px;font-weight:${theme.headingWeight};color:${theme.linkColor};margin:12px 0 0;text-align:center;">${esc(title)}</div></a>`
}

function recipeBlock(r: RenderRecipe, theme: Theme, anchor?: string): string {
  const img = r.imageUrl
    ? `<img src="${esc(r.imageUrl)}" width="624" alt="Recipe" style="display:block;width:100%;max-width:624px;height:auto;border-radius:6px;margin:0 0 18px;" />`
    : ''
  // The recipe name is overlaid on the image, so drop the leading <h2> from the
  // intro when an image is present (avoid duplicating the title).
  const intro = r.imageUrl ? r.intro.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '').trim() : r.intro
  const h3 = (t: string) =>
    `<h3 style="margin:22px 0 10px;font-family:${theme.fontStack};font-size:18px;font-weight:${theme.headingWeight};color:${theme.fontColor};">${t}</h3>`
  const a = (f: string) => (anchor ? `${anchor}.${f}` : undefined)
  return `${img}${para(normalizeBody(intro, theme), theme, 'left', a('intro'))}${h3('Ingredients')}${para(bulletizeLines(r.ingredients, theme), theme, 'left', a('ingredients'))}${h3('Instructions')}${para(normalizeBody(r.instructions, theme), theme, 'left', a('instructions'))}`
}

export function buildRenderInput(
  nl: {
    featureArticle?: unknown
    secondaryArticle?: unknown
    teasers?: unknown
    quickHits?: unknown
    fun?: unknown
    modules?: unknown
    previewText?: string | null
    summaryImageUrl?: string | null
  },
  video?: RenderVideo | null,
  editionDate?: Date | string | null,
  offers?: { evergreen?: RenderOffer | null; seasonal?: RenderOffer | null },
): RenderInput {
  const qh = nl.quickHits as { tips?: string[]; facts?: string[] } | null | undefined
  return {
    featureArticle: (nl.featureArticle as RenderArticle | null) ?? null,
    secondaryArticle: (nl.secondaryArticle as RenderArticle | null) ?? null,
    teasers: (nl.teasers as RenderTeaser[] | null) ?? null,
    quickHits: qh ? { tips: qh.tips ?? [], facts: qh.facts ?? [] } : null,
    fun: (nl.fun as RenderInput['fun']) ?? null,
    modules: (nl.modules as RenderModules | null) ?? null,
    previewText: nl.previewText ?? null,
    video: video ?? null,
    summaryImageUrl: nl.summaryImageUrl ?? null,
    editionDate: editionDate ?? null,
    evergreenOffer: offers?.evergreen ?? null,
    seasonalOffer: offers?.seasonal ?? null,
  }
}

export function renderNewsletterHtml(
  input: RenderInput,
  brand: RenderBrand,
  opts?: { editMode?: boolean },
): string {
  const theme = resolveTheme(brand)
  if (opts?.editMode) theme.editAnchors = true
  const rows: string[] = []
  // Section toggles: template-level defaults (brand) ∪ per-edition overrides.
  const off = new Set<string>([
    ...((Array.isArray(brand.nlSectionsDisabled) ? brand.nlSectionsDisabled : []) as string[]),
    ...(input.disabledSections ?? []),
  ])
  // Semantic band colors (from the 4 brand section colors):
  //   pink = the rest · lightBlue = curated teasers · navy = articles + facts · green = recipes
  const [pink, lightBlue, navy, green] = theme.sections
  // Emit a colored band + white content block + spacer for one section.
  const section = (title: string, inner: string, color: string) => {
    rows.push(band(title, color, theme))
    rows.push(content(inner))
    rows.push(spacer())
  }
  // Band title itself editable (teaser headlines, secondary article title).
  const sectionA = (title: string, inner: string, color: string, bandAnchor: string) => {
    rows.push(band(title, color, theme, bandAnchor))
    rows.push(content(inner))
    rows.push(spacer())
  }

  // Header (logo on header band)
  rows.push(headerBlock(brand, theme))

  const fun = input.fun
  const teasers = input.teasers ?? []

  // Trivia question — plain heading (no band)
  if (fun?.triviaQuestion && !off.has('trivia')) {
    rows.push(plainHeading('Trivia Question', theme))
    rows.push(content(para(`<p style="margin:0;font-size:20px;">${esc(fun.triviaQuestion)}</p>`, theme, 'center', 'fun.triviaQuestion')))
    rows.push(spacer())
  }

  // Cover summary image (full-width) with a navy "In Today's Edition" masthead
  // band above it. The band carries the title + publishing date as live HTML
  // text (not baked into the image), formatted in UTC so the date can't drift.
  if (input.summaryImageUrl) {
    if (input.editionDate) {
      const dateStr = new Date(input.editionDate).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
      rows.push(
        `<tr><td style="background-color:${navy};padding:22px 24px;text-align:center;">
          <div style="font-family:${HEADING_STACK};font-size:26px;font-weight:${theme.headingWeight};color:#ffffff;letter-spacing:0.5px;line-height:1.2;">In Today's Edition</div>
          <div style="font-family:${theme.fontStack};font-size:16px;font-weight:600;color:#ffffff;opacity:0.85;margin-top:6px;">${esc(dateStr)}</div>
        </td></tr>`,
      )
    }
    rows.push(
      `<tr><td style="background-color:#ffffff;padding:0;"><img src="${esc(input.summaryImageUrl)}" width="680" alt="In this issue" style="display:block;width:100%;max-width:680px;height:auto;" /></td></tr>`,
    )
    rows.push(spacer())
  }

  // Video (pink)
  if (input.video?.url && !off.has('video')) section('Watch This', videoCard(input.video, theme), pink)

  // Facts (navy)
  if (input.quickHits && input.quickHits.facts.length > 0 && !off.has('didYouKnow')) {
    section('Did You Know?', bulletList(input.quickHits.facts, theme, 'quickHits.facts'), navy)
  }

  // Teaser 1 (curated → light blue)
  if (teasers[0] && !off.has('teaser1')) sectionA(teaserHeading(teasers[0]), teaserBlock(teasers[0], theme, 0), lightBlue, 'teasers.0.headline')

  // Tips (pink)
  if (input.quickHits && input.quickHits.tips.length > 0 && !off.has('tips')) {
    section('Tips Of The Day', bulletList(input.quickHits.tips, theme, 'quickHits.tips'), pink)
  }

  // Seasonal offer (after Tips) — green "Special Offer"
  if (input.seasonalOffer && !off.has('seasonalOffer')) rows.push(offerCard(input.seasonalOffer, theme, green, 'Special Offer'))

  // Teaser 2 (curated → light blue)
  if (teasers[1] && !off.has('teaser2')) sectionA(teaserHeading(teasers[1]), teaserBlock(teasers[1], theme, 1), lightBlue, 'teasers.1.headline')

  // Joke (pink)
  if (fun?.joke && !off.has('joke')) section('Joke Of The Day', para(fun.joke, theme, 'center', 'fun.joke'), pink)

  // Recipe 1 — mid-edition (green), deliberately separated from Recipe 2 near the
  // end so the two green bands don't stack back-to-back.
  if (input.modules?.recipe && !off.has('recipe')) section('Recipe Of The Day', recipeBlock(input.modules.recipe, theme, 'modules.recipe'), green)

  // Feature article (navy)
  if (input.featureArticle) section('Article Of The Day', articleBlock(input.featureArticle, theme, true, 'featureArticle'), navy)

  // Evergreen offer (after the feature) — pink "Remember" call-to-action
  if (input.evergreenOffer && !off.has('evergreenOffer')) rows.push(offerCard(input.evergreenOffer, theme, pink, 'Remember'))

  // Teaser 3 (curated → light blue)
  if (teasers[2] && !off.has('teaser3')) sectionA(teaserHeading(teasers[2]), teaserBlock(teasers[2], theme, 2), lightBlue, 'teasers.2.headline')

  // Secondary (specialization) article — band shows its own headline (navy)
  if (input.secondaryArticle && !off.has('secondaryArticle')) sectionA(decodeEntities(input.secondaryArticle.title), articleBlock(input.secondaryArticle, theme, false, 'secondaryArticle'), navy, 'secondaryArticle.title')

  // Recipe 2 — near the end (green); Recipe 1 renders mid-edition, before the feature.
  if (input.modules?.recipe2 && !off.has('recipe2')) section('Another Recipe', recipeBlock(input.modules.recipe2, theme, 'modules.recipe2'), green)

  // Trivia answer (payoff, last — pink). Extra 60px bottom padding for whitespace
  // before the footer (no trailing spacer — the padding is the gap).
  if (fun?.triviaQuestion && fun?.triviaAnswer && !off.has('trivia')) {
    rows.push(band('Trivia Answer', pink, theme))
    rows.push(
      `<tr><td style="background-color:#ffffff;padding:32px 28px 60px;">${para(`<p style="margin:0;">${esc(fun.triviaAnswer)}</p>`, theme, 'center', 'fun.triviaAnswer')}</td></tr>`,
    )
  }

  // Footer (shared chrome)
  rows.push(footerBlock(brand, theme))

  return emailShell(theme, input.previewText ?? null, rows.join('\n      '))
}

// ── Shared chrome (header band · footer · document shell) ────────────────────

/** Branded header band: logo replace/beside/above the org name (layout-aware). */
function headerBlock(brand: RenderBrand, theme: Theme): string {
  const name = `<div style="font-family:${HEADING_STACK};font-size:26px;font-weight:${theme.headingWeight};color:${theme.headerTextColor};text-align:center;">${esc(brand.organizationName ?? '')}</div>`
  const logoImg = (maxWidth: number) =>
    `<img src="${esc(theme.headerLogoUrl!)}" alt="${esc(brand.organizationName ?? 'Logo')}" width="${maxWidth}" style="display:block;width:100%;max-width:${maxWidth}px;height:auto;margin:0 auto;" />`

  let inner: string
  if (!theme.headerLogoUrl) {
    inner = name
  } else if (theme.headerLogoLayout === 'beside') {
    // Table row, not flexbox — Outlook. Logo left, name right, vertically centered.
    const sideLogo = Math.min(theme.headerLogoWidth, 180)
    inner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
      <td style="vertical-align:middle;padding-right:16px;">${logoImg(sideLogo)}</td>
      <td style="vertical-align:middle;text-align:left;"><div style="font-family:${HEADING_STACK};font-size:26px;font-weight:${theme.headingWeight};color:${theme.headerTextColor};">${esc(brand.organizationName ?? '')}</div></td>
    </tr></table>`
  } else if (theme.headerLogoLayout === 'above') {
    const topLogo = Math.min(theme.headerLogoWidth, 220)
    inner = `${logoImg(topLogo)}<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>${name}`
  } else {
    inner = logoImg(theme.headerLogoWidth)
  }
  return `<tr><td style="background-color:${theme.headerBg};padding:24px;text-align:center;">${inner}</td></tr>\n      ${spacer()}`
}

/** Branded footer: logo · org name · stacked address+phone · social · disclaimer · unsubscribe. */
function footerBlock(brand: RenderBrand, theme: Theme): string {
  const footerLogo = theme.footerLogoUrl
    ? `<img src="${esc(theme.footerLogoUrl)}" alt="${esc(brand.organizationName ?? 'Logo')}" width="${theme.footerLogoWidth}" style="display:block;width:100%;max-width:${theme.footerLogoWidth}px;height:auto;margin:0 auto 18px;" />`
    : ''
  // Explicit choice wins (run-5 request); else flip with the logo/icon variant.
  const footerText = brand.nlFooterTextColor?.trim() || (theme.footerIconVariant === 'light' ? '#ffffff' : '#00142b')

  const street = [brand.addressLine1, brand.addressLine2].filter(Boolean).join(', ')
  const cityLine = [
    [brand.addressLocality, brand.addressRegion].filter(Boolean).join(', '),
    brand.postalCode,
    brand.addressCountryName,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+,/g, ',')
  const addrLines: string[] = []
  if (street || cityLine) {
    if (street) addrLines.push(esc(street))
    if (cityLine) addrLines.push(esc(cityLine))
  } else if (brand.organizationAddress) {
    addrLines.push(esc(brand.organizationAddress))
  }
  if (brand.organizationPhone) addrLines.push(esc(brand.organizationPhone))
  const addrLine = addrLines.length ? `<div style="margin-top:8px;">${addrLines.join('<br/>')}</div>` : ''

  const contactLine = brand.organizationEmail
    ? `<div style="margin-top:6px;"><a href="mailto:${esc(brand.organizationEmail)}" style="color:${footerText};"><u>${esc(brand.organizationEmail)}</u></a></div>`
    : ''

  const socialItems = (brand.socialMediaLinks ?? [])
    .map((l) => ({ slug: socialSlug(l.platform), url: (l.url ?? '').trim() }))
    .filter((l): l is { slug: string; url: string } => !!l.slug && !!l.url)
  const iconSuffix = theme.footerIconVariant === 'dark' ? '-dark' : ''
  const socialRow = socialItems.length
    ? `<div style="margin:20px 0 4px;">${socialItems
        .map(
          (l) =>
            `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="display:inline-block;margin:0 7px;"><img src="${SOCIAL_ICON_BASE}/${l.slug}${iconSuffix}.png" width="26" height="26" alt="${l.slug}" style="display:inline-block;width:26px;height:26px;border:0;" /></a>`,
        )
        .join('')}</div>`
    : ''

  const disclaimer =
    brand.nlFooterDisclaimer?.trim() ||
    'If you follow a link in this email and make a purchase, we may earn a small commission at no extra cost to you; it helps support our work.'
  const nameLine = footerLogo ? '' : `<div style="font-weight:600;">${esc(brand.organizationName ?? '')}</div>`

  return `<tr><td style="background-color:${theme.footerBg};padding:60px 24px 32px;">
      <div style="font-family:${theme.fontStack};font-size:13px;color:${footerText};text-align:center;line-height:1.6;">
        ${footerLogo}
        ${nameLine}
        ${addrLine}
        ${contactLine}
        ${socialRow}
        <div style="font-size:11px;opacity:0.7;margin-top:18px;">${disclaimer}</div>
        <div style="font-size:11px;opacity:0.85;margin-top:12px;">You're receiving this because you subscribed.</div>
        <div style="font-size:11px;opacity:0.85;margin-top:10px;"><a href="${UNSUBSCRIBE_MERGE}" style="color:${footerText};"><u>Unsubscribe here</u></a></div>
        <div style="font-size:11px;opacity:0.85;margin-top:10px;">Have questions? Just reply to this email.</div>
      </div>
    </td></tr>`
}

/** Wrap content rows in the branded email document (head, fonts, dark-mode opt-out, container). */
function emailShell(theme: Theme, previewText: string | null, rowsHtml: string): string {
  const preheader = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(previewText)}</div>`
    : ''
  const fontLink = GOOGLE_FONTS.has(theme.fontFamily)
    ? `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.fontFamily).replace(/%20/g, '+')}:wght@400;600;700&display=swap" rel="stylesheet" />`
    : ''
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Newsletter</title>
${fontLink}
<style>
  /* Declare dark-mode support so clients (Apple Mail/iOS) keep our designed
     colours instead of auto-inverting the footer, bands, and headings. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  img { border:0; outline:none; text-decoration:none; }
  @media only screen and (max-width:680px) { .nl-container { width:100% !important; } }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
  <tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" class="nl-container" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:680px;background-color:#ffffff;">
      ${rowsHtml}
    </table>
  </td></tr>
</table>
${theme.editAnchors ? EDIT_BRIDGE_SCRIPT : ''}
</body>
</html>`
}

/**
 * Edit-mode iframe bridge (review WYSIWYG): makes [data-nl-section] blocks
 * contentEditable, streams {section, html} edits to the parent, captures
 * selections while request-mode is armed, and highlights request pins.
 * Plain inline JS — the preview iframe has no bundler.
 */
const EDIT_BRIDGE_SCRIPT = `<style>
  [data-nl-section] { outline: 1px dashed transparent; transition: outline-color .15s; border-radius: 3px; }
  [data-nl-section]:hover { outline-color: #7cb8c4; }
  [data-nl-section]:focus { outline: 2px solid #2d808e; }
  mark[data-nl-pin] { background: #fde68a; padding: 0 2px; }
</style>
<script>
(function () {
  var requestMode = false;
  var els = document.querySelectorAll('[data-nl-section]');
  function post(msg) { parent.postMessage(msg, '*'); }
  els.forEach(function (el) {
    el.setAttribute('contenteditable', 'true');
    var t;
    el.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        post({ type: 'nl-edit', section: el.getAttribute('data-nl-section'), html: el.innerHTML, text: el.innerText });
      }, 250);
    });
  });
  // Links must not navigate while reviewing.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();
  }, true);
  document.addEventListener('mouseup', function () {
    if (!requestMode) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    var text = sel.toString().trim();
    if (!text) return;
    var full = document.body.innerText || '';
    var idx = full.indexOf(text);
    post({
      type: 'nl-selection',
      quotedText: text,
      prefixContext: idx > 0 ? full.slice(Math.max(0, idx - 40), idx) : '',
      suffixContext: idx >= 0 ? full.slice(idx + text.length, idx + text.length + 40) : '',
    });
  });
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'nl-set-request-mode') {
      requestMode = !!d.on;
      els.forEach(function (el) { el.setAttribute('contenteditable', requestMode ? 'false' : 'true'); });
    }
    if (d.type === 'nl-highlight' && Array.isArray(d.quotes)) {
      d.quotes.forEach(function (q) {
        if (!q) return;
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) {
          var i = node.nodeValue.indexOf(q);
          if (i >= 0) {
            try {
              var range = document.createRange();
              range.setStart(node, i);
              range.setEnd(node, i + q.length);
              var mark = document.createElement('mark');
              mark.setAttribute('data-nl-pin', '');
              range.surroundContents(mark);
            } catch (err) { /* split-node quote — skip pin */ }
            break;
          }
        }
      });
    }
  });
  post({ type: 'nl-ready' });
})();
</script>`

/**
 * Render a promotional email in the SAME branded chrome as the newsletter:
 * header logo band → the promo HTML (as returned by the generator, dropped into
 * a themed white content card) → footer. No offers, no CTA button — links stay
 * as-is. `bodyHtml` is the generator's output; `previewText` is optional.
 */
export function renderPromoEmail(bodyHtml: string, brand: RenderBrand, previewText?: string | null): string {
  const theme = resolveTheme(brand)
  // Personalised greeting (GHL merge field, normal weight) + sign-off with the
  // configured author name. 200px bottom padding focuses the reader on the body.
  const greeting = `<p style="margin:0 0 16px;font-weight:${theme.bodyWeight};">Hey {{contact.first_name}},</p>`
  const author = brand.defaultAuthorName?.trim()
  const signoff = author
    ? `<p style="margin:24px 0 0;font-weight:${theme.bodyWeight};">Best wishes,<br/>${esc(author)}</p>`
    : ''
  // The greeting leads — strip a leading headline from the body (the headline is
  // already the email subject), keeping the rest of the HTML as-is.
  const body = bodyHtml.replace(/^\s*<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '')
  const card = `<tr><td style="background-color:#ffffff;padding:32px 28px 200px;font-family:${theme.fontStack};font-size:16px;font-weight:${theme.bodyWeight};color:${theme.fontColor};line-height:1.6;">${greeting}${body}${signoff}</td></tr>`
  const rows = [headerBlock(brand, theme), card, footerBlock(brand, theme)]
  return emailShell(theme, previewText ?? null, rows.join('\n      '))
}

/** Teaser heading = the real source article title, falling back to the voiced title. */
function teaserHeading(t: RenderTeaser): string {
  return decodeEntities((t.headline || t.title || 'Around the web').trim())
}
