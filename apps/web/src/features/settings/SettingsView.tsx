'use client'

/**
 * Shared Settings surface (embed client shell plan, 2026-09-15).
 *
 * Mounted by BOTH shells: the Clerk web app (/settings page) and the GHL
 * embed's Settings tab. `embedMode` curates the section list for GHL-first
 * clients — everything mistake-fixable shows; Clerk-roster, API-key, and
 * direct-OAuth surfaces hide (GHL owns users + social connections there).
 */
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

export function SettingsView({ embedMode = false }: { embedMode?: boolean }) {
  // Hook order matters: useSettingsData's mount fetch runs before the social
  // connection effects, matching the original single-component effect order.
  const settings = useSettingsData()
  const social = useSocialConnections()

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">
          {embedMode
            ? 'Fix or fine-tune anything about your practice, brand, and content'
            : 'Manage your preferences, API keys, and connected accounts'}
        </p>
      </div>

      <div className="space-y-6">
        <AppearanceSection />

        {!embedMode && <TeamSection />}

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

        {!embedMode && <GhlSettingsPanel />}

        {!embedMode && <VoiceSettingsPanel />}

        {embedMode ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Social accounts:</span> connect or manage your Facebook,
            Instagram and LinkedIn profiles in your Omniply CRM under <b>Marketing → Social Planner</b> — posts
            publish through those connections automatically.
          </div>
        ) : (
          <ConnectedAccountsSection settings={settings} social={social} />
        )}
      </div>
    </div>
  )
}
