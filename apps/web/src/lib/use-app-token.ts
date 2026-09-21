'use client'

import { useCallback } from 'react'
import { isEmbedMode } from './embedSession'

/**
 * Embed-safe replacement for `useAuth().getToken()` in components that mount
 * BOTH on the Clerk web app and inside the GHL embed shell.
 *
 * In the embed there is no Clerk at all — ClerkProvider is not mounted there
 * (Providers.tsx skips it for /embed), auth rides the SSO-derived embed
 * bearer that the global fetch bridge attaches to header-less /api calls.
 * So this deliberately avoids the useAuth() HOOK (which throws without a
 * provider) and reads the window.Clerk global at call time instead: on the
 * web app it mints/refreshes the session token exactly like useAuth's
 * getToken; in the embed it returns null without ever touching clerk-js.
 * Background (2026-09-21): clerk-js running inside the iframe surfaced its
 * interactive session-recovery UI when a stale ADMIN Clerk cookie was
 * present in the browser.
 */
type ClerkGlobal = { session?: { getToken(): Promise<string | null> } | null }

export function useAppToken(): () => Promise<string | null> {
  return useCallback(async () => {
    if (isEmbedMode()) return null
    try {
      const clerk = (window as Window & { Clerk?: ClerkGlobal }).Clerk
      return (await clerk?.session?.getToken()) ?? null
    } catch {
      return null
    }
  }, [])
}
