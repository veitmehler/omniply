'use client'

import { GhlSettingsPanel } from '@/components/GhlSettingsPanel'
import { VoiceSettingsPanel } from '@/components/VoiceSettingsPanel'
import { AppearanceSection } from '@/features/settings/AppearanceSection'
import { WritingStyleSection } from '@/features/settings/WritingStyleSection'
import { BrandProfileSection } from '@/features/settings/BrandProfileSection'
import { AutoGenerateSection } from '@/features/settings/AutoGenerateSection'
import { SocialPostsSection } from '@/features/settings/SocialPostsSection'
import { DiagramStyleSection } from '@/features/settings/DiagramStyleSection'
import { ArticleTypographySection } from '@/features/settings/ArticleTypographySection'
import { WordPressSection } from '@/features/settings/WordPressSection'
import { ChatAssistantSection } from '@/features/settings/ChatAssistantSection'
import { ChatKnowledgeSection } from '@/features/settings/ChatKnowledgeSection'
import { VoiceAssistantSection } from '@/features/settings/VoiceAssistantSection'
import { ConnectedAccountsSection } from '@/features/settings/ConnectedAccountsSection'
import { TeamSection } from '@/features/settings/TeamSection'
import { useSettingsData } from '@/features/settings/useSettingsData'
import { useSocialConnections } from '@/features/settings/useSocialConnections'

export default function SettingsPage() {
  // Hook order matters: useSettingsData's mount fetch runs before the social
  // connection effects, matching the original single-component effect order.
  const settings = useSettingsData()
  const social = useSocialConnections()

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your preferences, API keys, and connected accounts
        </p>
      </div>

      <div className="space-y-6">
        <AppearanceSection />

        <TeamSection />

        <WritingStyleSection settings={settings} />

        <BrandProfileSection settings={settings} />

        <AutoGenerateSection settings={settings} />

        <SocialPostsSection settings={settings} />

        <DiagramStyleSection settings={settings} />

        <ArticleTypographySection settings={settings} />

        <WordPressSection />

        <ChatAssistantSection />

        <ChatKnowledgeSection />

        <VoiceAssistantSection />

        <GhlSettingsPanel />

        <VoiceSettingsPanel />

        <ConnectedAccountsSection settings={settings} social={social} />
      </div>
    </div>
  )
}
