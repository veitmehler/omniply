/**
 * Omniply platform overview (site refresh 2026-08-05; recomposed on the brand
 * design system 2026-11-05). Served at `/` on the marketing hosts
 * (middleware rewrite) and at /home. Graphical brand page, not a sales
 * letter: the Loop is the centerpiece, the vertical pathways sit above the
 * fold, and the vertical sales letters live at /chiropractors and /wellness.
 * Voice = master pitch; dash-free house style.
 */
import type { Metadata } from 'next'
import {
  XRAY_URL,
  Btn,
  CtaRow,
  SiteHeader,
  Eyebrow,
  Section,
  SectionHead,
  Measure,
  Grid,
  Card,
  H1,
  H3,
  P,
  NumberedCards,
  Callout,
  LoopDiagram,
  StatBand,
  PipelineDiagram,
  Faq,
  FaqJsonLd,
  MarketingFooter,
  type FaqEntry,
} from '@/components/marketing/Marketing'

export const metadata: Metadata = {
  title: 'Omniply... Marketing Autopilot for Local Practices',
  description:
    'Be the practice AI assistants and people find: instant AI response to every call and message, content in your voice, compounding Google reviews, and client recall. One loop, four systems. You approve, it ships. One flat monthly subscription.',
}

const FAQ_ITEMS: FaqEntry[] = [
  {
    q: 'What exactly is Omniply?',
    a: 'A marketing autopilot for local practices. It answers inquiries instantly with AI chat and voice, writes and publishes your content in your voice, grows your Google reviews automatically, and brings past clients back with systematic recall. Four systems, one loop, one flat price.',
  },
  {
    q: 'Will it really sound like me?',
    a: 'That is the whole point of the onboarding. You talk, in your own words, about your business and the people you serve. The system studies how you actually speak and writes in that voice from day one. Most owners say the spooky moment is reading their first newsletter and hearing themselves in it.',
  },
  {
    q: 'How much of my time does this take?',
    a: 'Setup is a guided conversation of roughly ten to fifteen minutes, and the system starts producing in hours. After that, your job is a review pass measured in minutes per week: read, click approve, done. Nothing carrying your name ships without your sign-off.',
  },
  {
    q: 'What is included in the subscription?',
    a: 'Everything in the loop. Weekly articles, the weekly newsletter with 25,000 email sends a month, social posts with designed graphics, branded lead-magnet guides, a branded, interactive self-assessment lead-capture quiz on your website, built for your profession, the AI response and recall systems, and the review growth engine. No per-piece fees, no content credits, no surprise line items.',
  },
  {
    q: 'What does "visible to AI assistants" actually mean?',
    a: 'When someone asks ChatGPT, Siri or Google’s AI who to book, the assistant reads the same public signals a careful human would: your reviews, your content, your website’s structure, and whether anyone answers when it reaches out. Omniply builds exactly those signals, and its chat and voice front desk means an AI assistant that calls or messages your practice gets an instant answer instead of a voicemail.',
  },
  {
    q: 'Can I cancel? What happens to my content?',
    a: 'You can cancel any month. Everything already published stays published, because it was always yours: your website, your email list, your social accounts, your documents.',
  },
]

const LOOP = [
  { title: 'Response', body: 'An AI front desk: chat and voice that answer in two rings, day and night, and book on the spot or take a timed callback.' },
  { title: 'Proof', body: 'Every happy client becomes public evidence. Reviews compound like interest.' },
  { title: 'Presence', body: 'Real content, produced in your voice every week... what keeps clients warm, and what Google and the AI assistants read when they recommend.' },
  { title: 'Recall', body: 'Nobody drifts unnoticed. The ones who faded get a reason to come back.' },
]

export default function HomePage() {
  return (
    <main className="om">
      <SiteHeader />

      {/* ── Hero: AI-booking lead (angle sweep 2026-10-09) + vertical pathways ── */}
      <Section tone="dark" hero>
        <Measure>
          <Eyebrow>Omniply</Eyebrow>
          <H1>Your next client will ask an AI assistant who to book. Can it even find you?</H1>
          <P first>
            132 million Americans already research with AI assistants before they buy. If one can&rsquo;t
            find your practice, understand your website, or talk to it, it simply books the next practice
            down the road.
          </P>
          <P lead>
            Omniply is marketing on autopilot for local practices: it makes you the practice AI assistants
            and people find, answers every call and message in seconds, writes in your voice, asks for the
            review, and remembers every client who drifted. You approve. It ships.
          </P>
        </Measure>
        <Grid cols={3} style={{ marginTop: 48 }}>
          <Card href="/chiropractors">
            <Eyebrow>Live now</Eyebrow>
            <H3>For chiropractic practices &rarr;</H3>
            <P>The full story, built for your world.</P>
          </Card>
          <Card href="/wellness">
            <Eyebrow>Live now</Eyebrow>
            <H3>For wellness &amp; longevity centers &rarr;</H3>
            <P>HBOT, IV, cold plunge, massage, longevity... your version.</P>
          </Card>
          <Card href={XRAY_URL}>
            <Eyebrow>2 minutes</Eyebrow>
            <H3>X-Ray your business &rarr;</H3>
            <P>Four system scores, a dollar figure on what is quietly leaking, and whether AI assistants can find you.</P>
          </Card>
        </Grid>
      </Section>

      {/* ── Why speed and presence decide (missed calls: the second angle) ── */}
      <Section tone="grey">
        <SectionHead eyebrow="Why it matters now" title="Your clients decide faster than your front desk can answer." />
        <StatBand />
        <Measure style={{ marginTop: 40 }}>
          <P lead center>
            Whoever answers first and stays familiar wins the booking. That is not a slogan, it is the
            measured behavior of people choosing a local practice today. And the newest wave skips the phone
            entirely: they ask an AI assistant, and the assistant recommends whoever it can actually read.
          </P>
        </Measure>
      </Section>

      {/* ── The Loop ── */}
      <Section tone="dark">
        <SectionHead eyebrow="The mechanism" title="One loop. Four systems. Each one feeds the next." />
        <LoopDiagram />
        <div style={{ marginTop: 40 }}>
          <NumberedCards items={LOOP} />
        </div>
        <Measure>
          <Callout>
            <P>
              It is not four tools, and it is not another AI content engine. It is one flywheel: instant
              response converts the inquiry, happy clients leave reviews, reviews and presence bring the next
              inquiry, recall keeps them all coming back. Break any link and the leak reopens somewhere else.
            </P>
          </Callout>
        </Measure>
      </Section>

      {/* ── Verticals ── */}
      <Section tone="white">
        <SectionHead
          eyebrow="Built per profession"
          title="Tailored deep, not templated wide."
          lead="Omniply is built one profession at a time, so the content calendar, the compliance guardrails and the voice all fit your actual world."
        />
        <Grid cols={2} style={{ marginTop: 40 }}>
          <Card href="/chiropractors">
            <Eyebrow>Live</Eyebrow>
            <H3>Chiropractic &rarr;</H3>
            <P>Seasonal spine calendar, healthcare-safe claims, recall built for care plans.</P>
          </Card>
          <Card href="/wellness">
            <Eyebrow>Live</Eyebrow>
            <H3>Wellness &amp; Longevity Centers &rarr;</H3>
            <P>Recovery and longevity calendar, claims-safe content, per-service booking, a front desk that answers in five languages.</P>
          </Card>
        </Grid>
        <Measure style={{ marginTop: 20 }}>
          <Card muted>
            <Eyebrow>In the pipeline</Eyebrow>
            <H3>More practice types</H3>
            <P>
              The loop is universal. The tailoring takes time, and we do one profession properly at a time.
              Run something else? Take the X-Ray anyway and tell us what you do... that list decides what we
              build next.
            </P>
          </Card>
        </Measure>
      </Section>

      {/* ── How it runs (dark: PipelineDiagram uses white linework) ── */}
      <Section tone="dark">
        <SectionHead eyebrow="How it runs" title="A pipeline with one gate: you." />
        <Measure>
          <P>
            Omniply is not an assistant you prompt. It is a pipeline that runs on a fixed weekly rhythm, holds
            everything at a review gate where you approve with one click, and publishes across every channel
            on schedule. The same input produces the same quality, week after week... and the one thing the
            machine never does is skip a week.
          </P>
        </Measure>
        <PipelineDiagram />
      </Section>

      {/* ── FAQ ── */}
      <Section tone="grey">
        <SectionHead eyebrow="Questions, answered straight" title="The short version of everything owners ask." />
        <Faq items={FAQ_ITEMS} />
      </Section>

      {/* ── Founder ── */}
      <Section tone="white">
        <SectionHead eyebrow="Who built this" title="Sixteen years of doing this manually taught me exactly what to automate." />
        <Measure>
          <P>
            I have spent 16 years running marketing for health professionals and local practices. The system
            inside Omniply is the playbook elite practice coaches teach their clients to execute by hand...
            the one that works every time it is actually executed, and fails every time life gets in the way
            of executing it. So I learned to code and built the version that cannot get tired, cannot get
            busy, and cannot skip a week.
          </P>
        </Measure>
      </Section>

      {/* ── Close ── */}
      <Section tone="dark">
        <SectionHead eyebrow="Here's what to do next" title="Start where the evidence starts: with the X-Ray." />
        <Measure>
          <P lead center>
            Two minutes, twelve questions... four system scores, a dollar figure on what your business is
            quietly leaking every month, and a read on whether AI assistants can even find you. No call, no
            pitch. A report and a number.
          </P>
          <CtaRow sub="2 minutes · free · your report is yours to keep">
            <Btn href={XRAY_URL}>X-Ray My Business</Btn>
            <Btn href="/walkthrough" ghost>Watch the walkthrough</Btn>
          </CtaRow>
        </Measure>
      </Section>

      <FaqJsonLd items={FAQ_ITEMS} />
      <MarketingFooter />
    </main>
  )
}
