'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import { Loader2 } from 'lucide-react'
import { SocialPreviewPanel, type SocialAutomationRunRow } from './SocialPreviewPanel'

/**
 * Preview + approve the article-day social posts. Self-contained data-fetching,
 * mirroring NewsletterSocialPreview's pattern — deliberately does NOT reuse
 * useWorkflowJob (that hook also drives error logs/schema/syndication/export,
 * all unrelated to social review). No section header here — the modal chrome
 * that hosts this owns the title (see dashboard/SocialReviewModal.tsx).
 */
export function ArticleSocialPreview({ jobId, onApproved }: { jobId: string; onApproved?: () => void }) {
  const getToken = useAppToken()
  const [runs, setRuns] = useState<SocialAutomationRunRow[]>([])
  const [retryingSpec, setRetryingSpec] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${jobId}/social-automation`, { cache: 'no-store' })
      if (res.ok) setRuns((await res.json()).runs ?? [])
    } finally {
      setLoaded(true)
    }
  }, [jobId])

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

  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading social posts…
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No social posts yet for this article.
      </div>
    )
  }

  return (
    <SocialPreviewPanel
      onApproved={onApproved}
      jobId={jobId}
      runs={runs}
      onRefresh={fetchRuns}
      onRetryFailed={handleRetrySpec}
      retryingSpec={retryingSpec}
    />
  )
}
