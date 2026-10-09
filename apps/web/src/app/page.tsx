import { redirect } from 'next/navigation'

/**
 * Root route. Marketing hosts never reach this file (the middleware rewrites
 * `/` → /home for them); any other host that falls through lands on the same
 * homepage instead of the pre-Omniply orphan page that used to live here
 * (deleted in the 2026-10-09 angle sweep).
 */
export default function RootPage() {
  redirect('/home')
}
