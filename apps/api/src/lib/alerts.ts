import { prisma } from '@omniply/shared'
import { logger } from './logger'
import { Prisma } from '@prisma/client'
import { getSystemApiKey } from './system-keys'

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

/** Persist failure and optionally email admin + user via Resend. */
export async function sendFailureAlert(input: FailureAlertInput): Promise<void> {
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

  const recipients = new Set<string>()
  if (adminTo) recipients.add(adminTo)

  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    })
    if (user?.email) recipients.add(user.email)
  }

  if (!resendKey || recipients.size === 0) return

  const subject = `[Omniply] ${input.errorType}`
  const body = `${input.message}\n\n${JSON.stringify(input.context ?? {}, null, 2)}`

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
      if (!response.ok) {
        logger.warn({ to, status: response.status }, '[alerts] Resend API error')
      }
    } catch (err) {
      logger.error({ err, to }, '[alerts] failed to send email')
    }
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
