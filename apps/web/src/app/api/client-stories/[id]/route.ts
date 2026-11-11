import { NextRequest } from 'next/server'
import { proxyToApi } from '@/lib/api-proxy'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return proxyToApi(request, `/api/client-stories/${encodeURIComponent(id)}`, { method: 'PUT' })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return proxyToApi(request, `/api/client-stories/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
