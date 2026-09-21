'use client'

/**
 * Download the self-contained 2-Minute Spine Check page (non-WordPress
 * clinics). WordPress-connected accounts get /spine-check published
 * automatically instead — this button is the manual path for everyone else.
 */
import { useState } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SpineCheckDownloadButton() {
  const getToken = useAppToken()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/spine-check-download', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Download failed — is your brand set up?')
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'spine-check.html'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setError('Download failed — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Button variant="outline" onClick={download} disabled={busy} className="inline-flex items-center gap-2">
        <Activity className="h-4 w-4" />
        {busy ? 'Preparing…' : 'Download Spine Check page'}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
