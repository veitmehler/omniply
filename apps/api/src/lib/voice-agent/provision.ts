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
 *   2. instant voice clone from the archived onboarding recordings
 *   3. create/update the ConvAI agent (custom-LLM → our /agent/voice/:secret)
 *   4. number supply: per-clinic Twilio subaccount under OUR master account,
 *      buy a local voice number, import it into the clinic's ElevenLabs
 *      workspace bound to the agent
 *
 * Failures store a readable lastError + status 'error' (never throw to the
 * route); partial progress persists so the next run resumes.
 */
import { randomBytes } from 'node:crypto'
import { prisma, decrypt, brandSettingsForUser, listS3Keys, readS3Object } from '@omniply/shared'
import { logger } from '../logger'
import { cloneElevenLabsVoiceFromSamples } from '../elevenlabs/client'
import { createConvAiAgent, updateConvAiAgent, importTwilioNumber, type ConvAiAgentSpec } from '../elevenlabs/convai'
import { buyVoiceNumber, createTwilioSubaccount, getTwilioSubaccountToken, twilioConfigured, type TwilioAddress } from '../twilio'

const MAX_CLONE_SAMPLES = 6

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

    // ── Voice clone (reused when already cloned) ─────────────────────────────
    let voiceId = config.voiceId
    if (!voiceId) {
      const keys = (await listS3Keys(`onboarding/${accountId}/voice/`)).slice(0, MAX_CLONE_SAMPLES)
      if (keys.length === 0) {
        notes.push('No onboarding voice recordings found — agent uses the ElevenLabs default voice until a clone is made.')
      } else {
        const samples = []
        for (const key of keys) {
          const obj = await readS3Object(key)
          samples.push({ buffer: obj.body, filename: key.split('/').pop() ?? 'sample.webm' })
        }
        const clone = await cloneElevenLabsVoiceFromSamples({ apiKey, name: `${practiceName} — Omniply voice`, samples })
        voiceId = clone.voice_id
        await persist({ voiceId })
        notes.push(`Voice cloned from ${samples.length} onboarding recording(s).`)
        logger.info({ accountId, voiceId, samples: samples.length }, '[voice-agent] instant voice clone created')
      }
    }

    // ── Agent create/update ──────────────────────────────────────────────────
    const spec: ConvAiAgentSpec = {
      name: `${practiceName} — Omniply voice agent`,
      firstMessage: `Thanks for calling ${practiceName}! I'm the practice's AI assistant. How can I help you today?`,
      customLlmUrl: `${apiBase()}/api/agent/voice/${secret}`,
      voiceId,
      transferNumber: opts.transferNumber !== undefined ? opts.transferNumber : config.transferNumber,
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

    // ── Rescue agent + internal number (voice-rescue plan; best-effort —
    // the TwiML <Say> floor covers a clinic without it) ──────────────────────
    let rescueAgentId = config.rescueAgentId
    let rescueNumber = config.rescueNumber
    try {
      if (!rescueAgentId) {
        const rescueSpec: ConvAiAgentSpec = {
          name: `${practiceName} — Omniply message agent`,
          firstMessage: `Sorry about that — the team couldn't pick up just now. I can take a message so they call you back. What's your name and the best number to reach you?`,
          customLlmUrl: `${apiBase()}/api/agent/voice/${secret}/message`,
          voiceId,
          transferNumber: null,
        }
        const created = await createConvAiAgent(apiKey, rescueSpec)
        rescueAgentId = created.agent_id
        await persist({ rescueAgentId })
        notes.push('Rescue (message) agent created.')
        logger.info({ accountId, rescueAgentId }, '[voice-agent] rescue agent created')
      }
      if (!rescueNumber && rescueAgentId && twilioConfigured() && twilioSubaccountSid) {
        const subToken = await getTwilioSubaccountToken(twilioSubaccountSid)
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
        rescueNumber = bought.phoneNumber
        await persist({ rescueNumber, rescueNumberSid: bought.numberSid })
        const imported = await importTwilioNumber(apiKey, {
          phoneNumber: rescueNumber,
          label: `${practiceName} — Omniply message line (internal)`,
          twilioSid: twilioSubaccountSid,
          twilioToken: subToken,
          agentId: rescueAgentId,
        })
        await persist({ rescueNumberId: imported.phone_number_id })
        notes.push(`Rescue number ${rescueNumber} bought and connected to the message agent.`)
        logger.info({ accountId, rescueNumber }, '[voice-agent] rescue number bought + imported')
      }
    } catch (err) {
      // Non-fatal: the main agent stays ready; TwiML floor covers rescues.
      logger.warn({ err, accountId }, '[voice-agent] rescue provisioning failed (floor active)')
      notes.push(`Rescue agent setup incomplete: ${err instanceof Error ? err.message.slice(0, 200) : 'error'}`)
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
