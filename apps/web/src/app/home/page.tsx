/**
 * Omniply platform overview (site refresh 2026-08-05).
 * Served at `/` on the marketing hosts (middleware rewrite) and at /home.
 * Graphical brand page, not a sales letter: the Loop is the centerpiece, the
 * chiropractic pathway sits above the fold, and the vertical sales letter
 * lives at /chiropractors. Voice = master pitch; dash-free house style.
 */
import type { Metadata } from 'next'
import {
  TOKENS,
  XRAY_URL,
  Cta,
  SiteHeader,
  Eyebrow,
  Section,
  H2,
  P,
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
    'One loop, four systems: instant AI response to every call and message, content in your voice, compounding Google reviews, and client recall. You approve, it ships.',
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
    q: 'What is included?',
    a: 'Everything in the loop. Weekly articles, the weekly newsletter with 25,000 email sends a month, social posts with designed graphics, branded lead-magnet guides, the 2-Minute Spine Check for your website, the AI response and recall systems, and the review growth engine. No per-piece fees, no content credits, no surprise line items.',
  },
  {
    q: 'Can I cancel? What happens to my content?',
    a: 'You can cancel any month. Everything already published stays published, because it was always yours: your website, your email list, your social accounts, your documents.',
  },
]

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      {/* ── Hero: platform definition + vertical pathway above the fold ── */}
      <Section dark>
        <Eyebrow>Omniply</Eyebrow>
        <h1 className="mb-6 text-4xl font-extrabold leading-tight md:text-5xl" style={{ textWrap: 'balance' } as React.CSSProperties}>
          How many client calls did your practice miss this week?
        </h1>
        <P lead>
          Each one booked with whoever answered. Omniply is marketing on autopilot for local practices: it
          answers in seconds, writes in your voice, asks for the review, and remembers every client who
          drifted... every week, while you run the practice. You approve. It ships.
        </P>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <a
            href="/chiropractors"
            className="rounded-xl border p-6 transition-transform hover:scale-[1.01]"
            style={{ borderColor: TOKENS.lime, background: 'rgba(195,244,59,0.06)' }}
          >
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: TOKENS.lime }}>
              Live now
            </div>
            <div className="mt-2 text-xl font-bold text-white">For chiropractic practices &rarr;</div>
            <div className="mt-1 text-sm text-white/60">The full story, built for your world.</div>
          </a>
          <a
            href={XRAY_URL}
            className="rounded-xl border border-white/15 p-6 transition-transform hover:scale-[1.01]"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-white/50">2 minutes</div>
            <div className="mt-2 text-xl font-bold text-white">X-Ray your practice &rarr;</div>
            <div className="mt-1 text-sm text-white/60">
              Four system scores and a dollar figure on what is quietly leaking.
            </div>
          </a>
        </div>
      </Section>







      {/* ── Why speed and presence decide ── */}
      <Section>
        <Eyebrow>Why it matters now</Eyebrow>
        <H2>Your clients decide faster than your front desk can answer.</H2>
        <StatBand />
        <P>
          Whoever answers first and stays familiar wins the booking. That is not a slogan, it is the measured
          behavior of people choosing a local practice today.
        </P>
      </Section>

      {/* ── The Loop ── */}
      <Section dark>
        <Eyebrow>The mechanism</Eyebrow>
        <H2>One loop. Four systems. Each one feeds the next.</H2>
        <LoopDiagram />
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            ['Response', 'An AI front desk: chat and voice that answer in two rings, day and night, and book on the spot or take a timed callback.'],
            ['Proof', 'Every happy client becomes public evidence. Reviews compound like interest.'],
            ['Presence', 'Real content, produced in your voice every week... what keeps clients warm, and what Google and the AI assistants read when they recommend.'],
            ['Recall', 'Nobody drifts unnoticed. The ones who faded get a reason to come back.'],
          ].map(([head, body]) => (
            <div key={head}>
              <div className="text-lg font-bold" style={{ color: TOKENS.lime }}>{head}</div>
              <p className="mt-1 text-white/75">{body}</p>
            </div>
          ))}
        </div>
        <P>
          <br />
          It is not four tools, and it is not another AI content engine. It is one flywheel: instant response
          converts the inquiry, happy clients leave reviews, reviews and presence bring the next inquiry,
          recall keeps them all coming back. Break any link and the leak reopens somewhere else.
        </P>
      </Section>

      {/* ── Verticals ── */}
      <Section>
        <Eyebrow>Built per profession</Eyebrow>
        <H2>Tailored deep, not templated wide.</H2>
        <P>
          Omniply is built one profession at a time, so the content calendar, the compliance guardrails and
          the voice all fit your actual world.
        </P>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <a href="/chiropractors" className="rounded-xl border-2 p-6 transition-transform hover:scale-[1.01]" style={{ borderColor: TOKENS.accent }}>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: TOKENS.accentDeep }}>Live</div>
            <div className="mt-2 text-xl font-bold">Chiropractic &rarr;</div>
            <div className="mt-1 text-sm" style={{ color: TOKENS.muted }}>
              Seasonal spine calendar, healthcare-safe claims, recall built for care plans.
            </div>
          </a>
          <div className="rounded-xl border p-6" style={{ borderColor: TOKENS.line }}>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: TOKENS.muted }}>In the pipeline</div>
            <div className="mt-2 text-xl font-bold" style={{ color: TOKENS.muted }}>More practice types</div>
            <div className="mt-1 text-sm" style={{ color: TOKENS.muted }}>
              The loop is universal. The tailoring takes time, and we do one profession properly at a time.
            </div>
          </div>
        </div>
      </Section>

      {/* ── How it runs (dark: PipelineDiagram uses white linework) ── */}
      <Section dark>
        <Eyebrow>How it runs</Eyebrow>
        <H2>A pipeline with one gate: you.</H2>
        <P>
          Omniply is not an assistant you prompt. It is a pipeline that runs on a fixed weekly rhythm, holds
          everything at a review gate where you approve with one click, and publishes across every channel on
          schedule. The same input produces the same quality, week after week... and the one thing the machine
          never does is skip a week.
        </P>
        <PipelineDiagram />
      </Section>

      {/* ── FAQ ── */}
      <Section>
        <Eyebrow>Questions, answered straight</Eyebrow>
        <H2>The short version of everything owners ask.</H2>
        <Faq items={FAQ_ITEMS} />
      </Section>

      {/* ── Founder + Close ── */}
      <Section dark>
        <Eyebrow>Who built this</Eyebrow>
        <H2>Sixteen years of doing this manually taught me exactly what to automate.</H2>
        <P>
          I have spent 16 years running marketing for health professionals and local practices. The system
          inside Omniply is the playbook elite practice coaches teach their clients to execute by hand... the
          one that works every time it is actually executed, and fails every time life gets in the way of
          executing it. So I learned to code and built the version that cannot get tired, cannot get busy, and
          cannot skip a week.
        </P>
        <div className="my-12 h-px w-full" style={{ background: '#343434' }} />
        <H2>Start where the doctors start: with the X-Ray.</H2>
        <P lead>
          Two minutes, twelve questions... four system scores and a dollar figure on what your practice is
          quietly leaking every month. No call, no pitch. A report and a number.
        </P>
        <Cta href={XRAY_URL} sub="2 minutes · free · your report is yours to keep">
          X-Ray My Practice
        </Cta>
        <p className="mt-6 text-center text-sm text-white/50">
          Prefer to see the system first? <a href="/walkthrough" className="underline">Watch the walkthrough</a>
        </p>
      </Section>

      <FaqJsonLd items={FAQ_ITEMS} />
      <MarketingFooter />
    </main>
  )
}
