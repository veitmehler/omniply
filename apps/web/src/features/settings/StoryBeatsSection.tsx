'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Story {
  id: string
  storyText: string
  topicTags: string[]
  source: string
  kind: string
  originalText: string | null
  lastUsedAt: string | null
  useCount: number
  createdAt: string
}

const SOURCE_LABEL: Record<string, string> = { onboarding: 'From your onboarding', review: 'From a Google review', manual: 'Added by you' }
const KIND_LABEL: Record<string, string> = { client_case: 'Client story', owner_moment: 'Your own moment' }

// Story bank (2026-11-11): the sanitized stories that articles and social posts draw on.
// Owners can edit the published wording, remove a story, add one, or rebuild from onboarding.
export function StoryBeatsSection() {
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [newText, setNewText] = useState('')
  const [newKind, setNewKind] = useState<'client_case' | 'owner_moment'>('client_case')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/client-stories')
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { stories: Story[] }
      setStories(data.stories)
      setDrafts({})
    } catch {
      toast.error('Could not load your stories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (s: Story) => {
    const text = drafts[s.id]
    if (text == null || text === s.storyText) return
    setSaving(s.id)
    try {
      const res = await fetch(`/api/client-stories/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyText: text }) })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || 'Save failed')
      }
      toast.success('Story updated')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  const remove = async (s: Story) => {
    if (!confirm('Remove this story? Articles and posts will stop using it.')) return
    setSaving(s.id)
    try {
      const res = await fetch(`/api/client-stories/${s.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Story removed')
      await load()
    } catch {
      toast.error('Could not remove the story')
    } finally {
      setSaving(null)
    }
  }

  const add = async () => {
    const text = newText.trim()
    if (!text) return
    setAdding(true)
    try {
      const res = await fetch('/api/client-stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyText: text, kind: newKind }) })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || 'Could not add the story')
      }
      setNewText('')
      toast.success('Story added')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the story')
    } finally {
      setAdding(false)
    }
  }

  const rebuild = async () => {
    setRebuilding(true)
    try {
      const res = await fetch('/api/client-stories/rebuild', { method: 'POST' })
      if (!res.ok) throw new Error('Rebuild failed')
      const data = (await res.json()) as { stories: Story[]; beats: { stored: number } | null; reviewsTriaged: number }
      setStories(data.stories)
      setDrafts({})
      toast.success(`Rebuilt: ${data.beats?.stored ?? 0} stories from your onboarding, ${data.reviewsTriaged} reviews checked`)
    } catch {
      toast.error('Could not rebuild the stories')
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h2 className="text-xl font-semibold text-card-foreground flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Your stories
        </h2>
        <Button variant="outline" size="sm" onClick={rebuild} disabled={rebuilding}>
          {rebuilding ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          Rebuild from onboarding
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Real moments from your practice, rewritten so they can be published: no names, no exact ages, outcomes described as what people reported. Articles use one story each; social posts draw on them for the personal beats. Edit the wording here if a story does not sound like you.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : stories.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-6">No stories yet. Rebuild from your onboarding answers, or add one below.</p>
      ) : (
        <div className="space-y-4 mb-6">
          {stories.map((s) => {
            const draft = drafts[s.id] ?? s.storyText
            const dirty = draft !== s.storyText
            return (
              <div key={s.id} className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
                  <span className="rounded-full border border-border px-2 py-0.5">{KIND_LABEL[s.kind] ?? s.kind}</span>
                  <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
                  {s.useCount > 0 && <span>· used {s.useCount}×</span>}
                  {s.topicTags.length > 0 && <span>· {s.topicTags.join(', ')}</span>}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[88px]"
                />
                {s.originalText && s.originalText !== s.storyText && (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">What you originally said</summary>
                    <p className="mt-1 whitespace-pre-wrap">{s.originalText}</p>
                  </details>
                )}
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="ghost" size="sm" onClick={() => remove(s)} disabled={saving === s.id}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                  </Button>
                  <Button size="sm" onClick={() => save(s)} disabled={!dirty || saving === s.id}>
                    {saving === s.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />} Save
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-border p-4">
        <label className="text-sm font-medium text-card-foreground mb-2 block">Add a story</label>
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Two to four sentences, in your own words. No names, no exact ages, no cure claims."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[88px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as 'client_case' | 'owner_moment')} className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
            <option value="client_case">Client story</option>
            <option value="owner_moment">My own moment</option>
          </select>
          <Button size="sm" onClick={add} disabled={adding || !newText.trim()}>
            {adding ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />} Add story
          </Button>
        </div>
      </div>
    </div>
  )
}
