'use client'

/**
 * Social messaging replies (DM gate, 2026-11-12): per-channel mode for the
 * AI assistant on Instagram DMs, Facebook Messenger and WhatsApp.
 *   Off            — the assistant never replies on that channel.
 *   Inquiries only — replies to customer inquiries; stays out of threads the
 *                    owner is handling, ignores reactions, creator pitches,
 *                    promo codes and personal chatter.
 *   All messages   — every text message gets a reply.
 * Reads/writes /api/agent/dm-channels (proxied to the API).
 */
import { useEffect, useState } from 'react'
import { Send, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Mode = 'off' | 'inquiries' | 'all'
type Key = 'instagram' | 'facebook' | 'whatsapp'
type Modes = Record<Key, Mode>

const CHANNELS: { key: Key; label: string; hint: string }[] = [
  { key: 'instagram', label: 'Instagram DMs', hint: 'Often mixes customers with friends, creators and collab offers.' },
  { key: 'facebook', label: 'Facebook Messenger', hint: 'Page messages from your Facebook business page.' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Your business WhatsApp number connected to your Omniply CRM.' },
]

const MODES: { value: Mode; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'The assistant never replies here. You answer everything yourself.' },
  {
    value: 'inquiries',
    label: 'Inquiries only',
    description:
      'Replies to customer questions about services, prices, hours and booking. Stays out of any thread you have written in during the last 7 days, and ignores reactions, creator pitches, promo codes and personal chatter.',
  },
  { value: 'all', label: 'All messages', description: 'Every text message gets a reply within seconds.' },
]

export function SocialRepliesSection() {
  const [modes, setModes] = useState<Modes | null>(null)
  const [saved, setSaved] = useState<Modes | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/agent/dm-channels', { cache: 'no-store' })
        if (!res.ok) throw new Error('load failed')
        const data = (await res.json()) as { modes: Modes }
        if (!cancelled) {
          setModes(data.modes)
          setSaved(data.modes)
        }
      } catch {
        if (!cancelled) setError('Could not load your messaging settings')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = !!modes && !!saved && CHANNELS.some((c) => modes[c.key] !== saved[c.key])

  async function save() {
    if (!modes) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const res = await fetch('/api/agent/dm-channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modes),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not save')
        return
      }
      const data = (await res.json()) as { modes: Modes }
      setModes(data.modes)
      setSaved(data.modes)
      setDone(true)
      setTimeout(() => setDone(false), 2500)
    } catch {
      setError('Could not reach the server — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Send className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">Social messaging replies</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Choose how the AI assistant handles direct messages on each channel. It only ever answers
        questions about your business, never gives medical advice, and hands over to you the moment
        someone asks for a person.
      </p>

      {!modes ? (
        error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )
      ) : (
        <div className="space-y-5">
          {CHANNELS.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-4">
              <div className="mb-2">
                <div className="text-sm font-medium text-card-foreground">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.hint}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => {
                  const active = modes[c.key] === m.value
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setModes({ ...modes, [c.key]: m.value })}
                      aria-pressed={active}
                      className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                        active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <div className="text-sm font-medium text-card-foreground">{m.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{m.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : done ? <Check className="h-4 w-4 mr-1.5" /> : null}
              {done ? 'Saved' : 'Save'}
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
