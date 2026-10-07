/**
 * Deterministic JSON-LD schema builder for Article structured data.
 *
 * Replaces the previous LLM-based Step 16 (generate_schema_markup).
 * No LLM call — assembles valid Schema.org JSON-LD entirely from BrandSettings,
 * SitePage data, and PlatformSettings schema type rules.
 *
 * @type resolution priority:
 *   1. brand.schemaArticleType (explicit user override)
 *   2. First matching rule in PlatformSettings.schemaTypeRules (keyword match on brand.industry)
 *   3. Default: "Article"
 */

import type { BrandSettings } from '@prisma/client'

export interface SchemaTypeRule {
  keyword: string
  articleType: string
  publisherType: string
}

export interface BuildSchemaOpts {
  brand: BrandSettings
  schemaTypeRules: SchemaTypeRule[]
  title: string
  description: string
  articleUrl: string
  featuredImageUrl: string | null
  featuredImageWidth: number | null
  featuredImageHeight: number | null
  citationUrls: string[]
  publishedDate: string  // ISO 8601
  modifiedDate: string   // ISO 8601
}

// ── Type resolution ──────────────────────────────────────────────────────────

function resolveTypes(
  brand: BrandSettings,
  rules: SchemaTypeRule[],
): { articleType: string; publisherType: string } {
  // 1. Explicit brand override wins
  if (brand.schemaArticleType?.trim()) {
    return { articleType: brand.schemaArticleType.trim(), publisherType: 'Organization' }
  }

  // 2. Rule table match on industry (case-insensitive substring)
  const industry = brand.industry?.toLowerCase() ?? ''
  if (industry) {
    for (const rule of rules) {
      if (industry.includes(rule.keyword.toLowerCase())) {
        return { articleType: rule.articleType, publisherType: rule.publisherType }
      }
    }
  }

  // 3. Default
  return { articleType: 'Article', publisherType: 'Organization' }
}

// ── Builder ──────────────────────────────────────────────────────────────────

/** Returns pretty-printed JSON-LD string, or throws if opts are degenerate. */
export function buildArticleSchema(opts: BuildSchemaOpts): string {
  const { brand, schemaTypeRules } = opts
  const { articleType, publisherType } = resolveTypes(brand, schemaTypeRules)

  // ── Author ────────────────────────────────────────────────────────────────
  const author: Record<string, unknown> = { '@type': 'Person' }
  if (brand.defaultAuthorName)     author.name     = brand.defaultAuthorName
  if (brand.defaultAuthorWebsite)  author.url      = brand.defaultAuthorWebsite
  if (brand.defaultAuthorLinkedIn) author.sameAs   = [brand.defaultAuthorLinkedIn]
  if (brand.defaultAuthorJobTitle) author.jobTitle = brand.defaultAuthorJobTitle
  if (brand.defaultAuthorAlumniOf) {
    author.alumniOf = { '@type': 'EducationalOrganization', name: brand.defaultAuthorAlumniOf }
  }

  // ── Publisher address ─────────────────────────────────────────────────────
  let address: Record<string, unknown> | undefined
  const hasAddress = brand.addressLine1 || brand.addressLocality || brand.postalCode
  if (hasAddress) {
    address = { '@type': 'PostalAddress' }
    if (brand.addressLine1)         address.streetAddress   = brand.addressLine1
    if (brand.addressLocality)      address.addressLocality = brand.addressLocality
    if (brand.addressRegion)        address.addressRegion   = brand.addressRegion
    if (brand.postalCode)           address.postalCode      = brand.postalCode
    if (brand.organizationCountryCode) address.addressCountry = brand.organizationCountryCode
  }

  // ── Publisher ─────────────────────────────────────────────────────────────
  const publisher: Record<string, unknown> = { '@type': publisherType }
  if (brand.organizationName)    publisher.name      = brand.organizationName
  if (brand.organizationWebsite) publisher.url       = brand.organizationWebsite
  if (brand.organizationLogoUrl) {
    publisher.logo = { '@type': 'ImageObject', url: brand.organizationLogoUrl }
  }
  if (brand.organizationEmail)   publisher.email     = brand.organizationEmail
  if (brand.organizationPhone)   publisher.telephone = brand.organizationPhone
  if (address)                   publisher.address   = address
  const sameAs = [
    ...(brand.googleBusinessProfileUrl ? [brand.googleBusinessProfileUrl] : []),
    ...(brand.socialProfileUrls ?? []),
  ]
  if (sameAs.length > 0) publisher.sameAs = sameAs

  // ── Image ─────────────────────────────────────────────────────────────────
  let image: Record<string, unknown> | undefined
  if (opts.featuredImageUrl) {
    image = { '@type': 'ImageObject', url: opts.featuredImageUrl }
    if (opts.featuredImageWidth)  image.width  = opts.featuredImageWidth
    if (opts.featuredImageHeight) image.height = opts.featuredImageHeight
  }

  // ── Root object ───────────────────────────────────────────────────────────
  const schema: Record<string, unknown> = {
    '@context':    'https://schema.org',
    '@type':       articleType,
    headline:      opts.title,
    description:   opts.description,
    author,
    datePublished: opts.publishedDate,
    dateModified:  opts.modifiedDate,
    url:           opts.articleUrl,
    publisher,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.articleUrl },
  }

  if (image) schema.image = image

  if (opts.citationUrls.length > 0) schema.citation = opts.citationUrls

  // <-escape so content containing "</script>" can't break out of the
  // inline <script type="application/ld+json"> tag it's rendered into.
  return JSON.stringify(schema, null, 2).replace(/</g, '\\u003c')
}
