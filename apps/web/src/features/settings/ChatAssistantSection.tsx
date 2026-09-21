'use client'

/**
 * Chat assistant install section (chat-agent plan C1/C2b): mints the
 * account's widget token via POST /api/agent/provision and shows the
 * one-line embed snippet with a copy button. The same snippet works on
 * WordPress and any site builder that accepts a script tag.
 */
import { useState } from 'react'
import { useAppToken } from '@/lib/use-app-token'
import { MessageCircle, Copy, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const API_BASE = process.env.NEXT_PUBLIC_AGENT_API_BASE ?? 'https://svc.omniply.io'

export function ChatAssistantSection() {
  const getToken = useAppToken()
  const [snippet, setSnippet] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function provision() {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/agent/provision', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not create your widget code')
        return
      }
      const data = (await res.json()) as { token: string }
      setSnippet(`<script async src="${API_BASE}/api/agent/widget.js?v=4" data-omniply="${data.token}"></script>`)
    } catch {
      setError('Could not reach the server — please try again')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!snippet) return
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-card-foreground">AI Chat Assistant</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        A patient-safe chat assistant for your website: answers questions about your practice,
        hours and location, offers your guides, and captures booking and callback requests
        straight into your CRM. It never gives medical advice. Add the snippet below just
        before the closing <code className="font-mono text-xs">&lt;/body&gt;</code> tag of
        your site (or in a footer scripts box).
      </p>

      {!snippet ? (
        <Button onClick={provision} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1.5" />}
          Get my embed code
        </Button>
      ) : (
        <div className="space-y-2">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-4 py-3 text-xs font-mono whitespace-pre-wrap break-all">
            {snippet}
          </pre>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {copied ? 'Copied' : 'Copy snippet'}
          </Button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  )
}
