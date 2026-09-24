'use client'

import { X, Share2 } from 'lucide-react'
import { ArticleSocialPreview } from '@/features/social/ArticleSocialPreview'

/**
 * Focused modal for reviewing an article's social posts from the dashboard —
 * deliberately NOT a port of the whole /workflow/[jobId] page (that page also
 * carries error logs, schema, syndication, export, all unrelated to social
 * review). Sized/styled to match ReviewApproveModal's large-review-modal
 * convention (explicit close button, no backdrop-click-to-close — avoids
 * losing your place from an accidental click while scrolling a wide panel).
 */
export function SocialReviewModal({
  jobId,
  title,
  onClose,
  onApproved,
}: {
  jobId: string
  title: string
  onClose: () => void
  /** Approve-all inside the panel closes the modal (defaults to onClose). */
  onApproved?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Share2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold text-card-foreground">{title}</span>
            <span className="flex-shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Social Posts
            </span>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <ArticleSocialPreview jobId={jobId} onApproved={onApproved ?? onClose} />
        </div>
      </div>
    </div>
  )
}
