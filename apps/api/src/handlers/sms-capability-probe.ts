/**
 * SMS capability self-test (.plans/sms-capability-selftest.implementation-plan.md,
 * design locked with Veit 2026-10-08).
 *
 * A2P registration state is invisible via API, but its EFFECT is perfectly
 * observable: send one real SMS from the clinic's number to OUR sink number
 * (+1 210-960-8070, Twilio, master account) and read the carrier status —
 * empirically proven 2026-10-08 (delivered vs explicit "Error 30034 - Number
 * not A2P compliant").
 *
 * Daily per account (VoiceAgentConfig rows with GHL creds):
 *  - already delivered + flag on → skip (steady state costs nothing)
 *  - delivered → voiceSmsAvailable=true; on the FIRST flip send the owner
 *    the "✓ Texting is now live" confirmation (fire-and-forget: a landline
 *    owner number fails silently and NEVER downgrades the just-proven flag)
 *  - 30034 → a2p-pending, stay false, retry tomorrow (auto-flips the day
 *    the clinic's registration clears)
 *  - "no numbers available" → no-number, stay false, quiet
 *  - anything else → error + alert (sink misconfigured, creds broken, …)
 */
import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { getGhlCredentials } from '../lib/ghl/settings'
import { upsertGhlContact, sendGhlSmsGetMessageId, getGhlMessageStatus } from '../lib/ghl/client'
import { sendFailureAlert, sendTransactionalEmail } from '../lib/alerts'
import { twilioConfigured, listInboundMessages } from '../lib/twilio'
import { logger } from '../lib/logger'

export const SMS_SINK_NUMBER = '+12109608070'
const STATUS_POLL_MS = 20_000

async function probeAccount(accountId: string, ownerUserId: string): Promise<void> {
  const creds = await getGhlCredentials(ownerUserId)
  if (!creds) return

  const stamp = (status: string, available?: boolean) =>
    prisma.voiceAgentConfig.update({
      where: { accountId },
      data: {
        smsProbeStatus: status,
        smsProbeAt: new Date(),
        ...(available === undefined ? {} : { voiceSmsAvailable: available }),
      },
    })

  let messageId: string | null = null
  try {
    const sink = await upsertGhlContact(creds.apiKey, creds.locationId, {
      phone: SMS_SINK_NUMBER,
      firstName: 'Omniply',
      lastName: 'SMS Self-Test',
      tags: ['staff-internal'],
      source: 'sms-self-test',
    })
    if (!sink.contactId) throw new Error('sink contact upsert returned no id')
    messageId = await sendGhlSmsGetMessageId(
      creds.apiKey,
      sink.contactId,
      `Omniply texting self-test · ${accountId} · safe to ignore`,
    )
    if (!messageId) throw new Error('send returned no message id')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/no numbers available/i.test(msg)) {
      await stamp('no-number', false)
      return
    }
    await stamp('error', false)
    await sendFailureAlert({
      errorType: 'sms-probe-failed',
      message: `SMS capability probe could not SEND for account ${accountId}: ${msg}`,
      context: { accountId },
    }).catch(() => {})
    return
  }

  await new Promise((r) => setTimeout(r, STATUS_POLL_MS))
  const { status, error } = await getGhlMessageStatus(creds.apiKey, messageId).catch(() => ({
    status: null,
    error: 'status fetch failed',
  }))

  // Receipt verification (belt + braces, 2026-10-08): the sink is a Twilio
  // number on OUR master account — if the probe body physically arrived
  // there, delivery is proven regardless of what the status API says.
  // Anything at the sink NOT carrying this account's token is ignored.
  let receiptSeen = false
  if (twilioConfigured()) {
    receiptSeen = await listInboundMessages(SMS_SINK_NUMBER, new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .then((ms) => ms.some((m) => m.body.includes(accountId)))
      .catch(() => false)
  }

  if (status === 'delivered' || receiptSeen) {
    logger.info({ accountId, status, receiptSeen }, '[sms-probe] delivery confirmed')
    const before = await prisma.voiceAgentConfig.findUnique({
      where: { accountId },
      select: { voiceSmsAvailable: true },
    })
    await stamp('delivered', true)
    logger.info({ accountId }, '[sms-probe] delivered — texting capability ON')
    if (!before?.voiceSmsAvailable) {
      // First flip: the owner-facing confirmation (user's design). BOTH
      // channels so neither gets missed (decision 2026-10-08): email always
      // lands; the SMS — sent from the clinic's own number — is the nice
      // moment on a mobile and fails silently on a landline. Both are
      // fire-and-forget and NEVER touch the just-proven flag.
      const CONFIRM = '✓ - Texting is now live for your chat and voice AI assistants!'
      try {
        const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { email: true } })
        if (owner?.email) {
          await sendTransactionalEmail({
            to: owner.email,
            subject: '✓ Texting is now live for your AI assistants',
            text: `${CONFIRM}\n\nYour practice's number passed its texting self-test: booking links, appointment confirmations, and guides can now reach patients by SMS. Nothing to set up — it's already on.`,
            html: `<p><strong>${CONFIRM}</strong></p><p>Your practice's number passed its texting self-test: booking links, appointment confirmations, and guides can now reach patients by SMS. Nothing to set up — it's already on.</p>`,
          })
        }
      } catch (err) {
        logger.info({ accountId, err }, '[sms-probe] owner confirmation email failed (fine)')
      }
      try {
        const brand = await prisma.brandSettings.findFirst({
          where: { userId: ownerUserId },
          select: { organizationPhone: true },
        })
        if (brand?.organizationPhone) {
          const owner = await upsertGhlContact(creds.apiKey, creds.locationId, {
            phone: brand.organizationPhone,
            tags: ['staff-internal'],
            source: 'sms-self-test',
          })
          if (owner.contactId) {
            await sendGhlSmsGetMessageId(creds.apiKey, owner.contactId, CONFIRM)
          }
        }
      } catch (err) {
        logger.info({ accountId, err }, '[sms-probe] owner confirmation SMS not delivered (fine)')
      }
    }
    return
  }

  if (error && /30034|a2p/i.test(error)) {
    await stamp('a2p-pending', false)
    logger.info({ accountId }, '[sms-probe] A2P pending — will retry tomorrow')
    return
  }
  if (error && /no numbers available/i.test(error)) {
    await stamp('no-number', false)
    return
  }
  await stamp('error', false)
  await sendFailureAlert({
    errorType: 'sms-probe-failed',
    message: `SMS capability probe for account ${accountId} ended "${status}" (${error ?? 'no error detail'}) — not a known A2P/no-number case; check the sink (+1 210-960-8070) and the location's SMS setup.`,
    context: { accountId },
  }).catch(() => {})
}

export async function smsCapabilityProbeHandler(_jobs: PgBoss.Job<unknown>[]): Promise<void> {
  const rows = await prisma.voiceAgentConfig.findMany({
    where: { NOT: { AND: [{ voiceSmsAvailable: true }, { smsProbeStatus: 'delivered' }] } },
    select: { accountId: true },
    take: 50,
  })
  for (const row of rows) {
    const account = await prisma.account.findUnique({
      where: { id: row.accountId },
      select: { ownerUserId: true },
    })
    if (!account?.ownerUserId) continue
    await probeAccount(row.accountId, account.ownerUserId).catch((err) =>
      logger.warn({ accountId: row.accountId, err }, '[sms-probe] account probe crashed'),
    )
  }
}
