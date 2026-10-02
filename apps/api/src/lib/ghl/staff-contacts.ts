import { listGhlLocationUsers, upsertGhlContact } from './client'
import { logger } from '../logger'

/**
 * Pre-named staff contacts (user decision 2026-10-02).
 *
 * GHL threads SMS conversations by phone number and auto-creates a NAMELESS
 * contact when the number is unknown — so the first internal SMS
 * notification to a staff phone spawned mystery contacts (seen live on the
 * demo 2026-09-28: the front-desk number + a placeholder became blank
 * contacts one second after a callback workflow fired). Upserting a clearly
 * labeled contact per staff phone at provisioning means those threads land
 * on "Name (Staff)" instead.
 *
 * The `staff-internal` tag is the machine marker: marketing/drip workflows
 * must exclude it. Idempotent (phone-keyed upsert); failures only warn —
 * provisioning never blocks on this.
 */
export async function ensureStaffContacts(apiKey: string, locationId: string): Promise<void> {
  let users
  try {
    users = await listGhlLocationUsers(apiKey, locationId)
  } catch (err) {
    logger.warn({ err, locationId }, '[staff-contacts] user listing failed — skipped')
    return
  }
  for (const u of users) {
    const phone = u.phone?.trim()
    if (!phone) continue
    const lastName = [u.lastName?.trim(), '(Staff)'].filter(Boolean).join(' ')
    try {
      await upsertGhlContact(apiKey, locationId, {
        phone,
        ...(u.firstName?.trim() ? { firstName: u.firstName.trim() } : {}),
        lastName,
        tags: ['staff-internal'],
        source: 'omniply-provisioning',
      })
      logger.info({ locationId, phone: phone.slice(-4) }, '[staff-contacts] staff contact ensured')
    } catch (err) {
      logger.warn({ err, locationId, phone: phone.slice(-4) }, '[staff-contacts] upsert failed — continuing')
    }
  }
}
