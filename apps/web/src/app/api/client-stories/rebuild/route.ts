import { makeProxy } from '@/lib/api-proxy'

export const { POST } = makeProxy('/api/client-stories/rebuild')

// Transcript extraction + review triage can take ~30s.
export const maxDuration = 120
