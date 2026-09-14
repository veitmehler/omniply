import { makeProxy } from '@/lib/api-proxy'

export const { GET } = makeProxy('/api/voice-assistant/status')
