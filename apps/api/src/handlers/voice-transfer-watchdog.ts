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
import {
  endTwilioCall,
  getTwilioSubaccountToken,
  listSubaccountCalls,
  twilioConfigured,
  type TwilioCallInfo,
} from '../lib/twilio'

export interface VoiceTransferWatchdogJobData {
  accountId: string
  transferNumber: string
  armedAtIso: string
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

export async function voiceTransferWatchdogHandler(jobs: { data: VoiceTransferWatchdogJobData }[]): Promise<void> {
  for (const job of jobs) {
    const { accountId, transferNumber, armedAtIso } = job.data
    try {
      if (!twilioConfigured()) {
        logger.warn({ accountId }, '[voice-watchdog] Twilio env missing — cannot inspect transfer leg')
        continue
      }
      const config = await prisma.voiceAgentConfig.findUnique({
        where: { accountId },
        select: { twilioSubaccountSid: true },
      })
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
      await endTwilioCall(sub, stuck.sid)
      logger.warn(
        { accountId, callSid: stuck.sid, status: stuck.status },
        '[voice-watchdog] terminated unanswered transfer leg after timeout',
      )
    } catch (err) {
      logger.error({ err, accountId }, '[voice-watchdog] failed (transfer leg may still be ringing)')
    }
  }
}
