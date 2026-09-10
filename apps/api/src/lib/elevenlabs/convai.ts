/**
 * ElevenLabs Agents (ConvAI) API client — voice-agent provisioning
 * (.plans/voice-agent-elevenlabs.implementation-plan.md V2).
 *
 * All calls run with the CLINIC's own API key (per-clinic ElevenLabs account
 * — user decision 2026-09-09): the agent, cloned voice, and imported phone
 * number live in the clinic's workspace and bill to their plan.
 *
 * Field shapes follow the API reference as fetched 2026-09-09; provisioning
 * treats a 4xx here as a stored lastError (never a crash) so a vendor shape
 * drift surfaces as a readable provisioning error, not a mystery.
 */
import { instrumentCall } from '../net/instrument'

const BASE = 'https://api.elevenlabs.io/v1'
const TIMEOUT_MS = 45_000

async function convaiFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  return instrumentCall({ provider: 'elevenlabs', op: `convai ${path}` }, async () => {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`ElevenLabs ConvAI ${path} failed (${res.status}): ${body.slice(0, 400)}`)
    }
    return res.json() as Promise<T>
  })
}

export interface ConvAiAgentSpec {
  name: string
  firstMessage: string
  /** Our custom-LLM endpoint (full URL incl. the per-account secret). */
  customLlmUrl: string
  voiceId: string | null
  /** Clinic's real line for the human hand-off; omits the transfer tool when null. */
  transferNumber: string | null
  /**
   * Conversation-initiation webhook (voice-rescue one-number design): called
   * by ElevenLabs on every inbound call BEFORE the agent speaks; our server
   * returns a first-message override for rescue calls. API field shapes
   * live-verified 2026-09-10 (the docs wrongly claim UI-only config).
   */
  initWebhookUrl?: string | null
}

function agentConfigBody(spec: ConvAiAgentSpec, screening: boolean): Record<string, unknown> {
  return {
    name: spec.name,
    conversation_config: {
      agent: {
        first_message: spec.firstMessage,
        language: 'en',
        prompt: {
          // The REAL system prompt lives on our server (the custom LLM builds
          // it per turn). This stub does double duty: ElevenLabs interpolates
          // the system dynamic variables at call time and sends the result as
          // messages[0] — the voice shim parses CALL_ID out of it for stable
          // per-call conversation keys (live-verified route; the
          // elevenlabs_extra_body mechanism only exists for SDK-initiated
          // sessions, not inbound phone calls).
          prompt:
            'You are the practice assistant. CALL_ID={{system__conversation_id}} CALLER={{system__caller_id}}',
          llm: 'custom-llm',
          custom_llm: {
            url: spec.customLlmUrl,
            model_id: 'omniply-agent',
          },
          built_in_tools: {
            end_call: {
              name: 'end_call',
              description: 'End the call when the conversation is complete or the caller says goodbye.',
              params: { system_tool_type: 'end_call' },
            },
            ...(spec.transferNumber
              ? {
                  transfer_to_number: {
                    name: 'transfer_to_number',
                    description: 'Transfer the caller to the practice team when they ask for a human.',
                    params: {
                      system_tool_type: 'transfer_to_number',
                      transfers: [
                        {
                          transfer_destination: { type: 'phone', phone_number: spec.transferNumber },
                          condition: 'The caller asks to speak to a human, a real person, the front desk, or any staff member.',
                          transfer_type: 'conference',
                          // Call screening: the human must press a key to accept,
                          // so voicemail/unanswered rings do NOT count as
                          // connected and the call returns to the agent for the
                          // callback fallback. Requires the ElevenLabs "call
                          // screening on transfers" feature — provisioning
                          // retries WITHOUT this flag when the account lacks it.
                          ...(screening ? { require_acceptance: true } : {}),
                        },
                      ],
                    },
                  },
                }
              : {}),
          },
        },
      },
      ...(spec.voiceId ? { tts: { voice_id: spec.voiceId } } : {}),
    },
    ...(spec.initWebhookUrl
      ? {
          platform_settings: {
            workspace_overrides: {
              conversation_initiation_client_data_webhook: { url: spec.initWebhookUrl, request_headers: {} },
            },
            overrides: {
              enable_conversation_initiation_client_data_from_webhook: true,
              conversation_config_override: { agent: { first_message: true } },
            },
          },
        }
      : {}),
  }
}

/** True when the failure is specifically the transfer-screening feature gate. */
function isScreeningFeatureError(err: unknown): boolean {
  return err instanceof Error && /transfer_screening_not_enabled|require_acceptance/.test(err.message)
}

export async function createConvAiAgent(apiKey: string, spec: ConvAiAgentSpec): Promise<{ agent_id: string }> {
  try {
    return await convaiFetch<{ agent_id: string }>(apiKey, '/convai/agents/create', {
      method: 'POST',
      body: JSON.stringify(agentConfigBody(spec, true)),
    })
  } catch (err) {
    if (!isScreeningFeatureError(err)) throw err
    return convaiFetch<{ agent_id: string }>(apiKey, '/convai/agents/create', {
      method: 'POST',
      body: JSON.stringify(agentConfigBody(spec, false)),
    })
  }
}

export async function updateConvAiAgent(apiKey: string, agentId: string, spec: ConvAiAgentSpec): Promise<void> {
  try {
    await convaiFetch<unknown>(apiKey, `/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(agentConfigBody(spec, true)),
    })
  } catch (err) {
    if (!isScreeningFeatureError(err)) throw err
    await convaiFetch<unknown>(apiKey, `/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(agentConfigBody(spec, false)),
    })
  }
}

/** Import a Twilio number into the clinic's workspace, bound to the agent. */
export async function importTwilioNumber(
  apiKey: string,
  opts: { phoneNumber: string; label: string; twilioSid: string; twilioToken: string; agentId: string },
): Promise<{ phone_number_id: string }> {
  return convaiFetch<{ phone_number_id: string }>(apiKey, '/convai/phone-numbers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'twilio',
      phone_number: opts.phoneNumber,
      label: opts.label,
      sid: opts.twilioSid,
      token: opts.twilioToken,
      agent_id: opts.agentId,
    }),
  })
}

export interface ElevenLabsUsage {
  tier: string | null
  characterCount: number | null
  characterLimit: number | null
}

/** Subscription snapshot for the Settings usage meter (best-effort). */
export async function getElevenLabsUsage(apiKey: string): Promise<ElevenLabsUsage> {
  const data = await convaiFetch<{
    tier?: string
    character_count?: number
    character_limit?: number
  }>(apiKey, '/user/subscription')
  return {
    tier: data.tier ?? null,
    characterCount: data.character_count ?? null,
    characterLimit: data.character_limit ?? null,
  }
}
