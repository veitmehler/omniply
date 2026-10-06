/**
 * Booking provider interface (PMS framework v2, Phase A —
 * .plans/pms-connector-framework.implementation-plan.md).
 *
 * Tier-1 "direct" booking only: a provider returns REAL free slots (exact
 * ISO strings with offsets — the engine's truth guarantee hangs on these)
 * and creates/cancels appointments in the system that owns the diary.
 * Tier 2 (advisory) and Tier 3 (patterns) have no provider by design.
 *
 * The GHL CRM contact is NOT the provider's job — actions.ts always upserts
 * the GHL contact (communications CRM, universal); the provider handles its
 * own system's records (e.g. the Cliniko patient).
 */
import type { Prisma } from '@prisma/client'

export interface ProviderCtx {
  accountId: string
  ownerUserId: string
  /** account.agentBookingConfig (provider-specific ids). */
  config: Prisma.JsonValue | null
  /** GHL calendar id (direct-ghl only). */
  calendarId: string | null
}

export interface BookArgs {
  /** Exact ISO start as offered by freeSlots — already validator-approved. */
  slotStart: string
  name: string
  phone: string
  email: string | null
  /** The GHL contact the CRM step created (ghl provider uses it directly). */
  ghlContactId: string | null
}

export interface BookingProvider {
  /** Sorted ISO starts in the window; throw on hard failure (caller degrades). */
  freeSlots(ctx: ProviderCtx, startMs: number, endMs: number): Promise<string[]>
  book(ctx: ProviderCtx, args: BookArgs): Promise<{ externalId: string }>
  cancel(ctx: ProviderCtx, externalId: string): Promise<void>
}

export type DirectMode = 'direct-ghl' | 'direct-cliniko' | 'direct-nookal'
export type BookingMode = DirectMode | 'advisory-gcal' | 'patterns' | 'off'

export function isDirectMode(mode: string): mode is DirectMode {
  return mode === 'direct-ghl' || mode === 'direct-cliniko' || mode === 'direct-nookal'
}

export function normalizeBookingMode(raw: string | null | undefined): BookingMode {
  switch (raw) {
    case 'direct-ghl':
    case 'direct-cliniko':
    case 'direct-nookal':
    case 'advisory-gcal':
    case 'patterns':
      return raw
    default:
      return 'off'
  }
}
