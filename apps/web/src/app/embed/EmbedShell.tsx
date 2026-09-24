'use client'

/**
 * The embed CLIENT SHELL (plan 2026-09-15): the full client app inside the
 * GHL iframe. Tabs mount the SAME feature components as the Clerk web app —
 * their relative /api calls ride the global fetch bridge (embed bearer).
 * Veit decisions: GHL clients never log into the main platform; Settings
 * access at launch is non-negotiable.
 */
import { useEffect, useState } from 'react'
import { EditRequestPickup } from './EditRequestPickup'
import { embedFetch, installEmbedFetchBridge } from '@/lib/embedSession'
import { ContentPlan } from '@/features/dashboard/ContentPlan'
import { VoiceAgentCard } from '@/features/dashboard/VoiceAgentCard'
import { SettingsView } from '@/features/settings/SettingsView'
import { LeadMagnetsView } from '@/components/LeadMagnetsView'
import { IdeasBankView } from '@/features/ideas/IdeasBankView'
import { IdeaCapturePanel } from './IdeaCapturePanel'

type Tab = 'content' | 'ideas' | 'leadmagnets' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'content', label: 'My Content' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'leadmagnets', label: 'Lead Magnets' },
  { id: 'settings', label: 'Settings' },
]

export function EmbedShell({ justCompletedOnboarding = false }: { justCompletedOnboarding?: boolean }) {
  // Guides need review right after onboarding — land there; content lands
  // otherwise (the everyday surface).
  const [tab, setTab] = useState<Tab>(justCompletedOnboarding ? 'leadmagnets' : 'content')
  const [bridgeReady, setBridgeReady] = useState(false)

  useEffect(() => {
    installEmbedFetchBridge()
    setBridgeReady(true)
  }, [])

  // "Set it up" on the voice card must land the user ON the ElevenLabs step,
  // not just on the Settings tab. The section renders #voice-assistant from
  // its very first (loading) state, but the tab content mounts a React commit
  // after setTab — so poll briefly instead of assuming one frame is enough.
  function openVoiceSetup() {
    setTab('settings')
    let tries = 0
    const find = () => {
      const el = document.getElementById('voice-assistant')
      if (!el) {
        if (tries++ < 20) setTimeout(find, 50)
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.transition = 'box-shadow 0.4s ease'
      el.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--primary) 45%, transparent)'
      setTimeout(() => {
        el.style.boxShadow = ''
      }, 2200)
    }
    requestAnimationFrame(find)
  }

  if (!bridgeReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <nav className="mx-auto flex max-w-4xl gap-1 px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="mx-auto max-w-4xl p-4 md:p-6">
        {tab === 'content' && (
          <>
            {justCompletedOnboarding && (
              <div className="mb-4 rounded-xl border border-green-600/30 bg-green-500/10 p-4 text-sm text-foreground">
                🎉 <b>Setup complete — your first month&apos;s content is being generated.</b> Articles,
                newsletters and social posts appear below for review as they finish.
              </div>
            )}
            <VoiceAgentCard onSetup={openVoiceSetup} />
            <EditRequestPickup />
            <IdeaCapturePanel onFleshOut={() => setTab('ideas')} />
            <ContentPlan />
          </>
        )}
        {tab === 'ideas' && <IdeasBankView embedMode />}
        {tab === 'leadmagnets' && (
          <LeadMagnetsView
            apiFetch={(path, init) => embedFetch(path, init)}
            justCompletedOnboarding={justCompletedOnboarding}
          />
        )}
        {tab === 'settings' && <SettingsView embedMode />}
      </main>
    </div>
  )
}
