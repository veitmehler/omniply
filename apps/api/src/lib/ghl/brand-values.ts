/**
 * Brand custom values (snapshot email-branding design, Veit 2026-10-21).
 *
 * GHL's email builder cannot drive colors/images from custom values in the
 * drag-and-drop UI, but CODE-view templates substitute {{custom_values.*}}
 * anywhere in the HTML, including style attributes and img src. So the
 * snapshot carries ONE designed transactional template, and each location
 * carries its brand as plain custom values written here.
 *
 * Everything computed is computed on OUR side (GHL merge fields cannot do
 * conditionals): the contrast ink for text ON the header color, and the
 * correct light/dark logo variant FOR that header. GHL just renders strings.
 *
 * Runs at the onboarding finale (brand is committed by then) and is safe to
 * re-run any time (upsert by name); a rebrand re-propagates by re-running.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../logger'
import { getGhlCredentials } from './settings'
import { upsertGhlCustomValue } from './client'
import { headerIsLight } from '../../leadgen/compile'
import { pickBrandLogoForBackground } from '../../newsletter/logo-process'

export async function writeBrandCustomValues(userId: string): Promise<boolean> {
  try {
    const brand = await brandSettingsForUser(userId)
    if (!brand) return false
    const creds = await getGhlCredentials(userId)
    if (!creds) return false

    // Same token resolution order as the PDF compiler and the newsletter.
    const headerColor = brand.nlHeaderBgColor ?? brand.diagramPrimaryColor ?? '#0b2545'
    const accentColor = brand.nlLinkColor ?? brand.diagramSecondaryColor ?? '#2a6f97'
    const lightHeader = headerIsLight(headerColor)
    const headerInk = lightHeader ? (brand.nlFontColor ?? '#1f2937') : '#ffffff'
    const logoHeader = pickBrandLogoForBackground(brand, headerColor) ?? ''

    const values: Record<string, string> = {
      omniply_brand_header_color: headerColor,
      omniply_brand_header_ink: headerInk,
      omniply_brand_accent_color: accentColor,
      omniply_brand_logo_header: logoHeader,
    }
    for (const [name, value] of Object.entries(values)) {
      await upsertGhlCustomValue(creds.apiKey, creds.locationId, name, value)
    }
    logger.info({ userId, headerColor, accentColor, hasLogo: Boolean(logoHeader) }, '[brand-values] custom values written')
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
