/**
 * Wellness & Longevity Centers sales letter (wellness-sales-funnel plan
 * Phase 3, 2026-10-30; recomposed on the brand design system 2026-11-05).
 * Mirrors the chiro letter's proven structure and angle hierarchy (AI booking
 * first, missed calls second, reviews-as-AI-visibility third); wording
 * register is clients/guests/sessions, never patients. Primary CTA
 * throughout = the X-Ray with ?v=wellness (skips the segmentation question).
 * Dash-free house style; ellipses voice.
 */
import type { Metadata } from 'next'
import Script from 'next/script'
import {
  XRAY_URL,
  Btn,
  CtaRow,
  SiteHeader,
  Eyebrow,
  Section,
  SectionHead,
  Measure,
  H1,
  P,
  Who,
  Bullet,
  CheckList,
  FeatureRows,
  NumberedCards,
  Callout,
  LoopDiagram,
  StatBand,
  ConsistencyGraph,
  ReactivationLoop,
  MapPackDiagram,
  Faq,
  FaqJsonLd,
  type FaqEntry,
  MarketingFooter,
  PilotCards,
  PricingBlock,
} from '@/components/marketing/Marketing'

const XRAY = `${XRAY_URL}?v=wellness`
const WALKTHROUGH = '/walkthrough?v=wellness'

export const metadata: Metadata = {
  title: 'Omniply for Wellness & Longevity Centers... Plug the Leak in Your Center',
  description:
    '132 million Americans now ask AI assistants before they book. Can one even find your wellness center? Omniply makes you the center AI and people find, answers every inquiry in seconds, and keeps clients with content, reviews and recall. X-Ray your center in 2 minutes.',
}

const FAQ_ITEMS: FaqEntry[] = [
  {
    q: 'Is the content safe for a wellness business to publish?',
    a: 'Claims guardrails are built into every generator: no cures, no medical promises, no outcome guarantees, nothing that says more than a session can honestly say. Evidence gets described at the level it deserves, and because you approve every piece before it ships, the final word on anything carrying your name is always yours.',
  },
  {
    q: 'Will it really sound like me, not like AI?',
    a: 'Yes, and this is the part owners doubt until they see it. During onboarding you simply talk about your center, your clients and what you believe about recovery and longevity. The system learns how you actually speak. The first newsletter reads like you dictated it on a good day, because in a real sense you did.',
  },
  {
    q: 'Does it work with my booking system?',
    a: 'Yes. Omniply works alongside your booking software, never instead of it. Depending on your system, the AI receptionist can book sessions directly into your calendars, one per service... HBOT, massage, consultations, each with its own schedule... or it shares current availability and sends clients your own booking link to confirm there. No migrations, no double bookings, no IT project.',
  },
  {
    q: 'My clients come from everywhere. Does it handle other languages?',
    a: 'Yes. The AI receptionist answers in the language the client writes in... English, Spanish, German, French and Russian... including prices and booking. For centers in tourist markets, the 9pm WhatsApp message in Spanish gets the same instant answer as a local call.',
  },
  {
    q: 'Can AI assistants really find my center? How does Omniply help?',
    a: 'When someone asks ChatGPT, Siri or Google’s AI where to recover, sleep better or try HBOT, the assistant reads the same public signals a careful human would: your reviews, your content, your website’s structure, and whether anyone answers when it reaches out. Omniply builds exactly those signals every week, adds the structured markup AI engines parse, and its chat and voice front desk means an assistant that contacts your center gets an instant answer and a booking... instead of silence.',
  },
  {
    q: 'Is my client data involved?',
    a: 'No. The marketing system runs on your public presence and your booking link. It does not touch health records or intake forms.',
  },
  {
    q: 'How much of my week does this take?',
    a: 'A few minutes over coffee. Content arrives in one approval inbox, you read it, you click approve, and the week is handled. The setup itself is a ten to fifteen minute guided conversation you do once, and the system starts producing in hours.',
  },
  {
    q: 'Do I have to come up with the topics?',
    a: 'No. Your content runs on a wellness calendar built around the seasons of a real center: new year resets, summer recovery, travel and jet lag, holiday stress, sleep in the dark months. Cold-exposure content lands when people are curious about it, not at random.',
  },
  {
    q: 'How does the review engine work? Is it ethical?',
    a: 'Completely. We never write, buy or fake reviews. The system makes it effortless for genuinely happy clients to leave one: a printed QR card for your front desk that opens your Google review form, plus well-timed follow-ups. The reviews are real. There are simply more of them, because asking finally happens consistently.',
  },
  {
    q: 'What exactly does the subscription include? Any hidden costs?',
    a: 'Everything in the loop: weekly client-education articles, the weekly newsletter with 25,000 email sends included, social posts with designed graphics, your branded lead-magnet guides, the Body Resilience Score quiz on your website, the AI response and recall systems, and the review engine. No per-piece fees, no content credits, no surprises.',
  },
  {
    q: 'How fast will I see results?',
    a: 'Honest answer: reactivation is fastest, because past clients who get reminded tend to rebook within weeks. Google visibility and new-client flow compound over months, which is exactly why consistency beats bursts. Anyone promising overnight clients from content is selling you something else.',
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

const LOOP = [
  {
    title: 'Response',
    body: 'An AI front desk that answers in two rings... at 2pm while you’re mid-session or at 2am while you’re asleep. Website chat and a phone voice that sound like your center, book the exact service the client names... each calendar its own schedule... or take a callback, with 200 voice minutes included. It answers in the client’s own language, five of them. The inquiry answered instantly is the client your competitor never meets.',
  },
  {
    title: 'Proof',
    body: 'A review engine that turns every happy client into public evidence, automatically. Reviews compound like interest: invisible week to week, undeniable year to year... and they feed the map pack and the AI answers alike.',
  },
  {
    title: 'Presence',
    body: 'Real content... posts, articles, a newsletter your clients actually read... produced in your voice every week, without you writing a word. It keeps clients warm between visits, and it is what Google and the AI assistants read when they decide who to recommend.',
  },
  {
    title: 'Recall',
    body: 'Reactivation that never forgets a client. The package ends, contact continues... and the ones who faded get a reason to come back before they slide into old habits, not after.',
  },
]

export default function WellnessPage() {
  return (
    <main className="om">
      {/* Omniply CRM affiliate tracking (marketing location), same snippet as
          /walkthrough and /intro/wellness. */}
      <Script id="omniply-affiliate" strategy="afterInteractive">{`
    (function() {
      var t = document.createElement("script");
      t.type = "text/javascript", t.async = !0, t.src = 'https://links.omniply.io/js/am.js', t.onload = t.onreadystatechange = function() {
          var t = this.readyState;
          if (!t || "complete" == t || "loaded" == t) try {
            affiliateManager.init('HsevyaesOdFid7b8KC9q', 'https://backend.leadconnectorhq.com', '.omniply.io')
          } catch (t) {}
      };
      var e = document.getElementsByTagName("script")[0];
      e.parentNode.insertBefore(t, e)
  })();
`}</Script>
      <SiteHeader vertical="For Wellness & Longevity Centers" walkthroughHref={WALKTHROUGH} xrayHref={XRAY} />

      {/* ── Hook: AI booking (same angle hierarchy as chiro) ── */}
      <Section tone="dark" hero>
        <Measure>
          <Eyebrow>Omniply for Wellness &amp; Longevity Centers</Eyebrow>
          <H1>When someone asks an AI assistant where to recover in your town... can it even find you?</H1>
          <P first>
            132 million Americans now use AI assistants to research and compare before they book. If you
            don&apos;t know the answer... probably not.
          </P>
          <P lead>
            And if an AI assistant can&apos;t understand your website, or talk to it, it will simply book the
            next center down the road. Meanwhile the inquiries you miss keep booking with whoever answered,
            and clients fade between visits, invisibly, until the quarter is already soft. There is a
            2-minute way to put a number on all of it, in dollars.
          </P>
          <Who>
            HBOT or IV lounge, cold-plunge and sauna studio, massage and bodywork practice, longevity
            clinic... if clients book sessions with you, this is built for you.
          </Who>
          <CtaRow sub="12 questions · 2 minutes · your missed inquiries, your AI visibility, and your monthly leak in dollars">
            <Btn href={XRAY}>X-Ray My Center</Btn>
            <Btn href={WALKTHROUGH} ghost>Watch the walkthrough</Btn>
          </CtaRow>
        </Measure>
      </Section>

      {/* ── The Big Change: three forces ── */}
      <Section tone="grey">
        <SectionHead eyebrow="Why this is happening to good centers" title="Three forces created the leak. None of them asked your permission." />
        <FeatureRows
          rows={[
            {
              title: 'The technology force',
              body: (
                <>
                  <P>
                    Clients now ask AI assistants the question they used to type into Google... &quot;who
                    should I see about this?&quot; For the assistant to send them your way, it has to{' '}
                    <em>find</em> your center, <em>understand</em> your website, and increasingly it wants to{' '}
                    <em>talk</em> to it... and book.
                  </P>
                  <P>
                    The answer engines read the same signals a careful human would: reviews, real content,
                    responsiveness. A center those engines can&apos;t read doesn&apos;t lose the comparison.
                    It never comes up.
                  </P>
                  <P>
                    And underneath that newest layer, the old one still runs: every potential client in your
                    town carries every competitor&apos;s front desk in their pocket. When someone decides at
                    9pm that the tension, the jet lag or the bad sleep finally has to go, they don&apos;t wait
                    for your opening hours... they search, they message, and they book with whoever answers.
                    Google decides who exists. The map pack decides who gets the call.
                  </P>
                </>
              ),
            },
            {
              title: 'The social force',
              body: (
                <>
                  <P>
                    Clients stopped calling back. Not because they&apos;re rude... because Amazon, Uber and a
                    decade of instant everything trained them.
                  </P>
                  <P>
                    Princeton researchers showed people form trust judgments in a tenth of a second, before a
                    single rational thought. Your future client doesn&apos;t compare certifications. They call
                    the name they already know, and they book with whoever answers first.
                  </P>
                </>
              ),
            },
            {
              title: 'The economic force',
              body: (
                <>
                  <P>
                    The compounding asset in wellness used to be location and reputation. Now it&apos;s
                    attention and reviews.
                  </P>
                  <P>
                    The centers growing right now don&apos;t deliver better sessions than you. They run better
                    systems... and every month, the gap gets more expensive to close.
                  </P>
                </>
              ),
            },
          ]}
        />
        <StatBand style={{ marginTop: 48 }} />
        <Measure style={{ marginTop: 40 }}>
          <P lead center>
            <strong>Ten years ago, &quot;great care plus word of mouth&quot; was a growth strategy. Today
            that&apos;s a lottery ticket.</strong>
          </P>
        </Measure>
      </Section>

      {/* ── Belief shift ── */}
      <Section tone="dark">
        <SectionHead eyebrow="Why effort can't fix it" title="You've already tried the obvious fix. It's called trying harder." />
        <Measure>
          <P>
            Posting at 11pm doesn&apos;t move the needle because everybody is asleep. Telling your front desk
            to follow up when it&apos;s quiet loses to clients who expect instant answers. Asking for a Google
            review when you remember, from the clients you&apos;re sure will say yes, means other centers win
            the map pack.
          </P>
          <P>
            So the real problem is that you need to get consistent systematically. That&apos;s exactly what
            the expensive wellness-business coaches sell. But then you hit the actual problem...{' '}
            <strong>it&apos;s not a discipline problem. It&apos;s a physics problem.</strong>
          </P>
          <P lead>
            <strong>Attention now runs 24 hours a day. Humans don&apos;t.</strong>
          </P>
          <P>
            You need sleep. Your family needs you. And you cannot out-hustle a force that never sleeps... you
            can only out-system it. The centers that grow are simply the ones where the system runs anyway.
          </P>
        </Measure>
        <ConsistencyGraph onDark audienceLabel="Client attention" />
      </Section>

      {/* ── Drift ── */}
      <Section tone="white">
        <SectionHead eyebrow="The quietest leak" title="A client finishes their package. They feel great. Then nothing happens." />
        <Measure>
          <P>
            No contact, no content, no reason to think of you. Eight months later the tension is back and the
            sleep is gone... in a town full of studios that answer faster than you.
          </P>
          <P>
            Quick question: how many electricians do you have stored in <em>your</em> phone for emergencies?
            Exactly. And if you don&apos;t have one, you&apos;ll call the first one on Google Maps that
            responds... correct? That is precisely how your faded clients choose where to recover next.
          </P>
        </Measure>
        <ReactivationLoop visitsLabel="Client visits" businessWord="center" />
        <Measure style={{ marginTop: 40 }}>
          <P>
            <strong>Every client who stopped coming has a body that did not stop needing recovery.</strong>{' '}
            They did not leave you. Life got loud, and nobody tapped them on the shoulder.
          </P>
        </Measure>
      </Section>

      {/* ── The Omniply Loop ── */}
      <Section tone="dark">
        <SectionHead
          eyebrow="The mechanism"
          title="The Omniply Loop: four systems, each feeding the next."
          lead="What fixes this is not a tool. It's a loop... it multiplies your omni-channel exposure where your clients pay attention all day."
        />
        <LoopDiagram />
        <div style={{ marginTop: 40 }}>
          <NumberedCards items={LOOP} />
        </div>
        <Measure>
          <Callout>
            <P>
              Instant response converts the inquiry. Happy clients leave reviews. Reviews and presence bring
              the next inquiry. Recall keeps them all coming back.{' '}
              <strong>It&apos;s not four tools. It&apos;s one flywheel.</strong>
            </P>
            <P>
              And it is not another AI content tool... the content is the compounding layer behind a front
              desk that never misses an inquiry. Break any link and the leak reopens somewhere else... which
              is exactly why buying point-solutions has never fixed it, and why coaching alone just hands the
              discipline problem back to you. The loop removes it.
            </P>
          </Callout>
        </Measure>
      </Section>

      {/* ── Proof / map pack ── */}
      <Section tone="grey">
        <SectionHead eyebrow="Getting found" title="Three centers get shown on the map. The rest get scrolled past." />
        <Measure>
          <P>
            When someone types <strong>wellness center near me</strong> or <strong>HBOT near me</strong>,
            Google shows three businesses above the fold, and fresh reviews are one of the strongest signals
            that decide who gets those spots. And the same board now gets read twice: when a client asks an
            AI assistant instead, it weighs the same reviews to decide which center to name.
          </P>
        </Measure>
        <MapPackDiagram query="wellness center near me" />
        <Measure style={{ marginTop: 40 }}>
          <P>
            A center collecting reviews <strong>systematically, every single week,</strong> outranks the
            center with a burst from two years ago. Same law as your content: consistency beats bursts,
            except here the prize is the most valuable screen real estate in your town... and, increasingly,
            the one answer an AI assistant gives. Omniply makes the asking automatic, from the front-desk QR
            card to the well-timed follow-up.
          </P>
        </Measure>
      </Section>

      {/* ── The Prognosis ── */}
      <Section tone="white">
        <SectionHead eyebrow="The prognosis" title="What your center looks like ninety days in." />
        <Measure>
          <CheckList>
            <Bullet head='The 2am "can I still get in tomorrow?" message answered, and booked, while you&apos;re asleep.'>
              Monday&apos;s schedule fills itself before your competitor&apos;s front desk even gets in.
            </Bullet>
            <Bullet head="A newsletter your clients actually open.">
              Written, designed and sent every week, without you typing a word of it.
            </Bullet>
            <Bullet head="Fresh Google reviews arriving quietly every week.">
              The compounding kind your competitors can&apos;t fake and can&apos;t catch up to.
            </Bullet>
            <Bullet head="Clients who felt great and faded getting a reason to come back.">
              Before they slide into old habits, not after they&apos;ve already googled someone else.
            </Bullet>
            <Bullet head="Your name showing up between visits.">
              So when they need a reset, there&apos;s no search... just &quot;book my usual spot.&quot;
            </Bullet>
            <Bullet head="And the one nobody puts on a features list: your evenings back.">
              No more 11pm posting. No more &quot;we should really ask for reviews.&quot; No more marketing
              guilt.
            </Bullet>
          </CheckList>
        </Measure>
      </Section>

      {/* ── Pilot program ── */}
      <Section tone="grey">
        <SectionHead eyebrow="From the pilot program" title="Real accounts, real outputs. No staged screenshots." />
        <PilotCards />
      </Section>

      {/* ── Economics ── */}
      <Section tone="white">
        <SectionHead eyebrow="The one-client math" title="Recovering one client a month pays for the entire system." />
        <Measure>
          <P>
            Take your average session fee. A typical client&apos;s first year is worth roughly twelve sessions
            of it. <strong>One recovered client covers the entire system for the month. The second one is
            profit.</strong> That&apos;s the whole business case... your own numbers, doing arithmetic you can
            check. The X-Ray does it for you, with every assumption shown.
          </P>
          <PricingBlock peopleWord="client" walkthroughHref={WALKTHROUGH} />
        </Measure>
      </Section>

      {/* ── Founder ── */}
      <Section tone="dark">
        <SectionHead eyebrow="Who built this" title="Built by someone who spent 16 years marketing health businesses by hand." />
        <Measure>
          <P>
            I have run marketing for health and wellness professionals for 16 years. The playbook inside
            Omniply is the exact system the top business coaches teach their private clients to run manually.
            I have watched it transform businesses, and I have watched it quietly die in busy months, over and
            over, for one reason only: humans cannot ship every week forever.
          </P>
          <P>
            So I learned to code and spent years building the version that can.{' '}
            <strong>Omniply does not get tired, does not get busy, and has never once skipped a week.</strong>
          </P>
        </Measure>
      </Section>

      {/* ── FAQ ── */}
      <Section tone="grey">
        <SectionHead eyebrow="Questions, answered straight" title="Everything wellness owners ask before they start." />
        <Faq items={FAQ_ITEMS} />
      </Section>

      {/* ── Close ── */}
      <Section tone="white">
        <SectionHead eyebrow="Here's what to do next" title="Decide the way you run your center: on the evidence." />
        <Measure>
          <P lead>
            The X-Ray takes 2 minutes: your missed inquiries per week, four system scores, a dollar figure on
            what your center is quietly leaking every month, and a projection of what staying invisible to AI
            assistants will cost you. Then the walkthrough shows the actual system on screen... how it
            answers, what it posts, what the recall messages look like. No call. No salesperson.
          </P>
          <P>
            One flat monthly subscription. Everything in the loop. Cancel anytime. We&apos;re not asking you
            to become a marketer... we&apos;re asking you to stop having to be one.
          </P>
          <CtaRow sub="free · 2 minutes · your report is yours to keep">
            <Btn href={XRAY}>X-Ray My Center</Btn>
            <Btn href={WALKTHROUGH} ghost>Watch the walkthrough</Btn>
          </CtaRow>
        </Measure>
      </Section>

      <FaqJsonLd items={FAQ_ITEMS} />
      <MarketingFooter />
    </main>
  )
}
