'use client'

/**
 * Download the self-contained link-in-bio HTML page (non-WordPress clinics).
 * WordPress-connected accounts get /linktree published automatically instead —
 * this button is the manual path for everyone else.
 */
import { useState } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LinktreeDownloadButton() {
  const getToken = useAppToken()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/linktree-download', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Download failed — is your booking URL set?')
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'linktree.html'
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
      <Button variant="outline" onClick={() => void download()} disabled={busy} className="inline-flex items-center gap-2">
        <Download className="h-4 w-4" />
        {busy ? 'Preparing…' : 'Download link-in-bio page (HTML)'}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
