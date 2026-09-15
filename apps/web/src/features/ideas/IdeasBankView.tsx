'use client'

import { useEffect, useState } from 'react'
import { Lightbulb, Loader2, Trash2, Pencil, Upload, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TopicEditModal, type EditableTopic } from '@/features/dashboard/TopicEditModal'
import { CsvImportModal, downloadIdeasTemplate } from '@/features/dashboard/CsvImportModal'

interface Idea {
  id: string
  topic: string
  mode: string | null
  outlineFrameworkNumber: number | null
  outlineSpecialInstructions: string | null
  realCaseStudies: string | null
}

export function IdeasBankView({ embedMode = false }: { embedMode?: boolean } = {}) {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditableTopic | null>(null)
  const [importing, setImporting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/topics/ideas', { cache: 'no-store' })
      if (res.ok) setIdeas((await res.json()).ideas ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function remove(id: string) {
    if (!confirm('Delete this idea?')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to delete')
        return
      }
      setIdeas((prev) => prev.filter((i) => i.id !== id))
    } finally {
      setBusyId(null)
    }
  }

  function summary(idea: Idea): string {
    const parts: string[] = []
    if (idea.outlineFrameworkNumber != null) parts.push(`Framework ${idea.outlineFrameworkNumber}`)
    if (idea.mode === 'article_only') parts.push('Article only')
    if (idea.outlineSpecialInstructions) parts.push('Special instructions')
    if (idea.realCaseStudies) parts.push('Case studies')
    return parts.join(' · ')
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-6 w-6 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ideas Bank</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your captured article ideas that haven&apos;t been scheduled yet. Add a framework and
              advanced options to personalize each one; schedule them from the Content Plan.
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <Button
            variant="outline"
            onClick={() => setImporting(true)}
            className="border-primary text-foreground hover:border-primary hover:bg-primary/15 hover:text-foreground"
          >
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <button
            onClick={downloadIdeasTemplate}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download example template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : ideas.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No unused ideas. Capture some on the dashboard under “Capture an Article Idea.”
        </div>
      ) : (
        <div className="space-y-2">
          {ideas.map((idea) => {
            const s = summary(idea)
            return (
              <div key={idea.id} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{idea.topic}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{s || 'No framework/options set'}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing({ id: idea.id, topic: idea.topic })} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit topic & options">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(idea.id)} disabled={busyId === idea.id} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50" title="Delete">
                    {busyId === idea.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <TopicEditModal topic={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}

      {importing && (
        <CsvImportModal onClose={() => setImporting(false)} onImported={() => void load()} />
      )}
    </div>
  )
}
