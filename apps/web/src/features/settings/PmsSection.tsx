'use client'

/**
 * PMS connection + patient import (PMS framework v2 Phases C/D).
 *
 * - Cliniko: paste the clinic's API key (validated with a real call).
 * - Patient import: upload the PMS patient-list CSV → GHL contacts
 *   (demographics only; re-uploads are safe — duplicates converge).
 * Booking mode/config stay admin-managed until the rollout surface lands.
 */
import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PmsStatus {
  bookingMode: string
  cliniko: { connected: boolean }
  sync: { provider: string; patientsCursor: string | null; lastError: string | null } | null
}

export function PmsSection() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<PmsStatus | null>(null)
  const [clinikoKey, setClinikoKey] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/pms/status', { cache: 'no-store' })
      if (res.ok) setStatus((await res.json()) as PmsStatus)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function saveClinikoKey() {
    if (!clinikoKey.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/pms/cliniko/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: clinikoKey.trim() }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; businesses?: unknown[] } | null
      if (!res.ok) {
        toast.error(d?.error ?? 'Key verification failed')
        return
      }
      toast.success('Cliniko connected — new patients will sync to your CRM automatically')
      setClinikoKey('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function importCsv(file: File) {
    setBusy(true)
    try {
      const text = await file.text()
      const res = await fetch('/api/pms/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text, source: 'csv' }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; processed?: number; upserted?: number; skipped?: number } | null
      if (!res.ok) {
        toast.error(d?.error ?? 'Import failed')
        return
      }
      toast.success(`Imported ${d?.upserted ?? 0} of ${d?.processed ?? 0} patients${d?.skipped ? ` (${d.skipped} skipped — no phone or email)` : ''}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (loading)
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  if (!status) return null

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">Practice Management System</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Keep your CRM in step with your practice software — patient names, phone numbers and emails only.
        Clinical records never leave your PMS.
      </p>

      {/* Cliniko connection */}
      <div className="rounded-lg border border-border p-4 mb-4">
        <p className="text-sm font-medium text-card-foreground mb-1">
          Cliniko {status.cliniko.connected && <span className="text-green-600 font-normal">— connected ✓</span>}
        </p>
        {status.cliniko.connected ? (
          <p className="text-xs text-muted-foreground">
            New and updated patients sync to your CRM automatically every few minutes.
            {status.sync?.lastError ? (
              <span className="text-destructive"> Last sync issue: {status.sync.lastError}</span>
            ) : null}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              In Cliniko: My Info → Manage API keys → create a key, and paste the whole value (it ends with a
              region code like &ldquo;-au2&rdquo;).
            </p>
            <div className="flex gap-2">
              <input
                className={input}
                type="password"
                placeholder="Cliniko API key"
                value={clinikoKey}
                onChange={(e) => setClinikoKey(e.target.value)}
              />
              <Button size="sm" onClick={saveClinikoKey} disabled={busy || !clinikoKey.trim()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify & connect'}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* CSV import — all PMSs */}
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium text-card-foreground mb-1">Import your patient list (any PMS)</p>
        <p className="text-xs text-muted-foreground mb-2">
          Export your patient list as a CSV from your practice software and upload it here — names, phone
          numbers and emails come across so recall and review requests reach your existing patients.
          Re-uploading later is safe: existing patients are matched, only new ones are added.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importCsv(f)
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
          Upload patient CSV
        </Button>
      </div>
    </div>
  )
}
