import { proxyToApi } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(request, `/api/admin/system-health/ledger/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
