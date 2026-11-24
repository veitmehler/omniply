/**
 * System Health: getting the message to a person. Email goes to the operations
 * inbox; a text message goes out as well when production has stopped or is
 * about to, because 469 alert emails sat unread for ten days in November 2026.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../logger'
import { sendOpsEmail } from '../alerts'
import { twilioConfigured, listMasterSmsNumbers, sendTwilioSms } from '../twilio'
import { SMS_SINK_NUMBER } from '../../handlers/sms-capability-probe'
import type { AlertLevel } from './rules'
import type { ServiceView } from './service'

/** The number alerts are sent from: the configured one, else the first SMS-capable master number that is not the self-test sink. */
export async function resolveSmsFrom(configured: string | null | undefined): Promise<string | null> {
  if (configured?.trim()) return configured.trim()
  if (process.env.OPS_ALERT_SMS_FROM) return process.env.OPS_ALERT_SMS_FROM
  if (!twilioConfigured()) return null
  const numbers = await listMasterSmsNumbers().catch(() => [])
  return numbers.find((n) => n !== SMS_SINK_NUMBER) ?? numbers[0] ?? null
}

/** Send one operations text. Returns Twilio's message sid, or the reason nothing was sent. */
export async function sendOpsSms(body: string): Promise<{ ok: true; sid: string; status: string; from: string; to: string } | { ok: false; reason: string }> {
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' }, select: { opsAlertSmsTo: true, opsAlertSmsFrom: true } }).catch(() => null)
  const to = settings?.opsAlertSmsTo?.trim()
  if (!to) return { ok: false, reason: 'No mobile number is set for alert texts' }
  if (!twilioConfigured()) return { ok: false, reason: 'Twilio is not configured on this server' }
  const from = await resolveSmsFrom(settings?.opsAlertSmsFrom)
  if (!from) return { ok: false, reason: 'No SMS-capable number on the Twilio account to send from' }
  try {
    const sent = await sendTwilioSms(from, to, body)
    logger.info({ sid: sent.sid, status: sent.status }, '[system-health] ops SMS sent')
    return { ok: true, sid: sent.sid, status: sent.status, from, to }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn({ reason }, '[system-health] ops SMS failed')
    return { ok: false, reason }
  }
}

const money = (n: number) => `$${n.toFixed(2)}`

/**
 * Text messages follow what is registered for the A2P 10DLC campaign
 * (2026-11-24): they name the registered brand, Azavea Inc, link only to our
 * own System Health page (never to a provider's site), and carry the opt-out
 * line. Change the wording here and the campaign's sample messages together.
 */
export const SMS_BRAND = 'Azavea Inc'
const SMS_FOOTER = 'Reply STOP to opt out, HELP for help.'
export function healthPageUrl(): string {
  const base = (process.env.APP_BASE_URL ?? 'https://chiro.omniply.io').replace(/\/$/, '')
  return `${base.startsWith('http') ? base : `https://${base}`}/admin/health`
}
const sms = (what: string) => `${SMS_BRAND} alert: ${what} Details: ${healthPageUrl()} ${SMS_FOOTER}`

/** Sent once when a mobile number is saved for alerts: the campaign's opt-in confirmation. */
export const SMS_OPT_IN_MESSAGE = `${SMS_BRAND}: you are now subscribed to system alerts for your account. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`
export const SMS_TEST_MESSAGE = `${SMS_BRAND} test: this is where alerts arrive when production stops. Nothing is wrong. ${SMS_FOOTER}`

/** What the alert says, in plain words, with the one link that fixes it. */
export function alertText(v: ServiceView, level: AlertLevel, reminder: boolean): { subject: string; body: string; sms: string } {
  const again = reminder ? ' (still open)' : ''
  const link = v.rechargeUrl ? `\n\nAdd credit: ${v.rechargeUrl}` : ''
  const c = v.credit
  const balance = c && c.balance !== null ? money(c.balance) : 'unknown'
  const perDay = c ? `${money(c.perDay)} a day` : ''
  if (v.domain) {
    const d = v.domain
    const when = d.expiresAt ? d.expiresAt.slice(0, 10) : 'unknown'
    const lapsed = d.parked || (d.daysLeft !== null && d.daysLeft < 0)
    return {
      subject: lapsed ? `The domain ${v.label} has lapsed${again}` : `The domain ${v.label} expires in ${d.daysLeft} days${again}`,
      body: lapsed
        ? `${v.label} is no longer on our nameservers or is past its registration date (${when}).\n\nNameservers now: ${d.nameservers.join(', ') || 'unknown'}\nUsed for: ${v.usedFor}\n\nRenew it at the registrar today: a lapsed domain can be bought by anyone.`
        : `${v.label} is registered until ${when}, ${d.daysLeft} days from now.\n\nUsed for: ${v.usedFor}\n\nRenew it at the registrar, or turn on auto-renew there.`,
      sms: sms(lapsed ? `the domain ${v.label} has lapsed and must be renewed today.` : `the domain ${v.label} expires in ${d.daysLeft} days.`),
    }
  }
  if (level === 'blocked') {
    return {
      subject: `${v.label} is out of credit: production is stopped${again}`,
      body: `${v.label} is refusing our calls because the account has no credit.\n\nLast error: ${v.calls.lastErrorMessage ?? 'payment required'}\nLast successful call: ${v.calls.lastSuccessAt ?? 'none on record'}\n\nNothing else needs fixing: work resumes when credit is added.${link}`,
      sms: sms(`${v.label} is out of credit and content production has stopped.`),
    }
  }
  if (level === 'depleted') {
    return {
      subject: `${v.label} balance is at zero${again}`,
      body: `Our tracked balance for ${v.label} is ${balance}. At ${perDay} it has run out, or is about to.${link}\n\nIf you topped up already, record the top-up on the System Health page so the number is right again.`,
      sms: sms(`the ${v.label} balance is at zero.`),
    }
  }
  if (level === 'down') {
    return {
      subject: `${v.label} is not answering${again}`,
      body: `Our calls to ${v.label} are failing.\n\nLast error: ${v.calls.lastErrorMessage ?? 'unknown'}${v.calls.lastErrorStatus ? ` (HTTP ${v.calls.lastErrorStatus})` : ''}\nLast successful call: ${v.calls.lastSuccessAt ?? 'none on record'}\nThe provider's own status: ${v.providerStatus?.description ?? 'no status feed'}${v.statusPageUrl ? `\n${v.statusPageUrl}` : ''}`,
      sms: sms(`${v.label} is not answering our calls.`),
    }
  }
  const days = c?.runwayDays !== null && c?.runwayDays !== undefined ? Math.floor(c.runwayDays) : null
  const urgent = level === 'critical'
  return {
    subject: `${v.label} credit is ${urgent ? 'nearly gone' : 'running low'}: about ${days ?? '?'} days left${again}`,
    body: `${v.label} has ${balance} left. At ${perDay} that is about ${days ?? '?'} days.\n\nWarning threshold: ${v.warnDays} days. Critical threshold: ${v.criticalDays} days.${link}`,
    sms: sms(`your ${v.label} balance is down to about ${days ?? '?'} days of use.`),
  }
}

export async function deliverAlert(v: ServiceView, level: AlertLevel, reminder: boolean, withSms: boolean): Promise<void> {
  const text = alertText(v, level, reminder)
  await sendOpsEmail(text.subject, text.body)
  if (withSms) await sendOpsSms(text.sms)
}
