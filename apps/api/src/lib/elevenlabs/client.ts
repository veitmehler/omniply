import { instrumentCall } from '../net/instrument'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

// Bare fetch() has no default timeout — a hung ElevenLabs request would hang
// the calling slot forever (same class of bug as the 2026-07-08 Fal incident).
const ADMIN_TIMEOUT_MS = 30_000 // verify/list voices
const UPLOAD_TIMEOUT_MS = 60_000 // voice cloning (audio upload)
const TTS_TIMEOUT_MS = 90_000 // narration synthesis (generation hot path)

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string>
}

export interface CloneVoiceResult {
  voice_id: string
  requires_verification?: boolean
}

async function elevenFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return instrumentCall({ provider: 'elevenlabs', op: path }, async () => {
    const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      ...init,
      headers: {
        'xi-api-key': apiKey,
        ...(init?.headers ?? {}),
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401) throw new Error(`ElevenLabs auth failed (401): ${body.slice(0, 200) || 'no details'}`)
      if (res.status === 403) {
        throw new Error(
          'ElevenLabs denied this request. Instant Voice Cloning requires a paid ElevenLabs plan.',
        )
      }
      throw new Error(`ElevenLabs API error (${res.status}): ${body.slice(0, 200)}`)
    }

    return res.json() as Promise<T>
  })
}

export async function verifyElevenLabsKey(apiKey: string): Promise<{ ok: true; subscription?: string }> {
  const data = await elevenFetch<{ subscription?: { tier?: string } }>(apiKey, '/user')
  return { ok: true, subscription: data.subscription?.tier }
}

export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const data = await elevenFetch<{ voices?: ElevenLabsVoice[] }>(apiKey, '/voices')
  return data.voices ?? []
}

/** IVC from several samples (voice-agent path: all onboarding recordings). */
export async function cloneElevenLabsVoiceFromSamples(opts: {
  apiKey: string
  name: string
  samples: { buffer: Buffer; filename: string }[]
}): Promise<CloneVoiceResult> {
  const form = new FormData()
  form.append('name', opts.name)
  for (const s of opts.samples) form.append('files', new Blob([s.buffer]), s.filename)

  return instrumentCall({ provider: 'elevenlabs', op: 'voices/add-multi' }, async () => {
    const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': opts.apiKey },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 403) {
        throw new Error('Voice cloning requires a paid ElevenLabs plan (IVC).')
      }
      throw new Error(`ElevenLabs clone failed (${res.status}): ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<CloneVoiceResult>
  })
}

export async function cloneElevenLabsVoice(opts: {
  apiKey: string
  name: string
  sampleBuffer: Buffer
  filename: string
}): Promise<CloneVoiceResult> {
  const form = new FormData()
  form.append('name', opts.name)
  form.append('files', new Blob([opts.sampleBuffer]), opts.filename)

  return instrumentCall({ provider: 'elevenlabs', op: 'voices/add' }, async () => {
    const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': opts.apiKey },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 403) {
        throw new Error(
          'Voice cloning requires a paid ElevenLabs plan (IVC). Upgrade your account or select an existing voice.',
        )
      }
      throw new Error(`ElevenLabs clone failed (${res.status}): ${body.slice(0, 200)}`)
    }

    return res.json() as Promise<CloneVoiceResult>
  })
}

export async function synthesizeSpeech(opts: {
  apiKey: string
  voiceId: string
  text: string
  modelId?: string
  stability?: number
  similarityBoost?: number
  speed?: number
}): Promise<Buffer> {
  return instrumentCall({ provider: 'elevenlabs', op: 'tts' }, async () => {
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${opts.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: opts.text.slice(0, 5000),
        model_id: opts.modelId ?? 'eleven_multilingual_v2',
        voice_settings: {
          stability: opts.stability ?? 0.5,
          similarity_boost: opts.similarityBoost ?? 0.75,
          speed: opts.speed ?? 1.0,
        },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${body.slice(0, 200)}`)
    }

    return Buffer.from(await res.arrayBuffer())
  })
}

export interface CharacterAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export interface TimestampedSpeechResult {
  audio: Buffer
  alignment: CharacterAlignment
}

interface AudioWithTimestampsResponse {
  audio_base64?: string
  alignment?: CharacterAlignment | null
}

export async function synthesizeSpeechWithTimestamps(opts: {
  apiKey: string
  voiceId: string
  text: string
  modelId?: string
  stability?: number
  similarityBoost?: number
  speed?: number
}): Promise<TimestampedSpeechResult> {
  return instrumentCall({ provider: 'elevenlabs', op: 'tts-timestamps' }, async () => {
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${opts.voiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: opts.text.slice(0, 5000),
        model_id: opts.modelId ?? 'eleven_multilingual_v2',
        voice_settings: {
          stability: opts.stability ?? 0.5,
          similarity_boost: opts.similarityBoost ?? 0.75,
          speed: opts.speed ?? 1.0,
        },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`ElevenLabs TTS with timestamps failed (${res.status}): ${body.slice(0, 200)}`)
    }

    const data = (await res.json()) as AudioWithTimestampsResponse
    if (!data.audio_base64) {
      throw new Error('ElevenLabs TTS with timestamps returned no audio')
    }
    if (
      !data.alignment?.characters?.length ||
      !data.alignment.character_end_times_seconds?.length
    ) {
      throw new Error('ElevenLabs TTS with timestamps returned no alignment data')
    }

    return {
      audio: Buffer.from(data.audio_base64, 'base64'),
      alignment: data.alignment,
    }
  })
}
