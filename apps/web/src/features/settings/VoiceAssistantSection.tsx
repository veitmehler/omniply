'use client'

/**
 * Voice Assistant setup + management (.plans/voice-agent-elevenlabs
 * .implementation-plan.md V2). Doubles as the guided integration walkthrough
 * the dashboard card links to (#voice-assistant): the visible step is derived
 * from provisioning state, so a half-finished setup resumes where it left
 * off. Deliberately NOT part of onboarding (user decision 2026-09-09) — the
 * clinic must create their own ElevenLabs account first.
 */
import { useEffect, useState } from 'react'
import { Loader2, PhoneCall, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface VoiceStatus {
  dismissed: boolean
  hasApiKey: boolean
  status: 'none' | 'pending' | 'ready' | 'error'
  voiceId: string | null
  phoneNumber: string | null
  mode: 'overflow' | 'direct'
  transferNumber: string | null
  lastError: string | null
  usage: { tier: string | null; characterCount: number | null; characterLimit: number | null } | null
}

export function VoiceAssistantSection() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<VoiceStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'overflow' | 'direct'>('overflow')
  const [transferNumber, setTransferNumber] = useState('')

  async function refresh() {
    try {
      const res = await fetch('/api/voice-assistant/status', { cache: 'no-store' })
      if (!res.ok) {
        setState(null)
        return
      }
      const d = (await res.json()) as VoiceStatus
      setState(d)
      setMode(d.mode)
      setTransferNumber(d.transferNumber ?? '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveKey() {
    if (!apiKey.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/voice-assistant/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; tier?: string | null } | null
      if (!res.ok) {
        toast.error(d?.error ?? 'Key verification failed')
        return
      }
      toast.success(d?.tier ? `Key verified (${d.tier} plan)` : 'Key verified')
      setApiKey('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function provision() {
    setBusy(true)
    try {
      const res = await fetch('/api/voice-assistant/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, transferNumber: transferNumber.trim() || null }),
      })
      const d = (await res.json().catch(() => null)) as {
        status?: string
        notes?: string[]
        lastError?: string | null
      } | null
      if (d?.status === 'ready') toast.success('Voice assistant is live!')
      else if (d?.status === 'pending') toast.info('Set up so far so good — the phone number is still pending.')
      else toast.error(d?.lastError ?? 'Provisioning failed')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function saveConfig() {
    setBusy(true)
    try {
      const res = await fetch('/api/voice-assistant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, transferNumber: transferNumber.trim() || null }),
      })
      if (res.ok) toast.success('Voice settings updated')
      else toast.error('Update failed')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <div id="voice-assistant" className="bg-card rounded-xl border border-border p-6 flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  if (!state) return null

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm'
  const ready = state.status === 'ready'

  return (
    <div id="voice-assistant" className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <PhoneCall className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">Voice Assistant (AI receptionist)</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        An AI phone receptionist in your own cloned voice, powered by your ElevenLabs account. It answers with the
        same knowledge as your chat assistant, transfers to your team on request, and takes callback messages.
      </p>

      {/* Step 1 — ElevenLabs account + key */}
      {!state.hasApiKey && (
        <div className="rounded-lg border border-border p-4 mb-4">
          <p className="text-sm font-medium text-card-foreground mb-1">Step 1 — connect your ElevenLabs account</p>
          <p className="text-xs text-muted-foreground mb-2">
            Create an account at elevenlabs.io (the Creator plan, $22/month, is what we recommend — it includes
            enough call minutes for most clinics). Then open Profile → API Keys, create a key, and paste it here.
          </p>
          <div className="flex gap-2">
            <input
              className={input}
              type="password"
              placeholder="ElevenLabs API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button size="sm" onClick={saveKey} disabled={busy || !apiKey.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify & save'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — mode + transfer + provision */}
      {state.hasApiKey && !ready && (
        <div className="rounded-lg border border-border p-4 mb-4 space-y-3">
          <p className="text-sm font-medium text-card-foreground">Step 2 — set up your AI receptionist</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">How do you want to use it?</label>
            <div className="mt-1 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" checked={mode === 'overflow'} onChange={() => setMode('overflow')} />
                <span>
                  <span className="font-medium">Missed-call backup</span> — keep your current number; forward
                  unanswered and after-hours calls to the AI (we&apos;ll show you how).
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" checked={mode === 'direct'} onChange={() => setMode('direct')} />
                <span>
                  <span className="font-medium">Direct line</span> — publish the AI number on your website and
                  profiles; the assistant answers every call first.
                </span>
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Your practice phone number (for &quot;talk to a human&quot; transfers)
            </label>
            <input
              className={input}
              placeholder="+1 555 123 4567"
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Setup clones your voice from your onboarding recordings, creates the phone agent in your ElevenLabs
            account, and connects a dedicated phone number.
          </p>
          {state.lastError && <p className="text-xs text-destructive">Last attempt: {state.lastError}</p>}
          <Button size="sm" onClick={provision} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {state.status === 'none' ? 'Set up voice assistant' : 'Retry setup'}
          </Button>
        </div>
      )}

      {/* Ready — management panel */}
      {ready && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-sm text-card-foreground">
            <span className="font-medium">Live.</span> Your AI receptionist answers on{' '}
            <span className="font-mono">{state.phoneNumber}</span>
            {state.voiceId ? ' in your cloned voice.' : ' (standard voice — no clone available yet).'}
          </p>
          {state.mode === 'overflow' ? (
            <p className="text-xs text-muted-foreground">
              Forwarding mode: in your phone system, set conditional forwarding (no answer / after hours) to the
              number above. Your published number stays the same.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Direct mode: publish the number above on your website, Google Business Profile, and social profiles.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Usage mode</label>
              <select className={input} value={mode} onChange={(e) => setMode(e.target.value as 'overflow' | 'direct')}>
                <option value="overflow">Missed-call backup (forwarding)</option>
                <option value="direct">Direct line (published number)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Transfer-to-human number</label>
              <input className={input} value={transferNumber} onChange={(e) => setTransferNumber(e.target.value)} />
            </div>
          </div>
          {state.usage && state.usage.characterLimit ? (
            <p className="text-xs text-muted-foreground">
              ElevenLabs plan{state.usage.tier ? ` (${state.usage.tier})` : ''}:{' '}
              {Math.round(((state.usage.characterCount ?? 0) / state.usage.characterLimit) * 100)}% of this
              month&apos;s included usage.
            </p>
          ) : null}
          <Button size="sm" onClick={saveConfig} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}
