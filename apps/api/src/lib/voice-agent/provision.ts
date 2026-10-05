/**
 * Voice-agent provisioning orchestrator
 * (.plans/voice-agent-elevenlabs.implementation-plan.md V2).
 *
 * Runs with the CLINIC's ElevenLabs key (ApiKey provider 'elevenlabs' on the
 * account owner). Idempotent — every step reuses what a prior run created
 * (voiceId/agentId/subaccount/number stored on VoiceAgentConfig), so the
 * wizard's "retry" is just calling this again.
 *
 * Steps:
 *   1. mint the custom-LLM secret (Account.voiceAgentSecret)
 *   2. voice selection: the stored voiceId, else the standard receptionist
 *      voice. (Auto-IVC from onboarding recordings was REMOVED 2026-10-05:
 *      ElevenLabs forbids custom-LLM agents with Instant Voice Clones —
 *      anti-impersonation control. Clinics download their recordings from
 *      Settings, create an identity-verified Professional Voice Clone in
 *      their own ElevenLabs account, and pick it in the voice selector.)
 *   3. create/update the ConvAI agent (custom-LLM → our /agent/voice/:secret)
 *   4. number supply: per-clinic Twilio subaccount under OUR master account,
 *      buy a local voice number, import it into the clinic's ElevenLabs
 *      workspace bound to the agent
 *
 * Failures store a readable lastError + status 'error' (never throw to the
 * route); partial progress persists so the next run resumes.
 */
import { randomBytes } from 'node:crypto'
import { prisma, decrypt, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../logger'
import { createConvAiAgent, updateConvAiAgent, importTwilioNumber, type ConvAiAgentSpec } from '../elevenlabs/convai'
import { buyVoiceNumber, createTwilioSubaccount, getTwilioSubaccountToken, twilioConfigured, type TwilioAddress } from '../twilio'

/** ElevenLabs premade "Rachel" — calm, natural receptionist default. */
export const DEFAULT_AGENT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

export async function ensureVoiceAgentSecret(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { voiceAgentSecret: true } })
  if (!account) throw new Error(`ensureVoiceAgentSecret: no account ${accountId}`)
  if (account.voiceAgentSecret) return account.voiceAgentSecret
  const minted = randomBytes(24).toString('base64url')
  const claimed = await prisma.account.updateMany({
    where: { id: accountId, voiceAgentSecret: null },
    data: { voiceAgentSecret: minted },
  })
  if (claimed.count > 0) return minted
  const after = await prisma.account.findUnique({ where: { id: accountId }, select: { voiceAgentSecret: true } })
  if (!after?.voiceAgentSecret) throw new Error(`ensureVoiceAgentSecret: claim lost (${accountId})`)
  return after.voiceAgentSecret
}

export async function clinicElevenLabsKey(ownerUserId: string): Promise<string | null> {
  const row = await prisma.apiKey.findFirst({ where: { userId: ownerUserId, provider: 'elevenlabs' } })
  if (!row) return null
  return decrypt(row.encryptedKey)
}

function apiBase(): string {
  return (process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io').replace(/\/$/, '')
}

export interface ProvisionResult {
  status: 'ready' | 'pending' | 'error'
  voiceId: string | null
  agentId: string | null
  phoneNumber: string | null
  notes: string[]
  lastError: string | null
}

export async function provisionVoiceAgent(
  userId: string,
  opts: { mode?: 'overflow' | 'direct'; transferNumber?: string | null } = {},
): Promise<ProvisionResult> {
  const notes: string[] = []
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
  if (!user?.accountId) return { status: 'error', voiceId: null, agentId: null, phoneNumber: null, notes, lastError: 'No account' }
  const accountId = user.accountId

  const config = await prisma.voiceAgentConfig.upsert({
    where: { accountId },
    create: { accountId, ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.transferNumber !== undefined ? { transferNumber: opts.transferNumber } : {}) },
    update: { ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.transferNumber !== undefined ? { transferNumber: opts.transferNumber } : {}) },
  })

  const fail = async (msg: string): Promise<ProvisionResult> => {
    logger.warn({ accountId, msg }, '[voice-agent] provisioning failed')
    const row = await prisma.voiceAgentConfig.update({
      where: { accountId },
      data: { status: 'error', lastError: msg.slice(0, 900) },
    })
    return { status: 'error', voiceId: row.voiceId, agentId: row.agentId, phoneNumber: row.phoneNumber, notes, lastError: msg }
  }

  try {
    const owner = (await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } }))?.ownerUserId ?? userId
    const apiKey = await clinicElevenLabsKey(owner)
    if (!apiKey) return await fail('No ElevenLabs API key on file — add it in the wizard or Settings first.')

    const brand = await brandSettingsForUser(owner)
    const practiceName = brand?.organizationName?.trim() || 'the practice'
    const secret = await ensureVoiceAgentSecret(accountId)

    // Persist partial progress IMMEDIATELY after each vendor-side create —
    // otherwise an error later in the run would orphan the created resource
    // and a retry would duplicate it (bug found in the first live run).
    const persist = (data: Record<string, unknown>) =>
      prisma.voiceAgentConfig.update({ where: { accountId }, data })

    // ── Voice selection (no auto-clone — see header) ─────────────────────────
    let voiceId = config.voiceId
    if (!voiceId) {
      voiceId = DEFAULT_AGENT_VOICE_ID
      await persist({ voiceId })
      notes.push(
        'Using the standard receptionist voice. To use your own: download your onboarding recordings in Settings, create a Professional Voice Clone in ElevenLabs, then pick it in the voice selector.',
      )
    }

    // ── Agent create/update ──────────────────────────────────────────────────
    const spec: ConvAiAgentSpec = {
      name: `${practiceName} — Omniply voice agent`,
      // Recording disclosure + intake opener (user wording 2026-09-10):
      // all-party-consent states need the recorded line; the name ask starts
      // the disconnect-insurance intake (engine overlay handles the number).
      firstMessage: `Thanks for calling ${practiceName} — I'm the practice's AI assistant, and calls are recorded for quality assurance. Who am I speaking with?`,
      customLlmUrl: `${apiBase()}/api/agent/voice/${secret}`,
      voiceId,
      transferNumber: opts.transferNumber !== undefined ? opts.transferNumber : config.transferNumber,
      // One-number rescue design: the initiation webhook swaps the greeting
      // for an apology on rescue calls (stamp-matched); no second agent/number.
      initWebhookUrl: `${apiBase()}/api/agent/voice-init/${secret}`,
    }
    let agentId = config.agentId
    if (agentId) {
      await updateConvAiAgent(apiKey, agentId, spec)
      notes.push('Agent updated.')
    } else {
      const created = await createConvAiAgent(apiKey, spec)
      agentId = created.agent_id
      await persist({ agentId })
      notes.push('Agent created.')
      logger.info({ accountId, agentId }, '[voice-agent] ConvAI agent created')
    }

    // ── Number supply (skipped gracefully until Twilio env is set) ───────────
    let phoneNumber = config.phoneNumber
    let phoneNumberId = config.phoneNumberId
    let twilioSubaccountSid = config.twilioSubaccountSid
    if (!phoneNumber) {
      if (!twilioConfigured()) {
        notes.push('Phone number pending — Twilio master credentials not configured on the platform yet.')
      } else {
        let subToken: string
        if (twilioSubaccountSid) {
          subToken = await getTwilioSubaccountToken(twilioSubaccountSid)
        } else {
          const sub = await createTwilioSubaccount(`omniply-voice-${accountId}`)
          twilioSubaccountSid = sub.sid
          subToken = sub.authToken
          await persist({ twilioSubaccountSid })
          logger.info({ accountId, subSid: sub.sid }, '[voice-agent] Twilio subaccount created')
        }
        // Clinic address for countries with a number-address requirement (AU).
        const address: TwilioAddress | null =
          brand?.addressLine1 && brand.addressLocality && brand.postalCode
            ? {
                customerName: practiceName,
                street: [brand.addressLine1, brand.addressLine2].filter(Boolean).join(', '),
                city: brand.addressLocality,
                region: brand.addressRegion ?? brand.addressLocality,
                postalCode: brand.postalCode,
                isoCountry: brand.organizationCountryCode ?? 'US',
              }
            : null
        const bought = await buyVoiceNumber(
          { sid: twilioSubaccountSid, token: subToken },
          brand?.organizationCountryCode ?? 'US',
          address,
        )
        phoneNumber = bought.phoneNumber
        const imported = await importTwilioNumber(apiKey, {
          phoneNumber,
          label: `${practiceName} — Omniply AI receptionist`,
          twilioSid: twilioSubaccountSid,
          twilioToken: subToken,
          agentId,
        })
        phoneNumberId = imported.phone_number_id
        notes.push(`Number ${phoneNumber} bought and connected to the agent.`)
        logger.info({ accountId, phoneNumber }, '[voice-agent] number bought + imported')
      }
    }

    const status: 'ready' | 'pending' = phoneNumber ? 'ready' : 'pending'
    await prisma.voiceAgentConfig.update({
      where: { accountId },
      data: { status, voiceId, agentId, phoneNumber, phoneNumberId, twilioSubaccountSid, lastError: null },
    })
    return { status, voiceId, agentId, phoneNumber, notes, lastError: null }
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err))
  }
}
