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
import { EditRequestList, quoteAnchorMissing } from '@/features/review/EditRequestList'

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
  topic?: { date: string; topic: string; secondaryTopic: string | null; calendar: { name: string } | null }
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
export function NewsletterEditionContent({ newsletterId, onApproved }: { newsletterId: string; onApproved?: () => void }) {
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
      // Close the hosting popover — staying open after approval reads as
      // "nothing happened" (Veit 2026-09-24). Standalone page: no-op.
      onApproved?.()
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [bridgeReady, setBridgeReady] = useState(false)
  const dirtyCount = Object.keys(dirty).length

  // Save-on-blur model (2026-09-22): refs mirror the latest dirty map +
  // edition so blur/unmount flushes read fresh state. `uiDirty` tracks
  // sections being typed in (bridge nl-dirty) before their blur-save lands.
  const dirtyRef = useRef<Record<string, DirtyEdit>>({})
  const nlRef = useRef<Newsletter | null>(null)
  const savingRef = useRef(false)
  const [uiDirty, setUiDirty] = useState(false)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { nlRef.current = nl }, [nl])
  // Floating navigator through open edit requests + "looks done" nudges.
  const [navIdx, setNavIdx] = useState(0)
  const [nudgeIds, setNudgeIds] = useState<Set<string>>(new Set())
  const requestsRef = useRef<typeof requests>([])
  useEffect(() => { requestsRef.current = requests }, [requests])

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
      if (d.type === 'nl-dirty') {
        setUiDirty(true)
      } else if (d.type === 'nl-edit' && typeof d.section === 'string') {
        // Section blurred — its final content arrives here; save immediately.
        const entry = { html: String(d.html ?? ''), text: String(d.text ?? '') }
        setDirty((prev) => ({ ...prev, [d.section]: entry }))
        dirtyRef.current = { ...dirtyRef.current, [d.section]: entry }
        void autosaveFlush()
      } else if (d.type === 'nl-selection' && requestMode) {
        setSelDraft({ quotedText: d.quotedText ?? '', prefixContext: d.prefixContext ?? '', suffixContext: d.suffixContext ?? '' })
      } else if (d.type === 'nl-ready') {
        // Highlighting happens in the ready+requests effect below (the request
        // fetch races this message — sending here shipped an empty list).
        setBridgeReady(true)
        if (requestMode) iframeRef.current?.contentWindow?.postMessage({ type: 'nl-set-request-mode', on: true }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // autosaveFlush only touches refs — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestMode, requests])

  const [controlsOpen, setControlsOpen] = useState(true)

  // Pins: send whenever the bridge is up AND requests are known (re-sent on
  // resolve/reopen; the bridge dedupes).
  useEffect(() => {
    if (!bridgeReady) return
    const quotes = requests
      .filter((r) => r.status === 'open')
      .map((r) => ({ q: r.quotedText, p: r.prefixContext ?? '', s: r.suffixContext ?? '' }))
    if (quotes.length) iframeRef.current?.contentWindow?.postMessage({ type: 'nl-highlight', quotes }, '*')
  }, [bridgeReady, requests])

  useEffect(() => {
    // A fresh edit-preview (after save) resets the bridge.
    setBridgeReady(false)
  }, [editHtml])

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
    await patchEdition({}, 'Saved — preview updated.')
  }

  /**
   * Flush of blurred-section edits (save-on-blur model). Does NOT reload the
   * edit iframe (a reload would steal the caret — the iframe already shows
   * exactly what was saved) and only clears dirty entries unchanged since the
   * snapshot so a section re-edited mid-request is never lost. Returns
   * whether the save persisted (Mark done refuses to resolve on failure).
   */
  async function autosaveFlush(): Promise<boolean> {
    const edition = nlRef.current
    const snap = dirtyRef.current
    if (!edition || Object.keys(snap).length === 0) return true
    if (savingRef.current) return true // in-flight save carries the map ref state
    savingRef.current = true
    try {
      const merged = buildSectionPatch(snap, edition as unknown as Record<string, unknown>)
      const res = await fetch(`/api/newsletters/${newsletterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (!res.ok) {
        setError('Saving your edits failed — they are still in the editor, try Save changes.')
        return false
      }
      const data = await res.json().catch(() => ({}))
      if (data.newsletter) setNl(data.newsletter)
      setDirty((prev) => {
        const next = { ...prev }
        for (const k of Object.keys(snap)) if (prev[k] === snap[k]) delete next[k]
        if (Object.keys(next).length === 0) setUiDirty(false)
        return next
      })
      setNotice('Saved.')
      // "Looks done" nudges: open requests whose quoted text no longer
      // appears in the (same-origin srcdoc) edit iframe were likely handled.
      const doc = iframeRef.current?.contentDocument
      if (doc) {
        const full = doc.body?.textContent ?? ''
        const missing = new Set<string>()
        for (const r of requestsRef.current) {
          if (r.status !== 'open') continue
          if (quoteAnchorMissing(full, r.quotedText, r.prefixContext, r.suffixContext)) missing.add(r.id)
        }
        setNudgeIds(missing)
      }
      return true
    } catch {
      setError('Saving your edits failed — they are still in the editor, try Save changes.')
      return false
    } finally {
      savingRef.current = false
    }
  }

  // Flush on unmount (modal close / navigation): keepalive lets the PATCH
  // finish even as the page goes away.
  useEffect(() => () => {
    const snap = dirtyRef.current
    const edition = nlRef.current
    if (edition && Object.keys(snap).length > 0) {
      const merged = buildSectionPatch(snap, edition as unknown as Record<string, unknown>)
      void fetch(`/api/newsletters/${newsletterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
        keepalive: true,
      }).catch(() => null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function setRequestStatus(id: string, status: 'resolved' | 'open') {
    // Resolving a request is a checkpoint — flush content edits first, and
    // refuse to resolve if the save failed.
    if (Object.keys(dirtyRef.current).length > 0) {
      const ok = await autosaveFlush()
      if (!ok) return
    }
    await fetch(`/api/edit-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    await loadRequests()
  }

  function scrollToPin(quote: string, prefix?: string | null, suffix?: string | null) {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'nl-scroll-to', quote, prefix: prefix ?? '', suffix: suffix ?? '' },
      '*',
    )
  }

  async function patchEdition(patch: Record<string, unknown>, doneNotice: string) {
    setSavingSection(true)
    setNotice(null)
    setError(null)
    try {
      // Unsaved in-preview edits ride along (option B, Veit 2026-09-17):
      // every mutation refreshes the edit iframe, which would discard them.
      let merged = patch
      if (nl && Object.keys(dirty).length > 0) {
        merged = { ...buildSectionPatch(dirty, nl as unknown as Record<string, unknown>), ...patch }
      }
      const res = await fetch(`/api/newsletters/${newsletterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNl(data.newsletter)
      setDirty({})
      setNotice(doneNotice)
      // The visible editable iframe must reflect the mutation (stale-preview
      // bug: toggles saved but the edit-mode render never refreshed).
      await loadEditPreview()
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
      await loadEditPreview()
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

  // Floating navigator: jump/resolve open requests without scrolling back to
  // the list in the controls column (parity with the article modal).
  const openList = requests.filter((r) => r.status === 'open')
  const navCurrent = openList.length > 0 ? openList[Math.min(navIdx, openList.length - 1)] : null

  function navJump(offset: number) {
    if (openList.length === 0) return
    const next = (Math.min(navIdx, openList.length - 1) + offset + openList.length) % openList.length
    setNavIdx(next)
    scrollToPin(openList[next].quotedText, openList[next].prefixContext, openList[next].suffixContext)
  }

  async function navMarkDone() {
    if (!navCurrent) return
    await setRequestStatus(navCurrent.id, 'resolved')
    if (openList.length > 1) {
      const next = openList.filter((r) => r.id !== navCurrent.id)[Math.min(navIdx, openList.length - 2)]
      if (next) scrollToPin(next.quotedText, next.prefixContext, next.suffixContext)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-foreground">
            {nl.subjectLine || nl.topic?.topic || 'Newsletter'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {nl.topic?.date ? new Date(nl.topic.date).toLocaleDateString(undefined, { timeZone: 'UTC' }) : ''}
            {nl.topic?.calendar ? ` · ${nl.topic.calendar.name}` : ''} ·{' '}
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
          {editable && (
            <EditRequestList
              requests={requests}
              onStatus={(id, st) => void setRequestStatus(id, st)}
              onJump={(q, p2, s2) => scrollToPin(q, p2, s2)}
              onNotify={() =>
                void fetch(`/api/newsletters/${newsletterId}/request-review`, { method: 'POST' }).then(() =>
                  setNotice('Sent back for review.'),
                )
              }
            />
          )}
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
                {SECTIONS.filter((s) => s.key !== 'secondary' || nl.topic?.secondaryTopic).map((s) => (
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
        <div className="relative flex flex-col rounded-xl border border-border bg-card p-2">
          {editable && !requestMode && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-6">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
                <button
                  onClick={() => {
                    // Blur the active section inside the (same-origin) edit
                    // iframe — its blur handler ships the content, which the
                    // parent then saves.
                    const active = iframeRef.current?.contentDocument?.activeElement as HTMLElement | null
                    active?.blur?.()
                  }}
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                    savingSection || savingRef.current
                      ? 'text-muted-foreground'
                      : uiDirty || dirtyCount > 0
                        ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25'
                        : 'text-green-700'
                  }`}
                  title={uiDirty || dirtyCount > 0 ? 'Save now' : 'All edits saved'}
                >
                  {savingSection || savingRef.current ? 'Saving…' : uiDirty || dirtyCount > 0 ? '● Unsaved' : '✓ Saved'}
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
                      onClick={() => scrollToPin(navCurrent.quotedText, navCurrent.prefixContext, navCurrent.suffixContext)}
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
      <NewsletterSocialPreview newsletterId={newsletterId} onApproved={onApproved} />
    </div>
  )
}
