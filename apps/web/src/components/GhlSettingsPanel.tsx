'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Mail, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { GhlAccountIds, GhlSocialAccount, GhlTag } from '@/lib/ghl/types'

interface PromoEmailConfig {
  enabled: boolean
  tagId: string | null
  tagName: string | null
  sendTime: string
  timezone: string
  fromName: string | null
  fromEmail: string | null
}

const DEFAULT_PROMO_EMAIL: PromoEmailConfig = {
  enabled: true,
  tagId: null,
  tagName: null,
  sendTime: '09:00',
  timezone: 'America/New_York',
  fromName: null,
  fromEmail: null,
}

const OMNIPLY_PLATFORMS = [
  { key: 'facebook' as const, label: 'Facebook' },
  { key: 'instagram' as const, label: 'Instagram' },
  { key: 'linkedin' as const, label: 'LinkedIn' },
  { key: 'threads' as const, label: 'Threads' },
]

export function GhlSettingsPanel() {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false)

  const [ghlApiKey, setGhlApiKey] = useState('')
  const [ghlLocationId, setGhlLocationId] = useState('')
  const [ghlUserId, setGhlUserId] = useState('')
  const [maskedApiKey, setMaskedApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [authType, setAuthType] = useState<string>('pi')
  const [accountIds, setAccountIds] = useState<GhlAccountIds>({})
  const [availableAccounts, setAvailableAccounts] = useState<GhlSocialAccount[]>([])
  const [lastError, setLastError] = useState<string | null>(null)

  const [promoEmail, setPromoEmail] = useState<PromoEmailConfig>(DEFAULT_PROMO_EMAIL)
  const [availableTags, setAvailableTags] = useState<GhlTag[]>([])
  const [isLoadingTags, setIsLoadingTags] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/ghl/settings')
      if (!response.ok) {
        throw new Error('Failed to load Omniply settings')
      }
      const data = await response.json()
      setGhlLocationId(data.ghlLocationId ?? '')
      setGhlUserId(data.ghlUserId ?? '')
      setMaskedApiKey(data.maskedApiKey ?? '')
      setHasApiKey(!!data.hasApiKey)
      setAuthType(data.authType ?? 'pi')
      setAccountIds(data.accountIds ?? {})
      setLastError(data.lastError ?? null)
      if (data.promoEmail) setPromoEmail({ ...DEFAULT_PROMO_EMAIL, ...data.promoEmail })
      return !!data.hasApiKey && !!data.ghlLocationId
    } catch (error) {
      console.error(error)
      toast.error('Failed to load Omniply settings')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleLoadAccounts = useCallback(async () => {
    try {
      setIsLoadingAccounts(true)
      const response = await fetch('/api/ghl/accounts')
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load accounts')
      }
      setAvailableAccounts(data.accounts ?? [])
      const count = data.accounts?.length ?? 0
      if (count === 0 && data.warning) {
        setLastError(data.warning)
        toast.warning('No accounts found — see instructions below')
      } else {
        setLastError(null)
        if (count > 0) toast.success(`Loaded ${count} connected account(s)`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load accounts'
      setLastError(message)
      toast.error(message)
    } finally {
      setIsLoadingAccounts(false)
    }
  }, [])

  const handleLoadTags = useCallback(async () => {
    try {
      setIsLoadingTags(true)
      const response = await fetch('/api/ghl/tags')
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load tags')
      }
      setAvailableTags(data.tags ?? [])
      const count = data.tags?.length ?? 0
      if (count > 0) toast.success(`Loaded ${count} tag(s)`)
      else toast.warning('No tags found in this Omniply location')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load tags'
      toast.error(message)
    } finally {
      setIsLoadingTags(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings().then((configured) => {
      if (configured) {
        void handleLoadAccounts()
        void handleLoadTags()
      }
    })
  }, [loadSettings, handleLoadAccounts, handleLoadTags])

  const handleSave = async () => {
    if (!ghlLocationId.trim() || !ghlUserId.trim()) {
      toast.error('Location ID and User ID are required')
      return
    }
    if (!ghlApiKey.trim() && !hasApiKey) {
      toast.error('API key is required')
      return
    }

    try {
      setIsSaving(true)
      const response = await fetch('/api/ghl/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghlApiKey: ghlApiKey.trim() || undefined,
          ghlLocationId: ghlLocationId.trim(),
          ghlUserId: ghlUserId.trim(),
          accountIds,
          promoEmail,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save GHL settings')
      }

      setMaskedApiKey(data.maskedApiKey ?? '')
      setHasApiKey(true)
      setGhlApiKey('')
      if (data.promoEmail) setPromoEmail({ ...DEFAULT_PROMO_EMAIL, ...data.promoEmail })
      toast.success('Omniply settings saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Omniply settings')
    } finally {
      setIsSaving(false)
    }
  }

  const openGhlOAuth = async (platform: string) => {
    try {
      const response = await fetch(`/api/ghl/oauth-url/${platform}`)
      const data = await response.json()
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Could not get GHL OAuth URL')
      }
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open GHL connect page')
    }
  }

  const accountsForPlatform = (platform: string) =>
    availableAccounts.filter((a) => a.platform === platform)

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-card-foreground">Omniply</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Facebook, Instagram, LinkedIn, and Threads publishing is routed through your Omniply Social Planner.
          Connect accounts in Omniply, then map them here.
        </p>
      </div>

      {authType === 'oauth' ? (
        <div className="rounded-lg border border-lime-200 bg-lime-50 px-4 py-3">
          <p className="text-sm font-medium text-lime-900">Connected via the Omniply app ✓</p>
          <p className="text-xs text-lime-800 mt-1">
            Location <span className="font-mono">{ghlLocationId}</span> — credentials are managed and renewed
            automatically. Nothing to configure here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Private Integration API key</label>
            <input
              type="password"
              value={ghlApiKey}
              onChange={(e) => setGhlApiKey(e.target.value)}
              placeholder={hasApiKey ? maskedApiKey || '••••••••' : 'Paste API key'}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            {hasApiKey && !ghlApiKey && (
              <p className="text-xs text-muted-foreground mt-1">Saved key: {maskedApiKey || 'configured'}. Enter a new value to replace it.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Location ID</label>
            <input
              type="text"
              value={ghlLocationId}
              onChange={(e) => setGhlLocationId(e.target.value)}
              placeholder="ve9EPM428h8vShlRW1KT"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">User ID</label>
            <input
              type="text"
              value={ghlUserId}
              onChange={(e) => setGhlUserId(e.target.value)}
              placeholder="Team member who owns scheduled posts"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {authType !== 'oauth' && (
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Omniply settings
          </Button>
        )}
        <Button variant="outline" onClick={() => void handleLoadAccounts()} disabled={isLoadingAccounts}>
          {isLoadingAccounts ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Load connected accounts
        </Button>
      </div>

      {lastError && (
        <p className="text-sm text-destructive">Last error: {lastError}</p>
      )}

      <div className="space-y-3 pt-2 border-t border-border">
        <p className="text-sm font-medium text-card-foreground">Platform account mapping</p>
        {OMNIPLY_PLATFORMS.map(({ key, label }) => {
          const options = accountsForPlatform(key)
          return (
            <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-[120px] text-sm text-card-foreground">{label}</div>
              <select
                value={accountIds[key] ?? ''}
                onChange={(e) =>
                  setAccountIds((prev) => ({
                    ...prev,
                    [key]: e.target.value || undefined,
                  }))
                }
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select Omniply account…</option>
                {options.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name ?? account.id}
                    {account.isExpired ? ' (expired)' : ''}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={() => void openGhlOAuth(key)}>
                <ExternalLink className="w-4 h-4 mr-1" />
                Connect in Omniply
              </Button>
            </div>
          )
        })}
        <p className="text-xs text-muted-foreground">
          If an account is missing, click &quot;Connect in Omniply&quot;, complete the OAuth flow, then click &quot;Load connected accounts&quot; again.
        </p>
      </div>

      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium text-card-foreground">Promotional email</p>
        </div>
        <p className="text-xs text-muted-foreground">
          When an article is published, automatically generate a promotional email and send it as an
          Omniply Email Campaign to a tag (smart list) at a set time that day.
        </p>

        <label className="flex items-center gap-2 text-sm text-card-foreground">
          <input
            type="checkbox"
            checked={promoEmail.enabled}
            onChange={(e) => setPromoEmail((p) => ({ ...p, enabled: e.target.checked }))}
            className="h-4 w-4 rounded border-input"
          />
          Send a promotional email for every published article
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-card-foreground">Tag / smart list</label>
              <Button variant="ghost" size="sm" onClick={() => void handleLoadTags()} disabled={isLoadingTags}>
                {isLoadingTags ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Refresh
              </Button>
            </div>
            <select
              value={promoEmail.tagId ?? ''}
              onChange={(e) => {
                const tagId = e.target.value || null
                const tagName = availableTags.find((t) => t.id === tagId)?.name ?? null
                setPromoEmail((p) => ({ ...p, tagId, tagName }))
              }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a tag…</option>
              {/* Keep the saved tag selectable even before the list is (re)loaded. */}
              {promoEmail.tagId && !availableTags.some((t) => t.id === promoEmail.tagId) && (
                <option value={promoEmail.tagId}>{promoEmail.tagName ?? promoEmail.tagId}</option>
              )}
              {availableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Send time</label>
            <input
              type="time"
              value={promoEmail.sendTime}
              onChange={(e) => setPromoEmail((p) => ({ ...p, sendTime: e.target.value }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Timezone</label>
            <input
              type="text"
              value={promoEmail.timezone}
              onChange={(e) => setPromoEmail((p) => ({ ...p, timezone: e.target.value }))}
              placeholder="America/New_York"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-card-foreground mb-1">From name</label>
              <input
                type="text"
                value={promoEmail.fromName ?? ''}
                onChange={(e) => setPromoEmail((p) => ({ ...p, fromName: e.target.value || null }))}
                placeholder="Optional"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-card-foreground mb-1">From email</label>
              <input
                type="email"
                value={promoEmail.fromEmail ?? ''}
                onChange={(e) => setPromoEmail((p) => ({ ...p, fromEmail: e.target.value || null }))}
                placeholder="Optional"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Click &quot;Save Omniply settings&quot; above to apply. The email is sent at the chosen time on the
          article&apos;s publish date; if that time has already passed, it sends shortly after publishing.
        </p>
      </div>
    </div>
  )
}
