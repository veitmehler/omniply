'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback } from 'react'
import { isEmbedMode } from './embedSession'

/**
 * Embed-safe replacement for `useAuth().getToken()` in components that mount
 * BOTH on the Clerk web app and inside the GHL embed shell.
 *
 * In the embed there is no Clerk session — auth rides the SSO-derived embed
 * bearer that the global fetch bridge attaches to header-less /api calls. So
 * here we must return null WITHOUT touching clerk-js: with a stale admin
 * Clerk cookie in the browser, getToken() can kick off Clerk's interactive
 * session recovery and surface a sign-in popover inside the iframe
 * (observed 2026-09-21).
 */
export function useAppToken(): () => Promise<string | null> {
  const { getToken } = useAuth()
  return useCallback(async () => {
    if (isEmbedMode()) return null
    try {
      return await getToken()
    } catch {
      return null
    }
  }, [getToken])
}
