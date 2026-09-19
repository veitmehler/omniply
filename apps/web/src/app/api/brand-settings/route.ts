import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { Prisma } from '@prisma/client'
import {
  prisma,
  hemisphereForCountry,
  brandSettingsForUser,
  canonicalAccountUserId,
  accountIdForUser,
  DEFAULT_DIAGRAM_STYLE_GUIDE,
} from '@omniply/shared'

const SPECIALIZATIONS_FIELD = 'specializations'

/**
 * Auto-route the client to the correct newsletter calendar after their
 * specialization/country changes. Mirrors apps/api calendar-routing.ts
 * (calendar = primary specialization × country-derived hemisphere; the override
 * applies only on equator-straddling "edge" countries).
 */
async function routeNewsletterCalendar(userId: string) {
  // Brand is account-scoped; routing is set on the account owner (the account's
  // single newsletter recipient).
  const [bs, ownerUserId] = await Promise.all([
    brandSettingsForUser(userId),
    canonicalAccountUserId(userId),
  ])
  const primary = bs?.primarySpecialization?.trim()
  let calendarId: string | null = null
  if (primary && bs?.organizationCountryCode?.trim()) {
    const { hemisphere, edge } = hemisphereForCountry(bs.organizationCountryCode)
    const override = bs.hemisphereOverride
    const effective = edge && (override === 'north' || override === 'south') ? override : hemisphere
    const cal = await prisma.newsletterCalendar.findFirst({
      where: { specializationKey: primary, hemisphere: effective },
      select: { id: true },
    })
    calendarId = cal?.id ?? null
  }
  await prisma.user.update({ where: { id: ownerUserId }, data: { newsletterCalendarId: calendarId } })
}

/** Auto-route the account's article calendar (same inputs; set on the Account). */
async function routeArticleCalendar(userId: string) {
  const [bs, accountId] = await Promise.all([brandSettingsForUser(userId), accountIdForUser(userId)])
  if (!accountId) return
  const primary = bs?.primarySpecialization?.trim()
  let calendarId: string | null = null
  if (primary && bs?.organizationCountryCode?.trim()) {
    const { hemisphere, edge } = hemisphereForCountry(bs.organizationCountryCode)
    const override = bs.hemisphereOverride
    const effective = edge && (override === 'north' || override === 'south') ? override : hemisphere
    const cal = await prisma.articleCalendar.findFirst({
      where: { specializationKey: primary, hemisphere: effective },
      select: { id: true },
    })
    calendarId = cal?.id ?? null
  }
  await prisma.account.update({ where: { id: accountId }, data: { articleCalendarId: calendarId } })
}

async function getUserId(clerkId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  })
  return user?.id ?? null
}

// GET /api/brand-settings
export async function GET() {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const settings = await brandSettingsForUser(userId)

    // Return empty-but-shaped object if no row exists yet. `diagramStyleGuideDefault`
    // travels alongside so the settings page can prefill the textarea without
    // bundling the shared constant into the client.
    return NextResponse.json({
      ...(settings ?? {
        geolocation: null,
        industry: null,
        specialization: null,
        specializations: [],
        primarySpecialization: null,
        hemisphereOverride: null,
        businessDescription: null,
        who: null,
        ourExperience: null,
        articleGoal: null,
        specialInstructions: null,
        defaultAuthorName: null,
        defaultAuthorWebsite: null,
        defaultAuthorLinkedIn: null,
        defaultAuthorJobTitle: null,
        defaultAuthorAlumniOf: null,
        schemaArticleType: null,
        organizationName: null,
        organizationWebsite: null,
        organizationEmail: null,
        organizationPhone: null,
        addressLine1: null,
        addressLine2: null,
        addressLocality: null,
        addressRegion: null,
        postalCode: null,
        addressCountryName: null,
        organizationAddress: null,
        organizationCountryCode: null,
        organizationLogoUrl: null,
        socialLogoUrl: null,
        socialAccountName: null,
        instagramVerified: false,
        videoSpecialInstructions: null,
        socialCallToAction: null,
        socialPrimaryGoal: null,
        socialBioUrl: null,
        googleBusinessProfileUrl: null,
        socialMediaLinks: null,
        diagramPrimaryColor: null,
        diagramSecondaryColor: null,
        diagramLineColor: null,
        diagramFontFamily: null,
        diagramStyleGuide: null,
        articleDisclaimer: null,
        diagramLogoVariant: null,
        articleFontFamily: null,
        articleFontWeight: null,
        articleFontSizeBase: null,
      }),
      diagramStyleGuideDefault: DEFAULT_DIAGRAM_STYLE_GUIDE,
    })
  } catch (err) {
    console.error('[brand-settings] GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch brand settings' }, { status: 500 })
  }
}

// PATCH /api/brand-settings
export async function PATCH(request: NextRequest) {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const body = await request.json()

    const stringFields = [
      'geolocation',
      'industry',
      'specialization',
      'primarySpecialization',
      'hemisphereOverride',
      'businessDescription',
      'who',
      'ourExperience',
      'articleGoal',
      'specialInstructions',
      'defaultAuthorName',
      'defaultAuthorWebsite',
      'defaultAuthorLinkedIn',
      'defaultAuthorJobTitle',
      'defaultAuthorAlumniOf',
      'schemaArticleType',
      'organizationName',
      'organizationWebsite',
      'organizationEmail',
      'organizationPhone',
      // Structured address sub-fields
      'addressLine1',
      'addressLine2',
      'addressLocality',
      'addressRegion',
      'postalCode',
      'addressCountryName',
      // Combined legacy + fallback string (computed below if sub-fields provided)
      'organizationAddress',
      'organizationCountryCode',
      'organizationLogoUrl',
      'socialLogoUrl',
      'socialAccountName',
      'videoSpecialInstructions',
      'socialCallToAction',
      'socialPrimaryGoal',
      'socialBioUrl',
      'googleBusinessProfileUrl',
      'diagramPrimaryColor',
      'diagramSecondaryColor',
      'diagramLineColor',
      'diagramFontFamily',
      'diagramStyleGuide',
      'articleDisclaimer',
      'diagramLogoVariant',
      'articleFontFamily',
      'articleFontWeight',
      'articleFontSizeBase',
    ] as const

    const data: Prisma.BrandSettingsUpdateInput = {}

    for (const field of stringFields) {
      if (field in body) {
        data[field] = body[field] ? String(body[field]).trim() : null
      }
    }

    // Auto-compute combined organizationAddress from structured sub-fields when provided
    if ('addressLine1' in body || 'addressLocality' in body || 'postalCode' in body) {
      const parts = [
        data.addressLine1,
        data.addressLine2,
        data.addressLocality,
        data.addressRegion,
        data.postalCode,
        data.addressCountryName,
      ].filter((p): p is string => typeof p === 'string' && p.length > 0)
      data.organizationAddress = parts.length > 0 ? parts.join(', ') : null
    }

    // Normalise country code to ISO 3166-1 alpha-2
    if (data.organizationCountryCode != null && typeof data.organizationCountryCode === 'string') {
      const code = data.organizationCountryCode.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
      data.organizationCountryCode = code.length === 2 ? code : null
    }

    // hemisphereOverride must be 'north' | 'south' | null
    if (data.hemisphereOverride != null && typeof data.hemisphereOverride === 'string') {
      data.hemisphereOverride =
        data.hemisphereOverride === 'north' || data.hemisphereOverride === 'south'
          ? data.hemisphereOverride
          : null
    }

    // diagramLogoVariant must be 'light' | 'dark' | null (null → default light)
    if (data.diagramLogoVariant != null && typeof data.diagramLogoVariant === 'string') {
      data.diagramLogoVariant =
        data.diagramLogoVariant === 'light' || data.diagramLogoVariant === 'dark'
          ? data.diagramLogoVariant
          : null
    }

    // specializations: string[] of specialization keys the client serves
    if (SPECIALIZATIONS_FIELD in body) {
      const raw = body[SPECIALIZATIONS_FIELD]
      data.specializations = Array.isArray(raw)
        ? raw.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : []
    }

    // Boolean field — can't go through the string coercion loop above
    if ('instagramVerified' in body) {
      data.instagramVerified = Boolean(body.instagramVerified)
    }

    // socialMediaLinks is a JSON array: [{ platform: string, url: string }]
    if ('socialMediaLinks' in body) {
      const raw = body.socialMediaLinks
      if (Array.isArray(raw)) {
        const sanitized = raw
          .filter((l: unknown) => l && typeof l === 'object' && (l as Record<string, unknown>).platform && (l as Record<string, unknown>).url)
          .map((l: unknown) => {
            const link = l as Record<string, unknown>
            return { platform: String(link.platform).trim(), url: String(link.url).trim() }
          })
        data.socialMediaLinks = sanitized as Prisma.InputJsonValue
      } else {
        data.socialMediaLinks = Prisma.JsonNull
      }
    }

    // Brand profile is account-shared → write to the account owner's row.
    const ownerUserId = await canonicalAccountUserId(userId)
    const settings = await prisma.brandSettings.upsert({
      where: { userId: ownerUserId },
      create: { userId: ownerUserId, ...data } as Prisma.BrandSettingsUncheckedCreateInput,
      update: data,
    })

    // Re-route to the matching newsletter calendar whenever the routing inputs change.
    if (
      'primarySpecialization' in body ||
      'organizationCountryCode' in body ||
      'hemisphereOverride' in body
    ) {
      await routeNewsletterCalendar(userId)
      await routeArticleCalendar(userId)
    }

    return NextResponse.json(settings)
  } catch (err) {
    console.error('[brand-settings] PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update brand settings' }, { status: 500 })
  }
}
