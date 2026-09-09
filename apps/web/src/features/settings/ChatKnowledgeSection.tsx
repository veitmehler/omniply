'use client'

/**
 * Business Info & Chat Knowledge editor (chat-kb plan F2): the same data the
 * onboarding kb_review screen approved, permanently editable. Saving rebuilds
 * the assistant's knowledge immediately (server busts the context cache).
 */
import { useEffect, useState } from 'react'
import { BookOpen, Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Faq { q: string; a: string }

export function ChatKnowledgeSection() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [openingHours, setOpeningHours] = useState('')
  const [phone, setPhone] = useState('')
  const [bookingUrl, setBookingUrl] = useState('')
  const [extraKnowledge, setExtraKnowledge] = useState('')
  const [available, setAvailable] = useState(true)

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
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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
