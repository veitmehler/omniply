import { prisma, brandSettingsForUser } from '@omniply/shared'
import { Prisma } from '@prisma/client'
import { logger } from '../../lib/logger'

/**
 * Authority engine rotation (.plans/authority-content-engine plan, v1).
 *
 * RANDOM with anti-streak (user requirement 2026-10-15): shuffled-bag draw —
 * shuffle the five types, draw without replacement, reshuffle when empty,
 * with the constraint that a new bag's first draw never equals the previous
 * bag's last draw. Guarantees: never two of the same type consecutively, no
 * repeating fixed sequence, and every type appears exactly once per bag.
 * State persists on brand_settings.authorityEngineState so restarts/deploys
 * neither reset nor repeat the pattern.
 */

export const AUTHORITY_TYPES = ['opinion', 'belief_shift', 'leadership', 'proof', 'framework'] as const
export type AuthorityType = (typeof AUTHORITY_TYPES)[number]

export function isAuthorityType(v: unknown): v is AuthorityType {
  return typeof v === 'string' && (AUTHORITY_TYPES as readonly string[]).includes(v)
}

export interface AuthorityBagState {
  bag: AuthorityType[]
  lastDrawn: AuthorityType | null
  /** Chiro port: per-account opt-in — clinics draw registers only when true
   *  (azavea is always-on by vertical). Preserved across state writes. */
  enabled?: boolean
}

export function parseState(raw: unknown): AuthorityBagState {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as { bag?: unknown; lastDrawn?: unknown; enabled?: unknown }
    const bag = Array.isArray(o.bag) ? o.bag.filter(isAuthorityType) : []
    const lastDrawn = isAuthorityType(o.lastDrawn) ? o.lastDrawn : null
    return { bag, lastDrawn, ...(o.enabled === true ? { enabled: true } : {}) }
  }
  return { bag: [], lastDrawn: null }
}

/** Should this brand's content draw authority registers? */
export function authorityRegisterEligible(vertical: string | null, stateRaw: unknown): boolean {
  return vertical === 'azavea' || parseState(stateRaw).enabled === true
}

/** Clinic authority pools (brand_settings.authorityPools): register → material. */
export type AuthorityPools = Partial<Record<AuthorityType, string[]>>

export function parsePools(raw: unknown): AuthorityPools | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: AuthorityPools = {}
  let any = false
  for (const t of AUTHORITY_TYPES) {
    const v = (raw as Record<string, unknown>)[t]
    if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      if (items.length) {
        out[t] = items
        any = true
      }
    }
  }
  return any ? out : null
}

/**
 * Pure draw step (exported for tests). Refills with a Fisher–Yates shuffle
 * when the bag is empty; if the fresh bag would open with the previous bag's
 * closing type, that first element is swapped with a random later one.
 */
export function nextDraw(
  state: AuthorityBagState,
  rand: () => number = Math.random,
): { drawn: AuthorityType; state: AuthorityBagState } {
  let bag = state.bag.filter(isAuthorityType)
  if (bag.length === 0) {
    bag = [...AUTHORITY_TYPES]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j], bag[i]]
    }
    if (state.lastDrawn && bag[0] === state.lastDrawn) {
      const j = 1 + Math.floor(rand() * (bag.length - 1))
      ;[bag[0], bag[j]] = [bag[j], bag[0]]
    }
  }
  const drawn = bag[0]
  return { drawn, state: { ...state, bag: bag.slice(1), lastDrawn: drawn } }
}

/**
 * Draw the next authority type for an account and persist the advanced bag.
 * Optimistic concurrency: the write only lands if the state is unchanged
 * since the read; on contention we re-read and retry (last attempt writes
 * unconditionally — a once-in-a-blue-moon double-draw skews nothing).
 */
export async function drawAuthorityType(userId: string): Promise<AuthorityType> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const brand = await brandSettingsForUser(userId)
    if (!brand) throw new Error(`Brand settings missing for user ${userId}`)
    const oldRaw = brand.authorityEngineState
    const { drawn, state } = nextDraw(parseState(oldRaw))
    const where =
      oldRaw === null
        ? { id: brand.id, authorityEngineState: { equals: Prisma.AnyNull } }
        : { id: brand.id, authorityEngineState: { equals: oldRaw as Prisma.InputJsonValue } }
    const claimed = await prisma.brandSettings.updateMany({
      where,
      data: { authorityEngineState: state as unknown as Prisma.InputJsonValue },
    })
    if (claimed.count > 0 || attempt === 2) {
      if (claimed.count === 0) {
        await prisma.brandSettings.update({
          where: { id: brand.id },
          data: { authorityEngineState: state as unknown as Prisma.InputJsonValue },
        })
        logger.warn({ userId, drawn }, '[authority-rotation] contention on final attempt — wrote unconditionally')
      }
      return drawn
    }
  }
  throw new Error('unreachable')
}

/**
 * Fit swap (plan: "swap within the bag rather than force it"): the generator
 * drew `drawn` but the article only supported `used`. Rebalance so counts
 * stay one-per-bag: `used` leaves the remaining bag (if present) and `drawn`
 * returns to it; lastDrawn becomes what was actually published. Best-effort.
 */
export async function swapAuthorityType(userId: string, drawn: AuthorityType, used: AuthorityType): Promise<void> {
  if (drawn === used) return
  try {
    const brand = await brandSettingsForUser(userId)
    if (!brand) return
    const state = parseState(brand.authorityEngineState)
    const idx = state.bag.indexOf(used)
    if (idx >= 0) state.bag.splice(idx, 1, drawn)
    else state.bag.push(drawn)
    state.lastDrawn = used
    await prisma.brandSettings.update({
      where: { id: brand.id },
      data: { authorityEngineState: state as unknown as Prisma.InputJsonValue },
    })
    logger.info({ userId, drawn, used }, '[authority-rotation] fit swap applied')
  } catch (err) {
    logger.warn({ userId, drawn, used, err }, '[authority-rotation] fit swap failed (non-fatal)')
  }
}
