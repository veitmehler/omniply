'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import {
  Loader2,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const POST_TYPE_LABELS: Record<string, string> = {
  quote: 'Quote card',
  video_reel: 'Video reel',
  carousel: 'Carousel',
  hook_video: 'Hook video',
  quote_video: 'Quote video',
  pitch_carousel: 'Pitch carousel',
  pitch_hook: 'Pitch hook',
  tips_story: 'Tips story',
}

export type SpecPreviewPlatform = {
  platform: string
  caption: string
  imageUrl?: string
  mediaUrls?: string[]
  videoUrl?: string
  status: string
  postId?: string
}

export type SpecPreviewPayload = {
  slotKey: string
  postType: string
  isStory: boolean
  scheduledAt: string
  platforms: SpecPreviewPlatform[]
  assets: {
    imageUrl?: string
    mediaUrls?: string[]
    videoUrl?: string
    title?: string
  }
}

export type SocialSpecResultRow = {
  id: string
  slotKey: string
  status: string
  error: string | null
  postsCreated: number
  previewJson?: SpecPreviewPayload | null
  assetsJson?: {
    postType?: string
    storySlides?: string[]
    carouselSlides?: { type: string; headlineText: string | null; bodyText: string | null }[]
    carouselDiagram?: boolean
  } | null
  overridesJson?: {
    textMode?: 'light' | 'dark' | null
    slides?: Record<string, { text?: string; headline?: string; body?: string; imageUrl?: string | null }>
  } | null
  approvedAt?: string | null
}

export type SocialAutomationRunRow = {
  id: string
  status: string
  scheduledDate: string
  totalSpecs: number
  completedSpecs: number
  failedSpecs: number
  currentSpec: string | null
  error: string | null
  slideCount?: number | null
  _count?: { posts: number }
  specResults?: SocialSpecResultRow[]
}

function parsePreview(json: unknown): SpecPreviewPayload | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.slotKey !== 'string' || typeof o.postType !== 'string') return null
  return json as SpecPreviewPayload
}

function formatScheduledAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Carousel lightbox ────────────────────────────────────────────────────────

function CarouselLightbox({
  urls,
  startIndex,
  onClose,
}: {
  urls: string[]
  startIndex: number
  onClose: () => void
}) {
  const [current, setCurrent] = useState(startIndex)

  const prev = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setCurrent((c) => (c - 1 + urls.length) % urls.length)
    },
    [urls.length],
  )

  const next = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setCurrent((c) => (c + 1) % urls.length)
    },
    [urls.length],
  )

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setCurrent((c) => (c - 1 + urls.length) % urls.length)
      if (e.key === 'ArrowRight') setCurrent((c) => (c + 1) % urls.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, urls.length])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* Close */}
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        onClick={onClose}
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Slide counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium">
        {current + 1} / {urls.length}
      </div>

      {/* Prev */}
      {urls.length > 1 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          onClick={prev}
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}

      {/* Image */}
      <img
        src={urls[current]}
        alt={`Slide ${current + 1}`}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Next */}
      {urls.length > 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          onClick={next}
          aria-label="Next slide"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      {/* Thumbnail strip */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 overflow-x-auto max-w-[90vw] px-2 pb-1">
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            onClick={(e) => { e.stopPropagation(); setCurrent(i) }}
            className={`flex-shrink-0 rounded border-2 transition-all ${
              i === current ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
            }`}
          >
            <img
              src={url}
              alt={`Slide ${i + 1}`}
              className="h-12 w-12 rounded object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Slot media ────────────────────────────────────────────────────────────────

/**
 * Slide editor (review UX, Veit 2026-09-17): in-place slide text editing and
 * per-slide image regeneration through the deterministic recompose endpoint
 * (no re-roll of the post). Story carousels additionally get the per-post
 * Light/Dark text toggle. Diagram-background carousels are not editable
 * (their overlay can't be reproduced by the recompose path).
 * Editing opens a popover modal (Veit: the inline drawer was too cramped to
 * edit a story in) with the slide thumbnails alongside the text fields.
 */
function StorySlideEditor({
  spec,
  preview,
  onRefresh,
}: {
  spec: SocialSpecResultRow
  preview: SpecPreviewPayload | null
  onRefresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const assets = spec.assetsJson
  const isStory = assets?.postType === 'story_text' && (assets.storySlides?.length ?? 0) > 0
  const isCarousel =
    assets?.postType === 'carousel' && (assets.carouselSlides?.length ?? 0) > 0 && !assets.carouselDiagram
  const storySlides = assets?.storySlides ?? []
  const plans = assets?.carouselSlides ?? []
  const initialDrafts = isStory
    ? storySlides.map((t) => ({ headline: '', body: t }))
    : plans.map((pl) => ({ headline: pl.headlineText ?? '', body: pl.bodyText ?? '' }))
  const [drafts, setDrafts] = useState(initialDrafts)
  const mode = spec.overridesJson?.textMode ?? null
  const thumbs =
    preview?.assets.mediaUrls?.length
      ? preview.assets.mediaUrls
      : preview?.platforms.find((p) => p.mediaUrls?.length)?.mediaUrls ?? []

  if (!isStory && !isCarousel) return null

  async function recompose(body: Record<string, unknown>, busyKey: string): Promise<boolean> {
    setBusy(busyKey)
    try {
      const res = await fetch(`/api/social-automation/spec-results/${spec.id}/recompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Recompose failed')
        return false
      }
      toast.success('Slides updated.')
      await onRefresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  // Save is a FINISHING action: overlay while recomposing, auto-close on
  // success (the refreshed card thumbnails are the visible outcome); a
  // failure keeps the modal open so drafts aren't lost. "New image" is an
  // ITERATIVE action and deliberately keeps the modal open (Veit 2026-09-17).
  const saveTexts = () => {
    const changed: Record<string, { text?: string; headline?: string; body?: string }> = {}
    drafts.forEach((d, i) => {
      if (isStory) {
        if (d.body.trim() && d.body !== storySlides[i]) changed[String(i)] = { text: d.body }
      } else {
        const patch: { headline?: string; body?: string } = {}
        if (d.headline !== (plans[i]?.headlineText ?? '')) patch.headline = d.headline
        if (d.body !== (plans[i]?.bodyText ?? '')) patch.body = d.body
        if (Object.keys(patch).length) changed[String(i)] = patch
      }
    })
    if (Object.keys(changed).length === 0) {
      setOpen(false)
      return
    }
    void recompose({ slides: changed }, 'save').then((ok) => {
      if (ok) setOpen(false)
    })
  }

  const slideCount = isStory ? storySlides.length : plans.length
  const canNewImage = (i: number) => (isStory ? i > 0 : true)

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {isStory && (
          <>
            <span className="text-[11px] text-muted-foreground">Text:</span>
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                onClick={() => void recompose({ textMode: mode === m ? null : m }, `mode-${m}`)}
                disabled={busy !== null}
                className={`rounded border px-2 py-0.5 text-[11px] ${mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                title={mode === m ? 'Back to automatic' : `Force ${m} text`}
              >
                {busy === `mode-${m}` ? '…' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
            {mode && (
              <button
                onClick={() => {
                  setBusy('preset')
                  void fetch('/api/brand-settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storyTextMode: mode }),
                  })
                    .then((res) => {
                      if (res.ok) toast.success(`${mode === 'light' ? 'Light' : 'Dark'} text is now the default for future posts.`)
                      else toast.error('Could not save the preset')
                    })
                    .finally(() => setBusy(null))
                }}
                disabled={busy !== null}
                className="rounded border border-dashed border-primary/50 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                title="Every future story post starts with this text color (change in Settings → Social posts)"
              >
                {busy === 'preset' ? '…' : 'Use for all future posts'}
              </button>
            )}
          </>
        )}
        <button
          onClick={() => { setDrafts(initialDrafts); setOpen(true) }}
          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Edit slides
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (busy === null) setOpen(false) }}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {busy === 'save' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/80">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Recomposing slides…</span>
              </div>
            )}
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-sm font-semibold text-card-foreground">Edit slides</span>
              <button
                onClick={() => setOpen(false)}
                disabled={busy !== null}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {Array.from({ length: slideCount }, (_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-28 flex-shrink-0">
                    <div className="relative">
                      {thumbs[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[i]} alt={`Slide ${i + 1}`} className="aspect-square w-28 rounded-lg border border-border object-cover" />
                      ) : (
                        <div className="flex aspect-square w-28 items-center justify-center rounded-lg border border-border bg-muted text-xs text-muted-foreground">
                          {i + 1}
                        </div>
                      )}
                      {busy === `img-${i}` && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/70">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        </div>
                      )}
                    </div>
                    {canNewImage(i) && (
                      <button
                        onClick={() => void recompose({ regenerateImage: i }, `img-${i}`)}
                        disabled={busy !== null}
                        className="mt-1 w-full text-center text-[11px] text-primary hover:underline disabled:opacity-50"
                      >
                        {busy === `img-${i}` ? 'Generating…' : 'New image'}
                      </button>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Slide {i + 1}</label>
                    {isCarousel && (
                      <input
                        value={drafts[i]?.headline ?? ''}
                        onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)))}
                        placeholder="Headline"
                        className="mb-1.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium"
                      />
                    )}
                    <textarea
                      value={drafts[i]?.body ?? ''}
                      onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                      rows={isStory ? 4 : 3}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setOpen(false)}
                disabled={busy !== null}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
              >
                Close
              </button>
              <button
                onClick={saveTexts}
                disabled={busy !== null}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy === 'save' ? 'Recomposing…' : 'Save & recompose'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Per-platform captions (review UX, Veit 2026-09-17): full text on demand
 * (the old 4-line clamp hid most of it) + in-place editing before approval.
 * Story captions are identical across platforms by design, so an edit offers
 * "apply to all platforms" (pre-checked while they still match). Saving
 * updates the ready Post rows and the preview payload together — no LLM.
 */
function PlatformCaptions({
  spec,
  preview,
  editable,
  onRefresh,
}: {
  spec: SocialSpecResultRow
  preview: SpecPreviewPayload
  editable: boolean
  onRefresh: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [applyAll, setApplyAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const captions = preview.platforms.map((p) => p.caption)
  const allIdentical = captions.length > 1 && captions.every((c) => c === captions[0])
  const anyOpen = editing !== null || Object.values(expanded).some(Boolean)

  const startEdit = (platform: string, caption: string) => {
    setEditing(platform)
    setDraft(caption)
    setApplyAll(allIdentical)
  }

  const save = async () => {
    if (!editing || !draft.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/social-automation/spec-results/${spec.id}/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: editing, caption: draft, applyToAll: applyAll }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Saving the caption failed')
        return
      }
      toast.success(applyAll ? 'Caption updated on all platforms.' : 'Caption updated.')
      setEditing(null)
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`space-y-2 ${anyOpen ? '' : 'max-h-40 overflow-y-auto'}`}>
      {preview.platforms.map((p) => {
        const isOpen = !!expanded[p.platform]
        const isEditing = editing === p.platform
        return (
          <div key={p.platform} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium capitalize">{p.platform}</span>
              {editable && !isEditing && (
                <button
                  onClick={() => startEdit(p.platform, p.caption)}
                  className="text-[11px] text-primary hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <div className="mt-1 space-y-1.5">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  autoFocus
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {preview.platforms.length > 1 ? (
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
                      Apply to all platforms
                    </label>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setEditing(null)}
                      disabled={busy}
                      className="rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void save()}
                      disabled={busy || !draft.trim()}
                      className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className={`text-muted-foreground whitespace-pre-wrap mt-0.5 ${isOpen ? '' : 'line-clamp-4'}`}>
                  {p.caption}
                </p>
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [p.platform]: !isOpen }))}
                  className="mt-0.5 text-[11px] text-muted-foreground underline hover:text-foreground"
                >
                  {isOpen ? 'Show less' : 'Show full text'}
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SlotMedia({ preview }: { preview: SpecPreviewPayload }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const videoUrl =
    preview.assets.videoUrl ??
    preview.platforms.find((p) => p.videoUrl)?.videoUrl
  const mediaUrls =
    preview.assets.mediaUrls?.length
      ? preview.assets.mediaUrls
      : preview.platforms.find((p) => p.mediaUrls?.length)?.mediaUrls
  const imageUrl =
    preview.assets.imageUrl ??
    preview.platforms.find((p) => p.imageUrl)?.imageUrl ??
    mediaUrls?.[0]

  if (videoUrl) {
    return (
      <video
        key={videoUrl}
        src={videoUrl}
        controls
        playsInline
        className="w-full max-h-80 rounded-lg bg-black object-contain"
      />
    )
  }

  if (mediaUrls && mediaUrls.length > 1) {
    return (
      <>
        {lightboxIndex !== null && (
          <CarouselLightbox
            urls={mediaUrls}
            startIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {mediaUrls.map((url, i) => (
            <button
              key={`${url}-${i}`}
              onClick={() => setLightboxIndex(i)}
              className="flex-shrink-0 rounded-md overflow-hidden border border-border hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              title={`View slide ${i + 1} of ${mediaUrls.length}`}
            >
              <img
                src={url}
                alt={`Slide ${i + 1}`}
                className="h-32 w-32 object-cover"
              />
            </button>
          ))}
        </div>
      </>
    )
  }

  if (imageUrl) {
    return (
      <>
        {lightboxIndex !== null && (
          <CarouselLightbox
            urls={[imageUrl]}
            startIndex={0}
            onClose={() => setLightboxIndex(null)}
          />
        )}
        <button
          onClick={() => setLightboxIndex(0)}
          className="w-full rounded-lg overflow-hidden border border-border bg-muted hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <img
            key={imageUrl}
            src={imageUrl}
            alt=""
            className="w-full max-h-80 object-contain"
          />
        </button>
      </>
    )
  }

  return (
    <p className="text-xs text-muted-foreground italic">No preview media</p>
  )
}

function slotBadge(
  spec: SocialSpecResultRow,
  runStatus: string,
): { label: string; className: string } {
  if (spec.status === 'failed') {
    return { label: 'Failed', className: 'text-red-500' }
  }
  if (spec.approvedAt) {
    return { label: 'Approved', className: 'text-green-600' }
  }
  if (runStatus === 'scheduling') {
    return { label: 'Scheduling…', className: 'text-yellow-600' }
  }
  if (runStatus === 'ready' && spec.status === 'completed') {
    return { label: 'Ready', className: 'text-blue-600' }
  }
  if (spec.status === 'completed') {
    return { label: 'Generated', className: 'text-green-600' }
  }
  return { label: spec.status, className: 'text-muted-foreground' }
}

type SocialPreviewPanelProps = {
  /** Optional — legacy article context. Approve-all now uses a source-agnostic runId endpoint. */
  jobId?: string
  runs: SocialAutomationRunRow[]
  onRefresh: () => Promise<void>
  onRetryFailed: (runId: string, slotKey: string) => Promise<void>
  retryingSpec: string | null
}

export function SocialPreviewPanel({
  runs,
  onRefresh,
  onRetryFailed,
  retryingSpec,
}: SocialPreviewPanelProps) {
  const getToken = useAppToken()
  const [approvingAllRunId, setApprovingAllRunId] = useState<string | null>(null)
  const [approvingSlot, setApprovingSlot] = useState<string | null>(null)
  const [regeneratingSlot, setRegeneratingSlot] = useState<string | null>(null)
  const burstPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clear burst poll on unmount
  useEffect(() => {
    return () => {
      if (burstPollRef.current !== null) {
        clearInterval(burstPollRef.current)
        burstPollRef.current = null
      }
    }
  }, [])

  const handleApproveRun = async (runId: string) => {
    setApprovingAllRunId(runId)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/social-automation/${runId}/approve`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to schedule posts')
      toast.success('Scheduling all posts to Omniply…')
      await onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApprovingAllRunId(null)
    }
  }

  const handleApproveSlot = async (runId: string, slotKey: string) => {
    const key = `${runId}-${slotKey}`
    setApprovingSlot(key)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/social-automation/${runId}/approve/${slotKey}`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to approve slot')
      toast.success(`${slotKey} approved — scheduling to Omniply…`)
      await onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApprovingSlot(null)
    }
  }

  const handleRegenerateSlot = async (runId: string, slotKey: string) => {
    const key = `${runId}-${slotKey}`
    setRegeneratingSlot(key)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/social-automation/${runId}/regenerate/${slotKey}`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to regenerate')
      toast.success(`Regenerating ${slotKey}…`)
      await onRefresh()
      // The job is async — the parent polling loop only activates when a run
      // is pending/processing/scheduling, but by the time onRefresh() fires
      // the run is still "ready" (worker not started yet). Burst-poll for
      // 90 s so the updated result appears as soon as the worker finishes.
      if (burstPollRef.current !== null) clearInterval(burstPollRef.current)
      let polls = 0
      burstPollRef.current = setInterval(async () => {
        polls++
        await onRefresh()
        if (polls >= 30) {
          clearInterval(burstPollRef.current!)
          burstPollRef.current = null
        }
      }, 3000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Regenerate failed')
    } finally {
      setRegeneratingSlot(null)
    }
  }

  return (
    <div className="divide-y divide-border">
      {runs.map((run) => {
        const specBySlot = new Map(
          (run.specResults ?? []).map((s) => [s.slotKey, s]),
        )
        // Render the run's actual slots (weekly cadence = P1..P3; legacy = F1..S6),
        // ordered by slot key, instead of a fixed slot list.
        const slotKeys = [...(run.specResults ?? [])].map((s) => s.slotKey).sort()
        const readySlots =
          run.specResults?.filter(
            (s) => s.status === 'completed' && !s.approvedAt,
          ).length ?? 0
        const approvedSlots =
          run.specResults?.filter((s) => s.approvedAt).length ?? 0
        const showPreview =
          ['ready', 'scheduling', 'completed'].includes(run.status) &&
          (run.specResults?.some((s) => s.previewJson) ?? false)

        return (
          <div key={run.id} className="px-6 py-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-medium capitalize">{run.status}</span>
                <span className="text-muted-foreground ml-2">
                  {run.scheduledDate} · {run.completedSpecs}/{run.totalSpecs} specs
                  {run.slideCount ? ` · ${run.slideCount} slides (F4/F6)` : ''}
                  {run.currentSpec ? ` · ${run.currentSpec}` : ''}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {run._count?.posts ?? 0}{' '}
                {run.status === 'ready' ? 'preview posts' : 'posts'}
                {run.status === 'ready' && readySlots > 0
                  ? ` · ${readySlots} awaiting approval`
                  : ''}
                {approvedSlots > 0 ? ` · ${approvedSlots} approved` : ''}
                {run.failedSpecs > 0 ? ` · ${run.failedSpecs} failed` : ''}
              </div>
              {run.error && (
                <p className="w-full text-xs text-red-500">{run.error}</p>
              )}
            </div>

            {run.status === 'ready' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={approvingAllRunId === run.id || readySlots === 0}
                  onClick={() => void handleApproveRun(run.id)}
                >
                  {approvingAllRunId === run.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Approve &amp; schedule all to Omniply
                </Button>
                <span className="text-xs text-muted-foreground">
                  Review each slot below before scheduling, or approve everything at once.
                </span>
              </div>
            )}

            {(run.status === 'pending' || run.status === 'processing') && (
              <div className="flex flex-wrap gap-1.5">
                {slotKeys.map((slotKey) => {
                  const spec = specBySlot.get(slotKey)
                  return (
                    <span
                      key={slotKey}
                      className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-0.5 font-mono"
                    >
                      {slotKey}
                      <span className="text-muted-foreground">
                        {spec?.status ?? '…'}
                      </span>
                      {run.currentSpec === slotKey && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                    </span>
                  )
                })}
              </div>
            )}

            {showPreview && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {slotKeys.map((slotKey) => {
                  const spec = specBySlot.get(slotKey)
                  if (!spec) return null
                  const preview = parsePreview(spec.previewJson)
                  const badge = slotBadge(spec, run.status)
                  const canApprove =
                    run.status === 'ready' &&
                    spec.status === 'completed' &&
                    !spec.approvedAt
                  const canRegenerate =
                    ['ready', 'completed', 'failed'].includes(run.status) &&
                    spec.status !== 'pending'
                  const actionKey = `${run.id}-${slotKey}`

                  return (
                    <div
                      key={slotKey}
                      className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-sm font-semibold">{slotKey}</span>
                          {preview && (
                            <p className="text-xs text-muted-foreground">
                              {POST_TYPE_LABELS[preview.postType] ?? preview.postType}
                              {preview.isStory ? ' · Story' : ' · Feed'}
                            </p>
                          )}
                          {preview?.scheduledAt && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" />
                              {formatScheduledAt(preview.scheduledAt)}
                            </p>
                          )}
                        </div>
                        <span className={`text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>

                      {spec.status === 'failed' && (
                        <p className="text-xs text-red-500">{spec.error ?? 'Generation failed'}</p>
                      )}

                      {preview && spec.status === 'completed' && (
                        <>
                          <SlotMedia preview={preview} />
                          {!spec.approvedAt && <StorySlideEditor spec={spec} preview={preview} onRefresh={onRefresh} />}
                          <PlatformCaptions
                            spec={spec}
                            preview={preview}
                            editable={!spec.approvedAt}
                            onRefresh={onRefresh}
                          />
                        </>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {canApprove && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs gap-1"
                            disabled={approvingSlot === actionKey}
                            onClick={() => void handleApproveSlot(run.id, slotKey)}
                          >
                            {approvingSlot === actionKey ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                            Approve
                          </Button>
                        )}
                        {canRegenerate && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={regeneratingSlot === actionKey}
                            onClick={() => void handleRegenerateSlot(run.id, slotKey)}
                          >
                            {regeneratingSlot === actionKey ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Regenerate
                          </Button>
                        )}
                        {spec.status === 'failed' && (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            disabled={retryingSpec === actionKey}
                            onClick={() => void onRetryFailed(run.id, slotKey)}
                          >
                            {retryingSpec === actionKey ? 'Retrying…' : 'Retry'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {run.status === 'completed' && !showPreview && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                All posts scheduled.
              </p>
            )}

            {run.status === 'scheduling' && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Scheduling approved posts to Omniply…
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
