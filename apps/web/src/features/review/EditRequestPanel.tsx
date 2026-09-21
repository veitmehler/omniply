'use client'

import { useEffect, useState } from 'react'
import { Loader2, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export interface PendingEdit {
  quotedText: string
  prefixContext: string
  suffixContext: string
  note: string
}

interface Assignee {
  email: string
  name: string | null
  source: 'member' | 'ghl'
}

/**
 * Shared request-edits side panel (articles + newsletters): note the current
 * selection, batch requests, pick an assignee — the dropdown merges the app
 * roster with ALL users of the client's GHL location (send-time seat
 * provisioning happens server-side; 3-seat cap).
 */
export function EditRequestPanel({
  what,
  selDraft,
  onClearSelection,
  sendUrl,
  onSent,
}: {
  /** 'article' | 'newsletter' — copy only. */
  what: string
  selDraft: Omit<PendingEdit, 'note'> | null
  onClearSelection: () => void
  /** POST target, e.g. /api/newsletters/:id/edit-requests */
  sendUrl: string
  onSent: (count: number) => void
}) {
  const [noteText, setNoteText] = useState('')
  const [pending, setPending] = useState<PendingEdit[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [assignee, setAssignee] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [acctRes, ghlRes] = await Promise.all([
        fetch('/api/account', { cache: 'no-store' }).catch(() => null),
        fetch('/api/ghl/location-users', { cache: 'no-store' }).catch(() => null),
      ])
      const list: Assignee[] = []
      const seen = new Set<string>()
      if (acctRes?.ok) {
        const acct = await acctRes.json()
        for (const m of [acct.owner, ...(acct.members ?? [])].filter(Boolean) as { email: string; name: string | null }[]) {
          const e = m.email.toLowerCase()
          if (!seen.has(e)) {
            seen.add(e)
            list.push({ email: e, name: m.name, source: 'member' })
          }
        }
      }
      if (ghlRes?.ok) {
        const { users } = await ghlRes.json()
        for (const u of (users ?? []) as { email: string; name: string | null }[]) {
          const e = u.email.toLowerCase()
          if (!seen.has(e)) {
            seen.add(e)
            list.push({ email: e, name: u.name, source: 'ghl' })
          }
        }
      }
      if (!cancelled) {
        setAssignees(list)
        // NO silent default (2026-09-21: preselecting the owner sent a round
        // of edits to the wrong person). Only restore the user's own
        // last-used choice — otherwise force an explicit pick.
        let last: string | null = null
        try { last = window.localStorage.getItem('omniply:lastAssignee') } catch { /* blocked storage */ }
        if (last && list.some((a) => a.email === last)) setAssignee(last)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function addPending() {
    if (!selDraft || !noteText.trim()) return
    setPending((prev) => [...prev, { ...selDraft, note: noteText.trim() }])
    setNoteText('')
    onClearSelection()
  }

  async function sendEdits() {
    if (!assignee.trim()) {
      toast.error('Pick a teammate to send to')
      return
    }
    setSending(true)
    try {
      const chosen = assignees.find((a) => a.email === assignee)
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeEmail: assignee, assigneeName: chosen?.name ?? undefined, requests: pending }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Could not send the edit requests')
        return
      }
      try { window.localStorage.setItem('omniply:lastAssignee', assignee) } catch { /* blocked storage */ }
      toast.success(`Sent ${pending.length} edit request(s) to ${chosen?.name ?? assignee}.`)
      onSent(pending.length)
      setPending([])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex w-80 flex-shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
        Highlight text in the {what}, then add a note for your teammate.
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {selDraft && (
          <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2">
            <div className="mb-1 line-clamp-2 text-xs italic text-muted-foreground">“{selDraft.quotedText}”</div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="What should change here?"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <div className="mt-1 flex justify-end gap-1">
              <button onClick={() => { onClearSelection(); setNoteText('') }} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={addPending} disabled={!noteText.trim()} className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Add</button>
            </div>
          </div>
        )}
        {pending.length === 0 && !selDraft && (
          <p className="text-xs text-muted-foreground">No notes yet. Select some text to start.</p>
        )}
        <div className="space-y-2">
          {pending.map((p, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="line-clamp-1 text-[11px] italic text-muted-foreground">“{p.quotedText}”</div>
              <div className="mt-0.5 flex items-start justify-between gap-2 text-xs text-foreground">
                <span>{p.note}</span>
                <button onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 border-t border-border p-3">
        {assignees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No teammates found — add users in your CRM or in Settings → Team.</p>
        ) : (
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="" disabled>
              Pick a teammate…
            </option>
            {assignees.map((a) => (
              <option key={a.email} value={a.email}>
                {(a.name ? `${a.name} — ${a.email}` : a.email) + (a.source === 'ghl' ? ' (from your CRM)' : '')}
              </option>
            ))}
          </select>
        )}
        <Button onClick={sendEdits} disabled={pending.length === 0 || sending || !assignee} className="w-full">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {assignee
            ? `Send ${pending.length || ''} to ${assignees.find((a) => a.email === assignee)?.name ?? assignee}`
            : 'Pick a teammate to send'}
        </Button>
      </div>
    </div>
  )
}
