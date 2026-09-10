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
import { prepareRescueConversation } from '../agent/voice-rescue'

const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/

// Log each account's offered tool schemas once per process — V3 verification
// reads these to confirm the transfer tool's exact parameter shape.
const toolsLogged = new Set<string>()

// Duplicate-turn guard: choppy caller audio makes ElevenLabs occasionally
// send the same turn twice within milliseconds (live call 2026-09-10: two
// requests 278ms apart) — both would run the engine and speak twice. Same
// conversation+message inside the window shares ONE in-flight computation.
const DEDUP_WINDOW_MS = 6_000
const recentVoiceTurns = new Map<string, { at: number; promise: Promise<VoiceReplyPlan> }>()

// Deterministic pivot phrasings: a repeated ask must not replay the identical
// sentence (live call 2026-09-10 spoke the same line three times). Indexed by
// how many pivots this conversation has already heard.
const PIVOT_CLOSED = [
  'The team is not in the practice right now, so I cannot put you through. Can I take your name and number instead? They will call you back as soon as they are in.',
  'As I said, the team is not in yet, so a transfer will not work. The fastest option is a callback, what is your name and number?',
  'I really cannot put you through until the team is back. Let me take your number and they will call you first thing.',
]
const PIVOT_GENERIC = [
  'I am not able to connect you directly right now. Can I take your name and number instead? The team will call you back as soon as they can.',
  'A direct connection is not possible right now, but a callback is. What is the best number for the team to reach you?',
]

function pivotLine(variants: string[], count: number): string {
  return variants[Math.min(count, variants.length - 1)]
}

// Text-only connection promises ("I'm connecting you...") with no transfer
// actually happening must never reach the caller.
const CONNECT_PROMISE_RE = /connect(?:ing)?\s+you|put(?:ting)?\s+you\s+through|transferr?(?:ing)?\s+you/i

async function handleVoiceCompletion(
  request: FastifyRequest<{ Params: { secret: string }; Body: VoiceCompletionBody }>,
  reply: FastifyReply,
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
    const computeTurnPlan = async (): Promise<VoiceReplyPlan> => {
    try {
      // Rescue calls: the initiation webhook already pre-created the
      // conversation row (rescueSourceId + context) under this visitor key;
      // the engine derives message mode from it.
      const result = await runAgentTurn({
        accountId: account.id,
        visitorKey: key,
        message,
        channel: 'voice',
        callerPhone,
      })
      // A transfer needs the offered tool, a stored destination (an empty
      // transfer_number fails platform validation and resurrects the repeat
      // loop), AND an OPEN practice — the transfer target is the clinic's own
      // line, which after hours is by definition unattended: an unanswered
      // conference transfer maroons the caller in hold music forever
      // (live-verified 2026-09-09; ElevenLabs never returns to the agent
      // without the feature-gated call screening).
      let practiceOpen = false
      if (!result.messageMode && result.action?.type === 'request_human' && transferNumber) {
        const ctx = await agentContextForAccount(account.id).catch(() => null)
        const open = ctx ? openStatusFor(ctx) : null
        practiceOpen = Boolean(open?.known && open.openNow)
        // Staging test override: force the gate open. LOUD on every use so
        // it can never silently linger in an environment.
        if (!practiceOpen && process.env.VOICE_TRANSFER_BYPASS_HOURS === '1') {
          practiceOpen = true
          logger.warn({ accountId: account.id }, '[voice-agent] ⚠️ VOICE_TRANSFER_BYPASS_HOURS active — hours gate bypassed')
        }
      }
      // Message mode NEVER transfers — the team already failed to pick up.
      const transferToolName =
        !result.messageMode && result.action?.type === 'request_human' && transferNumber && practiceOpen
          ? findTransferTool(body)
          : null
      let reply = result.reply
      const needsPivot =
        (result.action?.type === 'request_human' && !transferToolName) ||
        // Backstop: a text-only connection promise with no transfer happening
        // (live call 2026-09-10: model said "connecting you" without action).
        (!transferToolName && CONNECT_PROMISE_RE.test(reply))
      if (needsPivot) {
        const priorPivots = await prisma.agentMessage.count({
          where: { conversationId: result.conversationId, role: 'assistant', action: { path: ['type'], equals: 'request_human' } },
        }).catch(() => 0)
        // Vary phrasing per repeated ask — never the identical sentence again.
        reply =
          transferNumber && !practiceOpen
            ? pivotLine(PIVOT_CLOSED, Math.max(0, priorPivots - 1))
            : pivotLine(PIVOT_GENERIC, Math.max(0, priorPivots - 1))
        logger.warn(
          {
            accountId: account.id,
            conversationId: result.conversationId,
            practiceOpen,
            hasNumber: Boolean(transferNumber),
            textOnlyPromise: result.action?.type !== 'request_human',
            priorPivots,
          },
          '[voice-agent] no transfer possible — pivoted to callback offer',
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
      return { reply, transferToolName, transferNumber, model }
    } catch (err) {
      // A dead engine must never drop the live call — speak a safe fallback.
      const code = err instanceof AgentTurnError ? err.code : 'engine-error'
      logger.error({ err, accountId: account.id, code }, '[voice-agent] turn failed — safe fallback spoken')
      return {
        reply: 'Sorry, I am having trouble right now. Please call the practice directly and the team will help you.',
        transferToolName: null,
        model,
      }
    }
    }

    // Duplicate-turn guard: an identical turn inside the window shares the
    // in-flight computation (one engine run, one persisted turn, one voice).
    const turnKey = `${account.id}|${key}|${message}`
    const cached = recentVoiceTurns.get(turnKey)
    if (cached && Date.now() - cached.at < DEDUP_WINDOW_MS) {
      logger.warn({ accountId: account.id, turnKey: turnKey.slice(0, 80) }, '[voice-agent] duplicate turn deduped')
      plan = await cached.promise
    } else {
      const promise = computeTurnPlan()
      recentVoiceTurns.set(turnKey, { at: Date.now(), promise })
      if (recentVoiceTurns.size > 500) {
        const cutoff = Date.now() - DEDUP_WINDOW_MS
        for (const [k, v] of recentVoiceTurns) if (v.at < cutoff) recentVoiceTurns.delete(k)
      }
      plan = await promise
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
    select: { phoneNumber: true },
  })
  // One-number design: dial the clinic's OWN AI number back — fresh CallSid,
  // and the initiation webhook swaps the greeting for the rescue apology.
  // No callerId attribute on <Dial>: Twilio's default presents the ORIGINAL
  // caller's number, which is the rescue-link primary key.
  const twiml = config?.phoneNumber
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${xmlEscape(config.phoneNumber)}</Dial></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, the team could not pick up just now. Please call back and I will take a message, or the team will see your missed call and get back to you.</Say><Hangup/></Response>`
  logger.info({ accountId: account.id, redial: Boolean(config?.phoneNumber) }, '[voice-agent] rescue TwiML served')
  return reply.header('Content-Type', 'text/xml').send(twiml)
}

/**
 * ElevenLabs conversation-initiation webhook (one-number rescue design):
 * called on EVERY inbound call before the agent speaks. Rescue calls (stamp/
 * phone matched) get the apology greeting override + a pre-created message-
 * mode conversation; normal calls get an empty override (standard greeting).
 * MUST answer fast — it runs inside the call-connection window.
 */
async function handleVoiceInit(
  request: FastifyRequest<{ Params: { secret: string }; Body: { caller_id?: string; conversation_id?: string; call_sid?: string } }>,
  reply: FastifyReply,
) {
  const { secret } = request.params
  if (!SECRET_RE.test(secret)) return reply.status(401).send({ error: 'unauthorized' })
  const account = await prisma.account.findUnique({ where: { voiceAgentSecret: secret }, select: { id: true } })
  if (!account) return reply.status(401).send({ error: 'unauthorized' })

  const body = request.body ?? {}
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null
  const callerRaw = typeof body.caller_id === 'string' ? body.caller_id : null
  const callerPhone = callerRaw && /[0-9]{6,}/.test(callerRaw.replace(/[^0-9]/g, '')) ? callerRaw : null

  let firstMessage: string | null = null
  if (conversationId) {
    firstMessage = await prepareRescueConversation(account.id, callerPhone, conversationId).catch((err) => {
      logger.error({ err, accountId: account.id }, '[voice-init] rescue preparation failed — standard greeting')
      return null
    })
  }
  logger.info(
    { accountId: account.id, rescue: Boolean(firstMessage), hasCaller: Boolean(callerPhone) },
    '[voice-init] initiation webhook served',
  )
  return reply.send({
    type: 'conversation_initiation_client_data',
    ...(firstMessage ? { conversation_config_override: { agent: { first_message: firstMessage } } } : {}),
  })
}

export async function voiceAgentRoutes(app: FastifyInstance) {
  // Twilio webhooks POST form-encoded bodies; without a parser Fastify 415s
  // BEFORE the handler (live finding 2026-09-10: rescue TwiML fetch died as
  // "application error"). Scoped to this plugin; the body itself is unused.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  )
  app.post('/agent/voice/:secret/chat/completions', handleVoiceCompletion)
  app.post('/agent/voice/:secret/v1/chat/completions', handleVoiceCompletion)
  // ElevenLabs conversation-initiation webhook (rescue greeting override).
  app.post('/agent/voice-init/:secret', handleVoiceInit)
  // Twilio webhooks may use GET or POST depending on config.
  app.post('/agent/voice-rescue-twiml/:secret', handleRescueTwiml)
  app.get('/agent/voice-rescue-twiml/:secret', handleRescueTwiml)
}
