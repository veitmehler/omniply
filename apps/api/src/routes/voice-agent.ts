/**
 * Voice-agent custom-LLM endpoint (.plans/voice-agent-elevenlabs
 * .implementation-plan.md V1).
 *
 * ElevenLabs Agents (custom-LLM mode) POSTs OpenAI-compatible chat
 * completions here for every caller turn. The per-account secret in the URL
 * is the auth AND the account resolver — same posture as the DM webhook
 * token (no headers survive the ElevenLabs dashboard config reliably; the
 * URL does).
 *
 * Registered under BOTH .../chat/completions and .../v1/chat/completions:
 * vendors disagree on whether the configured base URL already contains /v1.
 *
 * The engine runs to completion (every guardrail + post-filter on the full
 * reply) before the first SSE byte streams — no unfiltered text is ever
 * spoken. A request_human action is translated into the transfer_to_number
 * system tool call when ElevenLabs offered one (phone calls only).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { getBoss, QUEUES } from '../queues/index'
import { AgentTurnError, runAgentTurn } from '../agent/engine'
import { agentContextForAccount, openStatusFor } from '../agent/context'
import {
  buildCompletion,
  buildStreamFrames,
  findTransferTool,
  lastUserMessage,
  toolContinuation,
  transferLooksFailed,
  voiceCallerPhone,
  voiceVisitorKey,
  type VoiceCompletionBody,
  type VoiceReplyPlan,
} from '../agent/voice-shim'
import { resolveRescueContext } from '../agent/voice-rescue'

const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/

// Log each account's offered tool schemas once per process — V3 verification
// reads these to confirm the transfer tool's exact parameter shape.
const toolsLogged = new Set<string>()

async function handleVoiceCompletion(
  request: FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>,
  reply: FastifyReply,
  mode: 'standard' | 'message' = 'standard',
) {
  const { secret } = request.params
  if (!SECRET_RE.test(secret)) return reply.status(401).send({ error: 'unauthorized' })

  const account = await prisma.account.findUnique({
    where: { voiceAgentSecret: secret },
    select: { id: true },
  })
  if (!account) return reply.status(401).send({ error: 'unauthorized' })
  const vconfig = await prisma.voiceAgentConfig.findUnique({
    where: { accountId: account.id },
    select: { transferNumber: true },
  })
  const transferNumber = vconfig?.transferNumber ?? null

  const body = request.body ?? {}
  const message = lastUserMessage(body)
  const model = typeof body.model === 'string' && body.model ? body.model : 'omniply-agent'
  const streaming = body.stream !== false

  if (!toolsLogged.has(account.id) && Array.isArray(body.tools) && body.tools.length > 0) {
    toolsLogged.add(account.id)
    logger.info(
      { accountId: account.id, tools: JSON.stringify(body.tools).slice(0, 2000) },
      '[voice-agent] offered tool schemas (first seen this process)',
    )
  }

  let plan: VoiceReplyPlan
  const continuation = toolContinuation(body)
  if (continuation !== null) {
    // Post-tool-call continuation: never re-run the turn. Transfer failed →
    // the plan's no-answer fallback (offer a callback message); otherwise
    // stay silent — on success the platform removes the agent from the call.
    const failed = transferLooksFailed(continuation)
    logger.info(
      { accountId: account.id, failed, toolResult: continuation.slice(0, 200) },
      '[voice-agent] tool continuation',
    )
    plan = {
      reply: failed
        ? 'It looks like the team could not pick up just now. Can I take your name and number instead? They will call you back as soon as possible.'
        : '',
      transferToolName: null,
      model,
    }
  } else if (!message) {
    // Empty/agent-only transcript (e.g. a first_message-only warmup ping):
    // respond with silence-safe filler rather than erroring the call.
    plan = { reply: 'How can I help you today?', transferToolName: null, model }
  } else {
    const { key, source } = voiceVisitorKey(body)
    const callerPhone = voiceCallerPhone(body)
    // Rescue call: link back to the failed-transfer conversation (no-
    // ambiguity rule inside; consumed stamp on turn 1, persisted context on
    // the new conversation row keeps turns 2+ covered).
    const rescue = mode === 'message' ? await resolveRescueContext(account.id, callerPhone).catch(() => null) : null
    try {
      const result = await runAgentTurn({
        accountId: account.id,
        visitorKey: key,
        message,
        channel: 'voice',
        voiceMode: mode,
        callerPhone,
        ...(rescue
          ? {
              seedKnownBlock: rescue.transcriptBlock,
              seedGhlContactId: rescue.ghlContactId,
              rescueSourceId: rescue.sourceId,
            }
          : {}),
      })
      // A transfer needs the offered tool, a stored destination (an empty
      // transfer_number fails platform validation and resurrects the repeat
      // loop), AND an OPEN practice — the transfer target is the clinic's own
      // line, which after hours is by definition unattended: an unanswered
      // conference transfer maroons the caller in hold music forever
      // (live-verified 2026-09-09; ElevenLabs never returns to the agent
      // without the feature-gated call screening).
      let practiceOpen = false
      if (mode === 'standard' && result.action?.type === 'request_human' && transferNumber) {
        const ctx = await agentContextForAccount(account.id).catch(() => null)
        const open = ctx ? openStatusFor(ctx) : null
        practiceOpen = Boolean(open?.known && open.openNow)
      }
      // Message mode NEVER transfers — the team already failed to pick up.
      const transferToolName =
        mode === 'standard' && result.action?.type === 'request_human' && transferNumber && practiceOpen
          ? findTransferTool(body)
          : null
      let reply = result.reply
      if (result.action?.type === 'request_human' && !transferToolName) {
        // Never speak an empty "connecting you" promise — pivot to a callback
        // offer, worded for WHY the transfer is off the table.
        reply =
          transferNumber && !practiceOpen
            ? 'The team is not in the practice right now, so I cannot put you through. Can I take your name and number instead? They will call you back as soon as they are in.'
            : 'I am not able to connect you directly right now. Can I take your name and number instead? The team will call you back as soon as they can.'
        logger.warn(
          { accountId: account.id, conversationId: result.conversationId, practiceOpen, hasNumber: Boolean(transferNumber) },
          '[voice-agent] request_human without transfer — pivoted to callback offer',
        )
      }
      if (transferToolName) {
        // Caveat rides in the spoken line: even the worst watchdog outcome
        // leaves the caller instructed.
        reply = `${reply} If the team cannot pick up, just call back and I will take a message.`
        // Arm the 25s watchdog: kills the still-ringing Twilio dial leg so an
        // unanswered transfer cannot hold the caller in music forever. Works
        // on OUR subaccount credentials — independent of the clinic's
        // ElevenLabs plan. Fire-and-forget: queue trouble must not break the
        // live call.
        try {
          const boss = await getBoss()
          await boss.send(
            QUEUES.VOICE_TRANSFER_WATCHDOG,
            {
              accountId: account.id,
              transferNumber,
              armedAtIso: new Date().toISOString(),
              conversationId: result.conversationId,
            },
            { startAfter: 25 },
          )
        } catch (err) {
          logger.error({ err, accountId: account.id }, '[voice-agent] failed to arm transfer watchdog')
        }
      }
      plan = { reply, transferToolName, transferNumber, model }
      logger.info(
        {
          accountId: account.id,
          conversationId: result.conversationId,
          visitorKeySource: source,
          action: result.action?.type ?? null,
          transfer: Boolean(transferToolName),
          ended: result.ended,
        },
        '[voice-agent] turn served',
      )
    } catch (err) {
      // A dead engine must never drop the live call — speak a safe fallback.
      const code = err instanceof AgentTurnError ? err.code : 'engine-error'
      logger.error({ err, accountId: account.id, code }, '[voice-agent] turn failed — safe fallback spoken')
      plan = {
        reply: 'Sorry, I am having trouble right now. Please call the practice directly and the team will help you.',
        transferToolName: null,
        model,
      }
    }
  }

  if (!streaming) return reply.send(buildCompletion(plan))

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  for (const frame of buildStreamFrames(plan)) reply.raw.write(frame)
  reply.raw.end()
  return reply
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Rescue TwiML: the watchdog redirects the caller's leg here after killing an
 * unanswered transfer. Dials the internal message-agent number; when the
 * rescue agent isn't provisioned, the floor is a spoken apology + hangup.
 */
async function handleRescueTwiml(
  request: FastifyRequest<{ Params: { secret: string } }>,
  reply: FastifyReply,
) {
  const { secret } = request.params
  if (!SECRET_RE.test(secret)) return reply.status(401).send({ error: 'unauthorized' })
  const account = await prisma.account.findUnique({ where: { voiceAgentSecret: secret }, select: { id: true } })
  if (!account) return reply.status(401).send({ error: 'unauthorized' })
  const config = await prisma.voiceAgentConfig.findUnique({
    where: { accountId: account.id },
    select: { rescueNumber: true },
  })
  // No callerId attribute on <Dial>: Twilio's default presents the ORIGINAL
  // caller's number, which is the rescue-link primary key.
  const twiml = config?.rescueNumber
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${xmlEscape(config.rescueNumber)}</Dial></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, the team could not pick up just now. Please call back and I will take a message, or the team will see your missed call and get back to you.</Say><Hangup/></Response>`
  logger.info({ accountId: account.id, rescue: Boolean(config?.rescueNumber) }, '[voice-agent] rescue TwiML served')
  return reply.header('Content-Type', 'text/xml').send(twiml)
}

export async function voiceAgentRoutes(app: FastifyInstance) {
  app.post('/agent/voice/:secret/chat/completions', (req, rep) =>
    handleVoiceCompletion(req as FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>, rep),
  )
  app.post('/agent/voice/:secret/v1/chat/completions', (req, rep) =>
    handleVoiceCompletion(req as FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>, rep),
  )
  // Message-taking (rescue) agent — mode as a PATH segment because ElevenLabs
  // appends /chat/completions to the configured base URL.
  app.post('/agent/voice/:secret/message/chat/completions', (req, rep) =>
    handleVoiceCompletion(req as FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>, rep, 'message'),
  )
  app.post('/agent/voice/:secret/message/v1/chat/completions', (req, rep) =>
    handleVoiceCompletion(req as FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>, rep, 'message'),
  )
  // Twilio webhooks may use GET or POST depending on config.
  app.post('/agent/voice-rescue-twiml/:secret', handleRescueTwiml)
  app.get('/agent/voice-rescue-twiml/:secret', handleRescueTwiml)
}
