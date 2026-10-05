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
import { Download, ExternalLink, Loader2, PhoneCall, RefreshCw } from 'lucide-react'
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
  recordingsCount?: number
  usage: { tier: string | null; characterCount: number | null; characterLimit: number | null } | null
}

interface VoiceOption {
  voiceId: string
  name: string
  category: string
  usable: boolean
}

export function VoiceAssistantSection() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<VoiceStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'overflow' | 'direct'>('overflow')
  const [transferNumber, setTransferNumber] = useState('')
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [selectedVoice, setSelectedVoice] = useState('')

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
      setSelectedVoice((prev) => prev || d.voiceId || '')
      if (d.hasApiKey) {
        void fetch('/api/voice-assistant/voices', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((v: { voices?: VoiceOption[] } | null) => {
            if (v?.voices) setVoices(v.voices)
          })
          .catch(() => {})
      }
    } finally {
      setLoading(false)
    }
  }

  // Fetch-based download: a plain <a href> navigation bypasses the embed
  // shell's fetch bridge (which injects the bearer token), so the proxy saw
  // an unauthenticated request → 401 (found live 2026-10-05). fetch() rides
  // the bridge in the embed and Clerk cookies on the web app.
  async function downloadRecordings() {
    setBusy(true)
    try {
      const res = await fetch('/api/voice-assistant/recordings', { cache: 'no-store' })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(d?.error ?? 'Download failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'voice-recordings.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  async function saveVoice() {
    if (!selectedVoice) return
    setBusy(true)
    try {
      const res = await fetch('/api/voice-assistant/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: selectedVoice }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; name?: string } | null
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not set the voice')
        return
      }
      toast.success(`Voice set to ${d?.name ?? 'the selected voice'}`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dashboard "Set it up" lands on /settings#voice-assistant, but the
  // browser's native hash-scroll fires at first paint — before the dozen
  // async sections ABOVE this one finish loading and expand, which pushes
  // this section far below the viewport (user reported landing on the chat
  // embed area, 2026-10-05). Re-pin once our own fetch settles, and again
  // after the slower sections above have grown.
  useEffect(() => {
    if (loading) return
    if (typeof window === 'undefined' || window.location.hash !== '#voice-assistant') return
    let cancelled = false
    const pin = () => {
      if (cancelled) return
      document.getElementById('voice-assistant')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // A manual scroll (wheel/touch) hands control back to the user.
    const cancel = () => { cancelled = true }
    window.addEventListener('wheel', cancel, { once: true, passive: true })
    window.addEventListener('touchmove', cancel, { once: true, passive: true })
    pin()
    const t1 = setTimeout(pin, 700)
    const t2 = setTimeout(pin, 1600)
    return () => {
      cancelled = true
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
    }
  }, [loading])

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
        An AI phone receptionist powered by your ElevenLabs account — in a natural voice, or your own
        professionally cloned one. It answers with the same knowledge as your chat assistant, transfers to your
        team on request, and takes callback messages.
      </p>

      {/* Step 1 — ElevenLabs account + key */}
      {!state.hasApiKey && (
        <div className="rounded-lg border border-border p-4 mb-4">
          <p className="text-sm font-medium text-card-foreground mb-1">Step 1 — connect your ElevenLabs account</p>
          <p className="text-xs text-muted-foreground mb-2">
            Create an account at elevenlabs.io (the Creator plan, $22/month, is what we recommend — it includes
            enough call minutes for most clinics and Professional Voice Cloning). Then open Profile → API Keys
            and create a key.{' '}
            <span className="font-medium text-card-foreground">
              Copy the key from the creation dialog — it starts with sk_ and is shown only once.
            </span>{' '}
            The key list afterwards only shows the key&apos;s ID, which won&apos;t work here.
          </p>
          <div className="flex gap-2">
            <input
              className={input}
              type="password"
              placeholder="ElevenLabs API key (sk_…)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button size="sm" onClick={saveKey} disabled={busy || !apiKey.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify & save'}
            </Button>
          </div>
          {apiKey.trim() !== '' && !apiKey.trim().startsWith('sk_') && (
            <p className="text-xs text-amber-600 mt-2">
              This doesn&apos;t look like an API key — keys start with sk_. If you copied this from the key list,
              that&apos;s the key&apos;s ID: create a new key and copy the sk_… value shown in the creation dialog.
            </p>
          )}
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
            Setup creates the phone agent in your ElevenLabs account and connects a dedicated phone number. It
            starts with a natural receptionist voice — you can switch it (or use your own professionally cloned
            voice) in the Voice panel below, any time.
          </p>
          {state.lastError && <p className="text-xs text-destructive">Last attempt: {state.lastError}</p>}
          <Button size="sm" onClick={provision} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {state.status === 'none' ? 'Set up voice assistant' : 'Retry setup'}
          </Button>
        </div>
      )}

      {/* Voice — selector + recordings download (needs the ElevenLabs key) */}
      {state.hasApiKey && (
        <div className="rounded-lg border border-border p-4 mb-4 space-y-2">
          <p className="text-sm font-medium text-card-foreground">Voice</p>
          <div className="flex gap-2">
            <select className={input} value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
              <option value="" disabled>Choose a voice…</option>
              {voices.map((v) => (
                <option key={v.voiceId} value={v.voiceId} disabled={!v.usable}>
                  {v.name}
                  {v.category === 'professional' ? ' — your professional clone' : v.category === 'cloned' ? ' — instant clone (not allowed for AI agents)' : ''}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={saveVoice} disabled={busy || !selectedVoice || selectedVoice === state.voiceId}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Use this voice'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Want the receptionist to answer in <span className="font-medium text-card-foreground">your</span>{' '}
            voice? ElevenLabs allows only identity-verified{' '}
            <span className="font-medium text-card-foreground">Professional Voice Clones</span> on AI agents —
            instant clones are blocked by their safety rules, which is why some voices above are marked not
            usable. Creating one takes three steps in ElevenLabs: upload about 30 minutes of clean audio of
            yourself{state.recordingsCount
              ? ` (your ${state.recordingsCount} onboarding recording${state.recordingsCount === 1 ? '' : 's'} below count toward it)`
              : ''}, read a short verification statement aloud, and let it train for a few hours. When it
            finishes, it appears in the list above — pick it and your receptionist switches voices.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {state.recordingsCount ? (
              <Button size="sm" variant="outline" onClick={downloadRecordings} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                Download my onboarding recordings (ZIP)
              </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
              <a href="https://elevenlabs.io/app/voice-lab" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Create a Professional Voice Clone
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Ready — management panel */}
      {ready && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-sm text-card-foreground">
            <span className="font-medium">Live.</span> Your AI receptionist answers on{' '}
            <span className="font-mono">{state.phoneNumber}</span>
            {(() => {
              const v = voices.find((x) => x.voiceId === state.voiceId)
              return v ? ` with the voice "${v.name}".` : '.'
            })()}
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
