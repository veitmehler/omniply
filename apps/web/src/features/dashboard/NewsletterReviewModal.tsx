'use client'

import { X, Mail } from 'lucide-react'
import { NewsletterEditionContent } from '@/features/newsletter/NewsletterEditionContent'

/**
 * Full-page newsletter review (metadata edit, regenerate-section controls,
 * HTML preview, AND social posts) as a dashboard modal — per the 2026-07-09
 * discussion, this opens "the whole page" rather than a social-only subset,
 * since /newsletter/[id] is already a focused page (unlike the article
 * workflow page). Shares NewsletterEditionContent with the standalone route
 * so both stay in sync automatically — same chrome convention as
 * SocialReviewModal (explicit close button, no backdrop-click-to-close).
 */
export function NewsletterReviewModal({
  newsletterId,
  title,
  onClose,
  onApproved,
}: {
  newsletterId: string
  title: string
  onClose: () => void
  /** Newsletter approve or social approve-all closes the modal (defaults to onClose). */
  onApproved?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold text-card-foreground">{title}</span>
            <span className="flex-shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Newsletter
            </span>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-background px-6 py-5">
          <NewsletterEditionContent newsletterId={newsletterId} onApproved={onApproved ?? onClose} />
        </div>
      </div>
    </div>
  )
}
