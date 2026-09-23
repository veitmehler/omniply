'use client'

/**
 * MediaRecorder voice answer (onboarding plan Phase 3).
 *
 * Record → upload → editable transcript → confirm. The parent commits the
 * confirmed transcript (+ audioKey) as the step answer. Falls back to typing
 * whenever recording is unavailable or the user prefers it.
 */
import { useRef, useState } from 'react'
import { embedFetch } from '@/lib/embedSession'

const MIN_SECONDS = 5

type Phase = 'idle' | 'recording' | 'uploading' | 'review'

export function VoiceRecorder({
  step,
  disabled,
  onConfirm,
}: {
  step: string
  disabled: boolean
  onConfirm: (answer: { text: string; audioKey?: string | null; voice: boolean }) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [audioKey, setAudioKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Escalating failure copy (Veit 2026-09-23): failures 1-2 prompt a
  // re-record; from the 3rd on, advise typing instead. Mic-access and
  // too-short messages don't count — only real service failures.
  const failCountRef = useRef(0)

  function serviceFailure() {
    failCountRef.current += 1
    const n = failCountRef.current
    setError(
      n === 1
        ? "That didn't come through — please try recording again."
        : n === 2
          ? 'Still no luck — one more try, please.'
          : 'The transcription service is having trouble right now — please type your answer below instead.',
    )
    setPhase('idle')
  }

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void upload(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.start()
      recorderRef.current = rec
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      setPhase('recording')
    } catch {
      setError("Couldn't access your microphone — type your answer below instead.")
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (seconds < MIN_SECONDS) {
      setError(`That was a bit short — aim for at least ${MIN_SECONDS} seconds so I really capture your voice.`)
    }
    recorderRef.current?.stop()
    setPhase('uploading')
  }

  async function upload(blob: Blob) {
    try {
      const form = new FormData()
      form.append('step', step)
      form.append('audio', blob, `${step}.webm`)
      // embedFetch re-authenticates on 401 — the embed token expires after
      // 15 minutes, easily crossed while someone thinks through an answer.
      const res = await embedFetch('/api/onboarding/voice-answer', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) {
        // 422 = audio was silent/too quiet — that's a mic tip, not a service
        // failure; keep the server's specific message and don't escalate.
        if (res.status === 422 && data.error) {
          setError(data.error)
          setPhase('idle')
          return
        }
        serviceFailure()
        return
      }
      failCountRef.current = 0
      setTranscript(data.transcript)
      setAudioKey(data.audioKey ?? null)
      setPhase('review')
    } catch {
      serviceFailure()
    }
  }

  if (phase === 'review') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Here&apos;s what I heard — fix anything I got wrong:</p>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm({ text: transcript.trim(), audioKey, voice: true })}
            disabled={disabled || !transcript.trim()}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            That&apos;s right ✓
          </button>
          <button
            onClick={() => setPhase('idle')}
            disabled={disabled}
            className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground"
          >
            Re-record
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-amber-600">{error}</p>}
      <div className="flex items-center gap-2">
        {phase === 'recording' ? (
          <button
            onClick={stop}
            className="flex-1 animate-pulse rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white"
          >
            ⏹ Stop ({seconds}s)
          </button>
        ) : phase === 'uploading' ? (
          <div className="flex-1 rounded-lg border border-border px-4 py-2.5 text-center text-sm text-muted-foreground">
            Transcribing…
          </div>
        ) : (
          <button
            onClick={() => void start()}
            disabled={disabled}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            🎙 Answer with your voice
          </button>
        )}
      </div>
    </div>
  )
}
