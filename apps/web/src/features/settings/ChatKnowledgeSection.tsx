'use client'

/**
 * Business Info & Chat Knowledge editor (chat-kb plan F2): the same data the
 * onboarding kb_review screen approved, permanently editable. Saving rebuilds
 * the assistant's knowledge immediately (server busts the context cache).
 */
import { useEffect, useState } from 'react'
import { BookOpen, Loader2, Save, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Faq { q: string; a: string }
interface ListingStatus { state: 'none' | 'ok' | 'mismatch_pending'; listingName?: string }
interface Discrepancy { field: string; website: string; google: string; note: string }

export function ChatKnowledgeSection() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [openingHours, setOpeningHours] = useState('')
  const [phone, setPhone] = useState('')
  const [bookingUrl, setBookingUrl] = useState('')
  const [extraKnowledge, setExtraKnowledge] = useState('')
  const [available, setAvailable] = useState(true)
  const [listing, setListing] = useState<ListingStatus>({ state: 'none' })
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])
  const [newGbpUrl, setNewGbpUrl] = useState('')
  const [fixingLink, setFixingLink] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/agent/kb', { cache: 'no-store' })
        if (!res.ok) {
          if (alive) setAvailable(false)
          return
        }
        const d = await res.json()
        if (!alive) return
        setFaqs(Array.isArray(d.faqs) ? d.faqs : [])
        setOpeningHours(d.openingHours ?? '')
        setPhone(d.organizationPhone ?? '')
        setBookingUrl(d.bookingUrl ?? '')
        setExtraKnowledge(d.extraKnowledge ?? '')
        if (d.listing?.state) setListing(d.listing)
        setDiscrepancies(Array.isArray(d.discrepancies) ? d.discrepancies : [])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function confirmListing() {
    setConfirming(true)
    try {
      const res = await fetch('/api/agent/kb/confirm-listing', { method: 'POST' })
      if (!res.ok) {
        toast.error('Could not confirm the listing — try again')
        return
      }
      setListing({ ...listing, state: 'ok' })
      toast.success('Listing confirmed — its hours and reviews are now used')
    } finally {
      setConfirming(false)
    }
  }

  async function updateGbpLink() {
    const url = newGbpUrl.trim()
    if (!url) return
    setFixingLink(true)
    try {
      const res = await fetch('/api/agent/kb', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs, gbpUrl: url }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(d?.error ?? 'Could not update the link')
        return
      }
      setListing({ state: 'none' })
      setNewGbpUrl('')
      toast.success('Link updated — your listing re-resolves within a few minutes')
    } finally {
      setFixingLink(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/agent/kb', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs, openingHours, organizationPhone: phone, bookingUrl, extraKnowledge }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(d?.error ?? 'Save failed')
        return
      }
      toast.success('Chat knowledge updated — the assistant uses it immediately')
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  if (!available) return null

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">Business Info &amp; Chat Knowledge</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Everything the chat assistant knows about your practice. Edit any answer and save — changes reach the
        assistant within seconds.
      </p>

      {listing.state === 'mismatch_pending' && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="text-card-foreground">
                Your Google link points to a listing called <strong>&ldquo;{listing.listingName}&rdquo;</strong>, which
                doesn&apos;t match your practice name. Until this is sorted out, that listing&apos;s hours, rating and
                reviews are not used.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={confirmListing} disabled={confirming}>
                  {confirming && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  That&apos;s us — use it
                </Button>
                <input
                  className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm min-w-[220px] flex-1"
                  placeholder="Paste the correct Google Maps link"
                  value={newGbpUrl}
                  onChange={(e) => setNewGbpUrl(e.target.value)}
                />
                <Button size="sm" onClick={updateGbpLink} disabled={fixingLink || !newGbpUrl.trim()}>
                  {fixingLink && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Update link
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {listing.state === 'ok' && listing.listingName && (
        <p className="text-xs text-muted-foreground mb-3">
          Google listing: <span className="text-card-foreground">{listing.listingName}</span>
        </p>
      )}
      {discrepancies.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-medium text-card-foreground">Your website and Google listing disagree</p>
              {discrepancies.map((d, i) => (
                <p key={i} className="text-muted-foreground">{d.note}</p>
              ))}
              <p className="text-xs text-muted-foreground">
                Patients see the Google version — worth fixing on your Google Business Profile. The hours below are
                what the assistant actually uses.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 mb-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Practice phone</label>
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Booking page URL</label>
          <input className={input} value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Opening hours (overrides Google when set)</label>
          <textarea className={input} rows={3} value={openingHours} onChange={(e) => setOpeningHours(e.target.value)} />
        </div>
      </div>

      <p className="text-sm font-medium text-card-foreground mb-2">Questions &amp; answers ({faqs.length})</p>
      <div className="space-y-3">
        {faqs.map((f, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <input className={input} value={f.q} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} placeholder="Question" />
            <textarea className={input} rows={2} value={f.a} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} placeholder="Answer" />
            <button type="button" className="inline-flex items-center gap-1 text-xs text-destructive" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <label className="text-xs font-medium text-muted-foreground">Anything else the assistant should know</label>
        <p className="text-xs text-muted-foreground mb-1">
          Practical facts that don&apos;t fit the questions above — parking, payment options, what to bring, referral
          policy. The assistant treats this as reference information only.
        </p>
        <textarea
          className={input}
          rows={6}
          maxLength={5000}
          value={extraKnowledge}
          onChange={(e) => setExtraKnowledge(e.target.value)}
          placeholder="e.g. Free parking behind the building. We accept HSA/FSA cards. New patients should arrive 10 minutes early."
        />
        <p className="text-right text-xs text-muted-foreground">{extraKnowledge.length.toLocaleString()}/5,000</p>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add question
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save &amp; rebuild
        </Button>
      </div>
    </div>
  )
}
