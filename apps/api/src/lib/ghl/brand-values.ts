/**
 * Brand custom values (snapshot email-branding design, Veit 2026-10-21).
 *
 * GHL's email builder cannot drive colors/images from custom values in the
 * drag-and-drop UI, but CODE-view templates substitute {{custom_values.*}}
 * anywhere in the HTML, including style attributes and img src. So the
 * snapshot carries ONE designed transactional template, and each location
 * carries its brand as plain custom values written here.
 *
 * ALIGNMENT RULE (Veit 2026-10-21): these values mirror the NEWSLETTER
 * template the client customizes in Settings — same fields, same fallback
 * chain as newsletter/render.ts resolveTheme — so transactional emails and
 * newsletters read as one family. Everything computed is computed on OUR
 * side (GHL merge fields cannot do conditionals): contrast inks and the
 * correct light/dark logo variant. GHL just renders strings at SEND time,
 * so a client's later redesign propagates by re-running this writer — the
 * GHL template itself never needs touching.
 *
 * Runs at the onboarding finale and after every newsletter-template save /
 * logo re-process (routes/newsletters.ts); idempotent upserts by name.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import type { BrandSettings } from '@prisma/client'
import { logger } from '../logger'
import { getGhlCredentials } from './settings'
import { upsertGhlCustomValue } from './client'
import { headerIsLight } from '../../leadgen/compile'
import { pickBrandLogoForBackground } from '../../newsletter/logo-process'

/** Transactional-email logo width: honor the client's newsletter choice,
 *  clamped to what a 600px card can carry. */
const LOGO_WIDTH_MIN = 120
const LOGO_WIDTH_MAX = 280
const LOGO_WIDTH_DEFAULT = 220

type BrandLike = Pick<
  BrandSettings,
  | 'nlHeaderBgColor'
  | 'nlFooterBgColor'
  | 'nlLinkColor'
  | 'nlButtonColor'
  | 'nlButtonTextColor'
  | 'nlFontColor'
  | 'nlFontFamily'
  | 'nlLogoWidth'
  | 'diagramPrimaryColor'
  | 'diagramSecondaryColor'
>

/** Pure compute — newsletter fallback chains (render.ts resolveTheme) kept in
 *  lockstep. Exported for tests. Logo variant is NOT computed here (needs the
 *  full brand row); the writer adds it. */
export function computeBrandValues(brand: BrandLike): Record<string, string> {
  const headerColor = brand.nlHeaderBgColor ?? brand.diagramPrimaryColor ?? '#0b2545'
  const footerColor = brand.nlFooterBgColor ?? '#011328'
  const accentColor = brand.nlLinkColor ?? brand.diagramSecondaryColor ?? '#2a6f97'
  const buttonColor = brand.nlButtonColor ?? brand.nlLinkColor ?? '#2a6f97'
  const darkInk = brand.nlFontColor ?? '#1f2937'
  const logoWidth = Math.min(LOGO_WIDTH_MAX, Math.max(LOGO_WIDTH_MIN, brand.nlLogoWidth ?? LOGO_WIDTH_DEFAULT))
  return {
    omniply_brand_header_color: headerColor,
    omniply_brand_header_ink: headerIsLight(headerColor) ? darkInk : '#ffffff',
    omniply_brand_footer_color: footerColor,
    omniply_brand_footer_ink: headerIsLight(footerColor) ? darkInk : '#ffffff',
    omniply_brand_accent_color: accentColor,
    omniply_brand_button_color: buttonColor,
    omniply_brand_button_text_color: brand.nlButtonTextColor ?? (headerIsLight(buttonColor) ? '#1f2937' : '#ffffff'),
    omniply_brand_font_family: brand.nlFontFamily ?? 'Helvetica',
    omniply_brand_font_color: brand.nlFontColor ?? '#3a4450',
    omniply_brand_logo_width: String(logoWidth),
  }
}

export async function writeBrandCustomValues(userId: string): Promise<boolean> {
  try {
    const brand = await brandSettingsForUser(userId)
    if (!brand) return false
    const creds = await getGhlCredentials(userId)
    if (!creds) return false

    const values = computeBrandValues(brand)
    values.omniply_brand_logo_header = pickBrandLogoForBackground(brand, values.omniply_brand_header_color) ?? ''

    for (const [name, value] of Object.entries(values)) {
      await upsertGhlCustomValue(creds.apiKey, creds.locationId, name, value)
    }
    logger.info(
      { userId, header: values.omniply_brand_header_color, footer: values.omniply_brand_footer_color, hasLogo: Boolean(values.omniply_brand_logo_header) },
      '[brand-values] custom values written',
    )
    return true
  } catch (err) {
    logger.warn({ userId, err }, '[brand-values] write failed (non-fatal — template falls back to neutral)')
    return false
  }
}

/** Account-id convenience for admin/ops scripts. */
export async function writeBrandCustomValuesForAccount(accountId: string): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  if (!account?.ownerUserId) return false
  return writeBrandCustomValues(account.ownerUserId)
}
