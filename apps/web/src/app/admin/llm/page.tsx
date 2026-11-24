'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, Save, Loader2, Check, RefreshCw, ArrowDownToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface KeyStatus {
  provider: string
  hasEnvKey: boolean
  hasDbKey: boolean
  hasUserKey: boolean
}

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic / Claude',
  openrouter: 'OpenRouter',
  'fal-ai': 'Fal.ai',
  resend: 'Resend (transactional email)',
  oxylabs_serp_username: 'Oxylabs SERP API — Username',
  oxylabs_serp_password: 'Oxylabs SERP API — Password',
  oxylabs_proxy_username: 'Oxylabs Residential Proxy — Username',
  oxylabs_proxy_password: 'Oxylabs Residential Proxy — Password',
  digitalocean: 'DigitalOcean — read-only token (billing read), for System Health',
}

export default function LLMKeysPage() {
  const [statuses, setStatuses] = useState<KeyStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [migrating, setMigrating] = useState(false)

  // Transactional email "From" address (PlatformSettings, not a secret key).
  const [fromEmail, setFromEmail] = useState('')
  const [savingFrom, setSavingFrom] = useState(false)

  async function fetchFromEmail() {
    try {
      const res = await fetch('/api/admin/platform-settings')
      if (res.ok) {
        const data = await res.json()
        setFromEmail(data.settings?.transactionalEmailFrom ?? '')
      }
    } catch {
      /* non-fatal */
    }
  }

  async function saveFromEmail() {
    setSavingFrom(true)
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionalEmailFrom: fromEmail.trim() || null }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Transactional From address saved')
    } catch {
      toast.error('Failed to save From address')
    } finally {
      setSavingFrom(false)
    }
  }

  async function fetchStatuses() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/llm-keys')
      if (!res.ok) throw new Error('Failed to load')
      setStatuses(await res.json())
    } catch {
      toast.error('Failed to load key statuses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatuses()
    fetchFromEmail()
  }, [])

  async function saveKey(provider: string) {
    const key = inputs[provider]?.trim()
    if (!key) { toast.error('Enter a key first'); return }
    setSaving((s) => ({ ...s, [provider]: true }))
    try {
      const res = await fetch(`/api/admin/llm-keys/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success(`${PROVIDER_LABELS[provider] ?? provider} key saved`)
      setInputs((i) => ({ ...i, [provider]: '' }))
      await fetchStatuses()
    } catch {
      toast.error('Failed to save key')
    } finally {
      setSaving((s) => ({ ...s, [provider]: false }))
    }
  }

  async function migrateFromUserKeys() {
    setMigrating(true)
    try {
      const res = await fetch('/api/admin/llm-keys/migrate', { method: 'POST' })
      if (!res.ok) throw new Error('Migration failed')
      const result = await res.json()
      if (result.migrated?.length > 0) {
        toast.success(`Migrated: ${result.migrated.join(', ')}`)
      } else {
        toast.info('No user keys found to migrate')
      }
      if (result.failed?.length > 0) {
        toast.error(`Failed to migrate: ${result.failed.join(', ')}`)
      }
      await fetchStatuses()
    } catch {
      toast.error('Migration failed')
    } finally {
      setMigrating(false)
    }
  }

  const hasAnyUserKey = statuses.some((s) => s.hasUserKey && !s.hasDbKey)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System LLM Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Keys set here are used by the article pipeline. Env-var keys take precedence over DB keys.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatuses} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* One-time migration banner */}
      {!loading && hasAnyUserKey && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-800">User API keys detected</p>
            <p className="text-xs text-blue-600 mt-0.5">
              You have API keys stored in your user settings. Click to copy them into the system key store so
              the article pipeline can use them.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-100 flex-shrink-0"
            onClick={migrateFromUserKeys}
            disabled={migrating}
          >
            {migrating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              : <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />}
            Migrate keys
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : (
        <div className="space-y-3">
          {statuses.map((s) => (
            <div key={s.provider} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-sm text-foreground">
                    {PROVIDER_LABELS[s.provider] ?? s.provider}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <SourceBadge label="ENV" active={s.hasEnvKey} />
                    <SourceBadge label="DB" active={s.hasDbKey} />
                    {s.hasUserKey && !s.hasDbKey && (
                      <SourceBadge label="USER KEY (not migrated)" active={false} warning />
                    )}
                  </div>
                </div>
                {(s.hasEnvKey || s.hasDbKey) && (
                  <Check className="h-4 w-4 text-green-400" />
                )}
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={visible[s.provider] ? 'text' : 'password'}
                    placeholder={`Update ${PROVIDER_LABELS[s.provider] ?? s.provider} key…`}
                    value={inputs[s.provider] ?? ''}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [s.provider]: e.target.value }))
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm pr-9 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((v) => ({ ...v, [s.provider]: !v[s.provider] }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {visible[s.provider] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveKey(s.provider)}
                  disabled={saving[s.provider] || !inputs[s.provider]?.trim()}
                >
                  {saving[s.provider]
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Save className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Transactional email From address (Resend) */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="font-medium text-sm text-foreground">Transactional email — From address</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          The “From” address for transactional emails (e.g. the newsletter “ready for review”
          notification), sent via the Resend key above. Use a domain verified in Resend.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="hello@yourdomain.com"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button size="sm" onClick={saveFromEmail} disabled={savingFrom}>
            {savingFrom ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Env-var keys (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, FAL_KEY,
        RESEND_API_KEY) are always read first. DB keys are a fallback for changing keys without
        redeploying.
      </p>
    </div>
  )
}

function SourceBadge({
  label,
  active,
  warning,
}: {
  label: string
  active: boolean
  warning?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
        active
          ? 'bg-green-500/20 text-green-400'
          : warning
            ? 'bg-yellow-500/15 text-yellow-600'
            : 'bg-muted text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}
