'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Loader2, ArrowLeft, Plus, Trash2, Sparkles, ImageIcon, RefreshCw } from 'lucide-react'

interface Offer {
  id: string
  title: string
  body: string
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  startDate: string | null
  endDate: string | null
  enabled: boolean
  sortOrder: number
}

const blank = (): Partial<Offer> => ({
  title: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  enabled: true,
  startDate: null,
  endDate: null,
})
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

export function OffersView({ embedMode = false }: { embedMode?: boolean } = {}) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Offer> | null>(null)
  // Bumped each time an editor session opens — the form renders below the
  // whole list, so without a scroll the click looks like it did nothing.
  const [editSession, setEditSession] = useState(0)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [seasonal, setSeasonal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [brief, setBrief] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/newsletters/offers', { cache: 'no-store' })
      const data = await res.json()
      setOffers(data.offers ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  function startEdit(o?: Offer) {
    setError(null)
    if (o) {
      setEditing(o)
      setSeasonal(!!(o.startDate || o.endDate))
    } else {
      setEditing(blank())
      setSeasonal(false)
    }
    setEditSession((n) => n + 1)
  }

  useEffect(() => {
    if (editSession > 0) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editSession])

  async function save() {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        title: editing.title,
        body: editing.body,
        ctaLabel: editing.ctaLabel,
        ctaUrl: editing.ctaUrl,
        enabled: editing.enabled ?? true,
        startDate: seasonal ? editing.startDate || null : null,
        endDate: seasonal ? editing.endDate || null : null,
      }
      const res = editing.id
        ? await fetch(`/api/newsletters/offers/${editing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/newsletters/offers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Save failed')
        return
      }
      // keep editing the (now-saved) offer so image actions have an id
      setEditing(data.offer ?? editing)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this offer?')) return
    await fetch(`/api/newsletters/offers/${id}`, { method: 'DELETE' })
    if (editing?.id === id) setEditing(null)
    await load()
  }

  async function draft() {
    if (!brief.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/newsletters/offers/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Draft failed')
        return
      }
      setEditing((e) => ({ ...e, title: data.title, body: data.body, ctaLabel: data.ctaLabel }))
    } finally {
      setBusy(false)
    }
  }

  async function generateImage() {
    if (!editing?.id) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/newsletters/offers/${editing.id}/generate-image`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Image generation failed')
        return
      }
      setEditing((e) => ({ ...e, imageUrl: data.imageUrl }))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !editing?.id) return
    e.target.value = ''
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/newsletters/offers/${editing.id}/image`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setEditing((ed) => ({ ...ed, imageUrl: data.imageUrl }))
        await load()
      } else setError(data.error ?? 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeImage() {
    if (!editing?.id) return
    setBusy(true)
    await fetch(`/api/newsletters/offers/${editing.id}/image`, { method: 'DELETE' })
    setEditing((e) => ({ ...e, imageUrl: null }))
    await load()
    setBusy(false)
  }

  const scheduleBadge = (o: Offer) =>
    o.startDate || o.endDate ? `${dateInput(o.startDate) || '…'} → ${dateInput(o.endDate) || '…'}` : 'Always'

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-gray-500">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {!embedMode && (
        <Link href="/newsletter" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Newsletter
        </Link>
      )}
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Offers</h1>
        <button onClick={() => startEdit()} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          <Plus className="h-4 w-4" /> New offer
        </button>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Set offers once — they auto-include by schedule. An <b>Always</b> offer shows after the feature article;
        a <b>date-range</b> (seasonal) offer shows after “Tips of the Day” and auto-expires.
      </p>

      {error && <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* List */}
      <div className="space-y-2">
        {offers.map((o) => (
          <div key={o.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <div className="h-12 w-20 flex-none overflow-hidden rounded bg-muted">
              {o.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.imageUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{o.title || '(untitled)'}</div>
              <div className="text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">{scheduleBadge(o)}</span>
                {!o.enabled && <span className="ml-2 text-amber-600">disabled</span>}
              </div>
            </div>
            <button onClick={() => startEdit(o)} className="text-xs text-blue-600 hover:underline">Edit</button>
            <button onClick={() => remove(o.id)} className="text-red-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {offers.length === 0 && <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No offers yet.</div>}
      </div>

      {/* Editor */}
      {editing && (
        <div ref={editorRef} className="mt-6 scroll-mt-16 rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">{editing.id ? 'Edit offer' : 'New offer'}</h3>

          {/* AI draft */}
          <div className="mb-4 rounded-lg bg-muted/50 p-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Draft with AI</label>
            <div className="flex gap-2">
              <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Mother's Day 20% off massage" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <button onClick={draft} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted"><Sparkles className="h-4 w-4" /> Draft</button>
            </div>
          </div>

          <div className="space-y-3">
            <input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Headline" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <textarea value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={2} placeholder="Short pitch" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input value={editing.ctaLabel ?? ''} onChange={(e) => setEditing({ ...editing, ctaLabel: e.target.value })} placeholder="Button label (e.g. Book Now)" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <input value={editing.ctaUrl ?? ''} onChange={(e) => setEditing({ ...editing, ctaUrl: e.target.value })} placeholder="Button link (https://…)" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>

            {/* Schedule */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Schedule</label>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={!seasonal} onChange={() => setSeasonal(false)} /> Always show</label>
                <label className="flex items-center gap-1"><input type="radio" checked={seasonal} onChange={() => setSeasonal(true)} /> Show between dates</label>
              </div>
              {seasonal && (
                <div className="mt-2 flex items-center gap-2">
                  <input type="date" value={dateInput(editing.startDate ?? null)} onChange={(e) => setEditing({ ...editing, startDate: e.target.value || null })} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                  <span className="text-muted-foreground">→</span>
                  <input type="date" value={dateInput(editing.endDate ?? null)} onChange={(e) => setEditing({ ...editing, endDate: e.target.value || null })} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.enabled ?? true} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> Enabled</label>

            {/* Image */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Banner image (16:9, optional)</label>
              {!editing.id ? (
                <p className="text-xs text-muted-foreground">Save the offer first to add an image.</p>
              ) : (
                <div className="space-y-2">
                  {editing.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editing.imageUrl} alt="" className="aspect-video w-full max-w-md rounded-lg border border-border object-cover" />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={generateImage} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                      {editing.imageUrl ? <RefreshCw className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />} {editing.imageUrl ? 'Regenerate' : 'Generate'} with AI
                    </button>
                    <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                      Upload
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadImage} className="hidden" />
                    </label>
                    {editing.imageUrl && <button onClick={removeImage} disabled={busy} className="text-xs text-red-600 hover:underline">Remove</button>}
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
              <button onClick={() => setEditing(null)} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
