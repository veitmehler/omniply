import { prisma, brandSettingsForUser } from '@omniply/shared'
import { downloadImageFromStorage } from '@omniply/shared'
import { themeFromBrand } from '../article-pipeline/enrichment/diagram-theme'

export interface SocialBrandTheme {
  primaryColor: string
  secondaryColor: string
  /** The brand accent (onboarding-approved nlLinkColor first) — the "secondary
   *  brand color" used by the non-EL accent-tinted carousels. */
  accentColor: string
  textColor: string
  fontFamily: string
  organizationName: string
  /** Social account display name shown on quote cards. Falls back to organizationName. */
  socialAccountName: string
  /** When true, an Instagram-style blue verified badge is rendered on quote cards. */
  instagramVerified: boolean
  logoUrl: string | null
  /**
   * Auto-generated transparent logo variants for compositing onto colored
   * backgrounds (brand-tint carousels): light = white logo (dark backdrops),
   * dark = navy logo (light backdrops). Newsletter variants first, then the
   * cached diagram variants; null when the client never uploaded a logo.
   */
  logoLightUrl: string | null
  logoDarkUrl: string | null
  /** Client-specific instructions injected into the Fal.ai video reel prompt (e.g. style, restrictions). */
  videoSpecialInstructions: string
  /**
   * The effective call-to-action injected as {{call_to_action}}. Derived from the
   * business's primary goal (link-in-bio strategy) — see resolveSocialCta. Falls
   * back to the raw custom text for backward compatibility.
   */
  socialCallToAction: string
  /** The business's link-in-bio page URL (reference — posts verbally say "link in bio"). */
  socialBioUrl: string
  /** Brand voice fields — injected into caption and carousel prompts. */
  writingStyle: string
  businessDescription: string
  who: string
  industry: string
  /**
   * Comment-keyword funnel (dm_keyword preset, P3 main-app rollout): parsed
   * keyword + asset when socialPrimaryGoal === 'dm_keyword', else null. Drives
   * the story CTA slide + the IG/FB caption split (snapshot comment workflows
   * DM the trigger link). LinkedIn stays link-only (no comment automation).
   */
  commentKeyword: string | null
  commentAsset: string | null
}

/** Story CTA-slide hook line for keyword accounts; null when no dm_keyword preset. */
export function commentHookFromTheme(theme: Pick<SocialBrandTheme, 'commentKeyword' | 'commentAsset'>): string | null {
  if (!theme.commentKeyword) return null
  return `Comment "${theme.commentKeyword}" and we will send you ${theme.commentAsset || 'our free guide'}.`
}

/** Facebook caption append for keyword accounts (link stays; comment path added). */
export function commentFbAppendFromTheme(theme: Pick<SocialBrandTheme, 'commentKeyword'>): string | null {
  if (!theme.commentKeyword) return null
  return `Or just comment "${theme.commentKeyword}" and we will send it straight to you.`
}

/**
 * Resolve the effective {{call_to_action}} from the business's link-in-bio goal.
 * Because feed posts and stories can't carry a clickable link, every CTA drives
 * to the profile bio link. Presets emit LLM guidance that says "link in bio";
 * a null/absent goal preserves the legacy behavior (raw custom text verbatim).
 */
export function resolveSocialCta(
  goal: string | null | undefined,
  customText: string,
): string {
  const linkPhrase = 'via the link in our bio'
  switch (goal) {
    case 'newsletter':
      return `Encourage readers to subscribe to our free newsletter ${linkPhrase}.`
    case 'booking':
      return `Encourage readers to book an appointment with us ${linkPhrase}.`
    case 'custom':
      return customText
    case 'dm_keyword': {
      // customText = 'KEYWORD|asset description', e.g. 'SPINE|our 2-Minute
      // Spine Check'. Comment automation (snapshot workflows) DMs the trigger
      // link when the keyword appears in a comment (DM responder plan D3).
      const [keyword, asset] = customText.split('|').map((s) => s.trim())
      if (!keyword) return customText
      return `Invite readers to comment the word "${keyword.toUpperCase()}" on this post to get ${asset || 'our free guide'} sent to them by direct message.`
    }
    default:
      // Legacy / unset — inject the raw custom text exactly as before.
      return customText
  }
}

export async function loadSocialBrandTheme(userId: string): Promise<SocialBrandTheme> {
  const [brand, settings] = await Promise.all([
    brandSettingsForUser(userId),
    prisma.settings.findUnique({ where: { userId } }),
  ])
  const theme = themeFromBrand(brand)

  // Social compositors always use the bundled Helvetica Neue — never inherit
  // article or diagram font settings, which are unrelated concerns.
  const fontFamily = 'HelveticaNeue, Helvetica, Arial, sans-serif'

  const organizationName = brand?.organizationName?.trim() || 'Your Brand'
  let commentKeyword: string | null = null
  let commentAsset: string | null = null
  if (brand?.socialPrimaryGoal === 'dm_keyword') {
    const [k, a] = (brand.socialCallToAction ?? '').split('|').map((s) => s.trim())
    commentKeyword = k ? k.toUpperCase() : null
    commentAsset = a || null
  }
  return {
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    accentColor: brand?.nlLinkColor?.trim() || theme.secondaryColor,
    textColor: brand?.diagramTextColor?.trim() || '#1F2937',
    fontFamily,
    organizationName,
    socialAccountName: brand?.socialAccountName?.trim() || organizationName,
    instagramVerified: brand?.instagramVerified ?? false,
    logoUrl: brand?.socialLogoUrl ?? brand?.organizationLogoUrl ?? null,
    logoLightUrl: brand?.nlLogoLightUrl ?? brand?.diagramLogoLightUrl ?? null,
    logoDarkUrl: brand?.nlLogoDarkUrl ?? brand?.diagramLogoDarkUrl ?? null,
    videoSpecialInstructions: brand?.videoSpecialInstructions?.trim() ?? '',
    socialCallToAction: resolveSocialCta(brand?.socialPrimaryGoal, brand?.socialCallToAction?.trim() ?? ''),
    socialBioUrl: brand?.socialBioUrl?.trim() ?? '',
    writingStyle: settings?.writingStyle?.trim() ?? '',
    businessDescription: brand?.businessDescription?.trim() ?? '',
    who: brand?.who?.trim() ?? '',
    industry: brand?.industry?.trim() ?? '',
    commentKeyword,
    commentAsset,
  }
}

export async function loadLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  if (!logoUrl) return null
  try {
    return await downloadImageFromStorage(logoUrl)
  } catch {
    return null
  }
}

/**
 * Load the logo buffer for a brand-tinted slide: the requested light/dark
 * transparent variant when it exists, else the raw logo as a best-effort
 * fallback (may clash with the tint color — acceptable; uploading through the
 * newsletter/diagram flow generates real variants).
 */
export async function loadTintLogo(
  brand: SocialBrandTheme,
  variant: 'light' | 'dark',
): Promise<Buffer | null> {
  const url = (variant === 'light' ? brand.logoLightUrl : brand.logoDarkUrl) ?? brand.logoUrl
  return loadLogoBuffer(url)
}
