'use client'

/**
 * Quick idea capture on the My Content tab (parity batch A): one field, zero
 * friction — get the idea down before it evaporates. Development happens in
 * the Ideas tab (IdeasBankView).
 */
import { useState } from 'react'
import { toast } from 'sonner'

export function IdeaCapturePanel({ onFleshOut }: { onFleshOut: () => void }) {
  const [topic, setTopic] = useState('')
  const [saving, setSaving] = useState(false)

  async function capture() {
    const t = topic.trim()
    if (!t) return
    setSaving(true)
    try {
      const res = await fetch('/api/topics/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t }),
      })
      if (res.ok) {
        toast.success('Saved to your Ideas')
        setTopic('')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? 'Could not save the idea')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void capture()
        }}
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Got a content idea? Capture it before it escapes…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={saving}
        />
        <button
          type="submit"
          disabled={saving || !topic.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save idea'}
        </button>
      </form>
      <button onClick={onFleshOut} className="mt-2 text-xs text-muted-foreground hover:text-foreground">
        Flesh out your ideas in the Ideas tab →
      </button>
    </div>
  )
}
