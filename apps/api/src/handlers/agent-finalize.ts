import type PgBoss from 'pg-boss'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getGhlCredentials } from '../lib/ghl/settings'
import { createGhlContactNote, updateGhlContact } from '../lib/ghl/client'
import { knownDetailsFor, primaryEmailOf, splitFullName } from '../agent/known'
import { recordLLMUsage } from '../lib/llm-usage'
import { runNewsletterPrompt } from '../newsletter/llm'

/**
 * Chat-agent inactivity finalizer (contact-convergence batch).
 *
 * There is no reliable "end of chat" event (visitors close tabs), so a
 * conversation idle for 15+ minutes counts as finished. Time-sensitive
 * effects (callback notification, Drive grant, drip) already fired inline;
 * this pass does the once-per-conversation cleanup:
 *  - reconciles known visitor details onto the converged GHL contact
 *    (preferred callback email wins the primary slot),
 *  - writes ONE conversation-summary note for contacts that never got the
 *    callback note (captures without callbacks),
 *  - marks the conversation finalized.
 * Conversations without a contact are just marked finalized (nothing to do).
 */
const IDLE_MINUTES = 15
const BATCH_LIMIT = 50

export async function agentFinalizeHandler(_jobs: PgBoss.Job<object>[]): Promise<void> {
  const idleCutoff = new Date(Date.now() - IDLE_MINUTES * 60 * 1000)
  const conversations = await prisma.agentConversation.findMany({
    where: { finalizedAt: null, updatedAt: { lt: idleCutoff }, turnCount: { gt: 0 } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_LIMIT,
    select: {
      id: true,
      accountId: true,
      ghlContactId: true,
      account: { select: { ownerUserId: true, vertical: true } },
    },
  })
  if (!conversations.length) return

  for (const convo of conversations) {
    try {
      if (convo.ghlContactId && convo.account.ownerUserId) {
        const creds = await getGhlCredentials(convo.account.ownerUserId)
        if (creds) {
          const known = await knownDetailsFor(convo.id)
          const email = primaryEmailOf(known)
          if (email || known.name || known.phone) {
            await updateGhlContact(creds.apiKey, convo.ghlContactId, {
              ...(email ? { email } : {}),
              ...(known.name ? splitFullName(known.name) : {}),
              ...(known.phone ? { phone: known.phone } : {}),
            }).catch((err) => logger.warn({ err, conversationId: convo.id }, '[agent-finalize] reconcile failed'))
          }
          await maybeWriteSummaryNote(convo.id, convo.ghlContactId, convo.account.ownerUserId, convo.account.vertical, creds.apiKey)
        }
      }
      await prisma.agentConversation.update({ where: { id: convo.id }, data: { finalizedAt: new Date() } })
    } catch (err) {
      logger.warn({ err, conversationId: convo.id }, '[agent-finalize] conversation finalize failed (retries next run)')
    }
  }
  logger.info({ count: conversations.length }, '[agent-finalize] idle conversations finalized')
}

/** Summary note for contacts whose conversation had no callback (those already carry one). */
async function maybeWriteSummaryNote(
  conversationId: string,
  contactId: string,
  ownerUserId: string,
  vertical: string,
  apiKey: string,
): Promise<void> {
  const messages = await prisma.agentMessage.findMany({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { action: true },
  })
  const hadCallback = messages.some((m) => (m.action as { type?: string } | null)?.type === 'request_callback')
  if (hadCallback) return

  const rows = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 40,
    select: { role: true, content: true },
  })
  const transcript = rows.map((m) => `${m.role === 'visitor' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n')
  try {
    const { content, response } = await runNewsletterPrompt('agent_summary', { transcript }, { vertical })
    await recordLLMUsage(ownerUserId, 'agent', response)
    const summary = content.trim().slice(0, 1000)
    if (summary) {
      await createGhlContactNote(apiKey, contactId, `💬 Chat assistant conversation summary\n${summary}`)
    }
  } catch (err) {
    logger.warn({ err, conversationId }, '[agent-finalize] summary note failed (contact reconciled anyway)')
  }
}
