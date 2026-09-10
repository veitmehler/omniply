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
import { addGhlContactTags, createGhlContactNote, getChatSummaryFieldId, updateGhlContact, upsertGhlContact } from '../lib/ghl/client'
import { driveConfigured, grantReader } from '../lib/gdrive/client'
import { recordLLMUsage } from '../lib/llm-usage'
import { runNewsletterPrompt } from '../newsletter/llm'
import type { AgentContext } from './context'
import type { AgentAction } from './tools'
import { knownDetailsFor, primaryEmailOf } from './known'
import { normalizePhoneE164 } from './phone'

/** The conversation's converged contact id, if one exists yet. */
async function contactIdFor(conversationId: string): Promise<string | null> {
  const row = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { ghlContactId: true },
  })
  return row?.ghlContactId ?? null
}

async function conversationMeta(conversationId: string): Promise<{ channel: string; ghlContactId: string | null }> {
  const row = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { channel: true, ghlContactId: true },
  })
  return { channel: row?.channel ?? 'web', ghlContactId: row?.ghlContactId ?? null }
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

/** Visitor asked for a human: pause the AI (ai-off) + leave a handover note.
 * The snapshot's tag-triggered workflow notifies the front desk. */
async function executeRequestHuman(ctx: AgentContext, conversationId: string): Promise<void> {
  const meta = await conversationMeta(conversationId)
  if (!meta.ghlContactId) return
  const creds = await getGhlCredentials(ctx.ownerUserId)
  if (!creds) return
  await addGhlContactTags(creds.apiKey, meta.ghlContactId, ['ai-off', 'human-requested'])
  const summary = await callbackSummary(ctx, conversationId)
  await createGhlContactNote(
    creds.apiKey,
    meta.ghlContactId,
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
  // The summary also lands in the "Chat Summary" custom field (find-or-create)
  // so the snapshot's notification workflow can merge {{contact.chat_summary}}
  // straight into the front-desk SMS/email text.
  const summaryText = [action.reason, summary].filter(Boolean).join(', ')
  const fieldId = summaryText
    ? await getChatSummaryFieldId(creds.apiKey, creds.locationId).catch(() => null)
    : null
  const customFields = fieldId && summaryText ? [{ id: fieldId, value: summaryText.slice(0, 2000) }] : undefined
  const tags = ['callback-requested', 'chat-agent-lead']

  const known = await knownDetailsFor(conversationId)
  const existingId = await contactIdFor(conversationId)
  // Normalize to E.164 with the CLINIC's country — GHL otherwise guesses
  // from the location default and can misfile foreign formats (+1074… bug).
  const phone = normalizePhoneE164(action.phone, ctx.countryCode)
  let contactId: string | null = existingId
  if (existingId) {
    // Converge: same contact the guide capture created — fields by id, tag-add.
    await updateGhlContact(creds.apiKey, existingId, {
      phone,
      ...(action.name ? { firstName: action.name } : {}),
      ...(customFields ? { customFields } : {}),
    })
    await addGhlContactTags(creds.apiKey, existingId, tags)
  } else {
    const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
      phone,
      firstName: action.name ?? known.name ?? undefined,
      // Carry the known email into creation so the contact starts complete.
      ...(primaryEmailOf(known) ? { email: primaryEmailOf(known)! } : {}),
      tags,
      source: 'chat-agent',
      ...(customFields ? { customFields } : {}),
    })
    contactId = result.contactId ?? null
    if (contactId) {
      await prisma.agentConversation.update({
        where: { id: conversationId },
        data: { ghlContactId: contactId },
      })
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

async function executeCapture(
  ctx: AgentContext,
  conversationId: string,
  action: Extract<AgentAction, { type: 'capture_contact' }>,
): Promise<void> {
  const docs = await prisma.leadGenDocument.findMany({
    where: { accountId: ctx.accountId, status: 'live', driveFileId: { not: null } },
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
      ...(action.name ? { firstName: action.name } : {}),
      ...(action.phone ? { phone: normalizePhoneE164(action.phone, ctx.countryCode) } : {}),
    })
    await addGhlContactTags(creds.apiKey, existingId, tags)
  } else {
    const result = await upsertGhlContact(creds.apiKey, creds.locationId, {
      email: action.email,
      ...((action.name ?? known.name) ? { firstName: (action.name ?? known.name)! } : {}),
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
}

/**
 * Execute a validated action. Never throws — failures alert + flag but the
 * visitor's reply has already shipped.
 */
export async function executeAgentAction(
  ctx: AgentContext,
  conversationId: string,
  action: AgentAction,
): Promise<void> {
  try {
    switch (action.type) {
      case 'request_callback':
        await executeCallback(ctx, conversationId, action)
        break
      case 'capture_contact':
        await executeCapture(ctx, conversationId, action)
        break
      case 'add_contact_email':
        await executeAddEmail(ctx, conversationId, action)
        break
      case 'send_guide_link':
        await executeDmGuideTags(ctx, conversationId, action.slug)
        break
      case 'request_human':
        await executeRequestHuman(ctx, conversationId)
        break
      default:
        // send_booking_link / offer_guide render client-side; nothing to do.
        break
    }
  } catch (err) {
    logger.error({ err, conversationId, action: action.type }, '[agent] action execution failed')
    await prisma.agentConversation
      .update({ where: { id: conversationId }, data: { flagged: true, flagReason: `action-failed:${action.type}` } })
      .catch(() => {})
    await sendFailureAlert({
      errorType: 'agent-action-failed',
      message: `Chat-agent ${action.type} failed for account ${ctx.accountId}: ${err instanceof Error ? err.message : String(err)}. The visitor was told it succeeded — follow up via the flagged transcript.`,
      context: { accountId: ctx.accountId, conversationId },
    }).catch(() => {})
  }
}
