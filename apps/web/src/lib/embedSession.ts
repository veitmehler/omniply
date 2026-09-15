'use client'

/**
 * Embedded-mode session (onboarding plan Phase 0).
 *
 * Inside the GHL iframe there are no cookies and no Clerk: we ask the parent
 * window for the encrypted SSO payload, exchange it at /api/embed/session for
 * a short-lived bearer token, and hold it IN MEMORY only. `embedFetch` adds
 * the Authorization header and transparently re-runs the handshake once when
 * the token expires.
 */

export interface EmbedSession {
  token: string
  user: { id: string; email: string; name: string | null }
  accountId: string
  accountStatus: string
  onboardingCompleted: boolean
  provisioningPending?: boolean
}

let session: EmbedSession | null = null

function requestEncryptedUserData(timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('No response from the GHL parent window — is the app opened inside GHL?'))
    }, timeoutMs)
    function onMessage(e: MessageEvent) {
      const data = e.data as { message?: string; payload?: string } | undefined
      if (data?.message === 'REQUEST_USER_DATA_RESPONSE' && typeof data.payload === 'string') {
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        resolve(data.payload)
      }
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
  })
}

// The iframe page is served from chiro.omniply.io, which the API's CORS
// already allows — so embedded mode talks to the DO API directly (no Clerk-
// coupled Vercel proxy in the path).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://svc.omniply.io'

export function embedApiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export async function establishEmbedSession(): Promise<EmbedSession> {
  const encryptedData = await requestEncryptedUserData()
  const res = await fetch(embedApiUrl('/api/embed/session'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Session exchange failed (${res.status})`)
  }
  const data = await res.json()
  if (data.provisioningPending) {
    session = null
    return { provisioningPending: true } as EmbedSession
  }
  session = data as EmbedSession
  return session
}

export function currentEmbedSession(): EmbedSession | null {
  return session
}

/** fetch() against the DO API with the embed bearer; one transparent re-handshake on 401. */
export async function embedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!session) await establishEmbedSession()
  const withAuth = (): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer emb_${session!.token}` },
  })
  let res = await fetch(embedApiUrl(path), withAuth())
  if (res.status === 401) {
    await establishEmbedSession()
    res = await fetch(embedApiUrl(path), withAuth())
  }
  return res
}

/**
 * Global fetch bridge for the embed client shell (plan 2026-09-15): the
 * feature components (Settings sections, ContentPlan, …) call relative
 * `/api/...` Next routes with PLAIN fetch. Inside the GHL iframe there is no
 * Clerk session, so this wraps window.fetch once to attach the embed bearer
 * to same-origin API calls — with one transparent re-handshake on a 401
 * (the token lives 15 minutes). Requests that already carry an
 * Authorization header (Clerk-minted) are left untouched.
 */
let bridgeInstalled = false
export function installEmbedFetchBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') return
  bridgeInstalled = true
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const isApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)
    if (!isApiCall) return original(input, init)
    const existing = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (existing.has('authorization')) return original(input, init)

    const call = (token: string) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('Authorization', `Bearer emb_${token}`)
      return original(input, { ...init, headers })
    }
    if (!session) await establishEmbedSession()
    let res = await call(session!.token)
    if (res.status === 401) {
      await establishEmbedSession()
      res = await call(session!.token)
    }
    return res
  }
}
