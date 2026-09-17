'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Save,
} from 'lucide-react'
import { useRef } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { NewsletterSocialPreview } from '@/features/social/NewsletterSocialPreview'
import { EditRequestPanel, type PendingEdit } from '@/features/review/EditRequestPanel'
import { buildSectionPatch, type DirtyEdit } from './reverse-map'

type EditableSections = Record<string, unknown>

interface Newsletter extends EditableSections {
  id: string
  status: string
  subjectLine: string | null
  previewText: string | null
  renderedHtml: string | null
  scheduledFor: string | null
  sectionsDisabled: string[] | null
  validation: { completionPercentage?: number; missing?: string[] } | null
  topic: { date: string; topic: string; secondaryTopic: string | null; calendar: { name: string } | null }
}

// Render-section keys the client can switch off (review UX feature 2).
const TOGGLE_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'video', label: 'Video' },
  { key: 'teaser1', label: 'Teaser 1' },
  { key: 'teaser2', label: 'Teaser 2' },
  { key: 'teaser3', label: 'Teaser 3' },
  { key: 'tips', label: 'Tips of the day' },
  { key: 'didYouKnow', label: 'Did you know' },
  { key: 'joke', label: 'Joke' },
  { key: 'trivia', label: 'Trivia' },
  { key: 'recipe', label: 'Recipe 1' },
  { key: 'recipe2', label: 'Recipe 2' },
  { key: 'secondaryArticle', label: 'Secondary article' },
  { key: 'seasonalOffer', label: 'Seasonal offer' },
  { key: 'evergreenOffer', label: 'Evergreen offer' },
]

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'feature', label: 'Feature article' },
  { key: 'secondary', label: 'Secondary article' },
  { key: 'teasers', label: 'Around the web' },
  { key: 'quickHits', label: 'Tips & facts' },
  { key: 'fun', label: 'Trivia & joke' },
  { key: 'modules', label: 'Recipes' },
  { key: 'subject', label: 'Subject line' },
  { key: 'preview', label: 'Preview text' },
  { key: 'summaryImage', label: 'Cover image' },
]

/**
 * The newsletter edition's editable content + social preview — extracted from
 * `/newsletter/[id]/page.tsx` so both the standalone route AND the dashboard's
 * NewsletterReviewModal can render it. Deliberately excludes route-navigation
 * chrome (the "All editions" back link, outer page width/padding) — those stay
 * with each caller, since a modal has no "navigate away" concept and provides
 * its own sizing.
 */
export function NewsletterEditionContent({ newsletterId }: { newsletterId: string }) {
  const [nl, setNl] = useState<Newsletter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [subject, setSubject] = useState('')
  const [preview, setPreview] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}`, { cache: 'no-store' })
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${(await res.text()) || res.statusText}`)
        return
      }
      const data = await res.json()
      const n: Newsletter = data.newsletter
      setNl(n)
      setSubject(n.subjectLine ?? '')
      setPreview(n.previewText ?? '')
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load edition')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsletterId])

  const editable = nl?.status === 'ready_for_review'

  async function saveMeta() {
    setSavingMeta(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectLine: subject, previewText: preview }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNl(data.newsletter)
      setNotice('Saved.')
    } catch (err) {
      setError((err as Error).message ?? 'Save failed')
    } finally {
      setSavingMeta(false)
    }
  }

  async function regenerate(section: string) {
    setRegenerating(section)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      const n: Newsletter = data.newsletter
      setNl(n)
      setSubject(n.subjectLine ?? '')
      setPreview(n.previewText ?? '')
      setNotice(`Regenerated: ${section}.`)
    } catch (err) {
      setError((err as Error).message ?? 'Regenerate failed')
    } finally {
      setRegenerating(null)
    }
  }

  async function approve() {
    setApproving(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/approve`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNotice('Approved — the email is scheduled.')
      await load()
    } catch (err) {
      setError((err as Error).message ?? 'Approve failed')
    } finally {
      setApproving(false)
    }
  }

  const [savingSection, setSavingSection] = useState(false)
  const [videoBusy, setVideoBusy] = useState<'next' | 'link' | null>(null)
  const [videoLink, setVideoLink] = useState('')

  // In-preview WYSIWYG (review UX): edit-mode HTML + dirty section map.
  const [editHtml, setEditHtml] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Record<string, DirtyEdit>>({})
  const [requestMode, setRequestMode] = useState(false)
  const [selDraft, setSelDraft] = useState<Omit<PendingEdit, 'note'> | null>(null)
  const [requests, setRequests] = useState<
    { id: string; quotedText: string; prefixContext: string | null; suffixContext: string | null; note: string; status: string; createdAt: string }[]
  >([])
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [requestDetail, setRequestDetail] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const dirtyCount = Object.keys(dirty).length

  async function loadEditPreview() {
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/edit-preview`, { cache: 'no-store' })
      if (res.ok) setEditHtml(await res.text())
    } catch {
      /* preview falls back to renderedHtml */
    }
  }

  async function loadRequests() {
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/edit-requests`, { cache: 'no-store' })
      if (res.ok) setRequests((await res.json()).requests ?? [])
    } catch {
      /* panel simply stays empty */
    }
  }

  useEffect(() => {
    if (nl?.status === 'ready_for_review') {
      void loadEditPreview()
      void loadRequests()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nl?.status, newsletterId])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data ?? {}
      if (d.type === 'nl-edit' && typeof d.section === 'string') {
        setDirty((prev) => ({ ...prev, [d.section]: { html: String(d.html ?? ''), text: String(d.text ?? '') } }))
      } else if (d.type === 'nl-selection' && requestMode) {
        setSelDraft({ quotedText: d.quotedText ?? '', prefixContext: d.prefixContext ?? '', suffixContext: d.suffixContext ?? '' })
      } else if (d.type === 'nl-ready') {
        const quotes = requests.filter((r) => r.status === 'open').map((r) => r.quotedText)
        if (quotes.length) iframeRef.current?.contentWindow?.postMessage({ type: 'nl-highlight', quotes }, '*')
        if (requestMode) iframeRef.current?.contentWindow?.postMessage({ type: 'nl-set-request-mode', on: true }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [requestMode, requests])

  const [controlsOpen, setControlsOpen] = useState(true)

  function toggleRequestMode() {
    const next = !requestMode
    setRequestMode(next)
    setSelDraft(null)
    // The request panel needs the width — tuck the controls away (re-openable).
    if (next) setControlsOpen(false)
    iframeRef.current?.contentWindow?.postMessage({ type: 'nl-set-request-mode', on: next }, '*')
  }

  async function saveWysiwyg() {
    if (!nl || dirtyCount === 0) return
    const patch = buildSectionPatch(dirty, nl as unknown as Record<string, unknown>)
    await patchEdition(patch, 'Saved — preview updated.')
    setDirty({})
    await loadEditPreview()
  }

  async function setRequestStatus(id: string, status: 'resolved' | 'open') {
    await fetch(`/api/edit-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    await loadRequests()
  }

  function scrollToPin(quote: string) {
    iframeRef.current?.contentWindow?.postMessage({ type: 'nl-scroll-to', quote }, '*')
  }

  async function patchEdition(patch: Record<string, unknown>, doneNotice: string) {
    setSavingSection(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNl(data.newsletter)
      setNotice(doneNotice)
    } catch (err) {
      setError((err as Error).message ?? 'Save failed')
    } finally {
      setSavingSection(false)
    }
  }

  async function changeVideo(url?: string) {
    setVideoBusy(url ? 'link' : 'next')
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(url ? { url } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNl(data.newsletter)
      setVideoLink('')
      setNotice(url ? 'Video replaced with your link.' : 'Found another video.')
    } catch (err) {
      setError((err as Error).message ?? 'Video change failed')
    } finally {
      setVideoBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading edition…
      </div>
    )
  }

  if (error && !nl) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="font-mono text-xs">{error}</div>
      </div>
    )
  }

  if (!nl) return null

  const completion = nl.validation?.completionPercentage
  const missing = nl.validation?.missing ?? []

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-foreground">
            {nl.subjectLine || nl.topic.topic}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(nl.topic.date).toLocaleDateString(undefined, { timeZone: 'UTC' })}
            {nl.topic.calendar ? ` · ${nl.topic.calendar.name}` : ''} ·{' '}
            <span className="capitalize">{nl.status.replace(/_/g, ' ')}</span>
            {typeof completion === 'number' ? ` · ${completion}% complete` : ''}
          </p>
        </div>
        {editable && (
          <button
            onClick={approve}
            disabled={approving}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve &amp; schedule
          </button>
        )}
      </div>

      {notice && <div className="mb-3 text-sm text-green-700">{notice}</div>}
      {error && (
        <div className="mb-3 flex items-start gap-2 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {missing.length > 0 && (
        <div className="mb-3 text-xs text-amber-700">Incomplete sections: {missing.join(', ')}</div>
      )}

      <div className={`grid gap-6 ${controlsOpen ? 'lg:grid-cols-[320px_1fr]' : 'lg:grid-cols-[36px_1fr]'}`}>
        {/* Controls (collapsible — the request panel needs the width) */}
        {!controlsOpen && (
          <button
            onClick={() => setControlsOpen(true)}
            title="Show controls"
            className="hidden h-24 items-center justify-center self-start rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted lg:flex"
          >
            »
          </button>
        )}
        <div className={`space-y-4 ${controlsOpen ? '' : 'lg:hidden'}`}>
          {editable && (
            <button
              onClick={() => setControlsOpen(false)}
              className="hidden w-full items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted lg:flex"
            >
              « Hide controls
            </button>
          )}
          {editable && requests.length > 0 && (
            <div className="rounded-xl border border-border bg-card">
              <button
                onClick={() => setRequestsOpen((v) => !v)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit requests</span>
                <span className="flex items-center gap-2">
                  {requests.some((r) => r.status === 'open') && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {requests.filter((r) => r.status === 'open').length} open
                    </span>
                  )}
                  <span className="text-muted-foreground">{requestsOpen ? '▾' : '▸'}</span>
                </span>
              </button>
              {requestsOpen && (
                <div className="space-y-1.5 px-4 pb-4">
                  {requests.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRequestDetail(r.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-muted"
                    >
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${r.status === 'open' ? 'bg-amber-500' : 'bg-green-600'}`} />
                      <span className="min-w-0 truncate italic text-muted-foreground">“{r.quotedText}”</span>
                    </button>
                  ))}
                  {requests.length > 0 && requests.every((r) => r.status !== 'open') && (
                    <button
                      onClick={() => void fetch(`/api/newsletters/${newsletterId}/request-review`, { method: 'POST' }).then(() => setNotice('Sent back for review.'))}
                      className="mt-1 w-full rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      All done — notify the reviewer
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {requestDetail && (() => {
            const r = requests.find((x) => x.id === requestDetail)
            if (!r) return null
            return (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setRequestDetail(null)}>
                <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What to change</div>
                  <p className="mb-4 text-sm font-medium text-foreground">{r.note}</p>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Where</div>
                  <p className="mb-4 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">
                    {r.prefixContext ? `…${r.prefixContext}` : ''}
                    <mark className="bg-amber-200 not-italic text-foreground">{r.quotedText}</mark>
                    {r.suffixContext ? `${r.suffixContext}…` : ''}
                  </p>
                  <div className="mb-4 text-[11px] text-muted-foreground">
                    Requested {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => { scrollToPin(r.quotedText); setRequestDetail(null) }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      Show in email
                    </button>
                    <div className="flex gap-2">
                      {r.status === 'open' ? (
                        <button
                          onClick={() => { void setRequestStatus(r.id, 'resolved'); setRequestDetail(null) }}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        >
                          Mark done
                        </button>
                      ) : (
                        <button
                          onClick={() => { void setRequestStatus(r.id, 'open'); setRequestDetail(null) }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Reopen
                        </button>
                      )}
                      <button onClick={() => setRequestDetail(null)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
          {editable && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Video</h3>
              <button
                onClick={() => void changeVideo()}
                disabled={videoBusy !== null}
                className="mb-2 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                Find another video
                {videoBusy === 'next' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              <div className="flex gap-2">
                <input
                  value={videoLink}
                  onChange={(e) => setVideoLink(e.target.value)}
                  placeholder="Paste a YouTube link…"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={() => videoLink.trim() && void changeVideo(videoLink.trim())}
                  disabled={videoBusy !== null || !videoLink.trim()}
                  className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {videoBusy === 'link' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Use'}
                </button>
              </div>
            </div>
          )}

          {editable && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Regenerate a section
              </h3>
              <div className="space-y-1.5">
                {SECTIONS.filter((s) => s.key !== 'secondary' || nl.topic.secondaryTopic).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => regenerate(s.key)}
                    disabled={regenerating !== null}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {s.label}
                    {regenerating === s.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                ))}
                <button
                  onClick={() => regenerate('all')}
                  disabled={regenerating !== null}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Regenerate everything
                  {regenerating === 'all' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          )}

          {editable && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sections in this edition
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">Untick anything you don&apos;t want — the preview updates.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TOGGLE_SECTIONS.map((t) => {
                  const disabled = (nl.sectionsDisabled ?? []).includes(t.key)
                  return (
                    <label key={t.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!disabled}
                        disabled={savingSection}
                        onChange={() => {
                          const cur = new Set(nl.sectionsDisabled ?? [])
                          if (disabled) cur.delete(t.key)
                          else cur.add(t.key)
                          void patchEdition({ sectionsDisabled: [...cur] }, disabled ? `${t.label} shown again.` : `${t.label} hidden.`)
                        }}
                      />
                      {t.label}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email metadata
            </h3>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject line</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!editable}
              className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Preview text</label>
            <input
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              disabled={!editable}
              className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
            {editable && (
              <button
                onClick={saveMeta}
                disabled={savingMeta}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {savingMeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            )}
          </div>

        </div>

        {/* Preview — editable in place when ready_for_review (review WYSIWYG) */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-2">
          {editable && (
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="text-xs text-muted-foreground">
                {requestMode
                  ? 'Highlight text to request an edit from a teammate.'
                  : 'Click into the email to edit it directly.'}
                {dirtyCount > 0 && <span className="ml-2 text-amber-600">• {dirtyCount} unsaved section(s)</span>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleRequestMode}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${requestMode ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  {requestMode ? 'Done requesting' : 'Request edits'}
                </button>
                <button
                  onClick={() => void saveWysiwyg()}
                  disabled={dirtyCount === 0 || savingSection}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {savingSection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save changes
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-1 gap-0">
            <div className="flex min-w-0 flex-1 flex-col">
              {editable && editHtml ? (
                <iframe
                  ref={iframeRef}
                  title="Newsletter preview (editable)"
                  srcDoc={editHtml}
                  className="min-h-[800px] w-full flex-1 rounded-lg border-0 bg-white"
                />
              ) : nl.renderedHtml ? (
                <iframe
                  title="Newsletter preview"
                  srcDoc={nl.renderedHtml}
                  className="min-h-[800px] w-full flex-1 rounded-lg border-0 bg-white"
                />
              ) : (
                <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
                  No preview yet.
                </div>
              )}
            </div>
            {requestMode && (
              <EditRequestPanel
                what="email"
                selDraft={selDraft}
                onClearSelection={() => setSelDraft(null)}
                sendUrl={`/api/newsletters/${newsletterId}/edit-requests`}
                onSent={() => {
                  setRequestMode(false)
                  iframeRef.current?.contentWindow?.postMessage({ type: 'nl-set-request-mode', on: false }, '*')
                  void loadRequests()
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Full-width: social posts generated from this newsletter */}
      <NewsletterSocialPreview newsletterId={newsletterId} />
    </div>
  )
}
