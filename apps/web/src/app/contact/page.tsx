import type { Metadata } from 'next'
import { SiteHeader, Section, SectionHead, Measure, P, MarketingFooter } from '@/components/marketing/Marketing'
import { ContactForm } from './ContactForm'

export const metadata: Metadata = {
  title: 'Contact... Omniply',
  description: 'Talk to the team behind Omniply.',
}

export default function ContactPage() {
  return (
    <main className="om">
      <SiteHeader />
      <Section tone="white">
        <SectionHead
          eyebrow="Contact"
          title="Talk to us."
          lead="Questions about the platform, your practice, or whether Omniply fits: send them over. A human reads every message and replies within one business day."
        />
        <Measure style={{ marginTop: 40 }}>
          <ContactForm />
          <P>
            <span className="om-small" style={{ display: 'block', marginTop: 32 }}>
              Prefer email? <a href="mailto:support@omniply.io" className="om-link">support@omniply.io</a>
            </span>
          </P>
        </Measure>
      </Section>
      <MarketingFooter />
    </main>
  )
}
