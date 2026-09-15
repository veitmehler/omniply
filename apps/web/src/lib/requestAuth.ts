/**
 * Dual-auth for Next API routes (embed client shell plan, 2026-09-15).
 *
 * GHL-embedded clients carry the API-issued embed token (`Bearer emb_<jwt>`,
 * minimal HS256) instead of a Clerk session — cookies are unreliable in
 * cross-site iframes. This helper resolves the SAME clerkId space from either
 * source, so every route's downstream (clerkId → user/account) is untouched.
 *
 * Order: Clerk session first (browser users), then the bearer header.
 * Secret matches the API's embed-auth: EMBED_JWT_SECRET || GHL_SSO_SECRET.
 */
import { auth } from '@clerk/nextjs/server'
import { headers } from 'next/headers'
import { createHmac, timingSafeEqual } from 'node:crypto'

function tokenSecret(): string | null {
  return process.env.EMBED_JWT_SECRET || process.env.GHL_SSO_SECRET || null
}

function verifyEmbedJwt(token: string): string | null {
  const secret = tokenSecret()
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest()
  let given: Buffer
  try {
    given = Buffer.from(sig, 'base64url')
  } catch {
    return null
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub?: string; exp?: number }
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.sub
  } catch {
    return null
  }
}

/** clerkId from the Clerk session OR the embed bearer; null = unauthenticated. */
export async function resolveClerkId(): Promise<string | null> {
  try {
    const { userId } = await auth()
    if (userId) return userId
  } catch {
    /* fall through to the bearer */
  }
  const h = (await headers()).get('authorization')
  if (!h?.startsWith('Bearer emb_')) return null
  return verifyEmbedJwt(h.slice('Bearer emb_'.length))
}
