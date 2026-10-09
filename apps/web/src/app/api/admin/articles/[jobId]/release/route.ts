import { proxyToApi } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return proxyToApi(request, `/api/admin/articles/${jobId}/release`, { method: 'POST' })
}
