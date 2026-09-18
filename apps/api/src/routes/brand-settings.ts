import type { FastifyInstance } from 'fastify'
import { prisma, resolveAccountForClerkId, brandSettingsForUser } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { searchBusinessKnowledgePanel } from '../newsletter/oxylabs'
import { generateDiagramStyleGuideFromWebsite } from '../onboarding/diagram-style-gen'

/**
 * Onboarding discovery: auto-find a client's Google Business Profile from their
 * business name + location, for confirmation before storing into the existing
 * BrandSettings.googleBusinessProfileUrl field. See
 * .plans/client-story-review-mining.implementation-plan.md Phase 1. This route
 * only *resolves a candidate* — confirming/storing the URL still goes through
 * the existing PATCH /api/brand-settings (web-side, direct Prisma write).
 */

function registrableDomain(url: string | null): string | null {
  if (!url) return null
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase()
    const parts = host.replace(/^www\./, '').split('.')
    return parts.length >= 2 ? parts.slice(-2).join('.') : host
  } catch {
    return null
  }
}

export async function brandSettingsDiscoveryRoutes(app: FastifyInstance) {
  // POST /api/brand-settings/generate-diagram-style — (re)generate the
  // website-derived AI diagram style guide (Veit 2026-09-18, pre-launch).
  // Synchronous (~10-20s: screenshot + one vision call); stores the guide on
  // success and returns it so the settings textarea can show it immediately.
  app.post('/brand-settings/generate-diagram-style', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const result = await generateDiagramStyleGuideFromWebsite(account.ownerUserId)
    if (!result) {
      return reply.status(422).send({
        error:
          'Could not derive a style from the website — check the website URL and diagram colors in settings, then try again. The default style stays active.',
      })
    }
    return reply.send({ guide: result.guide })
  })

  // POST /api/brand-settings/discover-gbp — resolve a Google Business Profile
  // candidate from the account's organizationName + geolocation (or an explicit
  // override), for the onboarding "Is this your business?" confirmation step.
  app.post<{ Body: { query?: string } }>('/brand-settings/discover-gbp', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return

    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const brand = await brandSettingsForUser(account.userId)
    const organizationName = brand?.organizationName?.trim()
    const geolocation = brand?.geolocation?.trim()
    const query = request.body?.query?.trim() || [organizationName, geolocation].filter(Boolean).join(' ')

    if (!query) {
      return reply.status(400).send({
        error: 'No business name on file yet — enter your business name and location first, or provide a search query.',
      })
    }

    const panel = await searchBusinessKnowledgePanel(query)
    if (!panel || !panel.website) {
      return reply.send({ found: false })
    }

    const candidateDomain = registrableDomain(panel.website)
    const ownDomain = registrableDomain(brand?.organizationWebsite ?? null)
    const websiteMatches = !!(candidateDomain && ownDomain && candidateDomain === ownDomain)

    // The knowledge panel confirms identity (website/address) but isn't itself a Maps place
    // link. A Maps "search" URL built from the confirmed name+address reliably redirects to
    // the single matching place page — Phase 2's capture step already resolves redirects
    // (it has to, for short g.page/goo.gl links too), so this needs no separate place-ID lookup.
    const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [organizationName, panel.address].filter(Boolean).join(' '),
    )}`

    return reply.send({
      found: true,
      candidate: {
        description: panel.description,
        website: panel.website,
        address: panel.address,
        mapsSearchUrl,
      },
      websiteMatches,
    })
  })

  // GET /api/brand-settings/gbp-status — has this account confirmed a GBP URL?
  // Used by the client-story spider/gate to know whether there's anything to
  // spider for an account without duplicating the BrandSettings read elsewhere.
  app.get('/brand-settings/gbp-status', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'User not found' })

    const brand = await prisma.brandSettings.findFirst({
      where: { user: { accountId: account.accountId } },
      select: { googleBusinessProfileUrl: true },
    })
    return reply.send({ configured: !!brand?.googleBusinessProfileUrl?.trim() })
  })
}
