/**
 * Clinic ENTITY schema markup (agent plan Phase 3.1, approved 2026-07-28).
 *
 * The entity layer — who the business is, where, when open, how to book —
 * complementing the per-article Article JSON-LD (content layer). Published as
 * fenced body-embedded <script type="application/ld+json"> blocks via the same
 * production-proven technique the article pipeline uses (Google accepts JSON-LD
 * anywhere in the DOM; REST content editing cannot reach the theme <head> —
 * that's the 3.1b micro-plugin's job later).
 *
 * Coverage ladder (best available per site):
 *   1. Editable WP pages (front page + contact/about) get the fenced block.
 *   2. Page-builder pages (Elementor/Divi/…) are SKIPPED — they render from
 *      builder data and ignore REST content.
 *   3. Every clinic: /linktree page + article publisher entity (already rich).
 */
import { prisma, decrypt, brandSettingsForUser, accountMemberIdsForUser } from '@omniply/shared'
import { logger } from './logger'
import { assertSafeWpUrl } from './ssrf'
import { withTimeout } from './net/with-timeout'

type Brand = NonNullable<Awaited<ReturnType<typeof brandSettingsForUser>>>

export const SCHEMA_FENCE_START = '<!-- omniply-schema -->'
export const SCHEMA_FENCE_END = '<!-- /omniply-schema -->'

// ── JSON-LD builders ─────────────────────────────────────────────────────────

function postalAddress(brand: Brand): Record<string, unknown> | null {
  const addr: Record<string, unknown> = { '@type': 'PostalAddress' }
  if (brand.addressLine1) addr.streetAddress = [brand.addressLine1, brand.addressLine2].filter(Boolean).join(', ')
  if (brand.addressLocality) addr.addressLocality = brand.addressLocality
  if (brand.addressRegion) addr.addressRegion = brand.addressRegion
  if (brand.postalCode) addr.postalCode = brand.postalCode
  if (brand.organizationCountryCode) addr.addressCountry = brand.organizationCountryCode
  return Object.keys(addr).length > 1 ? addr : null
}

/** MedicalClinic entity: name, contact, address, hours, GBP link, booking action. */
export function buildClinicEntity(brand: Brand, opts?: { mcpUrl?: string | null }): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
  }
  if (brand.organizationName) entity.name = brand.organizationName
  if (brand.organizationWebsite) {
    entity.url = brand.organizationWebsite
    entity['@id'] = `${brand.organizationWebsite.replace(/\/+$/, '')}/#clinic`
  }
  if (brand.organizationPhone) entity.telephone = brand.organizationPhone
  if (brand.organizationLogoUrl) entity.image = brand.organizationLogoUrl
  const addr = postalAddress(brand)
  if (addr) entity.address = addr
  if (brand.openingHours) {
    // Free-text hours (one line per range) — schema.org accepts text openingHours.
    entity.openingHours = brand.openingHours
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }
  if (brand.googleBusinessProfileUrl) entity.sameAs = [brand.googleBusinessProfileUrl]
  if (brand.primarySpecialization) entity.medicalSpecialty = brand.primarySpecialization
  if (brand.bookingUrl || opts?.mcpUrl) {
    // Two entry points on one ReserveAction: the human booking page and the
    // machine endpoint (MCP) — the discovery trail for AI agents (plan:
    // .plans/mcp-booking-endpoint). Agents that read schema find the direct
    // protocol; everyone else keeps the page.
    const targets: Array<Record<string, unknown>> = []
    if (brand.bookingUrl) targets.push({ '@type': 'EntryPoint', urlTemplate: brand.bookingUrl })
    if (opts?.mcpUrl) {
      targets.push({
        '@type': 'EntryPoint',
        urlTemplate: opts.mcpUrl,
        httpMethod: 'POST',
        contentType: 'application/json',
        description:
          'Model Context Protocol (MCP) endpoint for AI assistants: JSON-RPC tools get_clinic_info, get_availability, book_appointment, request_callback. See https://omniply.io/agents',
      })
    }
    entity.potentialAction = {
      '@type': 'ReserveAction',
      name: 'Book an Appointment',
      target: targets.length === 1 ? targets[0] : targets,
    }
  }
  return entity
}

export interface ClinicFaq {
  q: string
  a: string
}

/** FAQPage from logistics-only Q&A (NEVER clinical — enforced at generation). */
export function buildFaqSchema(faqs: ClinicFaq[]): Record<string, unknown> | null {
  const valid = faqs.filter((f) => f.q?.trim() && f.a?.trim())
  if (valid.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: valid.map((f) => ({
      '@type': 'Question',
      name: f.q.trim(),
      acceptedAnswer: { '@type': 'Answer', text: f.a.trim() },
    })),
  }
}

/** Wrap JSON-LD objects in the fenced script block. */
export function buildFencedBlock(schemas: Record<string, unknown>[]): string {
  const scripts = schemas
    .map((s) => `<script type="application/ld+json">\n${JSON.stringify(s, null, 1)}\n</script>`)
    .join('\n')
  return `${SCHEMA_FENCE_START}\n${scripts}\n${SCHEMA_FENCE_END}`
}

/** Replace-or-append the fenced block in page content (idempotent). */
export function upsertFencedBlock(content: string, block: string): string {
  const start = content.indexOf(SCHEMA_FENCE_START)
  const end = content.indexOf(SCHEMA_FENCE_END)
  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(0, start) + block + content.slice(end + SCHEMA_FENCE_END.length)
  }
  return `${content}\n${block}`
}

/** Page-builder signatures: those pages render from builder data, not content. */
export function looksLikeBuilderPage(content: string): boolean {
  return /elementor|et_pb_|fl-builder|fl_builder|vc_row|wpbakery|fusion_|\bbrizy\b|oxygen_|ct_section/i.test(content)
}

// ── WordPress publishing ladder ──────────────────────────────────────────────

const CONTACT_SLUGS = ['contact', 'contact-us', 'about', 'about-us']

interface WpPage {
  id: number
  slug: string
  content: { raw?: string; rendered?: string }
}

/**
 * Publish the entity (+ FAQ, when available) onto the clinic's editable pages.
 * Best-effort: failures log and degrade — the linktree + article publisher
 * floor always exists. Returns which pages were touched.
 */
export async function publishClinicSchema(userId: string): Promise<{ pages: string[] } | null> {
  try {
    const brand = await brandSettingsForUser(userId)
    if (!brand?.organizationName) return null
    const memberIds = await accountMemberIdsForUser(userId)
    const conn = await prisma.wordPressConnection.findFirst({
      where: { userId: { in: memberIds } },
      select: { username: true, appPassword: true, siteUrl: true },
    })
    if (!conn) return null
    await assertSafeWpUrl(conn.siteUrl)
    const auth = `Basic ${Buffer.from(`${conn.username}:${decrypt(conn.appPassword) ?? ''}`).toString('base64')}`
    const siteBase = conn.siteUrl.replace(/\/+$/, '')
    const wp = (path: string, init?: RequestInit) =>
      withTimeout(
        (signal) =>
          fetch(`${siteBase}/wp-json/wp/v2${path}`, {
            ...init,
            headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
            signal,
          }),
        30_000,
        `clinic-schema wp ${path}`,
      )

    const schemas: Record<string, unknown>[] = [buildClinicEntity(brand)]
    const faqs = (brand.clinicFaqs as unknown as ClinicFaq[] | null) ?? []
    const faqSchema = buildFaqSchema(faqs)
    const block = buildFencedBlock(schemas)
    const blockWithFaq = buildFencedBlock(faqSchema ? [...schemas, faqSchema] : schemas)

    // Capability probe: script tags survive only with unfiltered_html (multisite
    // admins lack it). Draft probe page, read back, delete.
    const probeRes = await wp('/pages', {
      method: 'POST',
      body: JSON.stringify({ title: 'omniply-probe', status: 'draft', content: '<script type="application/ld+json">{}</script>' }),
    })
    if (!probeRes.ok) {
      logger.warn({ userId, status: probeRes.status }, '[clinic-schema] probe create failed — skipping page ladder')
      return { pages: [] }
    }
    const probe = (await probeRes.json()) as { id: number; content?: { raw?: string } }
    const probeRaw = probe.content?.raw ?? ''
    await wp(`/pages/${probe.id}?force=true`, { method: 'DELETE' }).catch(() => {})
    if (!probeRaw.includes('<script')) {
      logger.warn({ userId }, '[clinic-schema] scripts stripped (no unfiltered_html) — linktree/article floor only')
      return { pages: [] }
    }

    // Target pages: front page (entity + FAQ) + first contact/about page (entity).
    const touched: string[] = []
    const settingsRes = await wp('/settings')
    const frontId = settingsRes.ok ? ((await settingsRes.json()) as { page_on_front?: number }).page_on_front : 0

    const applyTo = async (pageId: number, withFaq: boolean, label: string) => {
      const pageRes = await wp(`/pages/${pageId}?context=edit`)
      if (!pageRes.ok) return
      const page = (await pageRes.json()) as WpPage
      const raw = page.content?.raw ?? ''
      if (!raw || looksLikeBuilderPage(raw)) {
        logger.info({ userId, pageId, label }, '[clinic-schema] builder/empty page — skipped')
        return
      }
      const updated = upsertFencedBlock(raw, withFaq ? blockWithFaq : block)
      if (updated === raw) return
      const putRes = await wp(`/pages/${pageId}`, { method: 'POST', body: JSON.stringify({ content: updated }) })
      if (putRes.ok) {
        touched.push(label)
        logger.info({ userId, pageId, label }, '[clinic-schema] fenced block published')
      }
    }

    if (frontId) await applyTo(frontId, true, 'front-page')

    const listRes = await wp(`/pages?per_page=50&status=publish&context=edit`)
    if (listRes.ok) {
      const pages = (await listRes.json()) as WpPage[]
      const contact = pages.find((p) => CONTACT_SLUGS.includes(p.slug) && p.id !== frontId)
      if (contact) await applyTo(contact.id, false, contact.slug)
    }

    return { pages: touched }
  } catch (err) {
    logger.warn({ userId, err }, '[clinic-schema] publish failed (non-fatal)')
    return null
  }
}
