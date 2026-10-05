/**
 * Thin proxy helper — forwards authenticated requests from Vercel to the DO API.
 *
 * Usage:
 *   export async function POST(request: NextRequest) {
 *     return proxyToApi(request, '/api/ai/generate')
 *   }
 *
 * The helper:
 *  1. Verifies the Clerk session (returns 401 if not authenticated).
 *  2. Gets a short-lived Clerk JWT for the DO API to verify.
 *  3. Forwards the raw request body + content-type to the DO API.
 *  4. Streams the DO API response back to the browser.
 */

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const DO_API_BASE = process.env.DO_API_BASE ?? 'https://svc.omniply.io'

export async function proxyToApi(
  request: NextRequest,
  path: string,
  options: { method?: string } = {},
): Promise<NextResponse> {
  // 1. Resolve the Clerk JWT to forward to the DO API.
  //
  // Prefer a client-supplied `Authorization: Bearer` token when present. The
  // browser mints this with `useAuth().getToken()`, which actively refreshes
  // the session token on demand — this sidesteps the stale-cookie problem on
  // long-lived pages (background-tab timer throttling stalls Clerk's cookie
  // refresh, so the server-side `auth()` cookie token can be expired even
  // though the session is still valid). The DO API verifies the token itself,
  // so a forwarded client token is just as trustworthy as a cookie-derived one.
  //
  // Fall back to the cookie-derived token for callers that don't attach one.
  const clientAuth = request.headers.get('authorization')
  let token: string | null = null
  if (clientAuth?.startsWith('Bearer ')) {
    token = clientAuth.slice(7)
  } else {
    const { userId, getToken } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    token = await getToken()
  }

  if (!token) {
    return NextResponse.json({ error: 'Could not obtain auth token' }, { status: 401 })
  }

  // 3. Forward the request
  const method = options.method ?? request.method
  const contentType = request.headers.get('content-type') ?? 'application/json'
  const isBodyless = ['GET', 'HEAD'].includes(method.toUpperCase())

  // Preserve the query string — server-side filters (e.g. /api/articles?status=)
  // and pagination params are otherwise silently dropped.
  const upstreamUrl = `${DO_API_BASE}${path}${request.nextUrl.search}`

  let body: ArrayBuffer | undefined
  if (!isBodyless) {
    const raw = await request.arrayBuffer()
    if (raw.byteLength > 0) body = raw
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: {
        ...(body ? { 'Content-Type': contentType } : {}),
        Authorization: `Bearer ${token}`,
      },
      body,
    })
  } catch (err) {
    // Network-level failure (DNS, TCP, Vercel → DO timeout).
    // Return a clean 503 so the browser gets a parseable JSON error instead
    // of an unhandled exception that Next.js would turn into a 500 HTML page.
    console.error('[api-proxy] upstream fetch failed', err)
    return NextResponse.json(
      { error: 'Backend temporarily unavailable — please try again' },
      { status: 503 },
    )
  }

  // 4. Return the upstream response body as-is
  const responseBody = await upstreamResponse.arrayBuffer()
  const responseContentType =
    upstreamResponse.headers.get('content-type') ?? 'application/json'
  // File downloads (e.g. the voice-recordings ZIP) need the attachment
  // filename to survive the proxy hop.
  const disposition = upstreamResponse.headers.get('content-disposition')

  return new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': responseContentType,
      ...(disposition ? { 'Content-Disposition': disposition } : {}),
    },
  })
}

/**
 * Convenience wrapper for routes that proxy a specific HTTP method to the DO API
 * under the same path as the route file.
 */
export function makeProxy(path: string) {
  return {
    GET: (request: NextRequest) => proxyToApi(request, path, { method: 'GET' }),
    POST: (request: NextRequest) => proxyToApi(request, path, { method: 'POST' }),
    PUT: (request: NextRequest) => proxyToApi(request, path, { method: 'PUT' }),
    PATCH: (request: NextRequest) => proxyToApi(request, path, { method: 'PATCH' }),
    DELETE: (request: NextRequest) => proxyToApi(request, path, { method: 'DELETE' }),
  }
}
