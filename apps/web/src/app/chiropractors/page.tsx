/**
 * Chiropractor sales letter (site refresh 2026-08-05).
 * The master pitch (.documentation/marketing/practice-treatment-plan-master-pitch.md)
 * in page form: drift hero, three forces, belief shift, the Omniply Loop,
 * Prognosis, one-patient math. Primary CTA throughout = the Practice X-Ray.
 * Dash-free house style; ellipses voice.
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
  Bullet,
  LoopDiagram,
  StatBand,
  ConsistencyGraph,
  ReactivationLoop,
  MapPackDiagram,
  Faq,
  FaqJsonLd,
  type FaqEntry,
  MarketingFooter,
} from '@/components/marketing/Marketing'
import { FoundingNotify } from '@/components/marketing/FoundingNotify'

export const metadata: Metadata = {
  title: 'Omniply for Chiropractors... Plug the Leak in Your Practice',
  description:
    'How many patient calls did your practice miss this week? Each one booked with whoever answered. Omniply answers in seconds, day and night... then content, reviews and recall keep them. X-Ray your practice in 2 minutes.',
}

const FAQ_ITEMS: FaqEntry[] = [
  {
    q: 'Is the content compliant for healthcare advertising?',
    a: 'Compliance guardrails are built into every generator: no overclaiming, no miracle cures, no guarantees of outcomes, nothing that promises what an adjustment cannot promise. And because you approve every piece before it ships, the final word on anything carrying your name is always yours.',
  },
  {
    q: 'Will it really sound like me, not like AI?',
    a: 'Yes, and this is the part practices doubt until they see it. During onboarding you simply talk about your practice, your patients and what you believe about care. The system learns how you actually speak. The first newsletter reads like you dictated it on a good day, because in a real sense you did.',
  },
  {
    q: 'Does it work with my booking system?',
    a: 'Yes. Omniply works alongside your practice software, never instead of it. Depending on your system, the AI receptionist can book appointments directly into your calendar, or it shares current availability and sends patients your own booking link to confirm there. Either way: no migrations, no double bookings, no IT project.',
  },
  {
    q: 'Is my patient data involved?',
    a: 'No. The marketing system runs on your public presence and your booking link. It does not touch clinical records.',
  },
  {
    q: 'How much of my week does this take?',
    a: 'A few minutes over coffee. Content arrives in one approval inbox, you read it, you click approve, and the week is handled. The setup itself is a ten to fifteen minute guided conversation you do once, and the system starts producing in hours.',
  },
  {
    q: 'Do I have to come up with the topics?',
    a: 'No. Your content runs on a chiropractic calendar built around the seasons of a real practice: new year resolutions, gardening season backs, school posture, holiday stress. Sciatica content lands when people are digging, not in February.',
  },
  {
    q: 'How does the review engine work? Is it ethical?',
    a: 'Completely. We never write, buy or fake reviews. The system makes it effortless for genuinely happy patients to leave one: a printed QR card for your front desk that opens your Google review form, plus well-timed follow-ups. The reviews are real. There are simply more of them, because asking finally happens consistently.',
  },
  {
    q: 'What exactly is included? Any hidden costs?',
    a: 'Everything in the loop: weekly patient-education articles, the weekly newsletter with 25,000 email sends included, social posts with designed graphics, your branded lead-magnet guides, the 2-Minute Spine Check on your website, the AI response and recall systems, and the review engine. No per-piece fees, no content credits, no surprises.',
  },
  {
    q: 'How fast will I see results?',
    a: 'Honest answer: reactivation is fastest, because past patients who get reminded tend to rebook within weeks. Google visibility and new-patient flow compound over months, which is exactly why consistency beats bursts. Anyone promising overnight patients from content is selling you something else.',
  },
  {
    q: 'Can I cancel? What happens to everything?',
    a: 'Cancel any month. Your articles stay on your website, your list stays your list, your guides keep working. It was all built in your name from the start.',
  },
  {
    q: 'Do I need a WordPress website?',
    a: 'It works best with one. If your site runs on WordPress, Omniply publishes every article straight to your blog automatically... that is what powers the local-SEO flywheel with zero effort on your side. If you are on another platform, everything else still runs (newsletters, social posts, review collection), and articles are delivered ready to paste into your site. For fully automated article publishing, WordPress is required.',
  },
]

export default function ChiropractorsPage() {
  return (
    <main>
      <SiteHeader vertical="For Chiropractors" />
      {/* ── Hook: missed calls (sweep 2026-10-03; drift keeps the forces/drift sections) ── */}
      <Section dark>
        <Eyebrow>Omniply for Chiropractors</Eyebrow>
        <h1 className="mb-6 text-4xl font-extrabold leading-tight md:text-5xl" style={{ textWrap: 'balance' } as React.CSSProperties}>
          How many patient calls did your practice miss this week?
        </h1>
        <P lead>
          Every one of them was a person in pain who booked with whoever answered. And the calls are only the
          loudest part of the leak... patients also fade between visits, invisibly, until the quarter is
          already soft. There is a 2-minute way to put a number on all of it, in dollars.
        </P>
        <Cta href={XRAY_URL} sub="12 questions · 2 minutes · your missed calls and your monthly leak, in dollars">
          X-Ray My Practice
        </Cta>
      </Section>

      {/* ── The Big Change: three forces ── */}
      <Section>
        <Eyebrow>Why this is happening to good practices</Eyebrow>
        <H2>Three forces created the leak. None of them asked your permission.</H2>
        <P>
          <strong>The technology force.</strong> Every patient in your town now carries every competitor&apos;s
          front desk in their pocket. When someone&apos;s back seizes at 9pm, they don&apos;t wait for your
          opening hours... they search, they message, and they book with whoever answers. Google decides who
          exists. The map pack decides who gets the call. And a newer layer is settling on top: patients now
          ask AI assistants the question they used to type into Google... &quot;who should I see about
          this?&quot; The answer engines read the same signals: reviews, real content, responsiveness. A
          practice those engines can&apos;t read doesn&apos;t lose the comparison. It never comes up.
        </P>
        <P>
          <strong>The social force.</strong> Patients stopped calling back. Not because they&apos;re rude...
          because Amazon, Uber and a decade of instant everything trained them. Princeton researchers showed
          people form trust judgments in a tenth of a second, before a single rational thought. Your future
          patient doesn&apos;t compare credentials. They call the name they already know, and they book with
          whoever answers first.
        </P>
        <StatBand />
        <P>
          <strong>The economic force.</strong> The compounding asset in healthcare used to be location and
          reputation. Now it&apos;s attention and reviews. The practices growing right now are not better
          clinicians than you. They run better systems... and every month, the gap gets more expensive to
          close.
        </P>
        <P lead>
          <strong>Ten years ago, &quot;great care plus word of mouth&quot; was a growth strategy. Today
          that&apos;s a lottery ticket.</strong>
        </P>
      </Section>

      {/* ── Belief shift ── */}
      <Section dark>
        <Eyebrow>Why effort can&apos;t fix it</Eyebrow>
        <H2>You&apos;ve already tried the obvious fix. It&apos;s called trying harder.</H2>
        <P>
          Posting at 11pm doesn&apos;t move the needle because everybody is asleep. Telling your front desk to
          follow up when it&apos;s quiet loses to patients who expect instant answers. Asking for a Google
          review when you remember, from the patients you&apos;re sure will say yes, means other clinics win
          the map pack.
        </P>
        <P>
          So the real problem is that you need to get consistent systematically. That&apos;s exactly what the
          expensive chiropractic coaches sell. But then you hit the actual problem...{' '}
          <strong>it&apos;s not a discipline problem. It&apos;s a physics problem.</strong>
        </P>
        <P lead>
          <strong>Attention now runs 24 hours a day. Humans don&apos;t.</strong>
        </P>
        <P>
          You need sleep. Your family needs you. And you cannot out-hustle a force that never sleeps... you
          can only out-system it. The practices that grow are simply the ones where the system runs anyway.
        </P>
        <ConsistencyGraph onDark />
      </Section>

      {/* ── Drift ── */}
      <Section>
        <Eyebrow>The quietest leak</Eyebrow>
        <H2>A patient finishes their care plan. They feel good. Then nothing happens.</H2>
        <P>
          No contact, no content, no reason to think of you. Eight months later their back flares up... in a
          city full of clinics that answer faster than you.
        </P>
        <P>
          Quick question: how many electricians do you have stored in <em>your</em> phone for emergencies?
          Exactly. And if you don&apos;t have one, you&apos;ll call the first one on Google Maps that
          responds... correct? That is precisely how your faded patients choose their next chiropractor.
        </P>
        <ReactivationLoop />
        <P>
          <strong>Every patient who stopped coming has a spine that did not stop needing care.</strong> They
          did not leave you. Life got loud, and nobody tapped them on the shoulder.
        </P>
      </Section>

      {/* ── The Omniply Loop ── */}
      <Section dark>
        <Eyebrow>The mechanism</Eyebrow>
        <H2>The Omniply Loop: four systems, each feeding the next.</H2>
        <P lead>
          What fixes this is not a tool. It&apos;s a loop... it multiplies your omni-channel exposure where
          your patients pay attention all day.
        </P>
        <LoopDiagram />
        <div className="grid gap-6 sm:grid-cols-2">
          {[
            ['Response', 'An AI front desk that answers in two rings... at 2pm while you&rsquo;re adjusting or at 2am while you&rsquo;re asleep. Website chat and a phone voice that sound like your practice, send the booking link or take a callback for the exact time the patient names, with 200 voice minutes included. The inquiry answered instantly is the patient your competitor never meets.'],
            ['Proof', 'A review engine that turns every happy patient into public evidence, automatically. Reviews compound like interest: invisible week to week, undeniable year to year... and they feed the map pack and the AI answers alike.'],
            ['Presence', 'Real content... posts, articles, a newsletter your patients actually read... produced in your voice every week, without you writing a word. It keeps patients warm between visits, and it is what Google and the AI assistants read when they decide who to recommend.'],
            ['Recall', 'Reactivation that never forgets a patient. Care plan ends, contact continues... and the ones who faded get a reason to come back before the flare-up, not after.'],
          ].map(([head, body]) => (
            <div key={head}>
              <div className="text-lg font-bold" style={{ color: TOKENS.lime }}>{head}</div>
              <p className="mt-1 leading-relaxed text-white/75" dangerouslySetInnerHTML={{ __html: body }} />
            </div>
          ))}
        </div>
        <P>
          <br />
          Instant response converts the inquiry &rarr; happy patients leave reviews &rarr; reviews and
          presence bring the next inquiry &rarr; recall keeps them all coming back.{' '}
          <strong>It&apos;s not four tools. It&apos;s one flywheel.</strong> And it is not another AI content
          tool... the content is the compounding layer behind a front desk that never misses a call. Break
          any link and the leak reopens somewhere else... which is exactly why buying point-solutions has
          never fixed it, and why coaching alone just hands the discipline problem back to you. The loop
          removes it.
        </P>
      </Section>

      {/* ── Proof / map pack ── */}
      <Section>
        <Eyebrow>Getting found</Eyebrow>
        <H2>Three practices get shown on the map. The rest get scrolled past.</H2>
        <P>
          When someone in pain types <strong>chiropractor near me</strong>, Google shows three practices above
          the fold, and fresh reviews are one of the strongest signals that decide who gets those spots.
        </P>
        <MapPackDiagram />
        <P>
          A practice collecting reviews <strong>systematically, every single week,</strong> outranks the
          practice with a burst from two years ago. Same law as your content: consistency beats bursts,
          except here the prize is the most valuable screen real estate in your town... and Omniply makes the
          asking automatic, from the front-desk QR card to the well-timed follow-up.
        </P>
      </Section>

      {/* ── The Prognosis ── */}
      <Section dark>
        <Eyebrow>The prognosis</Eyebrow>
        <H2>What your practice looks like ninety days into treatment.</H2>
        <ul>
          <Bullet head="The 2am back-spasm call answered, and booked, while you're asleep...">
            so Monday&apos;s schedule fills itself before your competitor&apos;s front desk even gets in.
          </Bullet>
          <Bullet head="A newsletter your patients actually open...">
            written, designed and sent every week, without you typing a word of it.
          </Bullet>
          <Bullet head="Fresh Google reviews arriving quietly every week...">
            the compounding kind your competitors can&apos;t fake and can&apos;t catch up to.
          </Bullet>
          <Bullet head="Patients who felt fine and faded getting a reason to come back...">
            before the flare-up, not after they&apos;ve already googled someone else.
          </Bullet>
          <Bullet head="Your name showing up between visits,">
            so when the pain hits, there&apos;s no search... just &quot;call my chiro.&quot;
          </Bullet>
          <Bullet head="And the one nobody puts on a features list:">
            your evenings back. No more 11pm posting, no more &quot;we should really ask for reviews&quot;...
            no more marketing guilt.
          </Bullet>
        </ul>
      </Section>

      {/* ── Economics ── */}
      <Section>
        <Eyebrow>The one-patient math</Eyebrow>
        <H2>Recovering one patient a month pays for the entire system.</H2>
        <P>
          Take your average visit fee. A typical patient&apos;s first year is worth roughly twelve visits of
          it. <strong>Recovering one patient a month more than covers the entire system. The second one is
          profit.</strong> That&apos;s the whole business case... your own numbers, doing arithmetic you can
          check. The X-Ray does it for you, with every assumption shown.
        </P>
        <FoundingNotify />
      </Section>

      {/* ── Founder ── */}
      <Section dark>
        <Eyebrow>Who built this</Eyebrow>
        <H2>Built by someone who spent 16 years marketing practices like yours by hand.</H2>
        <P>
          I have run marketing for chiropractors and health professionals for 16 years. The playbook inside
          Omniply is the exact system the top practice coaches teach their private clients to run manually. I
          have watched it transform practices, and I have watched it quietly die in busy months, over and
          over, for one reason only: humans cannot ship every week forever.
        </P>
        <P>
          So I learned to code and spent years building the version that can. <strong>Omniply does not get
          tired, does not get busy, and has never once skipped a week.</strong>
        </P>
      </Section>

      {/* ── FAQ ── */}
      <Section>
        <Eyebrow>Questions, answered straight</Eyebrow>
        <H2>Everything chiropractors ask before they start.</H2>
        <Faq items={FAQ_ITEMS} />
      </Section>

      {/* ── Close ── */}
      <Section dark>
        <H2>Decide like a doctor decides: on the evidence.</H2>
        <P lead>
          The X-Ray takes 2 minutes: your missed calls per week, four system scores, and a dollar figure on
          what your practice is quietly leaking every month. Then the walkthrough shows the actual system on
          screen... how it answers, what it posts, what the recall messages look like. No call. No
          salesperson.
        </P>
        <P>
          Everything in the loop, one flat monthly rate, cancel anytime. We&apos;re not asking you to become
          a marketer... we&apos;re asking you to stop having to be one.
        </P>
        <Cta href={XRAY_URL} sub="free · 2 minutes · your report is yours to keep">
          X-Ray My Practice
        </Cta>
        <p className="mt-6 text-center text-sm text-white/50">
          Or see the system first: <a href="/walkthrough" className="underline">watch the walkthrough</a>
        </p>
      </Section>

      <FaqJsonLd items={FAQ_ITEMS} />
      <MarketingFooter />
    </main>
  )
}
