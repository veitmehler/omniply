/**
 * Booking provider registry (PMS framework v2 Phase A).
 *
 * Nookal is a DELIBERATE stub: its API endpoints can't be verified without
 * a trial account (plan Phase E gate), and we don't ship guessed vendor
 * calls. Selecting direct-nookal fails loudly at config time, not on a call.
 */
import type { BookingProvider, DirectMode } from './providers'
import { ghlProvider } from './ghl-provider'
import { clinikoProvider } from './cliniko'

const nookalStub: BookingProvider = {
  async freeSlots() {
    throw new Error('Nookal provider not yet verified — pending trial-account E2E (plan Phase E)')
  },
  async book() {
    throw new Error('Nookal provider not yet verified — pending trial-account E2E (plan Phase E)')
  },
  async cancel() {
    throw new Error('Nookal provider not yet verified — pending trial-account E2E (plan Phase E)')
  },
}

export function providerFor(mode: DirectMode): BookingProvider {
  switch (mode) {
    case 'direct-ghl':
      return ghlProvider
    case 'direct-cliniko':
      return clinikoProvider
    case 'direct-nookal':
      return nookalStub
  }
}

export { isDirectMode, normalizeBookingMode, type BookingMode, type DirectMode, type ProviderCtx, type BookingProvider } from './providers'
