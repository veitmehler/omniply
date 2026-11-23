import { proxyToApi } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return proxyToApi(request, `/api/admin/system-health/services/${encodeURIComponent(key)}/ledger`, { method: 'POST' })
}
