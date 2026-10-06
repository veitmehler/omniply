/**
 * Chat-agent turn engine (.plans/chat-agent-v1.implementation-plan.md §2/§4).
 *
 * One provider-agnostic jsonMode LLM call per turn, fenced deterministically:
 *   pre-filters (red flags, turn cap, abuse ceiling — no LLM) →
 *   engine call (admin-selected model via the agent_system prompt row) →
 *   post-filter (forbidden-pattern scan → safe fallback + flag) →
 *   whitelist-validated action.
 *
 * Budget (decision G): $1.50/day included per account; over budget the
 * visitor experience continues and overage accrues in LLMUsage (source
 * 'agent') for surcharge billing. Only the ~10× abuse ceiling hard-stops.
 */
import { prisma } from '@omniply/shared'
import { resolvePromptByKey } from '../lib/prompt-resolver'
import { getLLMAdapter } from '../article-pipeline/llm/factory'
import { cleanAndParseJSON } from '../article-pipeline/output-cleaner'
import { recordLLMUsage } from '../lib/llm-usage'
import { fillPrompt } from '../newsletter/llm'
import { logger } from '../lib/logger'
import { agentContextForAccount, openStatusFor, type AgentContext } from './context'
import {
  MAX_MESSAGE_CHARS,
  MAX_VISITOR_TURNS,
  checkRedFlags,
  checkReply,
  redFlagReply,
  safeFallbackReply,
  stripPunctuationDashes,
} from './guardrails'
import { validateAction, type AgentAction } from './tools'
import { executeAgentAction } from './actions'
import { knownDetailsFor, knownDetailsPromptBlock } from './known'
import { bookingInfoFor, type BookingInfo } from './booking'

export const INCLUDED_DAILY_BUDGET_USD = 1.5
export const ABUSE_CEILING_USD = 15

/** Demo-line hardening (sweep Part 4b): calls per caller per day on PUBLIC demo numbers. */
export const DEMO_DAILY_CALL_CAP = 4

function demoAccountIds(): Set<string> {
  return new Set(
    (process.env.DEMO_BOOKING_CLEANUP_ACCOUNT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export interface TurnInput {
  accountId: string
  conversationId?: string | null
  visitorKey: string
  message: string
  /** 'web' (widget, default), 'ghl-dm' (social DM), or 'voice' (phone via ElevenLabs custom-LLM). */
  channel?: 'web' | 'ghl-dm' | 'voice'
  /** DM transport: the GHL contact behind the thread (contact exists from birth). */
  ghlContactId?: string | null
  /** Voice: 'message' = rescue/message-taking agent posture (no transfers). */
  voiceMode?: 'standard' | 'message'
  /** Voice: caller's phone (parsed from CALLER=); stored for rescue linking. */
  callerPhone?: string | null
  /** Rescue call: prior-conversation transcript block appended to knownDetails. */
  seedKnownBlock?: string | null
  /** Rescue call: converge onto the source conversation's GHL contact. */
  seedGhlContactId?: string | null
  /** Rescue call: the conversation this one continues (audit + note context). */
  rescueSourceId?: string | null
  /** Voice: the clinic's GHL location can text links (latched false on a
   *  failed send — the overlay falls back to email delivery). */
  smsAvailable?: boolean
}

export interface TurnResult {
  conversationId: string
  reply: string
  action: AgentAction | null
  /** Echoed so the widget can render the booking card without another call. */
  bookingUrl: string | null
  guideTitle: string | null
  /** Drive link for the guide card (capture_contact / send_guide_link). */
  guideLink: string | null
  ended: string | null
  /** Voice: this conversation is a rescue call (message-taking posture) —
   *  the transport must never offer a transfer. */
  messageMode: boolean
}

interface ModelTurn {
  reply?: unknown
  action?: unknown
}

async function agentSpendTodayUsd(ownerUserId: string): Promise<number> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const agg = await prisma.lLMUsage.aggregate({
    _sum: { cost: true },
    where: { userId: ownerUserId, source: 'agent', createdAt: { gte: dayStart } },
  })
  return agg._sum.cost ?? 0
}

async function persistTurn(opts: {
  conversationId: string
  visitorText: string
  reply: string
  action: AgentAction | null
  filtered: boolean
  flagReason?: string | null
  endedReason?: string | null
  costUsd?: number
}): Promise<void> {
  await prisma.$transaction([
    prisma.agentMessage.create({
      data: { conversationId: opts.conversationId, role: 'visitor', content: opts.visitorText },
    }),
    prisma.agentMessage.create({
      data: {
        conversationId: opts.conversationId,
        role: 'assistant',
        content: opts.reply,
        action: opts.action ?? undefined,
        filtered: opts.filtered,
      },
    }),
    prisma.agentConversation.update({
      where: { id: opts.conversationId },
      data: {
        turnCount: { increment: 1 },
        ...(opts.costUsd ? { costUsd: { increment: opts.costUsd } } : {}),
        ...(opts.flagReason ? { flagged: true, flagReason: opts.flagReason } : {}),
        ...(opts.endedReason ? { endedReason: opts.endedReason } : {}),
      },
    }),
  ])
}

function guideFor(ctx: AgentContext, action: AgentAction | null): { title: string | null; link: string | null } {
  if (!action) return { title: null, link: null }
  const slug =
    action.type === 'offer_guide' || action.type === 'send_guide_link'
      ? action.slug
      : action.type === 'capture_contact'
        ? action.guideSlug
        : null
  const g = ctx.guides.find((x) => x.slug === slug)
  // User-locked delivery rule: a captured guide arrives BY EMAIL ONLY — the
  // in-chat card renders solely for visitors who declined the email ask
  // (send_guide_link), otherwise decliners would get nothing at all.
  const linkable = action.type === 'send_guide_link'
  return { title: g?.title ?? null, link: linkable ? (g?.driveLink ?? null) : null }
}

/**
 * Run one visitor turn. Throws AgentTurnError('bad-conversation') when the
 * conversationId doesn't belong to this account+visitor.
 */
export class AgentTurnError extends Error {
  constructor(public code: 'bad-conversation' | 'no-context') {
    super(code)
  }
}

export async function runAgentTurn(input: TurnInput): Promise<TurnResult> {
  const ctx = await agentContextForAccount(input.accountId)
  if (!ctx) throw new AgentTurnError('no-context')

  const message = input.message.trim().slice(0, MAX_MESSAGE_CHARS)

  // Load or create the conversation (ownership enforced).
  let conversation = input.conversationId
    ? await prisma.agentConversation.findUnique({ where: { id: input.conversationId } })
    : null
  if (input.conversationId && (!conversation || conversation.accountId !== input.accountId || conversation.visitorKey !== input.visitorKey)) {
    throw new AgentTurnError('bad-conversation')
  }
  const channel = input.channel ?? 'web'

  // DM threads and phone calls are id-less on the caller side: find the
  // latest conversation for this visitor instead of requiring the transport
  // to track ids across webhook calls.
  if (!conversation && (channel === 'ghl-dm' || channel === 'voice')) {
    conversation = await prisma.agentConversation.findFirst({
      where: { accountId: input.accountId, visitorKey: input.visitorKey, channel },
      orderBy: { createdAt: 'desc' },
    })
    // Turn-capped DM thread: roll over to a fresh conversation (cost control
    // per conversation without ever bricking the social thread).
    if (conversation && conversation.turnCount >= MAX_VISITOR_TURNS) conversation = null
  }
  conversation ??= await prisma.agentConversation.create({
    data: {
      accountId: input.accountId,
      visitorKey: input.visitorKey,
      channel,
      ...(input.ghlContactId ? { ghlContactId: input.ghlContactId } : {}),
      // Rescue seeding: contact convergence + audit link + caller phone
      // (only set on CREATE — an ongoing conversation keeps its identity).
      ...(input.seedGhlContactId && !input.ghlContactId ? { ghlContactId: input.seedGhlContactId } : {}),
      ...(input.rescueSourceId ? { rescueSourceId: input.rescueSourceId } : {}),
      ...(input.callerPhone ? { callerPhone: input.callerPhone } : {}),
      ...(input.seedKnownBlock ? { rescueContext: input.seedKnownBlock } : {}),
    },
  })

  // Demo-line call cap (sweep Part 4b): the demo number is PUBLIC on the
  // X-Ray results page — the same caller gets a few calls a day, then a
  // polite goodbye instead of LLM/ElevenLabs spend. Voice conversations are
  // per-call (visitorKey = EL conversation id), so counting rows = calls.
  if (
    channel === 'voice' &&
    input.callerPhone &&
    demoAccountIds().has(input.accountId) &&
    conversation.turnCount === 0
  ) {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const callsToday = await prisma.agentConversation.count({
      where: { accountId: input.accountId, channel: 'voice', callerPhone: input.callerPhone, createdAt: { gte: dayStart } },
    })
    if (callsToday > DEMO_DAILY_CALL_CAP) {
      const reply =
        'Thanks for trying the demo again! To keep this line free for other visitors, it allows a few calls per caller each day. Everything else about Omniply is at omniply dot io, or call again tomorrow. Goodbye!'
      await persistTurn({ conversationId: conversation.id, visitorText: message, reply, action: null, filtered: false, endedReason: 'demo-cap' })
      logger.info({ accountId: input.accountId, callsToday }, '[agent] demo call cap reached')
      return { conversationId: conversation.id, reply, action: null, bookingUrl: ctx.bookingUrl, guideTitle: null, guideLink: null, messageMode: false, ended: 'demo-cap' }
    }
  }
  if (conversation.endedReason === 'demo-cap') {
    const reply = 'This demo line allows a few calls per caller each day. See omniply dot io, or call again tomorrow. Goodbye!'
    await persistTurn({ conversationId: conversation.id, visitorText: message, reply, action: null, filtered: false })
    return { conversationId: conversation.id, reply, action: null, bookingUrl: ctx.bookingUrl, guideTitle: null, guideLink: null, messageMode: false, ended: 'demo-cap' }
  }

  // Message mode: set by the initiation webhook pre-creating the rescue
  // conversation (one-number design), or explicitly by the transport.
  const messageMode = (channel === 'voice' && Boolean(conversation.rescueSourceId)) || input.voiceMode === 'message'

  const base = {
    conversationId: conversation.id,
    bookingUrl: ctx.bookingUrl,
    guideTitle: null as string | null,
    guideLink: null as string | null,
    messageMode,
  }

  // ── Pre-filters (no LLM) ─────────────────────────────────────────────────
  if (channel === 'web' && conversation.turnCount >= MAX_VISITOR_TURNS) {
    const reply = `We've covered a lot! For anything more, the ${ctx.practiceName} front desk is the best next step${ctx.phone ? `: ${ctx.phone}` : ''}.`
    await persistTurn({ conversationId: conversation.id, visitorText: message, reply, action: null, filtered: false, endedReason: 'turn-cap' })
    return { ...base, reply, action: null, ended: 'turn-cap' }
  }

  const redFlag = checkRedFlags(message)
  if (redFlag) {
    const reply = redFlagReply(redFlag, ctx.countryCode)
    await persistTurn({
      conversationId: conversation.id,
      visitorText: message,
      reply,
      action: null,
      filtered: false,
      flagReason: `red-flag:${redFlag}`,
      endedReason: 'red-flag',
    })
    logger.warn({ accountId: input.accountId, conversationId: conversation.id, redFlag }, '[agent] red-flag interception')
    return { ...base, reply, action: null, ended: 'red-flag' }
  }

  const spentToday = await agentSpendTodayUsd(ctx.ownerUserId)
  if (spentToday >= ABUSE_CEILING_USD) {
    const reply = `The assistant is taking a break. Please call ${ctx.practiceName}${ctx.phone ? ` on ${ctx.phone}` : ''} or leave your details and the team will get back to you.`
    await persistTurn({ conversationId: conversation.id, visitorText: message, reply, action: null, filtered: false, endedReason: 'abuse-ceiling' })
    logger.warn({ accountId: input.accountId, spentToday }, '[agent] abuse ceiling reached — hard stop')
    return { ...base, reply, action: null, ended: 'abuse-ceiling' }
  }

  // ── Engine call ──────────────────────────────────────────────────────────
  const [sys, frame] = await Promise.all([
    resolvePromptByKey('agent_system', { vertical: ctx.vertical }),
    resolvePromptByKey('agent_user_frame', { vertical: ctx.vertical }),
  ])
  if (!sys?.isActive || !frame?.isActive) throw new AgentTurnError('no-context')

  const historyRows = await prisma.agentMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { role: true, content: true },
  })
  const history = historyRows
    .reverse()
    .map((m) => `${m.role === 'visitor' ? 'Visitor' : 'Assistant'}: ${m.content}`)
    .join('\n')

  const open = openStatusFor(ctx)
  const openStatus = open.known
    ? [`Local time at the practice: ${open.localTime}.`, open.verdict, open.todayLine ? `Today's hours: ${open.todayLine}` : null]
        .filter(Boolean)
        .join(' ')
    : 'Not computed — rely on WEEKLY HOURS if present, otherwise the front desk confirms hours.'

  const known = await knownDetailsFor(conversation.id)

  // Direct booking (Part 4a): voice standard-mode only in v1. Real free
  // slots fetched server-side; disabled (empty) keeps callback flow intact.
  const booking: BookingInfo =
    channel === 'voice' && !messageMode
      ? await bookingInfoFor(input.accountId, ctx.ownerUserId)
      : { mode: 'off', bookable: false, slots: [] }
  const groupedSlotLines = (): string[] => {
    const lines: string[] = []
    let day = ''
    for (const s of booking.slots) {
      if (s.dayLabel !== day) {
        day = s.dayLabel
        lines.push(`${day}:`)
      }
      lines.push(`  ${s.startIso} = ${s.timeLabel}`)
    }
    return lines
  }
  const bookingBlock = booking.bookable
    ? [
        'DIRECT BOOKING IS AVAILABLE ON THIS CALL. The complete list of bookable times (the raw value before each time is what you attach — the time is what you say):',
        ...groupedSlotLines(),
        'When the caller wants an appointment: make sure you have their name and number first (reuse details already known; read a new number back digit by digit). Offer AT MOST THREE times in one reply, each at a DIFFERENT hour, spread across what is available (for example one morning, one midday, one late afternoon) — more than three spoken times in a row is impossible to follow on the phone, and NEVER read the whole list. When they ask about a specific time or day, answer just for that: offer it if listed, otherwise the nearest listed time, said plainly ("the closest I have is four o\'clock"). When they choose, attach book_appointment with slotStart set to the EXACT raw value for that time plus their name and phone, and confirm it aloud in the same reply ("You are booked for Tuesday, October sixth at ten A M — the team will see you then.").',
        'NEVER invent, accept, or imply a time that is not in the list. Only when nothing listed suits the caller: offer a callback instead (request_callback) with their preferred time in their own words.',
      ].join('\n')
    : booking.mode === 'advisory-gcal' && booking.slots.length
      ? [
          'AVAILABILITY GUIDANCE — ADVISORY ONLY (you CANNOT book on this call). Times currently visible on the practice calendar (speak the time, never the raw value):',
          ...groupedSlotLines(),
          'When the caller asks about times: share AT MOST THREE of these, each at a different hour — and ALWAYS with this caveat, in your own natural words: you can currently see availability at those times, but the front desk may have recently booked one of them, so they should open the booking link you are sending, confirm the available times there, and book the appointment right on that page at their convenience. Then attach send_booking_link (texted on this call).',
          'NEVER present these times as guaranteed or "booked", NEVER attach book_appointment, and never skip the caveat. If the caller cannot use the link, take a callback instead (request_callback) with their preferred time in their own words.',
        ].join('\n')
      : booking.mode === 'patterns' && ctx.availabilityPatterns
        ? [
            'AVAILABILITY GUIDANCE — GENERAL PATTERNS ONLY (you cannot see the calendar and CANNOT book on this call). The practice describes its typical availability as:',
            `  ${ctx.availabilityPatterns.slice(0, 500)}`,
            'Share this ONLY as a general pattern in your own words ("we usually have..."), NEVER as specific times or dates, then attach send_booking_link so they can see the real times and book there — or take a callback (request_callback).',
          ].join('\n')
        : null

  const vars = {
    practiceName: ctx.practiceName,
    knowledge: ctx.knowledge,
    openStatus,
    // Rescue calls carry the failed-transfer conversation's transcript as an
    // extra known-details block (per-conversation layer, never the cached
    // KB). Read from the ROW (persisted at create) so turns 2+ keep it —
    // the pending stamp behind seedKnownBlock is consume-once.
    knownDetails: [knownDetailsPromptBlock(known), conversation.rescueContext?.trim() || input.seedKnownBlock?.trim() || null]
      .filter(Boolean)
      .join('\n\n'),
    channelStyle:
      channel === 'ghl-dm'
        ? [
            '=== CHANNEL: SOCIAL DM (Facebook/Instagram) ===',
            'Replies MUST be 1 to 3 short sentences. No markdown, no headers, no bullet lists. Links pasted as plain URLs.',
            'Guides: when the visitor wants a guide, attach send_guide_link IMMEDIATELY. Never ask for an email address; the link arrives right here in the chat.',
            'Human handoff: if the visitor asks for a human, a real person, or to stop talking to a bot, attach request_human and say a team member will take over this conversation shortly.',
          ].join('\n')
        : channel === 'voice' && messageMode
          ? [
              '=== CHANNEL: PHONE CALL (live voice) — MESSAGE-TAKING MODE ===',
              'You are SPEAKING to a caller whose transfer to the practice team was NOT answered. Everything you write is read aloud by text-to-speech.',
              'The call already opened with an apology that the team could not pick up — and when their details were already known, the opening ALREADY offered a callback on their number. Do NOT greet or apologize again, and NEVER ask for information present in KNOWN VISITOR DETAILS or the earlier-call context: if they confirm the offered number, attach request_callback with it immediately.',
              'Mission order: (1) capture a callback — if KNOWN VISITOR DETAILS or the earlier-call context already contain their name and number, CONFIRM those instead of re-asking ("Shall the team call you back on the number ending in ...?"), then attach request_callback. (2) After the callback is arranged, answer any further questions normally using the practice information.',
              input.smsAvailable
                ? 'Replies MUST be 1 to 2 short conversational sentences. No markdown, no lists, no URLs, no emoji. NEVER read a web address aloud. Guides and the booking link can be TEXTED: confirm the number first (if KNOWN VISITOR DETAILS has one, offer it; otherwise ask and read it back digit by digit), then attach send_guide_link or send_booking_link WITH that number in the phone field. Email via capture_contact remains the alternative if they prefer.'
                : 'Replies MUST be 1 to 2 short conversational sentences. No markdown, no lists, no URLs, no emoji. NEVER read a web address aloud and NEVER promise to text or SMS anything — texting is unavailable on this call. Guides go BY EMAIL (ask for the address, attach capture_contact); booking is by phone number or callback.',
              'NEVER offer to transfer or connect the caller to a person on this call — the team already did not pick up. If they insist on a human, explain the team is unavailable right now and the fastest option is a callback message.',
              'Callbacks: confirm the phone number by reading it back digit by digit before attaching request_callback. Ask what time works best for the call back BEFORE confirming — accept a clock time or a window, repeat it back, and put their words in the preferredTime field of request_callback. Never offer a coarse either-or like morning-or-afternoon yourself; if they have no preference, proceed without one.',
              'NEVER repeat a sentence you have already said this call. If asked whether you are a real person, answer honestly that you are the AI assistant.',
            ].join('\n')
        : channel === 'voice'
          ? [
              '=== CHANNEL: PHONE CALL (live voice) ===',
              'You are SPEAKING to a caller. Everything you write is read aloud by text-to-speech.',
              'Replies MUST be 1 to 2 short conversational sentences. No markdown, no lists, no URLs, no emoji, no symbols. Spell nothing out in formatting — speak it.',
              ...(bookingBlock ? [bookingBlock] : []),
              input.smsAvailable
                ? 'NEVER read a web address aloud. Guides and the booking link can be TEXTED: confirm the number first (offer the one in KNOWN VISITOR DETAILS when present; otherwise ask and read it back digit by digit), then attach send_guide_link or send_booking_link WITH that number in the phone field. Email via capture_contact remains the alternative. When BOOKING says no online booking, book by phone number or callback.'
                : 'NEVER read a web address aloud, and NEVER promise to text or SMS anything — texting is unavailable on this call. Guides: offer delivery BY EMAIL (ask for their email address and attach capture_contact). Booking: when BOOKING says online booking is available, offer to email the link; otherwise give the practice phone number naturally or arrange a callback.',
              'The call ALREADY OPENED with a greeting that named the practice, disclosed you are its AI assistant with recorded calls, and asked who is calling. NEVER greet again, never re-introduce yourself, never repeat the practice name unprompted. If asked whether you are a real person, answer honestly that you are the AI assistant. Never claim to be a person, even in a familiar voice.',
              [
                'INTAKE (first exchanges of the call): when the caller gives their name, thank them BY NAME and in that same reply handle the disconnect number:',
                input.callerPhone
                  ? `say "In case we get cut off, I will have the team use the number you are calling from, ${input.callerPhone.replace(/[^0-9]/g, '').split('').join(' ')} — does that work?". If they confirm, attach intake_details with their name and the number ${input.callerPhone}. If they give a different number instead, read the new one back digit by digit and attach intake_details with that one.`
                  : 'ask "In case we get disconnected, what is the best number for the team to call you back?" — read the number they give back digit by digit, and attach intake_details with their name and number.',
                'ONE attempt only: if the caller skips the name or declines a number, say "no problem" and help them anyway — NEVER ask again and NEVER make help conditional on their details. If they lead with a question instead of a name, just answer it; you may fold the intake into a later natural moment, at most once.',
                'intake_details is silent bookkeeping — never tell the caller they have been "saved" or "added to a system". Attach it ONCE, the first time both name and number are known; never re-attach it on later turns.',
                'When the caller merely confirms something ("yes", "that is right"), continue from where the conversation stood — do not re-ask how you can help or what brings them in.',
              ].join('\n'),
              'NEVER repeat a sentence you have already said this call, and do not end replies with recurring offers like "what can I help you with" — at most once per call, otherwise just answer. Vary acknowledgements too: never open two replies with the same phrase (one "I hear you" per call, maximum).',
              'Human handoff: if the caller asks for a human, a real person, the front desk, or a staff member, attach request_human and say "Of course — connecting you to the team now." Do not argue or ask why.',
              'If the caller mentions the team did not pick up or the transfer failed, apologize briefly and offer to take a callback message (request_callback).',
              'Callbacks: confirm the phone number by reading it back digit by digit before attaching request_callback. Ask what time works best for the call back BEFORE confirming — accept a clock time or a window, repeat it back, and put their words in the preferredTime field of request_callback. Never offer a coarse either-or like morning-or-afternoon yourself; if they have no preference, proceed without one.',
            ].join('\n')
          : [
              '=== CHANNEL: WEBSITE CHAT ===',
              'Replies MUST be 1 to 3 short sentences. No markdown, no headers, no bullet lists.',
              'Phone numbers are ALWAYS written as plain digits with hyphens, like 480-962-6011. Never spell them out in words and never replace the hyphens — style rules about dashes do not apply to phone numbers.',
              'Callbacks: before attaching request_callback, gather their name, the best number, AND the best time for the call back. Ask for a concrete time ("What time works best for the call back?") and accept whatever precision they give — a clock time, "tomorrow morning", a weekday — putting their words verbatim in the preferredTime field. Never offer a coarse either-or like morning-or-afternoon yourself; if they have no preference, proceed without one.',
              'Names: when the visitor gives a full name, keep the FULL name in action fields — never shorten it to just the first name.',
            ].join('\n'),
    guides: ctx.guides.map((g) => `${g.slug} — ${g.title}`).join('\n') || '(none)',
    history: history || '(first message)',
    message,
  }

  const adapter = getLLMAdapter(sys.defaultProvider)
  let reply: string | null = null
  let rawAction: unknown = null
  let costUsd = 0

  for (let attempt = 1; attempt <= 2 && reply === null; attempt++) {
    try {
      const response = await adapter.call({
        systemPrompt: fillPrompt(sys.userPrompt, vars),
        userPrompt: fillPrompt(frame.userPrompt, vars),
        model: sys.defaultModel,
        temperature: 0.4,
        maxTokens: sys.maxTokens ?? 700,
        jsonMode: true,
      })
      costUsd += response.cost
      await recordLLMUsage(ctx.ownerUserId, 'agent', response)
      const { data } = cleanAndParseJSON(response.content)
      const turn = data as ModelTurn
      if (typeof turn.reply === 'string' && turn.reply.trim()) {
        reply = turn.reply.trim().slice(0, 1200)
        rawAction = turn.action ?? null
      }
    } catch (err) {
      logger.warn({ err, accountId: input.accountId, attempt }, '[agent] engine call failed')
    }
  }

  let filtered = false
  let flagReason: string | null = null
  let action: AgentAction | null = null

  if (reply !== null) reply = stripPunctuationDashes(reply)

  if (reply === null) {
    reply = `Sorry, I'm having a moment. ${ctx.phone ? `The front desk can help right away on ${ctx.phone}.` : 'Please try again in a minute or contact the practice directly.'}`
  } else {
    const verdict = checkReply(reply)
    if (!verdict.ok) {
      logger.warn({ accountId: input.accountId, conversationId: conversation.id, reason: verdict.reason }, '[agent] post-filter replaced reply')
      reply = safeFallbackReply(ctx.practiceName, ctx.phone)
      filtered = true
      flagReason = `post-filter:${verdict.reason}`
    } else {
      action = validateAction(rawAction, {
        guideSlugs: ctx.guides.map((g) => g.slug),
        bookingAvailable: Boolean(ctx.bookingUrl),
        hasContact: Boolean(conversation.ghlContactId),
        // book_appointment validates only in direct modes (Tier 1).
        offeredSlots: booking.bookable ? booking.slots.map((s) => s.startIso) : [],
      })
      // A dropped action means the reply may promise something that never
      // executed (e.g. "the guide is on its way") — flag it so the transcript
      // surfaces in admin review instead of failing invisibly.
      const attempted = (rawAction as { type?: unknown } | null)?.type
      if (rawAction && !action && typeof attempted === 'string') {
        flagReason = `action-dropped:${attempted}`
        logger.warn({ accountId: input.accountId, conversationId: conversation.id, attempted }, '[agent] model action failed validation and was dropped')
      }
    }
  }

  await persistTurn({ conversationId: conversation.id, visitorText: message, reply, action, filtered, flagReason, costUsd })

  // Execute server-side effects (GHL contact/tags/note, Drive grants) AFTER
  // the turn is persisted — never throws, failures alert + flag.
  if (action) await executeAgentAction(ctx, conversation.id, action)

  if (spentToday + costUsd >= INCLUDED_DAILY_BUDGET_USD && spentToday < INCLUDED_DAILY_BUDGET_USD) {
    logger.warn({ accountId: input.accountId, spentToday: spentToday + costUsd }, '[agent] included daily budget crossed — overage accruing')
    const { sendFailureAlert } = await import('../lib/alerts')
    await sendFailureAlert({
      errorType: 'agent-budget-crossed',
      message: `Chat agent crossed the $${INCLUDED_DAILY_BUDGET_USD}/day included budget for account ${input.accountId} (spent today: $${(spentToday + costUsd).toFixed(2)}). Usage continues; overage accrues for surcharge billing (decision G). Hard stop only at $${ABUSE_CEILING_USD}.`,
      context: { accountId: input.accountId },
    }).catch(() => {})
  }

  const guide = guideFor(ctx, action)
  return { ...base, reply, action, guideTitle: guide.title, guideLink: guide.link, ended: null }
}
