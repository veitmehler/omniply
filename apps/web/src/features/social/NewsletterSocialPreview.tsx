'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import { CalendarClock } from 'lucide-react'
import { SocialPreviewPanel, type SocialAutomationRunRow } from './SocialPreviewPanel'

/** Preview + approve the newsletter-day social posts (weekly cadence). */
export function NewsletterSocialPreview({ newsletterId, onApproved }: { newsletterId: string; onApproved?: () => void }) {
  const getToken = useAppToken()
  const [runs, setRuns] = useState<SocialAutomationRunRow[]>([])
  const [retryingSpec, setRetryingSpec] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/social-automation`, { cache: 'no-store' })
      if (res.ok) setRuns((await res.json()).runs ?? [])
    } finally {
      setLoaded(true)
    }
  }, [newsletterId])

  useEffect(() => {
    void fetchRuns()
  }, [fetchRuns])

  // Poll while a run is still generating.
  useEffect(() => {
    const active = runs.some((r) => ['pending', 'processing', 'scheduling'].includes(r.status))
    if (!active) return
    const t = setInterval(() => void fetchRuns(), 5000)
    return () => clearInterval(t)
  }, [runs, fetchRuns])

  const handleRetrySpec = useCallback(
    async (runId: string, slotKey: string) => {
      setRetryingSpec(`${runId}-${slotKey}`)
      try {
        const token = await getToken()
        await fetch(`/api/social-automation/${runId}/retry/${slotKey}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        await fetchRuns()
      } finally {
        setRetryingSpec(null)
      }
    },
    [getToken, fetchRuns],
  )

  if (!loaded || runs.length === 0) return null

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <CalendarClock className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-card-foreground">Social posts</h2>
          <p className="text-xs text-muted-foreground">
            3 posts generated from this newsletter — preview captions and media, then approve to schedule via Omniply.
          </p>
        </div>
      </div>
      <SocialPreviewPanel
        onApproved={onApproved}
        runs={runs}
        onRefresh={fetchRuns}
        onRetryFailed={handleRetrySpec}
        retryingSpec={retryingSpec}
      />
    </div>
  )
}
