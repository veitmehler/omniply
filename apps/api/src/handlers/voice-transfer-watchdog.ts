/**
 * Voice-transfer watchdog (.plans/voice-agent-elevenlabs plan; user decision
 * 2026-09-09): a conference transfer that nobody answers leaves the caller in
 * hold music FOREVER — ElevenLabs never returns to the agent without the
 * feature-gated call-screening, which clinic-owned accounts can't be assumed
 * to have. Universal fix: the number and both call legs live in OUR Twilio
 * subaccount, so 25s after we emit the transfer tool call this job checks the
 * subaccount for the still-ringing outbound leg and terminates it.
 *
 * What ElevenLabs does when the leg dies (resume agent → our continuation
 * speaks the callback offer / retry / nothing) is captured by the logs of the
 * first live test — the escalation gets tuned on that evidence.
 */
import { prisma } from '@omniply/shared'
import { logger } from '../lib/logger'
import { samePhone } from '../agent/voice-rescue'
import {
  endTwilioCall,
  getTwilioSubaccountToken,
  listConferenceParticipants,
  listConferences,
  listSubaccountCalls,
  redirectTwilioCall,
  twilioConfigured,
  type TwilioCallInfo,
  type TwilioParticipant,
} from '../lib/twilio'

export interface VoiceTransferWatchdogJobData {
  accountId: string
  transferNumber: string
  armedAtIso: string
  /** The engine conversation that requested the transfer (rescue linking). */
  conversationId?: string
}

/**
 * Fallback caller-leg discovery (live finding 2026-09-10): ElevenLabs mixes
 * its "conference" transfer at ITS media layer — there is often NO Twilio
 * Conference resource at all (which is also why hold music survives the dial
 * leg's death: it streams from ElevenLabs). The caller's leg is then just
 * the in-progress INBOUND call to the clinic's AI number. No-ambiguity rule:
 * exact from-number match against the source conversation's callerPhone,
 * else the single in-progress inbound call, else null (caller self-recovers
 * by calling back — the rescue stamp keeps working).
 */
export function findInboundCallerLeg(
  calls: TwilioCallInfo[],
  clinicNumber: string,
  sourceCallerPhone: string | null,
): string | null {
  const candidates = calls.filter(
    (c) => c.direction === 'inbound' && c.status === 'in-progress' && samePhone(c.to, clinicNumber),
  )
  if (candidates.length === 0) return null
  if (sourceCallerPhone) {
    const byPhone = candidates.filter((c) => samePhone(c.from, sourceCallerPhone))
    if (byPhone.length === 1) return byPhone[0].sid
  }
  return candidates.length === 1 ? candidates[0].sid : null
}

/**
 * Pure decision: the caller's leg — the OTHER participant in the conference
 * that contains the stuck dial leg. Deterministic under concurrent calls
 * (no time-window guessing).
 */
export function findCallerLeg(
  participantsByConference: { conferenceSid: string; participants: TwilioParticipant[] }[],
  stuckDialSid: string,
): string | null {
  for (const conf of participantsByConference) {
    if (!conf.participants.some((p) => p.call_sid === stuckDialSid)) continue
    const other = conf.participants.find((p) => p.call_sid !== stuckDialSid)
    return other?.call_sid ?? null
  }
  return null
}

const STUCK_STATUSES = new Set(['queued', 'initiated', 'ringing'])

/** Pure decision: the outbound transfer leg that is still unanswered. */
export function pickStuckTransferLeg(
  calls: TwilioCallInfo[],
  transferNumber: string,
  armedAtIso: string,
): TwilioCallInfo | null {
  const wanted = transferNumber.replace(/[^0-9]/g, '')
  // Suffix match tolerates country-code formatting drift ("+1829…" vs
  // "(829) …") while still requiring a real number-length overlap.
  const sameNumber = (to: string) => {
    const digits = to.replace(/[^0-9]/g, '')
    if (digits.length < 8 || wanted.length < 8) return digits === wanted
    return digits.endsWith(wanted) || wanted.endsWith(digits)
  }
  // Legs created shortly BEFORE the watchdog was armed count too (the dial
  // starts a beat before our tool-call response is fully processed).
  const cutoff = new Date(armedAtIso).getTime() - 60_000
  return (
    calls.find((c) => {
      if (!c.direction?.startsWith('outbound')) return false
      if (!STUCK_STATUSES.has(c.status)) return false
      if (!sameNumber(c.to ?? '')) return false
      const created = Date.parse(c.date_created)
      return Number.isNaN(created) || created >= cutoff
    }) ?? null
  )
}

function apiBase(): string {
  return (process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io').replace(/\/$/, '')
}

export async function voiceTransferWatchdogHandler(jobs: { data: VoiceTransferWatchdogJobData }[]): Promise<void> {
  for (const job of jobs) {
    const { accountId, transferNumber, armedAtIso, conversationId } = job.data
    try {
      if (!twilioConfigured()) {
        logger.warn({ accountId }, '[voice-watchdog] Twilio env missing — cannot inspect transfer leg')
        continue
      }
      const [config, account, sourceConversation] = await Promise.all([
        prisma.voiceAgentConfig.findUnique({
          where: { accountId },
          select: { twilioSubaccountSid: true, phoneNumber: true },
        }),
        prisma.account.findUnique({ where: { id: accountId }, select: { voiceAgentSecret: true } }),
        conversationId
          ? prisma.agentConversation.findUnique({ where: { id: conversationId }, select: { callerPhone: true } })
          : Promise.resolve(null),
      ])
      if (!config?.twilioSubaccountSid) {
        logger.warn({ accountId }, '[voice-watchdog] no Twilio subaccount on file')
        continue
      }
      const sub = {
        sid: config.twilioSubaccountSid,
        token: await getTwilioSubaccountToken(config.twilioSubaccountSid),
      }
      const calls = await listSubaccountCalls(sub)
      const stuck = pickStuckTransferLeg(calls, transferNumber, armedAtIso)
      if (!stuck) {
        logger.info({ accountId }, '[voice-watchdog] transfer leg answered or already ended — nothing to do')
        continue
      }

      // Locate the caller's leg BEFORE killing the dial leg (once killed, the
      // dial participant vanishes from the conference and the link is lost).
      // Attempt 1: real Twilio conference (some configurations). Attempt 2 —
      // the one that fires in practice: ElevenLabs mixes at ITS media layer
      // with no Conference resource, so the caller is simply the in-progress
      // inbound call to the clinic number.
      let callerLegSid: string | null = null
      let discovery = 'none'
      try {
        const conferences = await listConferences(sub)
        const withParticipants = await Promise.all(
          conferences.map(async (c) => ({
            conferenceSid: c.sid,
            participants: await listConferenceParticipants(sub, c.sid).catch(() => []),
          })),
        )
        callerLegSid = findCallerLeg(withParticipants, stuck.sid)
        if (callerLegSid) discovery = 'conference'
      } catch (err) {
        logger.warn({ err, accountId }, '[voice-watchdog] conference discovery failed — trying inbound-leg fallback')
      }
      if (!callerLegSid && config.phoneNumber) {
        callerLegSid = findInboundCallerLeg(calls, config.phoneNumber, sourceConversation?.callerPhone ?? null)
        if (callerLegSid) discovery = 'inbound-leg'
      }

      await endTwilioCall(sub, stuck.sid)
      logger.warn(
        { accountId, callSid: stuck.sid, status: stuck.status, callerLegSid, discovery },
        '[voice-watchdog] terminated unanswered transfer leg after timeout',
      )

      // Rescue: stamp the source conversation, then redirect the caller out
      // of the dead conference to the message agent (or the apology floor).
      if (conversationId) {
        await prisma.agentConversation
          .updateMany({
            where: { id: conversationId, rescuePendingAt: null },
            data: { rescuePendingAt: new Date() },
          })
          .catch((err) => logger.warn({ err, accountId, conversationId }, '[voice-watchdog] rescue stamp failed'))
      }
      if (callerLegSid && account?.voiceAgentSecret) {
        try {
          await redirectTwilioCall(sub, callerLegSid, `${apiBase()}/api/agent/voice-rescue-twiml/${account.voiceAgentSecret}`)
          logger.info({ accountId, callerLegSid }, '[voice-watchdog] caller redirected to rescue TwiML')
        } catch (err) {
          logger.error({ err, accountId, callerLegSid }, '[voice-watchdog] caller redirect failed — caller remains in conference')
        }
      } else {
        logger.warn(
          { accountId, hasCallerLeg: Boolean(callerLegSid), hasSecret: Boolean(account?.voiceAgentSecret) },
          '[voice-watchdog] no rescue redirect possible',
        )
      }
    } catch (err) {
      logger.error({ err, accountId }, '[voice-watchdog] failed (transfer leg may still be ringing)')
    }
  }
}
