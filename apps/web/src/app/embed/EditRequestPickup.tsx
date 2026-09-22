'use client'

import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { NewsletterReviewModal } from '@/features/dashboard/NewsletterReviewModal'
import { ReviewApproveModal } from '@/features/dashboard/ReviewApproveModal'

interface Target {
  kind: 'article' | 'newsletter'
  id: string
  title: string
  count: number
}

/**
 * Edit-request pickup (review UX): the notification email only lands people
 * in the CRM — THIS banner is the deep link. Shows open requests assigned to
 * the current user and opens the right review surface directly.
 */
export function EditRequestPickup() {
  const [targets, setTargets] = useState<Target[]>([])
  const [open, setOpen] = useState<Target | null>(null)

  function loadTargets() {
    fetch('/api/edit-requests/mine', { cache: 'no-store' })
      .then(async (res) => (res.ok ? (await res.json()).targets ?? [] : []))
      .then(setTargets)
      .catch(() => setTargets([]))
  }

  useEffect(loadTargets, [])

  // Re-check on modal close so the banner disappears the moment the last
  // request is resolved — no page reload needed.
  function closeAndRefresh() {
    setOpen(null)
    loadTargets()
  }

  if (targets.length === 0) return null

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-400/50 bg-amber-500/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageSquarePlus className="h-4 w-4 text-amber-600" />
          Edit requests waiting for you
        </div>
        <div className="space-y-1.5">
          {targets.map((t) => (
            <button
              key={`${t.kind}:${t.id}`}
              onClick={() => setOpen(t)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0 truncate">
                {t.title} <span className="text-xs text-muted-foreground">({t.kind})</span>
              </span>
              <span className="flex-shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-800">
                {t.count} request{t.count > 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {open?.kind === 'newsletter' && (
        <NewsletterReviewModal newsletterId={open.id} title={open.title} onClose={closeAndRefresh} />
      )}
      {open?.kind === 'article' && (
        <ReviewApproveModal
          item={{ kind: 'article', id: open.id, title: open.title }}
          hasNext={false}
          onClose={closeAndRefresh}
          onApproved={closeAndRefresh}
        />
      )}
    </>
  )
}
