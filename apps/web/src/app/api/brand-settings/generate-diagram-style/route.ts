import { makeProxy } from '@/lib/api-proxy'

export const { POST } = makeProxy('/api/brand-settings/generate-diagram-style')

// Screenshot + vision can take ~20s — keep the proxy patient.
export const maxDuration = 120
