import { NextRequest } from 'next/server'
import { proxyToApi } from '@/lib/api-proxy'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return proxyToApi(request, `/api/newsletters/${id}/edit-requests`, { method: 'GET' })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return proxyToApi(request, `/api/newsletters/${id}/edit-requests`, { method: 'POST' })
}
