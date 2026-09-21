'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Globe, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { LinktreeDownloadButton } from './LinktreeDownloadButton'
import { SpineCheckDownloadButton } from './SpineCheckDownloadButton'

export function WordPressSection({ embedMode = false }: { embedMode?: boolean }) {
  const [publishTime, setPublishTime] = useState('09:00')
  const [savedTime, setSavedTime] = useState('09:00')
  const [savingTime, setSavingTime] = useState(false)

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const s = await res.json()
        if (typeof s?.wpPublishTime === 'string' && s.wpPublishTime) {
          setPublishTime(s.wpPublishTime)
          setSavedTime(s.wpPublishTime)
        }
      })
      .catch(() => {})
  }, [])

  async function savePublishTime() {
    setSavingTime(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpPublishTime: publishTime }),
      })
      if (!res.ok) {
        toast.error('Could not save the publish time')
        return
      }
      setSavedTime(publishTime)
      toast.success(`Articles will go live on your site at ${publishTime}.`)
    } finally {
      setSavingTime(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-card-foreground mb-2">WordPress</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a WordPress site to publish articles directly from the workflow. Connected sites also get a
        link-in-bio page published automatically at <code className="text-xs">/linktree</code>.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="wp-publish-time" className="mb-1 block text-sm font-medium text-card-foreground">
            Publish time
          </label>
          <input
            id="wp-publish-time"
            type="time"
            value={publishTime}
            onChange={(e) => setPublishTime(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <Button variant="outline" onClick={savePublishTime} disabled={savingTime || publishTime === savedTime}>
          {savingTime && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
        <p className="max-w-sm pb-1 text-xs text-muted-foreground">
          Approved articles are scheduled on your site for their calendar day at this time (your local timezone).
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {/* /settings/wordpress is a Clerk web page — never navigate the GHL
            iframe there. Embedded clients get WP connected during onboarding;
            changes go through support for now. */}
        {!embedMode && (
          <Button variant="outline" asChild>
            <Link href="/settings/wordpress" className="inline-flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Manage WordPress connections
            </Link>
          </Button>
        )}
        <LinktreeDownloadButton />
        <SpineCheckDownloadButton />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Not on WordPress? Download the page as a single HTML file and upload it to your own hosting.
      </p>
    </div>
  )
}
