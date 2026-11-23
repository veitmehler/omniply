import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { Prisma } from '@prisma/client'
import { getSystemApiKey } from './system-keys'
import { recordCallOutcome } from './net/call-stats'

const DEFAULT_FROM = 'notifications@omniply.io' // omniply.io is the Resend-verified domain

/** Resend API key — env (RESEND_API_KEY) first, else the admin-managed DB key. */
async function getResendApiKey(): Promise<string | null> {
  return getSystemApiKey('resend')
}

/**
 * From address for transactional email — admin-managed PlatformSettings value,
 * then env fallbacks, then a default.
 */
async function getTransactionalFrom(): Promise<string> {
  const ps = await prisma.platformSettings
    .findUnique({ where: { id: 'singleton' }, select: { transactionalEmailFrom: true } })
    .catch(() => null)
  return (
    ps?.transactionalEmailFrom?.trim() ||
    process.env.TRANSACTIONAL_EMAIL_FROM ||
    process.env.ALERT_EMAIL_FROM ||
    DEFAULT_FROM
  )
}

export interface FailureAlertInput {
  userId?: string
  jobId?: string
  errorType: string
  message: string
  context?: Record<string, unknown>
}

/** A failure of the same type for the same account inside this window is the same incident. */
export const ALERT_INCIDENT_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Whether this failure gets an email, given the previous one of the same type
 * for the same account: the first of an incident does, and so does the first of
 * each new UTC day while it lasts (the reminder). Every other repeat is only
 * logged. Kept pure so the rule is testable without a database.
 */
export function alertEmailDecision(previousAt: Date | null, now: Date): 'first' | 'reminder' | 'repeat' {
  if (!previousAt || now.getTime() - previousAt.getTime() > ALERT_INCIDENT_WINDOW_MS) return 'first'
  if (previousAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10)) return 'reminder'
  return 'repeat'
}

/**
 * Persist the failure and email the OPERATIONS inbox (ALERT_EMAIL_TO) via Resend.
 *
 * The account owner is never a recipient (Veit, 2026-11-23: "the client
 * shouldn't get our alert emails, only we should"). Until that day this function
 * also mailed `user.email`, with the raw error text as the body and no grouping:
 * during the Gemini credit outage one client received 405 identical
 * `newsletter_generate_failed` emails in two days, and the flood pushed Resend
 * over its rate limit 1,044 times, on the key that also sends client email.
 *
 * Every failure is still written to ErrorLog (the admin Errors page); only the
 * email is grouped: one when an incident starts, one reminder per UTC day.
 */
export async function sendFailureAlert(input: FailureAlertInput): Promise<void> {
  // Read the previous occurrence BEFORE this one is written.
  const now = new Date()
  const previous = await prisma.errorLog
    .findFirst({
      where: { errorType: input.errorType, userId: input.userId ?? null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    .catch(() => null)
  const decision = alertEmailDecision(previous?.createdAt ?? null, now)

  await prisma.errorLog
    .create({
      data: {
        userId: input.userId,
        jobId: input.jobId,
        errorType: input.errorType,
        errorMessage: input.message,
        context: (input.context ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((err) => {
      logger.error({ err }, '[alerts] failed to write ErrorLog')
    })

  const resendKey = await getResendApiKey()
  const from = process.env.ALERT_EMAIL_FROM ?? 'alerts@omniply.io'
  const adminTo = process.env.ALERT_EMAIL_TO

  // Operations only. The account is named in the body so we know whose it is.
  const recipients = new Set<string>()
  if (adminTo) recipients.add(adminTo)

  if (!resendKey || recipients.size === 0) return
  if (decision === 'repeat') {
    logger.info({ errorType: input.errorType, userId: input.userId }, '[alerts] repeat of an open incident — logged, not mailed')
    return
  }

  let account = ''
  if (input.userId) {
    const user = await prisma.user
      .findUnique({
        where: { id: input.userId },
        select: { email: true, brandSettings: { select: { organizationName: true } } },
      })
      .catch(() => null)
    account = [user?.brandSettings?.organizationName, user?.email].filter(Boolean).join(' · ')
  }

  // Env tag (2026-10-22): staging and prod alerts land in the same inbox —
  // an untagged staging failure reads as a prod incident (the SMS-probe
  // confusion that prompted this).
  const { deployEnvironment } = await import('./env')
  const env = deployEnvironment()
  const subject = `[Omniply${env === 'production' ? '' : ` ${env.toUpperCase()}`}] ${input.errorType}${decision === 'reminder' ? ' (still failing)' : ''}`
  const body =
    `${input.message}\n\n` +
    (account ? `Account: ${account}\n` : '') +
    `Repeats of this failure for this account are logged on the admin Errors page and not mailed again today.\n\n` +
    JSON.stringify(input.context ?? {}, null, 2)

  for (const to of recipients) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, text: body }),
      })
      recordCallOutcome('resend', response.ok ? 'success' : 'error', { status: response.status, message: `Resend answered ${response.status}` })
      if (!response.ok) {
        logger.warn({ to, status: response.status }, '[alerts] Resend API error')
      } else {
        // Successes were silent — impossible to tell "sent but in spam" from
        // "never sent" when an alert goes missing (live test 2026-10-09).
        logger.info({ to, errorType: input.errorType }, '[alerts] email sent')
      }
    } catch (err) {
      logger.error({ err, to }, '[alerts] failed to send email')
    }
  }
}

/**
 * One plain email to the operations inbox (ALERT_EMAIL_TO): the System Health
 * alerts. The caller owns grouping and reminders (ServiceAccount.alertLevel /
 * alertAt), so this just sends. Returns false when nothing is configured.
 */
export async function sendOpsEmail(subject: string, text: string): Promise<boolean> {
  const resendKey = await getResendApiKey()
  const to = process.env.ALERT_EMAIL_TO
  if (!resendKey || !to) return false
  const from = process.env.ALERT_EMAIL_FROM ?? 'alerts@omniply.io'
  const { deployEnvironment } = await import('./env')
  const env = deployEnvironment()
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `[Omniply${env === 'production' ? '' : ` ${env.toUpperCase()}`}] ${subject}`, text }),
    })
    recordCallOutcome('resend', response.ok ? 'success' : 'error', { status: response.status, message: `Resend answered ${response.status}` })
    if (!response.ok) logger.warn({ status: response.status }, '[alerts] ops email rejected by Resend')
    else logger.info({ subject }, '[alerts] ops email sent')
    return response.ok
  } catch (err) {
    logger.error({ err }, '[alerts] failed to send ops email')
    return false
  }
}

/**
 * Send a single transactional email via Resend. No-op (returns false) when
 * RESEND_API_KEY isn't configured. Distinct from sendFailureAlert — this is a
 * normal user-facing message, not an error log.
 */
export async function sendTransactionalEmail(input: {
  to: string
  subject: string
  html?: string
  text: string
}): Promise<boolean> {
  const resendKey = await getResendApiKey()
  if (!resendKey) {
    logger.info({ to: input.to }, '[alerts] no Resend key configured — skipping transactional email')
    return false
  }
  const from = await getTransactionalFrom()
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    })
    recordCallOutcome('resend', response.ok ? 'success' : 'error', { status: response.status, message: `Resend answered ${response.status}` })
    if (!response.ok) {
      logger.warn({ to: input.to, status: response.status }, '[alerts] transactional Resend error')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err, to: input.to }, '[alerts] failed to send transactional email')
    return false
  }
}

/**
 * Notify a customer that their newsletter editions are ready to review. Returns
 * false if the user has no email or Resend isn't configured.
 */
export async function sendNewsletterReadyEmail(userId: string, count: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  if (!user?.email) return false

  const base = process.env.APP_URL ?? 'https://chiro.omniply.io'
  const reviewUrl = `${base}/newsletter`
  const greeting = user.name ? `Hi ${user.name},` : 'Hi,'
  const plural = count === 1 ? 'edition is' : 'editions are'

  const text = `${greeting}

${count} newsletter ${plural} ready for your review.

Review, tweak, and approve them here:
${reviewUrl}

Once approved, each edition is scheduled to send automatically.`

  const html = `<p>${greeting}</p>
<p><strong>${count}</strong> newsletter ${plural} ready for your review.</p>
<p><a href="${reviewUrl}">Review, tweak, and approve your editions &rarr;</a></p>
<p style="color:#666;font-size:13px;">Once approved, each edition is scheduled to send automatically.</p>`

  return sendTransactionalEmail({
    to: user.email,
    subject: `${count} newsletter ${plural} ready to review`,
    text,
    html,
  })
}
