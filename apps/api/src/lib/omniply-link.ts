import { prisma } from '@omniply/shared'

/**
 * One-click deep link to the Omniply tab inside the client's CRM (Veit
 * 2026-09-23). The custom-page id is APP-LEVEL — verified identical across
 * two independent installs (demo + azavea locations) — so one constant
 * serves every client; env override in case GHL ever regenerates it on a
 * marketplace-app update (failure mode: GHL lands on the CRM dashboard,
 * same place the old sidebar-instructions link pointed).
 */
const OMNIPLY_PAGE_ID = process.env.GHL_OMNIPLY_PAGE_ID ?? '6a62c10397a755a86f579fff'
const CRM_BASE = process.env.GHL_WHITELABEL_BASE ?? 'https://crm.omniply.io'

export async function omniplyTabLink(
  accountOwnerUserId: string,
): Promise<{ href: string; label: string }> {
  const gs = await prisma.ghlSettings.findFirst({
    where: { userId: accountOwnerUserId },
    select: { ghlLocationId: true },
  })
  if (gs?.ghlLocationId) {
    return {
      href: `${CRM_BASE}/v2/location/${gs.ghlLocationId}/custom-page-link/${OMNIPLY_PAGE_ID}`,
      label: 'Open Omniply',
    }
  }
  const base = process.env.APP_BASE_URL ?? 'https://chiro.omniply.io'
  return { href: `${base}/dashboard`, label: 'Open your dashboard' }
}
