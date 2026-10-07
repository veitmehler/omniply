'use client'

import { useState, useEffect } from 'react'
import { Globe, Plus, Trash2, CheckCircle2, XCircle, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type WpConnection = {
  id: string
  label: string
  siteUrl: string
  username: string
  defaultStatus: string
  defaultCategoryId?: number | null
  defaultAuthorId?: number | null
  lastVerifiedAt?: string | null
  lastError?: string | null
  seoPlugin?: string | null
  createdAt: string
}

const SEO_PLUGIN_LABELS: Record<string, string> = {
  yoast:            'Yoast SEO',
  rankmath:         'Rank Math',
  aioseo:           'All in One SEO',
  seopress:         'SEOPress',
  theseoframework:  'The SEO Framework',
}

type WpOption = { id: number; name: string }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WordPressSettingsPage() {
  const [connections, setConnections] = useState<WpConnection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetch('/api/wp/connections')
      .then((r) => r.json())
      .then((d) => { setConnections(d.connections ?? []); setIsLoading(false) })
      .catch(() => setIsLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this WordPress connection?')) return
    const res = await fetch(`/api/wp/connections/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setConnections((prev) => prev.filter((c) => c.id !== id))
      toast.success('Connection removed')
    } else {
      toast.error('Failed to remove connection')
    }
  }

  const handleVerify = async (id: string) => {
    toast.info('Verifying…')
    const res = await fetch(`/api/wp/connections/${id}/verify`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) toast.success('Connection verified successfully')
    else toast.error(`Verification failed: ${data.error}`)
    setConnections((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, lastVerifiedAt: data.ok ? new Date().toISOString() : c.lastVerifiedAt, lastError: data.error ?? null }
          : c,
      ),
    )
  }

  const handleAdded = (conn: WpConnection) => {
    setConnections((prev) => [conn, ...prev])
    setShowForm(false)
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">WordPress Connections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect WordPress sites to publish enriched articles directly.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add site
        </Button>
      </div>

      {/* Add-connection form */}
      {showForm && (
        <div className="mb-8">
          <AddConnectionForm onAdded={handleAdded} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Existing connections */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : connections.length === 0 && !showForm ? (
        <div className="text-center py-16 text-muted-foreground">
          <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No WordPress sites connected yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              onDelete={handleDelete}
              onVerify={handleVerify}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── ConnectionCard ────────────────────────────────────────────────────────────

function ConnectionCard({
  conn,
  onDelete,
  onVerify,
}: {
  conn: WpConnection
  onDelete: (id: string) => void
  onVerify: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-semibold text-card-foreground truncate">{conn.label}</span>
            {conn.lastVerifiedAt && !conn.lastError ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-500/15 dark:bg-green-500/20">
                <CheckCircle2 className="h-3 w-3 shrink-0" /> Verified
              </span>
            ) : conn.lastError ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-500/15 dark:bg-red-500/20">
                <XCircle className="h-3 w-3 shrink-0" /> Error
              </span>
            ) : null}
          </div>
          <a
            href={conn.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate block text-xs text-primary hover:underline"
          >
            {conn.siteUrl}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">
            User: <span className="font-mono text-foreground">{conn.username}</span> &bull; Default status:{' '}
            <span className="capitalize">{conn.defaultStatus}</span>
            {conn.lastVerifiedAt && (
              <> &bull; SEO plugin:{' '}
                <span className="text-foreground">
                  {conn.seoPlugin ? (SEO_PLUGIN_LABELS[conn.seoPlugin] ?? conn.seoPlugin) : 'None detected'}
                </span>
              </>
            )}
          </p>
          {conn.lastError && (
            <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">{conn.lastError}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onVerify(conn.id)}>
            Verify
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(conn.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── AddConnectionForm ─────────────────────────────────────────────────────────

function AddConnectionForm({
  onAdded,
  onCancel,
}: {
  onAdded: (conn: WpConnection) => void
  onCancel: () => void
}) {
  const fieldClass =
    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

  const [label, setLabel] = useState('')
  const [siteUrl, setSiteUrl] = useState('https://')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [defaultStatus, setDefaultStatus] = useState('draft')
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | ''>('')
  const [defaultAuthorId, setDefaultAuthorId] = useState<number | ''>('')
  const [categories, setCategories] = useState<WpOption[]>([])
  const [authors, setAuthors] = useState<WpOption[]>([])
  const [showHowTo, setShowHowTo] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/wp/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label, siteUrl, username, appPassword,
          defaultStatus,
          defaultCategoryId: defaultCategoryId !== '' ? Number(defaultCategoryId) : undefined,
          defaultAuthorId: defaultAuthorId !== '' ? Number(defaultAuthorId) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Connection failed'); return }
      // Populate dropdowns from verification response
      if (data.categories) setCategories(data.categories)
      if (data.authors) setAuthors(data.authors)
      toast.success('WordPress site connected!')
      onAdded(data.connection)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold text-card-foreground">Connect a WordPress site</h2>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Label */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Label</label>
          <input
            type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="My Blog" required
            className={fieldClass}
          />
        </div>
        {/* Site URL */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Site URL</label>
          <input
            type="url" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com" required
            className={fieldClass}
          />
        </div>
        {/* Username */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">WordPress Username</label>
          <input
            type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="your-username" required
            className={fieldClass}
          />
        </div>
        {/* App Password */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Application Password
            <button
              type="button"
              onClick={() => setShowHowTo((v) => !v)}
              className="ml-1 align-middle text-primary hover:text-primary/80"
              title="How to generate"
            >
              <Info className="inline h-3.5 w-3.5" />
            </button>
          </label>
          <input
            type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" required
            className={fieldClass}
          />
        </div>
      </div>

      {/* How-to instructions (collapsible) */}
      {showHowTo && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-card-foreground">
          <p className="font-semibold">How to generate an Application Password:</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Sign in to your WordPress admin dashboard.</li>
            <li>Go to <strong className="text-foreground">Users → Profile</strong> (or edit the user you want to use).</li>
            <li>Scroll down to the <strong className="text-foreground">Application Passwords</strong> section.</li>
            <li>Type <code className="rounded bg-muted px-1 py-0.5 text-foreground">Omniply</code> in the &ldquo;New Application Password Name&rdquo; field.</li>
            <li>Click <strong className="text-foreground">Add New Application Password</strong> and copy the generated value.</li>
          </ol>
          <p className="mt-1 text-xs text-muted-foreground">
            Note: Application Passwords require WordPress 5.6+ and HTTPS on your site.
          </p>
        </div>
      )}

      {/* Default settings */}
      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Default Status</label>
          <select
            value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}
            className={fieldClass}
          >
            <option value="draft">Draft</option>
            <option value="publish">Publish</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Default Category</label>
          <select
            value={defaultCategoryId}
            onChange={(e) => setDefaultCategoryId(e.target.value !== '' ? Number(e.target.value) : '')}
            className={fieldClass}
          >
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Default Author</label>
          <select
            value={defaultAuthorId}
            onChange={(e) => setDefaultAuthorId(e.target.value !== '' ? Number(e.target.value) : '')}
            className={fieldClass}
          >
            <option value="">— none —</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Verifying…</>
          ) : (
            <>Verify & Save</>
          )}
        </Button>
      </div>
    </form>
  )
}
