import { makeProxy } from '@/lib/api-proxy'

export const { POST } = makeProxy('/api/pms/import-csv')
