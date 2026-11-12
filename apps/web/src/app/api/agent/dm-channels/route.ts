import { makeProxy } from '@/lib/api-proxy'

export const { GET, PUT } = makeProxy('/api/agent/dm-channels')
