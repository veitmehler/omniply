'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The one human action a quality-gate-held (needs_review) article requires:
 * release it into Phase B + enrichment → the client's review queue.
 */
export function ReleaseButton({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function release() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/articles/${jobId}/release`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Release failed (${res.status})`)
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Release failed')
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={release}
        disabled={busy}
        className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {busy ? 'Releasing…' : 'Approve & release to client review'}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  )
}
