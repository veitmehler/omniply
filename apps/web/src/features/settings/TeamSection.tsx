'use client'

import { useEffect, useState } from 'react'
import { Loader2, UserPlus, X, Users, Crown, Pencil, Check, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Member { id: string; name: string | null; email: string; status: 'active' | 'pending'; inviteUrl: string | null }
interface AccountData {
  account: { id: string; name: string | null }
  owner: { email: string; name: string | null } | null
  members: Member[]
  seatsUsed: number
  seatLimit: number
}

export function TeamSection({ embedMode = false }: { embedMode?: boolean } = {}) {
  const [data, setData] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/account', { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const seatsFull = data ? data.seatsUsed >= data.seatLimit : false
  const [ghlUsers, setGhlUsers] = useState<{ email: string; name: string | null }[]>([])
  const [pickEmail, setPickEmail] = useState('')

  useEffect(() => {
    if (!embedMode) return
    fetch('/api/ghl/location-users', { cache: 'no-store' })
      .then(async (r) => (r.ok ? (await r.json()).users ?? [] : []))
      .then(setGhlUsers)
      .catch(() => setGhlUsers([]))
  }, [embedMode])

  async function addFromGhl() {
    const u = ghlUsers.find((x) => x.email === pickEmail)
    if (!u) return
    setBusy(true)
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, name: u.name ?? undefined, skipInvite: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Failed to add')
        return
      }
      setPickEmail('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function addMember() {
    if (!email.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed to add'); return }
      setEmail(''); setName(''); await load()
    } finally { setBusy(false) }
  }

  async function saveEdit(m: Member) {
    setBusy(true)
    try {
      const payload: { name: string | null; email?: string } = { name: editName.trim() || null }
      if (m.status === 'pending' && editEmail.trim() && editEmail.trim().toLowerCase() !== m.email) payload.email = editEmail.trim()
      const res = await fetch(`/api/account/members/${m.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed to save'); return }
      setEditId(null); await load()
    } finally { setBusy(false) }
  }

  async function copyLink(m: Member) {
    if (!m.inviteUrl) {
      toast.error('No invite link available — Clerk emailed the invitation instead.')
      return
    }
    try {
      await navigator.clipboard.writeText(m.inviteUrl)
      toast.success('Invite link copied — send it to your teammate')
    } catch {
      toast.error(m.inviteUrl) // clipboard blocked; show the link to copy manually
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name ?? m.email} from your team?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/account/members/${m.id}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Failed to remove'); return }
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-2 flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-card-foreground">Team</h2>
      </div>
      {embedMode ? (
        <p className="mb-6 text-sm text-muted-foreground">
          Add up to {data ? data.seatLimit - 1 : 2} teammates from your CRM users — they open Omniply from the CRM
          sidebar and share this account with equal access. No separate passwords needed.
        </p>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">
          Add up to {data ? data.seatLimit - 1 : 2} teammates by email. They get an invitation email with a link to set
          their own password (use the <span className="inline-flex"><Link2 className="h-3.5 w-3.5" /></span> copy-link to
          share it directly too). Once they accept, they share this account with equal access.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Could not load your team.</p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            {/* Owner */}
            {data.owner && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {data.owner.name ?? data.owner.email}
                    <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Owner" />
                    <span className="text-xs text-muted-foreground">(you)</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{data.owner.email}</div>
                </div>
              </div>
            )}

            {/* Roster */}
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                {editId === m.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name"
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm" />
                    <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} disabled={m.status === 'active'}
                      placeholder="Email" className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60" />
                    <div className="flex gap-1">
                      <button onClick={() => saveEdit(m)} disabled={busy} className="rounded p-1.5 text-green-600 hover:bg-muted"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditId(null)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{m.name ?? m.email}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                      {m.status === 'active' ? 'Active' : 'Pending sign-up'}
                    </span>
                    {m.status === 'pending' && m.inviteUrl && (
                      <button onClick={() => copyLink(m)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Copy invite link"><Link2 className="h-4 w-4" /></button>
                    )}
                    <button onClick={() => { setEditId(m.id); setEditName(m.name ?? ''); setEditEmail(m.email) }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(m)} disabled={busy} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50" title="Remove"><X className="h-4 w-4" /></button>
                  </>
                )}
              </div>
            ))}
          </div>

          {seatsFull ? (
            <p className="text-xs text-amber-600">All {data.seatLimit} seats are in use. Remove a member to add someone new.</p>
          ) : embedMode ? (
            <div className="flex gap-2">
              <select
                value={pickEmail}
                onChange={(e) => setPickEmail(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Add a teammate from your CRM…</option>
                {ghlUsers
                  .filter(
                    (u) =>
                      u.email !== data.owner?.email?.toLowerCase() &&
                      !data.members.some((m) => m.email.toLowerCase() === u.email),
                  )
                  .map((u) => (
                    <option key={u.email} value={u.email}>{u.name ? `${u.name} — ${u.email}` : u.email}</option>
                  ))}
              </select>
              <Button onClick={addFromGhl} disabled={busy || !pickEmail}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name (optional)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addMember()} placeholder="teammate@example.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <Button onClick={addMember} disabled={busy || !email.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
