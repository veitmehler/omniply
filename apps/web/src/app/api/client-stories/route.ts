import { makeProxy } from '@/lib/api-proxy'

export const { GET, POST } = makeProxy('/api/client-stories')
