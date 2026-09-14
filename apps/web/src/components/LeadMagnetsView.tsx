'use client'

/**
 * Lead Magnets library view (leadgen plan Phase 5) — review-gated documents,
 * per-document tags, capture counts, Drive links. Shared between the open web
 * (Clerk + Vercel proxy fetch) and the embedded GHL surface (embedFetch) via
 * the injected `apiFetch`.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

interface LeadGenDoc {
  id: string
  title: string
  slug: string
  kind: string
  status: string
  driveLink: string | null
  pdfUrl: string | null
  ghlTagNames: string[]
  templateName: string | null
  captureCount: number
  lastError: string | null
}

interface Template {
  id: string
  name: string
  slug: string
  description: string | null
}

const STATUS_STYLE: Record<string, string> = {
  compiling: 'bg-blue-500/10 text-blue-600',
  pending_review: 'bg-amber-500/10 text-amber-600',
  live: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-600',
  disabled: 'bg-muted text-muted-foreground',
}

export function LeadMagnetsView({
  apiFetch,
  justCompletedOnboarding = false,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Rendered right after the onboarding finale: show the generation banner. */
  justCompletedOnboarding?: boolean
}) {
  const [docs, setDocs] = useState<LeadGenDoc[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([apiFetch('/api/leadgen/documents'), apiFetch('/api/leadgen/templates')])
    if (d.ok) setDocs((await d.json()).documents)
    if (t.ok) setTemplates((await t.json()).templates)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 15_000) // compiling → review auto-refresh
    return () => clearInterval(timer)
  }, [load])

  async function act(id: string, action: 'approve' | 'regenerate', note?: string) {
    setBusyId(id)
    try {
      const res = await apiFetch(`/api/leadgen/documents/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'regenerate' && note ? { note } : {}),
      })
      if (!res.ok) {
        toast.error((await res.json()).error ?? `${action} failed`)
      } else {
        toast.success(action === 'approve' ? 'Live! Prospects can now request access.' : 'Regenerating…')
        await load()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function addFromTemplate(templateId: string) {
    const res = await apiFetch('/api/leadgen/documents/from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
    })
    if (res.ok) {
      toast.success('Compiling your branded document…')
      await load()
    } else toast.error((await res.json()).error ?? 'Failed')
  }

  async function uploadCustom(file: File, title: string, addCover: boolean) {
    const form = new FormData()
    form.append('pdf', file, file.name)
    form.append('title', title || file.name.replace(/\.pdf$/i, ''))
    form.append('addCover', String(addCover))
    const res = await apiFetch('/api/leadgen/documents/upload', { method: 'POST', body: form })
    if (res.ok) {
      toast.success(addCover ? 'Uploading — adding your branded cover…' : 'Uploading…')
      await load()
    } else toast.error((await res.json().catch(() => ({}))).error ?? 'Upload failed')
  }

  async function saveTags(id: string, raw: string) {
    const tagNames = raw.split(',').map((t) => t.trim()).filter(Boolean)
    const res = await apiFetch(`/api/leadgen/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagNames }),
    })
    if (res.ok) toast.success('Tags updated')
    else toast.error('Tag update failed')
  }

  const availableTemplates = templates.filter((t) => !docs.some((d) => d.slug === t.slug))

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lead Magnets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Branded documents prospects can request via Google Drive — every request becomes a tagged lead in your CRM.
        </p>
      </div>

      {justCompletedOnboarding && (
        <div className="rounded-xl border border-green-600/30 bg-green-500/10 p-4 text-sm text-foreground">
          🎉 <b>Setup complete — your first month&apos;s content is being generated.</b> Articles, newsletters and
          social posts arrive for your review over the next hour. Meanwhile, review and approve your branded PDF
          guides below.
        </div>
      )}

      {docs.some((d) => d.status === 'compiling') && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-600/30 bg-blue-500/10 p-4 text-sm text-foreground">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Your branded guides are being created — this takes a few minutes, and each one appears for review the
          moment it&apos;s ready. No need to refresh.
        </div>
      )}

      {docs.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No documents yet — add one from a template below.
        </div>
      )}

      <div className="space-y-4">
        {docs.map((d) => (
          <div key={d.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-foreground">{d.title}</h2>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.status] ?? ''}`}
                  >
                    {d.status === 'compiling' && (
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-600 border-t-transparent" />
                    )}
                    {d.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {d.captureCount} lead{d.captureCount === 1 ? '' : 's'} captured
                  {d.templateName ? ` · from "${d.templateName}"` : ''}
                </p>
                {d.lastError && <p className="mt-1 text-xs text-red-600">{d.lastError}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {d.pdfUrl && (
                  <a href={d.pdfUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground">
                    Preview PDF
                  </a>
                )}
                {d.status === 'pending_review' && (
                  <button
                    onClick={() => void act(d.id, 'approve')}
                    disabled={busyId === d.id}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Approve → go live
                  </button>
                )}
                {(d.status === 'pending_review' || d.status === 'failed' || d.status === 'live') && d.kind === 'template' && (
                  <button
                    onClick={() => {
                      const note = window.prompt('Anything you want changed? (optional — guides the rewrite)') ?? undefined
                      void act(d.id, 'regenerate', note?.trim() || undefined)
                    }}
                    disabled={busyId === d.id}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                )}
              </div>
            </div>

            {d.status === 'live' && d.driveLink && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-xs text-muted-foreground">{d.driveLink}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(d.driveLink!)
                    toast.success('Link copied — share it anywhere')
                  }}
                  className="shrink-0 text-xs font-medium text-primary"
                >
                  Copy link
                </button>
              </div>
            )}

            <div className="mt-3">
              <label className="mb-1 block text-xs text-muted-foreground">CRM tags applied to captured leads (comma-separated)</label>
              <input
                defaultValue={d.ghlTagNames.join(', ')}
                onBlur={(e) => void saveTags(d.id, e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              />
            </div>
          </div>
        ))}
      </div>

      <UploadCard onUpload={uploadCustom} />

      {availableTemplates.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Add from template</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => void addFromTemplate(t.id)}
                title={t.description ?? undefined}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted"
              >
                + {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


function UploadCard({ onUpload }: { onUpload: (file: File, title: string, addCover: boolean) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [addCover, setAddCover] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <div className="rounded-xl border border-dashed border-border p-4">
      <h3 className="text-sm font-medium text-foreground">Upload your own PDF</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Hosted as-is — we can add a branded cover page, but the document content stays exactly as designed.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''))
          }}
          className="text-xs text-muted-foreground"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={addCover} onChange={(e) => setAddCover(e.target.checked)} />
          Add branded cover
        </label>
        <button
          disabled={!file || busy}
          onClick={async () => {
            if (!file) return
            setBusy(true)
            try {
              await onUpload(file, title, addCover)
              setFile(null)
              setTitle('')
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Upload
        </button>
      </div>
    </div>
  )
}
