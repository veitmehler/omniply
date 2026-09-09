'use client'

import { ApiKeyRequiredModal } from '@/components/ApiKeyRequiredModal'
import { useDashboard } from '@/features/dashboard/useDashboard'
import { ModeToggle } from '@/features/dashboard/sections/ModeToggle'
import { DashboardInput } from '@/features/dashboard/sections/DashboardInput'
import { GeneratedPosts } from '@/features/dashboard/sections/GeneratedPosts'
import { ContentPlan } from '@/features/dashboard/ContentPlan'
import { VoiceAgentCard } from '@/features/dashboard/VoiceAgentCard'

export default function DashboardPage() {
  const dashboard = useDashboard()

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Welcome to Omniply</h1>
        <p className="text-muted-foreground">
          Capture article ideas, plan your month, and review what&apos;s ready to publish.
        </p>
      </div>

      {/* Voice-assistant nudge (hidden once set up or dismissed) */}
      <VoiceAgentCard />

      {/* Capture an Article Idea | Social posts (tabbed) */}
      <ModeToggle dashboard={dashboard} />
      <DashboardInput dashboard={dashboard} />
      <GeneratedPosts dashboard={dashboard} />

      {/* 30-day plan with inline Review & Approve */}
      <ContentPlan />

      <ApiKeyRequiredModal
        isOpen={dashboard.showApiKeyModal}
        onClose={() => dashboard.setShowApiKeyModal(false)}
        reason={dashboard.apiKeyErrorReason}
      />
    </div>
  )
}
