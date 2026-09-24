'use client'

/**
 * LinkedIn & Medium platform articles for a PUBLISHED article — the embed's
 * window onto syndication (Veit 2026-09-24: "one of THE pieces AI answers
 * weigh"). Self-contained (the workflow page's SyndicationPanels is welded
 * to useWorkflowJob, which the embed can't mount — same split as
 * ArticleSocialPreview). Generation auto-fires at publish; this modal
 * fetches, polls while pending, retries on failure, and copies rich HTML
 * straight into LinkedIn's editor.
 */
import { useEffect, useState } from 'react'
import { BookMarked, ClipboardCheck, ClipboardCopy, Linkedin, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { markdownToHtml } from '@/features/workflow/markdown-to-html'

interface SyndicationArticle {
  platform: 'linkedin' | 'medium'
  title: string
  content: string
  status: 'pending' | 'completed' | 'failed'
  errorMessage?: string | null
}

export function SyndicationModal({
  jobId,
  articleTitle,
  onClose,
}: {
  jobId: string
  articleTitle: string
  onClose: () => void
}) {
  const [articles, setArticles] = useState<SyndicationArticle[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<'linkedin' | 'medium'>('linkedin')
  const [copied, setCopied] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  async function load() {
    const res = await fetch(`/api/articles/${jobId}/syndication`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setArticles(data.articles ?? [])
    }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  // Poll while generation is running (fires at publish; ~20s typical).
  const pending = articles.length === 0 || articles.some((a) => a.status === 'pending')
  useEffect(() => {
    if (!loaded || !pending) return
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pending])

  async function retry() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/articles/${jobId}/syndication`, { method: 'POST' })
      if (!res.ok) {
        toast.error('Could not restart generation')
        return
      }
      await load()
    } finally {
      setRetrying(false)
    }
  }

  /** Rich copy: HTML for LinkedIn/Medium editors + plain-text fallback. */
  async function copyRich(art: SyndicationArticle) {
    const html = `<h1>${art.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>\n${markdownToHtml(art.content)}`
    const plain = `# ${art.title}\n\n${art.content}`
    try {
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(plain)
      }
      setCopied(art.platform)
      setTimeout(() => setCopied(null), 2500)
    } catch {
      toast.error('Copy failed — please select and copy manually')
    }
  }

  const failed = articles.filter((a) => a.status === 'failed')
  const completed = articles.filter((a) => a.status === 'completed')
  const active = completed.find((a) => a.platform === tab) ?? completed[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <BookMarked className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-sm font-semibold text-card-foreground">
              LinkedIn &amp; Medium — {articleTitle}
            </span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!loaded ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : pending && completed.length === 0 && failed.length === 0 ? (
            <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Writing your LinkedIn and Medium versions — usually under a minute…
            </div>
          ) : completed.length === 0 && failed.length > 0 ? (
            <div className="space-y-3 py-4">
              {failed.map((a) => (
                <p key={a.platform} className="text-sm text-red-600">
                  {a.platform === 'linkedin' ? 'LinkedIn' : 'Medium'}: {a.errorMessage ?? 'Generation failed'}
                </p>
              ))}
              <Button variant="outline" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Try again
              </Button>
            </div>
          ) : active ? (
            <>
              <div className="mb-4 flex w-fit gap-1 rounded-lg bg-muted p-1">
                {(['linkedin', 'medium'] as const).map((platform) => {
                  const art = completed.find((a) => a.platform === platform)
                  if (!art) return null
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => setTab(platform)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        (active?.platform ?? tab) === platform
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {platform === 'linkedin' ? <Linkedin className="h-3.5 w-3.5" /> : <BookMarked className="h-3.5 w-3.5" />}
                      {platform === 'linkedin' ? 'LinkedIn Article' : 'Medium Article'}
                    </button>
                  )
                })}
              </div>

              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold leading-snug text-card-foreground">{active.title}</h3>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => void copyRich(active)}>
                  {copied === active.platform ? (
                    <>
                      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                      Copy for {active.platform === 'linkedin' ? 'LinkedIn' : 'Medium'}
                    </>
                  )}
                </Button>
              </div>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
                {active.content}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {active.platform === 'linkedin'
                  ? 'Paste into a new LinkedIn Article — headings and formatting carry over.'
                  : 'Paste into a new Medium story — or use Medium’s Import tool with your live article link to pull images automatically.'}
              </p>
            </>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">No platform articles yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
