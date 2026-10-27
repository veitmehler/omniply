'use client'

/**
 * AI booking calendars (the calendar-discovery card, 2026-10-27).
 *
 * Auto-discovers bookable targets — GHL calendars, or Cliniko appointment
 * types when a Cliniko key is connected — with AI-proposed guest-facing
 * labels and caller synonyms. The owner confirms which services the AI
 * receptionist may offer and book; nothing is bookable without this consent.
 * "Protected time" marks a service that must not be booked while any other
 * selected service has a booking (e.g. an owner-led consultation).
 */
import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Target {
  id: string
  name: string
  durationMinutes: number | null
}
interface CurrentService {
  key: string
  label: string
  calendarId: string
  synonyms: string[]
  cliniko?: { appointmentTypeId: string }
  exclusiveWith?: string[]
}
interface Discovery {
  provider: 'ghl' | 'cliniko' | null
  providers: { ghl: boolean; cliniko: boolean }
  mode: string
  targets: Target[]
  current: CurrentService[]
  suggestions: Record<string, { key: string; label: string; synonyms: string[] }>
}

interface Row {
  targetId: string
  name: string
  enabled: boolean
  key: string
  label: string
  synonyms: string
  exclusive: boolean
  durationMinutes: number | null
}

export function BookingAssistantSection() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [disc, setDisc] = useState<Discovery | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async (provider?: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agent-booking/discovery${provider ? `?provider=${provider}` : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        setDisc(null)
        return
      }
      const d = (await res.json()) as Discovery
      setDisc(d)
      const targetIdOf = (s: CurrentService) => (d.provider === 'cliniko' ? s.cliniko?.appointmentTypeId : s.calendarId)
      setRows(
        d.targets.map((t): Row => {
          const existing = d.current.find((s) => targetIdOf(s) === t.id)
          const sug = d.suggestions[t.id]
          return {
            targetId: t.id,
            name: t.name,
            enabled: !!existing,
            key: existing?.key ?? sug?.key ?? t.id.toLowerCase().slice(0, 12),
            label: existing?.label ?? sug?.label ?? t.name,
            synonyms: (existing?.synonyms ?? sug?.synonyms ?? []).join(', '),
            exclusive: !!existing?.exclusiveWith?.length,
            durationMinutes: t.durationMinutes,
          }
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!disc?.provider) return
    const selected = rows.filter((r) => r.enabled)
    if (!selected.length) {
      toast.error('Select at least one service, or turn AI booking off below')
      return
    }
    setBusy(true)
    try {
      const keys = selected.map((r) => r.key)
      const res = await fetch('/api/agent-booking/services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: disc.provider,
          services: selected.map((r) => ({
            key: r.key,
            label: r.label,
            targetId: r.targetId,
            synonyms: r.synonyms.split(',').map((s) => s.trim()).filter(Boolean),
            ...(r.durationMinutes ? { durationMinutes: r.durationMinutes } : {}),
            ...(r.exclusive ? { exclusiveWith: keys.filter((k) => k !== r.key) } : {}),
          })),
        }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(d?.error ?? 'Saving failed')
        return
      }
      toast.success(`AI booking active for ${selected.length} service${selected.length > 1 ? 's' : ''}`)
      await load(disc.provider)
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const res = await fetch('/api/agent-booking/services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      if (!res.ok) {
        toast.error('Could not turn off AI booking')
        return
      }
      toast.success('AI booking turned off — the assistant offers callbacks and booking links instead')
      await load(disc?.provider ?? undefined)
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  // No bookable system connected — the section stays out of the way.
  if (!disc?.provider) return null

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm'
  const active = disc.mode === 'direct-ghl' || disc.mode === 'direct-cliniko'

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <CalendarCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">AI booking calendars</h2>
        {active && <span className="text-xs text-green-600 font-medium">active ✓</span>}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Choose which services your AI receptionist may offer and book. Labels and phrasings below are
        suggestions — adjust them to how your guests actually talk.
      </p>

      {disc.providers.ghl && disc.providers.cliniko && (
        <div className="flex gap-2 mb-4">
          {(['ghl', 'cliniko'] as const).map((p) => (
            <Button key={p} size="sm" variant={disc.provider === p ? 'default' : 'outline'} onClick={() => void load(p)}>
              {p === 'ghl' ? 'CRM calendars' : 'Cliniko'}
            </Button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calendars found in your booking system yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.targetId} className={`rounded-lg border p-3 ${r.enabled ? 'border-border' : 'border-border/50 opacity-70'}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                />
                <span className="text-sm font-medium text-card-foreground">{r.name}</span>
                {r.durationMinutes ? <span className="text-xs text-muted-foreground">{r.durationMinutes} min</span> : null}
              </label>
              {r.enabled && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Shown to guests as</p>
                    <input
                      className={input}
                      value={r.label}
                      maxLength={60}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Also matches (comma-separated)</p>
                    <input
                      className={input}
                      value={r.synonyms}
                      placeholder="hyperbaric, oxygen chamber"
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, synonyms: e.target.value } : x)))}
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={r.exclusive}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, exclusive: e.target.checked } : x)))}
                    />
                    <span className="text-xs text-muted-foreground">
                      Protected time — never offer this while any other service has a booking
                    </span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || rows.every((r) => !r.enabled)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active ? 'Save changes' : 'Enable AI booking'}
        </Button>
        {active && (
          <button className="text-xs text-muted-foreground underline" onClick={() => void disable()} disabled={busy}>
            Turn off AI booking
          </button>
        )}
      </div>
    </div>
  )
}
