import { makeProxy } from '@/lib/api-proxy'

export const { POST } = makeProxy('/api/brand-settings/generate-article-disclaimer')

export const maxDuration = 120
