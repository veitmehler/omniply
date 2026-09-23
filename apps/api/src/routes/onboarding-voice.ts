/**
 * Voice answers for the onboarding questions (onboarding plan Phase 3).
 *
 * The browser records with MediaRecorder and uploads here. We ALWAYS archive
 * the audio to S3 (consent captured in the step copy) — it is the future
 * ElevenLabs corpus whether or not they opt in today — then transcribe
 * (Gemini audio-in; Whisper is the drop-in fallback if quality disappoints)
 * and return the transcript for inline correction before the answer commits.
 */
import type { FastifyInstance } from 'fastify'
import { uploadBufferWithKey, resolveAccountForClerkId } from '@omniply/shared'
import { requireAuth } from '../middleware/auth'
import { logger } from '../lib/logger'
import { getSystemApiKey } from '../lib/system-keys'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'

const TRANSCRIBE_MODEL = 'gemini-3-flash-preview'
const MAX_AUDIO_BYTES = 20 * 1024 * 1024

/**
 * Two attempts (45s, then 75s) — a hung Gemini request used to hold the
 * whole upload for the 120s cap and surface an error (seen live during the
 * 2026-09-23 onboarding run). Same total ceiling, but a transient hang now
 * recovers silently on the retry.
 */
async function transcribe(geminiKey: string, audio: Buffer, mimeType: string): Promise<string> {
  const attemptTimeouts = [45_000, 75_000]
  let lastErr: unknown
  for (let i = 0; i < attemptTimeouts.length; i++) {
    try {
      return await transcribeOnce(geminiKey, audio, mimeType, attemptTimeouts[i])
    } catch (err) {
      lastErr = err
      logger.warn({ err, attempt: i + 1 }, '[onboarding-voice] transcribe attempt failed')
    }
  }
  throw lastErr
}

async function transcribeOnce(
  geminiKey: string,
  audio: Buffer,
  mimeType: string,
  timeoutMs: number,
): Promise<string> {
  const res = await instrumentCall({ provider: 'gemini', op: 'onboarding.transcribe' }, () =>
    withTimeout(
      (signal) =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIBE_MODEL}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: 'Transcribe this audio verbatim. Return ONLY the spoken words as plain text — no timestamps, no speaker labels, no commentary. Light cleanup of filler sounds (um, uh) is fine; keep the natural phrasing.',
                    },
                    { inlineData: { mimeType, data: audio.toString('base64') } },
                  ],
                },
              ],
              generationConfig: { temperature: 0 },
            }),
            signal,
          },
        ),
      timeoutMs,
      'onboarding.transcribe',
    ),
  )
  if (!res.ok) throw new Error(`transcription HTTP ${res.status}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return (data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim()
}

export async function onboardingVoiceRoutes(app: FastifyInstance) {
  // POST /onboarding/voice-answer  (multipart: audio file + step field)
  app.post('/onboarding/voice-answer', async (request, reply) => {
    const clerkId = await requireAuth(request, reply)
    if (!clerkId) return
    const account = await resolveAccountForClerkId(clerkId)
    if (!account) return reply.status(404).send({ error: 'No account' })

    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'audio file required' })
    const step = (file.fields.step as { value?: string } | undefined)?.value ?? 'unknown'
    const audio = await file.toBuffer()
    if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) {
      return reply.status(400).send({ error: 'Audio missing or too large' })
    }
    const mimeType = file.mimetype || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'webm'

    // 1. Archive to S3 regardless of any later ElevenLabs decision.
    const key = `onboarding/${account.accountId}/voice/${step}-${Date.now()}.${ext}`
    let audioKey: string | null = null
    try {
      await uploadBufferWithKey(key, audio, mimeType)
      audioKey = key
    } catch (err) {
      logger.error({ err, key }, '[onboarding-voice] S3 archive failed (continuing with transcription)')
    }

    // 2. Transcribe.
    const geminiKey = await getSystemApiKey('gemini')
    if (!geminiKey) return reply.status(503).send({ error: 'Transcription unavailable', audioKey })
    try {
      const transcript = await transcribe(geminiKey, audio, mimeType)
      if (!transcript) return reply.status(422).send({ error: "Couldn't hear anything — try again a bit closer to the mic?", audioKey })
      return reply.send({ transcript, audioKey, durationHintSeconds: Math.round(audio.length / 4000) })
    } catch (err) {
      logger.warn({ err }, '[onboarding-voice] transcription failed')
      return reply.status(502).send({ error: 'Transcription failed — you can type the answer instead.', audioKey })
    }
  })
}
