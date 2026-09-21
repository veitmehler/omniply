'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from './ThemeProvider'
import { Toaster } from './Toaster'

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const inner = (
    <ThemeProvider>
      {children}
      <Toaster />
    </ThemeProvider>
  )
  // The GHL embed surface must never load clerk-js: auth there is the
  // SSO-derived embed bearer, and clerk-js booting inside the iframe can
  // run its cookie handshake / session-recovery UI against stale admin
  // Clerk cookies (seen 2026-09-21). No component under /embed uses Clerk
  // hooks — useAppToken() reads the window.Clerk global, not useAuth().
  if (pathname?.startsWith('/embed')) return inner
  return <ClerkProvider>{inner}</ClerkProvider>
}
