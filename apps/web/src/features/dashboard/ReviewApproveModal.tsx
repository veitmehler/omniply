'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Loader2, X, Check, Save, FileText, Mail, ArrowRight, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import '@/app/article-typography.css'
import { EditRequestPanel, type PendingEdit } from '@/features/review/EditRequestPanel'
import { EditRequestList, jumpToQuote, type EditRequest } from '@/features/review/EditRequestList'

export interface ReviewItem {
  kind: 'article' | 'newsletter'
  id: string // jobId for article, newsletterId for newsletter
  title: string
  /** Automated final Google-guidelines verdict (articles; parity batch B). */
  finalQuality?: { verdict: string; reasons: string[] } | null
}

/** Capture the current text selection inside a container as a quote + context. */
function captureSelection(container: HTMLElement): Omit<PendingEdit, 'note'> | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = sel.toString().trim()
  if (!text || !container.contains(sel.anchorNode)) return null
  const full = container.textContent ?? ''
  const idx = full.indexOf(text)
  return {
    quotedText: text,
    prefixContext: idx > 0 ? full.slice(Math.max(0, idx - 40), idx) : '',
    suffixContext: idx >= 0 ? full.slice(idx + text.length, idx + text.length + 40) : '',
  }
}

export function ReviewApproveModal({
  item,
  hasNext,
  onClose,
  onApproved,
}: {
  item: ReviewItem
  hasNext: boolean
  onClose: () => void
  onApproved: () => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [openRequests, setOpenRequests] = useState(0)
  const [requestList, setRequestList] = useState<EditRequest[]>([])
  const [requestListOpen, setRequestListOpen] = useState(false)

  async function refreshRequests() {
    const res = await fetch(`/api/articles/${item.id}/edit-requests`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setRequestList(data.requests ?? [])
      setOpenRequests(data.openCount ?? 0)
    }
  }

  async function setRequestStatus(id: string, status: 'resolved' | 'open') {
    // Marking a request done is a checkpoint — flush unsaved content first,
    // and REFUSE to resolve if the save failed (a resolved request must never
    // vouch for an edit that didn't persist).
    if (dirtyRef.current) {
      const ok = await saveEdits()
      if (!ok) return
    }
    await fetch(`/api/edit-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    await refreshRequests()
  }

  // request-edits mode
  const [requestMode, setRequestMode] = useState(false)
  const [selDraft, setSelDraft] = useState<Omit<PendingEdit, 'note'> | null>(null)
  const [rewriting, setRewriting] = useState(false)

  async function requestRewrite() {
    setRewriting(true)
    try {
      const res = await fetch(`/api/articles/${item.id}/rewrite`, { method: 'POST' })
      if (res.ok) {
        toast.success('Rewrite started — the article returns for review when it finishes.')
        onClose()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not start the rewrite')
      }
    } finally {
      setRewriting(false)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // `dirty` mirrored in a ref so async handlers read the latest value.
  const dirtyRef = useRef(false)
  // Floating navigator through open edit requests.
  const [navIdx, setNavIdx] = useState(0)
  // Requests whose quoted text vanished after a save — "looks done" nudges.
  const [nudgeIds, setNudgeIds] = useState<Set<string>>(new Set())
  const requestListRef = useRef<EditRequest[]>([])
  useEffect(() => { requestListRef.current = requestList }, [requestList])

  const isArticle = item.kind === 'article'

  function markDirty() {
    dirtyRef.current = true
    setDirty(true)
  }

  // OWNERSHIP FIX (2026-09-22): the editable body's HTML is written
  // imperatively ONCE per load — React never renders it, so no re-render or
  // remount can silently restore stale content over the user's edits (the
  // "reverted word" bug). Saves happen at intent boundaries: editor blur,
  // Mark done, and close — never on a typing timer that could snapshot a
  // half-finished state.
  useEffect(() => {
    if (!loading && isArticle && html !== null && bodyRef.current) {
      bodyRef.current.innerHTML = html
    }
  }, [loading, isArticle, html])

  async function handleClose() {
    if (isArticle && dirtyRef.current) {
      const ok = await saveEdits()
      if (!ok && !window.confirm('Saving your edits failed. Close anyway and lose them?')) return
    }
    onClose()
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setHtml(null); setDirty(false); dirtyRef.current = false; setReachedEnd(false); setNavIdx(0)
    setRequestMode(false); setSelDraft(null); setOpenRequests(0)
    ;(async () => {
      try {
        if (isArticle) {
          const [aRes, erRes] = await Promise.all([
            fetch(`/api/articles/${item.id}`, { cache: 'no-store' }),
            fetch(`/api/articles/${item.id}/edit-requests`, { cache: 'no-store' }),
          ])
          if (aRes.ok && !cancelled) {
            const { job } = await aRes.json()
            setHtml(job?.sitePage?.bodyHtml ?? '<p>(No content found.)</p>')
          }
          if (erRes.ok && !cancelled) {
            const er = await erRes.json()
            setOpenRequests(er.openCount ?? 0)
            setRequestList(er.requests ?? [])
          }
        } else {
          const res = await fetch(`/api/newsletters/${item.id}`, { cache: 'no-store' })
          if (res.ok && !cancelled) setHtml((await res.json()).newsletter?.renderedHtml ?? '<p>(No content found.)</p>')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [item.id, isArticle])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 48) setReachedEnd(true)
  }, [])

  useEffect(() => {
    if (!loading && scrollRef.current) {
      const el = scrollRef.current
      if (el.scrollHeight <= el.clientHeight + 48) setReachedEnd(true)
    }
  }, [loading, html])

  async function saveEdits(): Promise<boolean> {
    if (!isArticle || !bodyRef.current) return true
    setSaving(true)
    try {
      const res = await fetch(`/api/articles/${item.id}/content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: bodyRef.current.innerHTML }),
      })
      if (!res.ok) { toast.error('Failed to save edits'); return false }
      dirtyRef.current = false
      setDirty(false)
      // "Looks done" nudges: any open request whose quoted text no longer
      // appears in the edited body was almost certainly addressed.
      if (bodyRef.current) {
        const full = bodyRef.current.textContent ?? ''
        const missing = new Set<string>()
        for (const r of requestListRef.current) {
          if (r.status !== 'open') continue
          if (!full.includes(r.quotedText) && !full.includes(r.quotedText.slice(0, 60))) missing.add(r.id)
        }
        setNudgeIds(missing)
      }
      return true
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    setApproving(true)
    try {
      if (isArticle && dirty) {
        const ok = await saveEdits()
        if (!ok) return
      }
      const url = isArticle ? `/api/articles/${item.id}/publish` : `/api/newsletters/${item.id}/approve`
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Failed to approve')
        return
      }
      toast.success(isArticle ? 'Published — social posts are being generated.' : 'Approved — newsletter scheduled.')
      onApproved()
    } finally {
      setApproving(false)
    }
  }


  const approveBlocked = openRequests > 0

  // Floating navigator through the open requests: jump/resolve without ever
  // scrolling back to the list at the top.
  const openList = requestList.filter((r) => r.status === 'open')
  const navCurrent = openList.length > 0 ? openList[Math.min(navIdx, openList.length - 1)] : null

  function navJump(offset: number) {
    if (openList.length === 0) return
    const next = (Math.min(navIdx, openList.length - 1) + offset + openList.length) % openList.length
    setNavIdx(next)
    if (bodyRef.current) jumpToQuote(bodyRef.current, openList[next].quotedText)
  }

  async function navMarkDone() {
    if (!navCurrent) return
    await setRequestStatus(navCurrent.id, 'resolved')
    // The list shrinks; the same index now points at the next open request.
    if (bodyRef.current && openList.length > 1) {
      const next = openList.filter((r) => r.id !== navCurrent.id)[Math.min(navIdx, openList.length - 2)]
      if (next) jumpToQuote(bodyRef.current, next.quotedText)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {isArticle ? <FileText className="h-4 w-4 text-muted-foreground" /> : <Mail className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate text-sm font-semibold text-card-foreground">{item.title}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{isArticle ? 'Article' : 'Newsletter'}</span>
          </div>
          <button onClick={() => void handleClose()} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {approveBlocked && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            <button onClick={() => setRequestListOpen(true)} className="underline decoration-dotted underline-offset-2">
              {openRequests} edit request(s) are open with a teammate
            </button>{' '}
            — publishing is paused until they&apos;re resolved.
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          {/* Floating pill: save-state chip + edit-request navigator. */}
          {isArticle && !requestMode && !loading && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-6">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
                <button
                  onClick={() => { if (dirty) void saveEdits() }}
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                    saving
                      ? 'text-muted-foreground'
                      : dirty
                        ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25'
                        : 'text-green-700'
                  }`}
                  title={dirty ? 'Save now' : 'All edits saved'}
                >
                  {saving ? 'Saving…' : dirty ? '● Unsaved' : '✓ Saved'}
                </button>
                {navCurrent && (
                  <>
                    <span className="text-border">|</span>
                    <button
                      onClick={() => navJump(-1)}
                      disabled={openList.length < 2}
                      className="rounded-full px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
                      aria-label="Previous edit request"
                    >
                      ←
                    </button>
                    <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                      Edit {Math.min(navIdx, openList.length - 1) + 1}/{openList.length}
                    </span>
                    <button
                      onClick={() => { if (bodyRef.current) jumpToQuote(bodyRef.current, navCurrent.quotedText) }}
                      className="max-w-[14rem] truncate text-xs italic text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
                      title={`${navCurrent.note} — “${navCurrent.quotedText}”`}
                    >
                      “{navCurrent.quotedText}”
                    </button>
                    <button
                      onClick={() => void navMarkDone()}
                      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        nudgeIds.has(navCurrent.id)
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      }`}
                    >
                      {nudgeIds.has(navCurrent.id) ? 'Looks done — mark it ✓' : 'Mark done'}
                    </button>
                    <button
                      onClick={() => navJump(1)}
                      disabled={openList.length < 2}
                      className="rounded-full px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
                      aria-label="Next edit request"
                    >
                      →
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {/* Content */}
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-background px-6 py-5">
            {isArticle && item.finalQuality && !loading && (
              item.finalQuality.verdict === 'pass' ? (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm text-foreground">
                  <span aria-hidden>✅</span> Passed the automated Google quality check.
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-amber-900">
                    ⚠️ The automated Google quality check flagged this article
                    {item.finalQuality.verdict === 'error' ? ' (the check itself failed to run)' : ''}.
                  </div>
                  {item.finalQuality.reasons.length > 0 && (
                    <ul className="mb-2 list-disc pl-5 text-amber-900/90">
                      {item.finalQuality.reasons.slice(0, 5).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    disabled={rewriting}
                    onClick={() => void requestRewrite()}
                  >
                    {rewriting ? 'Starting rewrite…' : 'Rewrite this article'}
                  </button>
                  <span className="ml-2 text-xs text-amber-800/80">You can still approve as-is if you disagree.</span>
                </div>
              )
            )}
            {loading ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
            ) : isArticle ? (
              <>
              {requestList.length > 0 && (
                <div className="mb-3">
                  <EditRequestList
                    requests={requestList}
                    onStatus={(id, st) => void setRequestStatus(id, st)}
                    onJump={(q) => bodyRef.current && jumpToQuote(bodyRef.current, q)}
                    onNotify={() =>
                      void fetch(`/api/articles/${item.id}/request-review`, { method: 'POST' }).then(() =>
                        toast.success('Sent back for review.'),
                      )
                    }
                    open={requestListOpen}
                    onOpenChange={setRequestListOpen}
                  />
                </div>
              )}
              {/* innerHTML is set imperatively (ownership fix) — no
                  dangerouslySetInnerHTML, so React can never rewrite edits. */}
              <div
                ref={bodyRef}
                contentEditable={!requestMode}
                suppressContentEditableWarning
                onInput={markDirty}
                onBlur={() => { if (dirtyRef.current) void saveEdits() }}
                onMouseUp={() => { if (requestMode && bodyRef.current) setSelDraft(captureSelection(bodyRef.current)) }}
                className="article-body max-w-none rounded-lg bg-card p-6 text-foreground focus:outline-none"
              />
              </>
            ) : (
              <div className="mx-auto max-w-2xl rounded-lg bg-white p-2 shadow-sm" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
            )}
          </div>

          {/* Request-edits rail */}
          {requestMode && (
            <EditRequestPanel
              what="article"
              selDraft={selDraft}
              onClearSelection={() => setSelDraft(null)}
              sendUrl={`/api/articles/${item.id}/edit-requests`}
              onSent={() => {
                setRequestMode(false)
                void handleClose()
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="text-xs text-muted-foreground">
            {reachedEnd ? <span className="text-green-600">✓ Reviewed to the end</span> : 'Scroll to the bottom to enable Approve'}
            {isArticle && dirty && <span className="ml-2 text-amber-600">• unsaved edits</span>}
          </div>
          <div className="flex items-center gap-2">
            {isArticle && (
              <Button variant="outline" onClick={() => setRequestMode((v) => !v)}>
                <MessageSquarePlus className="h-4 w-4" />
                {requestMode ? 'Done requesting' : 'Request edits'}
              </Button>
            )}
            {isArticle && (
              <Button variant="outline" onClick={saveEdits} disabled={!dirty || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            )}
            <Button onClick={approve} disabled={!reachedEnd || approving || approveBlocked}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isArticle ? 'Approve & Publish' : 'Approve & Schedule'}
              {hasNext && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
