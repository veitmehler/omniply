/**
 * Voice transport shim (.plans/voice-agent-elevenlabs.implementation-plan.md V1).
 *
 * ElevenLabs Agents in custom-LLM mode POSTs an OpenAI-compatible
 * chat-completions request (full call transcript each turn, SSE streaming
 * expected, system tools offered as OpenAI tool definitions). These pure
 * helpers translate between that wire shape and our turn engine:
 *
 *   request  → last user utterance + a stable visitorKey (conversation id
 *              from elevenlabs_extra_body when provisioning set it, with
 *              defensive fallbacks)
 *   response → the FILTERED engine reply streamed as OpenAI chunks; a
 *              request_human action becomes a transfer_to_number tool call.
 *
 * The engine runs to completion (all guardrails/post-filters on the whole
 * reply) BEFORE anything streams — we trade ~1s of latency for the guarantee
 * that no unfiltered text is ever spoken (plan V1 decision).
 */
import { createHash, randomBytes } from 'node:crypto'

interface OpenAiMessagePart {
  type?: string
  text?: string
}

export interface OpenAiMessage {
  role?: string
  content?: string | OpenAiMessagePart[] | null
}

export interface OpenAiToolDef {
  type?: string
  function?: { name?: string; description?: string; parameters?: unknown }
}

export interface VoiceCompletionBody {
  messages?: OpenAiMessage[]
  stream?: boolean
  model?: string
  tools?: OpenAiToolDef[]
  user?: string
  elevenlabs_extra_body?: Record<string, unknown>
}

/** Flatten an OpenAI message content field (string or parts array) to text. */
export function messageText(m: OpenAiMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join(' ')
      .trim()
  }
  return ''
}

/** The utterance to answer: the last user-role message in the transcript. */
export function lastUserMessage(body: VoiceCompletionBody): string | null {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      const text = messageText(messages[i]).trim()
      return text || null
    }
  }
  return null
}

const KEY_SAFE = /[^A-Za-z0-9_-]/g

/**
 * Stable per-call visitor key. Priority:
 *  1. CALL_ID parsed from the system message — provisioning writes
 *     `CALL_ID={{system__conversation_id}}` into the agent's stub prompt and
 *     ElevenLabs interpolates it per call (the reliable phone-call channel;
 *     elevenlabs_extra_body only exists for SDK-initiated sessions)
 *  2. conversation_id from elevenlabs_extra_body (SDK sessions)
 *  3. caller_id from elevenlabs_extra_body (hashed — phone numbers are PII)
 *  4. the OpenAI `user` field
 *  5. hash of the transcript's opening exchange (stable within one call
 *     because history is append-only; collides across identical openers,
 *     which the engine's turn-capped rollover tolerates)
 */
/**
 * The caller's phone number, interpolated into the stub prompt as
 * CALLER={{system__caller_id}}. Null when withheld/anonymous or when the
 * template arrived un-interpolated. Primary key for rescue-context linking
 * (.plans/voice-rescue-agent.implementation-plan.md).
 */
export function voiceCallerPhone(body: VoiceCompletionBody): string | null {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((m) => m.role === 'system')
  if (!system) return null
  const m = /CALLER=(\+?[0-9][0-9 ()-]{5,24})/.exec(messageText(system))
  if (!m) return null
  const digits = m[1].replace(/[^0-9]/g, '')
  if (digits.length < 6) return null
  return m[1].startsWith('+') ? `+${digits}` : digits
}

export function voiceVisitorKey(body: VoiceCompletionBody): { key: string; source: string } {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((m) => m.role === 'system')
  const callId = system ? /CALL_ID=([A-Za-z0-9_-]{6,64})/.exec(messageText(system)) : null
  if (callId) {
    return { key: `el-${callId[1]}`.slice(0, 64), source: 'call_id' }
  }
  const extra = body.elevenlabs_extra_body ?? {}
  const conv = extra.conversation_id ?? extra.conversationId
  if (typeof conv === 'string' && conv.trim()) {
    return { key: `el-${conv.trim().replace(KEY_SAFE, '')}`.slice(0, 64), source: 'conversation_id' }
  }
  const caller = extra.caller_id ?? extra.callerId
  if (typeof caller === 'string' && caller.trim()) {
    const h = createHash('sha256').update(caller.trim()).digest('hex').slice(0, 24)
    return { key: `elc-${h}`, source: 'caller_id' }
  }
  if (typeof body.user === 'string' && body.user.trim()) {
    return { key: `elu-${body.user.trim().replace(KEY_SAFE, '')}`.slice(0, 64), source: 'user' }
  }
  const opener = messages
    .slice(0, 2)
    .map((m) => `${m.role}:${messageText(m)}`)
    .join('|')
  const h = createHash('sha256').update(opener).digest('hex').slice(0, 24)
  return { key: `elh-${h}`, source: 'opener-hash' }
}

/**
 * Tool-continuation detection. After we emit a tool call (transfer), the
 * platform calls back with the tool result appended, expecting a SHORT
 * continuation — not a re-run of the turn (live call 2026-09-09: the same
 * "connecting you now" was spoken three times while the transfer dialed).
 * Returns the tool-result text when the request is a continuation, null when
 * it is a normal visitor turn.
 */
export function toolContinuation(body: VoiceCompletionBody): string | null {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i]?.role
    if (role === 'user') return null
    if (role === 'tool') return messageText(messages[i]) || ''
    if (role === 'assistant' && (messages[i] as { tool_calls?: unknown }).tool_calls) return ''
  }
  return null
}

/** Does a tool result read like a failed/unanswered transfer? */
export function transferLooksFailed(toolResult: string): boolean {
  return /fail|no.?answer|busy|unavailable|not available|error|declin|timeout|cancel/i.test(toolResult)
}

/** Find the ElevenLabs transfer system tool among the offered tool defs. */
export function findTransferTool(body: VoiceCompletionBody): string | null {
  const tools = Array.isArray(body.tools) ? body.tools : []
  const t = tools.find((x) => x?.function?.name?.includes('transfer_to_number'))
  return t?.function?.name ?? null
}

// ── OpenAI response encoding ────────────────────────────────────────────────

export interface VoiceReplyPlan {
  reply: string
  /** Non-null → emit this transfer tool call. */
  transferToolName: string | null
  /** Destination for the transfer (required arg); null skips the call. */
  transferNumber?: string | null
  model: string
}

function completionId(): string {
  return `chatcmpl-${randomBytes(12).toString('hex')}`
}

/**
 * ElevenLabs' transfer_to_number requires (live offered schema, logged
 * 2026-09-09) `transfer_number` + `agent_message`; omitting them (we
 * previously sent only {reason}) makes the platform reject the call and
 * re-prompt the LLM — the root cause of the "connecting you now" spoken 3×.
 * The spoken-while-dialing line goes in `system__message_to_speak` (the LIVE
 * schema's field — the docs' `client_message` does not exist there), never in
 * streamed content (which would double it).
 */
function toolCallPayload(name: string, plan: VoiceReplyPlan) {
  return [
    {
      index: 0,
      id: `call_${randomBytes(8).toString('hex')}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify({
          transfer_number: plan.transferNumber ?? '',
          system__message_to_speak: plan.reply || 'Connecting you to the team now.',
          agent_message: 'Caller asked to speak with a person — transferring from the AI assistant.',
          reason: 'Caller asked for a human',
        }),
      },
    },
  ]
}

/** Split into spoken chunks (sentences) so TTS can start on the first one. */
export function sentenceChunks(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim())
  return parts.length > 0 ? parts.map((p, i) => (i < parts.length - 1 ? `${p} ` : p)) : [text]
}

/** Non-streaming completion JSON (stream:false fallback). */
export function buildCompletion(plan: VoiceReplyPlan): Record<string, unknown> {
  const toolCalls = plan.transferToolName ? toolCallPayload(plan.transferToolName, plan) : undefined
  return {
    id: completionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: plan.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          // On a transfer the spoken line rides in the tool's client_message,
          // so content is empty to avoid the platform speaking it twice.
          content: toolCalls ? '' : plan.reply,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
  }
}

/** SSE frames for the streaming response, ending with [DONE]. */
export function buildStreamFrames(plan: VoiceReplyPlan): string[] {
  const id = completionId()
  const created = Math.floor(Date.now() / 1000)
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: plan.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`

  const frames: string[] = [chunk({ role: 'assistant' }, null)]
  if (plan.transferToolName) {
    // Transfer: NO spoken content (client_message inside the tool carries the
    // single spoken line); just the tool call so the platform executes once.
    frames.push(chunk({ tool_calls: toolCallPayload(plan.transferToolName, plan) }, null))
    frames.push(chunk({}, 'tool_calls'))
  } else {
    for (const sentence of sentenceChunks(plan.reply)) {
      frames.push(chunk({ content: sentence }, null))
    }
    frames.push(chunk({}, 'stop'))
  }
  frames.push('data: [DONE]\n\n')
  return frames
}
