'use client'

/**
 * Dashboard notification card for the voice assistant (.plans/voice-agent
 * -elevenlabs.implementation-plan.md V2). Shown until the clinic either
 * completes setup or dismisses it ("not yet") — dismissal only hides the
 * card; Settings → Voice Assistant keeps the full setup available.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PhoneCall, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function VoiceAgentCard() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/voice-assistant/status', { cache: 'no-store' })
        if (!res.ok) return
        const d = (await res.json()) as { dismissed: boolean; status: string }
        if (alive && !d.dismissed && d.status !== 'ready') setVisible(true)
      } catch {
        /* card is a nudge — never surface errors here */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function dismiss() {
    setVisible(false)
    await fetch('/api/voice-assistant/dismiss', { method: 'POST' }).catch(() => {})
  }

  if (!visible) return null

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className="rounded-full bg-primary/10 p-2 mt-0.5">
        <PhoneCall className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-card-foreground">Add your AI voice receptionist</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Answer missed and after-hours calls in your own cloned voice — booked from your ElevenLabs account, with
          the same safe knowledge as your chat assistant. Takes about 10 minutes to set up.
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" asChild>
            <Link href="/settings#voice-assistant">Set it up</Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            I don&apos;t want an AI voice agent yet
          </Button>
        </div>
      </div>
      <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={dismiss}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
