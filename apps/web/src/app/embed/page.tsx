'use client'

/**
 * Embedded GHL entry point (onboarding plan Phase 0).
 *
 * Runs the SSO handshake, then routes: unfinished onboarding → the chat flow
 * (Phase 1 mounts here); completed → the embedded app surface. Rendered only
 * inside the GHL iframe (frame-ancestors CSP scoped to /embed).
 */
import { useEffect, useRef, useState } from 'react'
import { establishEmbedSession, embedFetch, type EmbedSession } from '@/lib/embedSession'
import { OnboardingChat } from './OnboardingChat'
import { EmbedShell } from './EmbedShell'

type State =
  | { phase: 'connecting' }
  | { phase: 'error'; message: string }
  | { phase: 'provisioning' }
  | { phase: 'seatRequired' }
  | { phase: 'ready'; session: EmbedSession }

export default function EmbedEntry() {
  const [state, setState] = useState<State>({ phase: 'connecting' })
  // True only for the session that JUST finished the finale (not on reloads).
  const justCompletedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    establishEmbedSession()
      .then((session) => {
        if (cancelled) return
        if (session.provisioningPending) setState({ phase: 'provisioning' })
        else if ((session as { seatRequired?: boolean }).seatRequired) setState({ phase: 'seatRequired' })
        else setState({ phase: 'ready', session })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.phase === 'connecting') {
    return (
      <Centered>
        <Spinner />
        <p className="text-sm text-muted-foreground mt-3">Connecting to your workspace…</p>
      </Centered>
    )
  }
  if (state.phase === 'seatRequired') {
    return (
      <Centered>
        <p className="text-base font-medium text-foreground">You don&apos;t have a seat yet</p>
        <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
          Ask the account owner to add you in Settings → Team, or to send you an edit request —
          that gives you access automatically. Accounts include 3 seats.
        </p>
      </Centered>
    )
  }

  if (state.phase === 'provisioning') {
    return (
      <Centered>
        <p className="text-base font-medium text-foreground">Almost there!</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm text-center">
          Your content workspace is being set up. You&apos;ll get an email as soon as it&apos;s ready —
          usually within one business day.
        </p>
      </Centered>
    )
  }
  if (state.phase === 'error') {
    return (
      <Centered>
        <p className="text-base font-medium text-foreground">Couldn&apos;t connect</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm text-center">{state.message}</p>
      </Centered>
    )
  }

  const { session } = state
  if (!session.onboardingCompleted) {
    return (
      <OnboardingChat
        onCompleted={() => {
          justCompletedRef.current = true
          setState({ phase: 'ready', session: { ...session, onboardingCompleted: true } })
        }}
      />
    )
  }

  // Post-onboarding: the full client shell (Content · Lead Magnets ·
  // Settings) — GHL clients manage everything from inside the iframe.
  return <EmbedShell justCompletedOnboarding={justCompletedRef.current} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center p-6">{children}</div>
}

function Spinner() {
  return (
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
  )
}
