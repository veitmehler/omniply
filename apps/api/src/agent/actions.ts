/**
 * Agent action EXECUTION (.plans/chat-agent-v1.implementation-plan.md C2).
 *
 * The engine validates actions (tools.ts); this module makes them real:
 *  - request_callback → GHL contact upsert (phone-first) + `callback-requested`
 *    tag (snapshot workflow notifies the front desk) + a contact note carrying
 *    the LLM-generated 2–3 sentence chat summary (decision C).
 *  - capture_contact → same machinery as the Spine Check capture: Drive
 *    grant-all, LeadCapture row, guide drip tags.
 *  - add_contact_email → patches the conversation's contact with the backup
 *    email (asked right after a callback is arranged).
 *
 * All best-effort: the visitor's chat never breaks on a CRM hiccup — failures
 * alert us (spine-check pattern) and are visible in the transcript flags.
 *
 * CONVERGENCE (contact-convergence batch): one conversation = ONE GHL contact.
 * The first contact-needing action creates it with everything known so far and
 * stores its id; every later action updates THAT contact by id (fields +
 * tag-add) instead of re-upserting by a different key — a guide capture
 * followed by a callback can no longer fragment into two contacts.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { sendFailureAlert } from '../lib/alerts'
import { getGhlCredentials } from '../lib/ghl/settings'
import {
  addGhlContactTags,
  removeGhlContactTags,
  findGhlContactIdByPhone,
  createGhlContactNote,
  getBookingTimeFieldId,
  getCallbackTimeFieldId,
  getChatSummaryFieldId,
  sendGhlConversationMessage,
  updateGhlContact,
  upsertGhlContact,
} from '../lib/ghl/client'
import { clearBookingCacheFor } from './booking'
import { buildBookingSms, buildGuideSms, SMS_PER_CONVERSATION_CAP } from './sms'
import { driveConfigured, grantReader } from '../lib/gdrive/client'
import { recordLLMUsage } from '../lib/llm-usage'
import { runNewsletterPrompt } from '../newsletter/llm'
import { NON_PATIENT_DOC_SLUGS, type AgentContext } from './context'
import type { AgentAction } from './tools'
import { knownDetailsFor, primaryEmailOf, splitFullName } from './known'
import { normalizePhoneE164 } from './phone'

/** The conversation's converged contact id, if one exists yet. */
async function contactIdFor(conversationId: string): Promise<string | null> {
  const row = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { ghlContactId: true },
  })
  return row?.ghlContactId ?? null
}

async function conversationMeta(
  conversationId: string,
): Promise<{ channel: string; ghlContactId: string | null; callerPhone: string | null }> {
  const row = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { channel: true, ghlContactId: true, callerPhone: true },
  })
  return {
    channel: row?.channel ?? 'web',
    ghlContactId: row?.ghlContactId ?? null,
    callerPhone: row?.callerPhone ?? null,
  }
}

/** DM channel: a guide link sent in-chat still applies the drip tags. */
async function executeDmGuideTags(
  ctx: AgentContext,
  conversationId: string,
  slug: string,
): Promise<void> {
  const meta = await conversationMeta(conversationId)
  if (meta.channel !== 'ghl-dm' || !meta.ghlContactId) return
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) return
  const doc = await prisma.leadGenDocument.findFirst({
    where: { accountId: ctx.accountId, slug, status: 'live' },
    select: { ghlTagNames: true },
  })
  const tags = [...(doc?.ghlTagNames?.length ? doc.ghlTagNames : [`leadgen-${slug}`]), 'chat-agent-lead']
  await addGhlContactTags(creds.apiKey, meta.ghlContactId, tags)
  logger.info({ conversationId, slug }, '[agent] dm guide link → drip tags applied')
}

/** Silent detail correction (C3 2026-10-08): update the converged contact's
 * name/phone with NO tags — nothing fires, nobody is asked to call. A note
 * lands on the record so the correction is visible in the contact history. */
async function executeUpdateContactDetails(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'update_contact_details' }>,
): Promise<void> {
  const contactId = await contactIdFor(conversationId)
  if (!contactId) return
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) return
  await updateGhlContact(creds.apiKey, contactId, {
    ...(action.phone ? { phone: normalizePhoneE164(action.phone, ctx.countryCode) } : {}),
    ...(action.name ? splitFullName(action.name) : {}),
  })
  await createGhlContactNote(
    creds.apiKey,
    contactId,
    `✏️ Visitor corrected their details in chat: ${[action.name, action.phone].filter(Boolean).join(' · ')}`,
  ).catch(() => {})
}

/** Visitor asked for a human: pause the AI (ai-off) + leave a handover note.
 * The snapshot's tag-triggered workflow notifies the front desk. */
async function executeRequestHuman(ctx: AgentContext, conversationId: string): Promise<void> {
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) return
  const meta = await conversationMeta(conversationId)
  let contactId = meta.ghlContactId
  if (!contactId) {
    // C3 probe 27 (2026-10-08): this used to bail silently when the
    // conversation had no contact yet — the visitor was promised a human
    // and NOTHING happened. The prompt now gathers name+number before
    // attaching request_human; create/converge the contact here so the
    // handover actually reaches the front desk.
    const known = await knownDetailsFor(conversationId)
    const knownEmail = primaryEmailOf(known)
    if (known.phone || knownEmail) {
      const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
        ...(known.phone ? { phone: normalizePhoneE164(known.phone, ctx.countryCode) } : {}),
        ...splitFullName(known.name ?? ''),
        ...(knownEmail ? { email: knownEmail } : {}),
        tags: ['chat-agent-lead'],
        source: 'chat-agent',
      })
      contactId = result.contactId ?? null
      if (contactId) {
        await prisma.agentConversation.update({ where: { id: conversationId }, data: { ghlContactId: contactId } })
      }
    }
  }
  if (!contactId) {
    // No contact AND no known details: surface it for review instead of
    // letting the handover vanish.
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { flagged: true, flagReason: 'human-requested-no-contact' },
    })
    logger.warn({ accountId: ctx.accountId, conversationId }, '[agent] human requested but no contact details — flagged')
    return
  }
  await addGhlContactTags(creds.apiKey, contactId, ['ai-off', 'human-requested'])
  const summary = await callbackSummary(ctx, conversationId)
  await createGhlContactNote(
    creds.apiKey,
    contactId,
    ['🙋 Visitor asked for a HUMAN — AI is paused on this conversation.', summary ? `Chat summary: ${summary}` : null]
      .filter(Boolean)
      .join('\n'),
  ).catch(() => {})
  logger.info({ accountId: ctx.accountId, conversationId }, '[agent] human takeover requested — ai-off applied')
}

/** Compact transcript for the front-desk summary prompt. */
async function transcriptFor(conversationId: string): Promise<string> {
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 40,
    select: { role: true, content: true },
  })
  return rows.map((m) => `${m.role === 'visitor' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n')
}

/** 2–3 sentence handover summary (decision C). Empty string on any failure. */
async function callbackSummary(ctx: AgentContext, conversationId: string): Promise<string> {
  try {
    const transcript = await transcriptFor(conversationId)
    const { content, response } = await runNewsletterPrompt('agent_summary', { transcript }, { vertical: ctx.vertical })
    await recordLLMUsage(ctx.ownerUserId, 'agent', response)
    return content.trim().slice(0, 1000)
  } catch (err) {
    logger.warn({ err, conversationId }, '[agent] callback summary generation failed')
    return ''
  }
}

async function executeCallback(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'request_callback' }>,
): Promise<void> {
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')

  const summary = await callbackSummary(ctx, conversationId)
  // Repeat callback for the SAME PERSON = corrected details after the first
  // notification already fired. The tag-triggered workflow won't re-fire on
  // an existing tag, so we remove + re-add it below and mark the summary as
  // superseding (user decision 2026-10-07). Same-PERSON scoping added
  // 2026-10-08: a conversation can hold callbacks for different people
  // (visitor + spouse), and the spouse's FIRST request must not say
  // "UPDATED". Match by phone tail or name. The current turn's action is
  // already persisted, so >1 same-person occurrences means a true repeat.
  const priorCallbackRows = await prisma.agentMessage.findMany({
    where: { conversationId, role: 'assistant', action: { path: ['type'], equals: 'request_callback' } },
    select: { action: true },
  })
  const digitsOf = (v: unknown): string => (typeof v === 'string' ? v.replace(/\D/g, '') : '')
  const nameOf = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '')
  const curPhone = digitsOf(action.phone)
  const curName = nameOf(action.name)
  const samePersonCount = priorCallbackRows.filter((r) => {
    const a = r.action as Record<string, unknown> | null
    if (!a) return false
    const p = digitsOf(a.phone)
    const n = nameOf(a.name)
    return (p && curPhone && p.slice(-9) === curPhone.slice(-9)) || (n && curName && n === curName)
  }).length
  const isUpdatedCallback = samePersonCount > 1
  // The summary also lands in the "Chat Summary" custom field (find-or-create)
  // so the snapshot's notification workflow can merge {{contact.chat_summary}}
  // straight into the front-desk SMS/email text.
  const known = await knownDetailsFor(conversationId)
  const existingId = await contactIdFor(conversationId)
  const primaryName = nameOf(known.name)
  const primaryPhone = digitsOf(known.phone)
  // Shared family number (user design 2026-10-08): "one person per phone
  // number" — a family member giving the VISITOR's own number stays on the
  // visitor's contact (the visitor remains the main contact until the front
  // desk meets the family in person). The mismatched name is NEVER applied
  // to the primary record; the family context rides in the summary.
  const sharedPhoneFamily = Boolean(
    existingId &&
      curName &&
      primaryName &&
      curName !== primaryName &&
      curPhone &&
      primaryPhone &&
      curPhone.slice(-9) === primaryPhone.slice(-9),
  )
  // Third-party callback (C3 2026-10-08: Sarah's callback RENAMED Steve's
  // converged contact): a callback naming someone OTHER than the primary,
  // on a DIFFERENT number, gets its OWN contact — the primary record is
  // never touched.
  const isThirdParty = Boolean(
    existingId && curName && primaryName && curName !== primaryName && !sharedPhoneFamily,
  )
  const summaryText = [
    isUpdatedCallback ? 'UPDATED CALLBACK — replaces the earlier request, details changed; use THESE details' : null,
    sharedPhoneFamily ? `Family callback on the shared number — this call is FOR ${action.name}` : null,
    action.reason,
    summary,
  ]
    .filter(Boolean)
    .join(', ')
  const fieldId = summaryText
    ? await getChatSummaryFieldId(creds.apiKey, creds.locationId).catch(() => null)
    : null
  // Structured preferred time (voice-sms plan §5) — its own custom field so
  // the notification workflow can merge {{contact.callback_preferred_time}}.
  const timeFieldId = action.preferredTime
    ? await getCallbackTimeFieldId(creds.apiKey, creds.locationId).catch(() => null)
    : null
  const customFields = [
    ...(fieldId && summaryText ? [{ id: fieldId, value: summaryText.slice(0, 2000) }] : []),
    ...(timeFieldId && action.preferredTime ? [{ id: timeFieldId, value: action.preferredTime }] : []),
  ]
  const customFieldsOrUndef = customFields.length > 0 ? customFields : undefined
  const tags = ['callback-requested', 'chat-agent-lead']

  // Normalize to E.164 with the CLINIC's country — GHL otherwise guesses
  // from the location default and can misfile foreign formats (+1074… bug).
  const phone = normalizePhoneE164(action.phone, ctx.countryCode)
  let contactId: string | null = existingId
  if (existingId && !isThirdParty) {
    // Converge: same contact the guide capture created — fields by id, tag-add.
    // sharedPhoneFamily: the family member's name must NEVER overwrite the
    // primary's (the original Sarah-renamed-Steve bug, upsert flavor).
    await updateGhlContact(creds.apiKey, existingId, {
      phone,
      ...(action.name && !sharedPhoneFamily ? splitFullName(action.name) : {}),
      ...(customFieldsOrUndef ? { customFields: customFieldsOrUndef } : {}),
    })
    if (isUpdatedCallback) {
      // Re-arm the tag-triggered notification workflow so the front desk
      // hears about the corrected details; best-effort (add still runs).
      await removeGhlContactTags(creds.apiKey, existingId, ['callback-requested']).catch(() => {})
    }
    await addGhlContactTags(creds.apiKey, existingId, tags)
  } else {
    // No primary yet (this callback establishes it) OR a third party
    // (dedicated contact; phone-first upsert converges onto an existing
    // patient record for that person when one exists).
    // Third-party CORRECTION (C3 2026-10-08: duplicate Henrikes): when this
    // person's number CHANGED, a phone-keyed upsert would mint a second
    // contact — find the contact their PRIOR number created and update it.
    let correctedId: string | null = null
    if (isThirdParty && isUpdatedCallback) {
      const priorPhone = priorCallbackRows
        .map((r) => r.action as Record<string, unknown> | null)
        .filter((a): a is Record<string, unknown> => Boolean(a))
        .filter((a) => nameOf(a.name) === curName && digitsOf(a.phone) && digitsOf(a.phone).slice(-9) !== curPhone.slice(-9))
        .map((a) => a.phone as string)
        .pop()
      if (priorPhone) {
        correctedId = await findGhlContactIdByPhone(
          creds.apiKey,
          creds.locationId,
          normalizePhoneE164(priorPhone, ctx.countryCode),
        )
      }
    }
    if (correctedId) {
      await updateGhlContact(creds.apiKey, correctedId, {
        phone,
        ...splitFullName(action.name ?? ''),
        ...(customFieldsOrUndef ? { customFields: customFieldsOrUndef } : {}),
      })
      contactId = correctedId
    } else {
      const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
        phone,
        ...splitFullName(action.name ?? known.name ?? ''),
        // Carry the known email into creation so the contact starts complete
        // — but ONLY for the primary person; a third party never inherits the
        // visitor's email.
        ...(!isThirdParty && primaryEmailOf(known) ? { email: primaryEmailOf(known)! } : {}),
        tags,
        source: 'chat-agent',
        ...(customFieldsOrUndef ? { customFields: customFieldsOrUndef } : {}),
      })
      contactId = result.contactId ?? null
    }
    if (contactId && !isThirdParty) {
      await prisma.agentConversation.update({
        where: { id: conversationId },
        data: { ghlContactId: contactId },
      })
    }
    if (contactId && isThirdParty && isUpdatedCallback) {
      // Corrected third-party details: re-arm the notification workflow on
      // THEIR contact (upsert alone won't re-trigger an existing tag).
      await removeGhlContactTags(creds.apiKey, contactId, ['callback-requested']).catch(() => {})
      await addGhlContactTags(creds.apiKey, contactId, tags)
    }
  }
  if (contactId) {
    // Rescue call: the front desk should know a LIVE transfer went unanswered
    // before this callback was taken (deterministic, not model-authored).
    const rescueRow = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      select: { rescueSourceId: true },
    })
    const note = [
      '📞 Chat assistant callback request',
      rescueRow?.rescueSourceId ? '⚠️ Live transfer to the team went unanswered before this callback was taken.' : null,
      action.preferredTime ? `Preferred time: ${action.preferredTime}` : null,
      action.reason ? `Reason: ${action.reason}` : null,
      summary ? `Chat summary: ${summary}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    await createGhlContactNote(creds.apiKey, contactId, note).catch((err) =>
      logger.warn({ err, conversationId }, '[agent] contact note failed (contact + tag landed)'),
    )
  }
  logger.info({ accountId: ctx.accountId, conversationId, converged: Boolean(existingId) }, '[agent] callback → GHL contact + tag')
}

/**
 * Direct booking (missed-call sweep Part 4a): contact upsert (phone-first,
 * same convergence rules as callbacks) → GHL appointment at the validated
 * slot → audit row + note. No LLM call — the caller is live on the phone.
 */
async function executeBooking(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'book_appointment' }>,
): Promise<void> {
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')
  const account = await prisma.account.findUnique({
    where: { id: ctx.accountId },
    select: { agentBookingMode: true, agentBookingCalendarId: true, agentBookingConfig: true },
  })
  const { isDirectMode, providerFor } = await import('../lib/booking')
  const mode = account?.agentBookingMode ?? 'off'
  if (!isDirectMode(mode)) throw new Error(`Booking not enabled in direct mode (mode=${mode})`)
  const provider = providerFor(mode)

  const phone = normalizePhoneE164(action.phone, ctx.countryCode)
  const tags = ['appointment-booked', 'chat-agent-lead']
  const known = await knownDetailsFor(conversationId)
  const existingId = await contactIdFor(conversationId)
  let contactId: string | null = existingId
  if (existingId) {
    await updateGhlContact(creds.apiKey, existingId, { phone, ...splitFullName(action.name) })
    await addGhlContactTags(creds.apiKey, existingId, tags)
  } else {
    const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
      phone,
      ...splitFullName(action.name),
      ...(primaryEmailOf(known) ? { email: primaryEmailOf(known)! } : {}),
      tags,
      source: 'chat-agent',
    })
    contactId = result.contactId ?? null
    if (contactId) {
      await prisma.agentConversation.update({ where: { id: conversationId }, data: { ghlContactId: contactId } })
    }
  }
  if (!contactId) throw new Error('Booking contact upsert returned no contact id')

  // Provider-side booking (ghl calendar / Cliniko diary / …). The GHL CRM
  // contact above is universal; the provider owns its own system's records.
  const booked = await provider.book(
    {
      accountId: ctx.accountId,
      ownerUserId: ctx.ownerUserId,
      config: account?.agentBookingConfig ?? null,
      calendarId: account?.agentBookingCalendarId ?? null,
    },
    {
      slotStart: action.slotStart,
      name: action.name,
      phone,
      email: primaryEmailOf(known) ?? null,
      ghlContactId: contactId,
    },
  )

  await prisma.agentAppointment.create({
    data: {
      accountId: ctx.accountId,
      conversationId,
      provider: mode.replace('direct-', ''),
      ghlEventId: booked.externalId,
      ghlContactId: contactId,
      startTime: new Date(action.slotStart),
    },
  })
  // The taken slot must vanish from the next turn's offer list immediately.
  clearBookingCacheFor(ctx.accountId)

  // "Booking Time" custom field (human-readable, clinic-local): the
  // tag-triggered email-confirmation workflow merges {{contact.booking_time}}
  // — tag workflows can't see appointment merge fields.
  try {
    const settings = await prisma.settings.findUnique({ where: { userId: ctx.ownerUserId }, select: { socialTimezone: true } })
    const { labelForSlot } = await import('./booking')
    const label = labelForSlot(action.slotStart, settings?.socialTimezone ?? null)
    const fieldId = await getBookingTimeFieldId(creds.apiKey, creds.locationId)
    if (fieldId) await updateGhlContact(creds.apiKey, contactId, { customFields: [{ id: fieldId, value: label }] })
  } catch (err) {
    logger.warn({ err, conversationId }, '[agent] booking-time field write failed (booking landed)')
  }

  await createGhlContactNote(
    creds.apiKey,
    contactId,
    ['📅 Appointment booked by the AI assistant on a live call', `Start: ${action.slotStart}`, `Caller: ${action.name} (${phone})`].join('\n'),
  ).catch((err) => logger.warn({ err, conversationId }, '[agent] booking note failed (appointment landed)'))

  logger.info(
    { accountId: ctx.accountId, conversationId, provider: mode, externalId: booked.externalId, slot: action.slotStart },
    '[agent] appointment booked via voice',
  )
}

async function executeCapture(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'capture_contact' }>,
): Promise<void> {
  const docs = await prisma.leadGenDocument.findMany({
    where: { accountId: ctx.accountId, status: 'live', driveFileId: { not: null }, slug: { notIn: NON_PATIENT_DOC_SLUGS } },
    select: { id: true, slug: true, driveFileId: true, ghlTagNames: true },
  })
  const matched = docs.find((d) => d.slug === action.guideSlug) ?? null

  // Drive grant-all first — same posture as the Spine Check: the lead must
  // never hit a request-access wall when drip links arrive.
  if (driveConfigured()) {
    for (const doc of docs) {
      await grantReader(doc.driveFileId!, action.email, false).catch((err) =>
        logger.warn({ documentId: doc.id, err }, '[agent] drive grant failed (request-access flow remains)'),
      )
    }
  }

  let captureId: string | null = null
  if (matched) {
    const capture = await prisma.leadCapture.create({
      data: {
        documentId: matched.id,
        accountId: ctx.accountId,
        requesterEmail: action.email,
        proposalId: `chat-agent:${randomUUID()}`,
        status: 'ghl_failed', // upgraded below on success
      },
    })
    captureId = capture.id
  }

  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')
  const guideTags = matched ? (matched.ghlTagNames.length ? matched.ghlTagNames : [`leadgen-${matched.slug}`]) : []
  const tags = [...guideTags, 'chat-agent-lead']

  const known = await knownDetailsFor(conversationId)
  const existingId = await contactIdFor(conversationId)
  let contactId: string | null = existingId
  if (existingId) {
    // Converge on the callback-created contact. The capture email only takes
    // the primary slot when no deliberately-chosen email exists (user rule:
    // the add_contact_email address always wins the primary slot).
    await updateGhlContact(creds.apiKey, existingId, {
      ...(known.preferredEmail ? {} : { email: action.email }),
      ...(action.name ? splitFullName(action.name) : {}),
      ...(action.phone ? { phone: normalizePhoneE164(action.phone, ctx.countryCode) } : {}),
    })
    await addGhlContactTags(creds.apiKey, existingId, tags)
  } else {
    const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
      email: action.email,
      ...((action.name ?? known.name) ? splitFullName((action.name ?? known.name)!) : {}),
      ...(action.phone ?? known.phone
        ? { phone: normalizePhoneE164((action.phone ?? known.phone)!, ctx.countryCode) }
        : {}),
      tags,
      source: 'chat-agent',
    })
    contactId = result.contactId ?? null
    if (contactId) {
      await prisma.agentConversation.update({
        where: { id: conversationId },
        data: { ghlContactId: contactId },
      })
    }
  }
  if (captureId) {
    await prisma.leadCapture.update({
      where: { id: captureId },
      data: { status: 'captured', ghlContactId: contactId },
    })
  }
  logger.info({ accountId: ctx.accountId, conversationId, guide: action.guideSlug, converged: Boolean(existingId) }, '[agent] capture → GHL + drip')
}

async function executeAddEmail(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'add_contact_email' }>,
): Promise<void> {
  const conversation = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { ghlContactId: true },
  })
  if (!conversation?.ghlContactId) return
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')
  await updateGhlContact(creds.apiKey, conversation.ghlContactId, { email: action.email })
  logger.info({ accountId: ctx.accountId, conversationId }, '[agent] backup email added to contact')

  // Guide-email correction (C3 2026-10-08): the Drive grant AND the drip's
  // first email (the one carrying the guide link) went to the ORIGINAL
  // capture address — a misspelled address means the lead never got the
  // guide. When this conversation captured a guide and the address CHANGED:
  // re-grant Drive to the new address and remove+re-add the guide tags so
  // the drip (re-entry is enabled on those workflows) re-delivers from
  // email 1 to the corrected inbox. Sends to the old misspelled address
  // just bounce; duplication is a non-issue.
  const captureRows = await prisma.agentMessage.findMany({
    where: { conversationId, role: 'assistant', action: { path: ['type'], equals: 'capture_contact' } },
    select: { action: true },
  })
  const captured = captureRows
    .map((r) => r.action as { email?: unknown; guideSlug?: unknown } | null)
    .filter((a): a is { email?: unknown; guideSlug?: unknown } => Boolean(a))
  const capturedEmails = captured
    .map((a) => (typeof a.email === 'string' ? a.email.toLowerCase() : ''))
    .filter(Boolean)
  if (capturedEmails.length && !capturedEmails.includes(action.email.toLowerCase())) {
    const docs = await prisma.leadGenDocument.findMany({
      where: { accountId: ctx.accountId, status: 'live', driveFileId: { not: null }, slug: { notIn: NON_PATIENT_DOC_SLUGS } },
      select: { id: true, slug: true, driveFileId: true, ghlTagNames: true },
    })
    if (driveConfigured()) {
      for (const doc of docs) {
        await grantReader(doc.driveFileId!, action.email, false).catch((err) =>
          logger.warn({ documentId: doc.id, err }, '[agent] re-grant after email correction failed'),
        )
      }
    }
    const capturedSlugs = captured.map((a) => (typeof a.guideSlug === 'string' ? a.guideSlug : null)).filter(Boolean)
    const dripTags = docs
      .filter((d) => capturedSlugs.includes(d.slug))
      .flatMap((d) => (d.ghlTagNames.length ? d.ghlTagNames : [`leadgen-${d.slug}`]))
    if (dripTags.length) {
      await removeGhlContactTags(creds.apiKey, conversation.ghlContactId, dripTags).catch(() => {})
      await addGhlContactTags(creds.apiKey, conversation.ghlContactId, dripTags)
      logger.info(
        { accountId: ctx.accountId, conversationId, dripTags },
        '[agent] guide email corrected — drip re-fired to the new address',
      )
    }
    // Audit trail: point the capture rows at the corrected address.
    await prisma.leadCapture
      .updateMany({
        where: { accountId: ctx.accountId, requesterEmail: { in: capturedEmails }, proposalId: { startsWith: 'chat-agent:' } },
        data: { requesterEmail: action.email },
      })
      .catch(() => {})
  }

  // Booking email confirmation (user design 2026-10-06): voice callers give
  // their email AFTER booking, when the appointment-triggered workflow has
  // already run (and skipped its email step). The tag fires the second,
  // tag-triggered workflow — ONLY when this conversation actually booked,
  // so callback-only visitors never get a phantom appointment email.
  const booked = await prisma.agentAppointment.findFirst({ where: { conversationId }, select: { id: true } })
  if (booked) {
    await addGhlContactTags(creds.apiKey, conversation.ghlContactId, ['booking-email-confirm']).catch((err) =>
      logger.warn({ err, conversationId }, '[agent] booking-email-confirm tag failed'),
    )
    logger.info({ accountId: ctx.accountId, conversationId }, '[agent] booking email confirmation tagged')
  }
}

/**
 * Voice intake (start-of-call name + disconnect number): INSERT-ONLY GHL
 * convergence — upsert-by-phone silently merges onto an existing contact or
 * creates a lead, and the conversation stores the CONFIRMED callback number
 * (network caller-id is often anonymous and always spoofable — it is never
 * treated as identity, and nothing stored in GHL is ever read back to the
 * caller from here).
 */
async function executeIntake(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'intake_details' }>,
): Promise<void> {
  // The confirmed number becomes the conversation's callback/rescue key.
  if (action.phone) {
    const phone = normalizePhoneE164(action.phone, ctx.countryCode)
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { callerPhone: phone } })
      .catch(() => {})
  }
  // GHL: converge/create only when we have a phone (the dedupe key). A
  // name-only intake stays conversation-local until an action needs GHL.
  if (!action.phone) return
  const meta = await conversationMeta(conversationId)
  if (meta.ghlContactId) {
    if (action.name) {
      const creds = await getGhlCredentials(ctx.ownerUserId)
      if (creds) await updateGhlContact(creds.apiKey, meta.ghlContactId, splitFullName(action.name)).catch(() => {})
    }
    return
  }
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) return
  const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
    phone: normalizePhoneE164(action.phone, ctx.countryCode),
    ...(action.name ? splitFullName(action.name) : {}),
    tags: ['chat-agent-lead'],
    source: 'chat-agent',
  })
  if (result.contactId) {
    await prisma.agentConversation.update({ where: { id: conversationId }, data: { ghlContactId: result.contactId } })
    logger.info({ conversationId, accountId: ctx.accountId }, '[agent] intake → GHL contact converged')
  }
}

/**
 * Voice SMS delivery (voice-sms plan): text the guide/booking link through
 * the clinic's GHL location. Deterministic templates; converges on the
 * conversation's contact; capped per conversation; a FAILED send latches
 * voiceSmsAvailable=false so future calls fall back to email delivery
 * (attempt-and-latch — GHL has no clean SMS-capability pre-probe).
 */
async function executeVoiceSms(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'send_guide_link' } | { type: 'send_booking_link' }>,
): Promise<void> {
  const meta = await conversationMeta(conversationId)
  if (meta.channel !== 'voice') return

  const rawPhone = action.phone ?? meta.callerPhone
  if (!rawPhone) {
    logger.warn({ conversationId, action: action.type }, '[agent] voice SMS without a phone — skipped')
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { flagged: true, flagReason: `sms-no-phone:${action.type}` } })
      .catch(() => {})
    return
  }

  // Per-conversation cap (abuse guard).
  const sent = await prisma.agentMessage.count({
    where: {
      conversationId,
      role: 'assistant',
      OR: [
        { action: { path: ['type'], equals: 'send_guide_link' } },
        { action: { path: ['type'], equals: 'send_booking_link' } },
      ],
    },
  })
  if (sent > SMS_PER_CONVERSATION_CAP) {
    logger.warn({ conversationId, sent }, '[agent] voice SMS cap reached — skipped')
    return
  }

  // Body: deterministic template, never model text.
  let body: string | null = null
  if (action.type === 'send_guide_link') {
    const guide = ctx.guides.find((g) => g.slug === action.slug)
    if (guide?.driveLink) body = buildGuideSms(ctx.practiceName, guide.title, guide.driveLink)
  } else if (ctx.bookingUrl) {
    body = buildBookingSms(ctx.practiceName, ctx.bookingUrl)
  }
  if (!body) {
    logger.warn({ conversationId, action: action.type }, '[agent] voice SMS has no link to send — skipped')
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { flagged: true, flagReason: `sms-no-link:${action.type}` } })
      .catch(() => {})
    return
  }

  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')
  const phone = normalizePhoneE164(rawPhone, ctx.countryCode)

  // Converge on the conversation's contact (or create it phone-first).
  let contactId = meta.ghlContactId
  if (!contactId) {
    const known = await knownDetailsFor(conversationId)
    const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
      phone,
      ...(known.name ? splitFullName(known.name) : {}),
      tags: ['chat-agent-lead'],
      source: 'chat-agent',
    })
    contactId = result.contactId ?? null
    if (contactId) {
      await prisma.agentConversation.update({ where: { id: conversationId }, data: { ghlContactId: contactId } })
    }
  }
  if (!contactId) throw new Error('voice SMS: no GHL contact')

  const ok = await sendGhlConversationMessage(creds.apiKey, { type: 'SMS', contactId, message: body })
  if (!ok) {
    // Latch: this location can't SMS — stop promising texts on future calls.
    await prisma.voiceAgentConfig
      .updateMany({ where: { accountId: ctx.accountId }, data: { voiceSmsAvailable: false } })
      .catch(() => {})
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { flagged: true, flagReason: `sms-failed:${action.type}` } })
      .catch(() => {})
    logger.error(
      { conversationId, accountId: ctx.accountId, action: action.type },
      '[agent] voice SMS send FAILED — voiceSmsAvailable latched false (email fallback from next call)',
    )
    return
  }
  await addGhlContactTags(creds.apiKey, contactId, ['sms-sent']).catch(() => {})
  logger.info({ conversationId, accountId: ctx.accountId, action: action.type }, '[agent] voice SMS sent')
}

/**
 * Execute a validated action. Never throws — failures alert + flag but the
 * visitor's reply has already shipped.
 */
export async function executeAgentAction(
  ctx: AgentContext,
  conversationId: string,
  action: AgentAction,
  assistantMessageId?: string,
): Promise<void> {
  try {
    switch (action.type) {
      case 'request_callback':
        await executeCallback(ctx, conversationId, action)
        break
      case 'book_appointment':
        await executeBooking(ctx, conversationId, action)
        break
      case 'capture_contact':
        await executeCapture(ctx, conversationId, action)
        break
      case 'add_contact_email':
        await executeAddEmail(ctx, conversationId, action)
        break
      case 'send_guide_link':
        await executeDmGuideTags(ctx, conversationId, action.slug)
        await executeVoiceSms(ctx, conversationId, action)
        break
      case 'send_booking_link':
        // Web renders the booking card client-side; voice texts the link.
        await executeVoiceSms(ctx, conversationId, action)
        break
      case 'request_human':
        await executeRequestHuman(ctx, conversationId)
        break
      case 'update_contact_details':
        await executeUpdateContactDetails(ctx, conversationId, action)
        break
      case 'intake_details':
        await executeIntake(ctx, conversationId, action)
        break
      default:
        // offer_guide renders client-side; nothing to do.
        break
    }
  } catch (err) {
    logger.error({ err, conversationId, action: action.type }, '[agent] action execution failed')
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { flagged: true, flagReason: `action-failed:${action.type}` } })
      .catch(() => {})
    // Make the failure visible to the MODEL too (C3 2026-10-08: the visitor
    // was told "corrected" twice while GHL refused both updates): overwrite
    // the persisted action with a _failed marker — the history renderer
    // turns it into a SYSTEM note, same as _dropped, and known-details stop
    // deriving from an action that never took effect.
    if (assistantMessageId) {
      await prisma.agentMessage
        .update({ where: { id: assistantMessageId }, data: { action: { type: '_failed', attempted: action.type } } })
        .catch(() => {})
    }
    await sendFailureAlert({
      errorType: 'agent-action-failed',
      message: `Chat-agent ${action.type} failed for account ${ctx.accountId}: ${err instanceof Error ? err.message : String(err)}. The visitor was told it succeeded — follow up via the flagged transcript.`,
      context: { accountId: ctx.accountId, conversationId },
    }).catch(() => {})
  }
}
