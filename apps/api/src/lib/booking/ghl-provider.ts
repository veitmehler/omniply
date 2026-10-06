/**
 * GHL calendar booking provider (PMS framework v2 Phase A) — the live
 * pipeline from the missed-call sweep, now behind the provider interface.
 * Also serves advisory-gcal's READ side (freeSlots against the Google-
 * mirroring GHL calendar); advisory never calls book/cancel.
 */
import { prisma } from '@omniply/shared'
import { getGhlCredentials } from '../ghl/settings'
import { getGhlFreeSlots, createGhlAppointment, deleteGhlCalendarEvent } from '../ghl/client'
import type { BookingProvider, ProviderCtx, BookArgs } from './providers'

async function creds(ctx: ProviderCtx) {
  const c = await getGhlCredentials(ctx.ownerUserId)
  if (!c) throw new Error('No GHL credentials for account owner')
  return c
}

export const ghlProvider: BookingProvider = {
  async freeSlots(ctx, startMs, endMs) {
    if (!ctx.calendarId) return []
    const c = await creds(ctx)
    const settings = await prisma.settings.findUnique({
      where: { userId: ctx.ownerUserId },
      select: { socialTimezone: true },
    })
    return getGhlFreeSlots(c.apiKey, ctx.calendarId, startMs, endMs, settings?.socialTimezone ?? undefined)
  },

  async book(ctx, args: BookArgs) {
    if (!ctx.calendarId) throw new Error('No booking calendar configured')
    if (!args.ghlContactId) throw new Error('GHL booking requires the CRM contact id')
    const c = await creds(ctx)
    const event = await createGhlAppointment(c.apiKey, {
      calendarId: ctx.calendarId,
      locationId: c.locationId,
      contactId: args.ghlContactId,
      startTime: args.slotStart,
      title: `${args.name} — booked by AI assistant`,
    })
    if (!event.id) throw new Error('GHL appointment creation returned no event id')
    return { externalId: event.id }
  },

  async cancel(ctx, externalId) {
    const c = await creds(ctx)
    await deleteGhlCalendarEvent(c.apiKey, externalId)
  },
}
