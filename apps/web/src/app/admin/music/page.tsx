'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Loader2, Music, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// Uploads bypass the Vercel proxy (4.5 MB request-body cap — far too small
// for WAV) and POST straight to the API, which accepts 100 MB and is CORS-
// allowlisted for the admin hosts. Same base-URL pattern as embedSession.ts.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://svc.omniply.io'

type MusicTrack = {
  id: string
  title: string
  url: string
  duration: number
  isActive: boolean
  createdAt: string
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function AdminMusicPage() {
  const { getToken } = useAuth()
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTracks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/music', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load music library (${res.status})`)
      setTracks(await res.json())
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to load music library')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTracks()
  }, [loadTracks])

  // Multiple files are uploaded one at a time — each POST carries one file,
  // so the server normalizes them strictly sequentially. A failed file is
  // reported and skipped; the rest continue.
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    setUploadProgress({ done: 0, total: files.length })
    let succeeded = 0
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ done: i, total: files.length })
        try {
          const formData = new FormData()
          formData.append('file', files[i])
          // Fresh token per file: big uploads on slow links can outlive the
          // ~60s Clerk session-token window.
          const token = await getToken()
          if (!token) throw new Error('Session expired — reload and sign in again')
          const res = await fetch(`${API_BASE}/api/admin/music`, {
            method: 'POST',
            body: formData,
            headers: { Authorization: `Bearer ${token}` },
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`)
          succeeded++
          toast.success(`"${data.title}" uploaded and normalized (${formatDuration(data.duration)})`)
        } catch (err) {
          toast.error(
            `${files[i].name}: ${err instanceof Error ? err.message : 'Upload failed'}`,
          )
        }
      }
      if (files.length > 1) {
        toast.info(`${succeeded} of ${files.length} tracks uploaded`)
      }
      await loadTracks()
    } finally {
      setUploadProgress(null)
    }
  }

  const handleToggleActive = async (track: MusicTrack) => {
    setBusyId(track.id)
    try {
      const res = await fetch(`/api/admin/music/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !track.isActive }),
      })
      if (!res.ok) throw new Error('Failed to update track')
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, isActive: !track.isActive } : t)),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update track')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (track: MusicTrack) => {
    if (!confirm(`Delete "${track.title}"? Videos already generated keep their music.`)) return
    setBusyId(track.id)
    try {
      const res = await fetch(`/api/admin/music/${track.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete track')
      setTracks((prev) => prev.filter((t) => t.id !== track.id))
      toast.success('Track deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete track')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Music Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Background tracks for social video posts. Every video picks a random active track,
            trims it to length with an end fade-out, and ducks it −20 dB under narration.
            Uploads are loudness-normalized (EBU R128, −16 LUFS) automatically.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav"
            className="hidden"
            onChange={handleUpload}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadProgress !== null}>
            {uploadProgress ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {uploadProgress.total > 1
                  ? `Normalizing ${uploadProgress.done + 1}/${uploadProgress.total}…`
                  : 'Normalizing…'}
              </>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Upload tracks</>
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Music className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            No tracks yet. Upload MP3, M4A, or WAV (max 100 MB). Videos generate without music
            while the library is empty.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
            >
              <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-card-foreground">
                  {track.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDuration(track.duration)} · added{' '}
                  {new Date(track.createdAt).toLocaleDateString()}
                </div>
              </div>
              <audio controls preload="none" src={track.url} className="h-8 w-56 shrink-0" />
              <button
                type="button"
                role="switch"
                aria-checked={track.isActive}
                aria-label={track.isActive ? 'Deactivate track' : 'Activate track'}
                disabled={busyId === track.id}
                onClick={() => handleToggleActive(track)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                  track.isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    track.isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId === track.id}
                onClick={() => handleDelete(track)}
                aria-label="Delete track"
              >
                {busyId === track.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
