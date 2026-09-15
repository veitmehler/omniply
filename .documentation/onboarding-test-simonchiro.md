# Onboarding E2E Test — simonchirocenter.com (user-owned test site)

Feature under test on top of the standard 19-step walkthrough
(.documentation/onboarding-testing-guide.md): blog-scrape writing sample with the
mandatory "I wrote this" authorship confirmation (deployed to staging, branch commit
"feat(onboarding): scrape newest blog post…").

## Pre-test checklist

USER (site + accounts):
- [√] Publish the planted article below to /blog on the WordPress site (title as given).
- [√] WordPress → Settings → Reading → "Discourage search engines" ON — BEFORE the test.
- [√] Create FB + IG (optional LinkedIn) profiles under unrelated names; add their links
      to the site header/footer (tests the crawl's socialLinks prefill).
- [ ] Staging test sub-account GHL Business Profile: name, user-controlled email, phone,
      US address (Mesa AZ), timezone America/Phoenix, website URL = the test site.
- [ ] Connect the social profiles in the sub-account's Social Planner.

ME (before you click "start"):
- [ ] Staging deploy green, seed state per guide Part C (owner User/Account/GhlSettings
      rows; NO BrandSettings — onboarding must fill everything).
- [ ] Tail staging logs live during the walkthrough.

## Extra verifications (on top of guide Part D table)

P3 client-rollout additions (2026-09-09):
- Voice questions are SIX now — q_moments answer lands in BrandSettings.storyBeats.
- CTA step is now the SOCIAL LEAD-GEN CONSENT (§4b-3, runs AFTER wordpress):
  quiz pitch + "Yes, please set this up." / "No, I don't want to generate
  leads…". Pick YES; verify socialPrimaryGoal='dm_keyword' +
  socialCallToAction='SPINE|our 2-Minute Spine Check' +
  installConsents.quiz=true stored. (First live run 2026-09-14 hit the OLD
  bug: LLM-generated options hid the SPINE one-tap entirely — fixed.)
- NEW install_consent step right before the finale: link-in-bio +
  chat-widget toggles (both default ON) → installConsents.linktree/chatWidget.
- NO ElevenLabs step appears (removed for clients).
- Finale burst: article days = story beats + KT music video (headline+shorts);
  newsletter days = nl story beats + brand-tint feature carousel; captions use
  the CLIENT keyword (not XRAY); hours 9/12/17.

- Step 2 (crawl): log shows blogSample stored — url + wordCount ≥ 400, WP REST path.
- Step 7 (writing sample): chat offers the planted article with excerpt; answer exactly
  `I wrote this`; verify Settings.writingStyle afterward ECHOES the fingerprint below.
- No GBP connected → reviews features degrade gracefully, no errors.
- Finale burst publishes to the live WP → verify → USER blocks site from public access.

## Planted article (publish verbatim; voice fingerprint is deliberate)

The fingerprint to look for in the generated writingStyle: sailing/nautical metaphors,
very short punch sentences, direct second-person address, the recurring phrase
"Here's the thing:", small numbered lists.

**Title: Your Spine Is a Mast, Not a Coat Rack**

Most people treat their spine like a coat rack. Something to hang a body on. Load it
up, forget about it, complain when it creaks.

Here's the thing: your spine is a mast.

A mast holds the whole ship in tension. Every line, every sail, every degree of lean
runs through it. When the mast is true, the boat points where you steer. When it
warps, even a little, you fight the wheel all day and blame the weather.

Your body works the same way. The spine is not furniture. It is rigging under load,
all day, every day.

Think about your morning. You fold yourself into a car seat. You lean into a screen.
You carry a bag on the same shoulder you always use. None of it feels like much.
Neither does one loose stay on a sailboat. But small slack compounds. The lean
becomes the posture. The posture becomes the ache. The ache becomes the thing you
plan your day around.

Sailors do not wait for the mast to crack. They tune the rig. A quarter turn here.
A check of the tension there. Boring, small, regular. That is the entire secret,
and nobody wants to hear it, because boring does not sell.

Here's the thing: maintenance beats rescue. Every time.

So what does tuning look like for a body? Three habits, none of them heroic:

1. Change your position before your body demands it. If you sit, stand every half
hour. Not because sitting is evil. Because holding ANY position too long lets the
slack settle in.

2. Load both sides. Swap the bag shoulder. Alternate the arm that carries the
groceries. Symmetry is not about perfection. It is about not always leaning the
same way into the same wind.

3. Pay attention to the small creaks. A twinge that shows up three mornings in a
row is information. Not a crisis. Information. Ships log everything. Log your body.

None of this replaces getting the rig professionally checked. A trained eye catches
what you cannot feel yet, the way a rigger spots a hairline issue from the dock.
That is what an examination is for: finding the slack before it finds you.

But do not outsource the whole job. The daily tuning is yours. Nobody else stands
your watch.

People ask me why I go on about small habits when they came in asking about one
sore spot. Because the sore spot is rarely the story. It is the loudest passenger,
not the captain. The story is how the whole rig has been carrying load, for months,
usually longer.

Here's the thing: you do not need to become a different person. You need a
quarter-turn of attention, applied regularly, at the points where your day loads
your spine.

Tune the mast. Trim the sails. Watch how differently the boat handles.

Your body is the only vessel you get. Sail it like you plan to keep it.

*(~600 words)*

## Dummy voice-interview answers (SPEAK all six — the recordings become the voice clone)

Answers below are matched to the LIVE question wordings in flow.ts (the earlier
shorthand versions didn't fit them). The flow explicitly asks you to ramble and
tell stories — longer spoken answers also make a better voice clone, so feel free
to pad these out loud; the text is the skeleton, not a script to read stiffly.

- **q_declaration** (live wording: "Imagine a patient describing your clinic to a
  friend three years from now. What do you want them to say you did for them?"):
  "I want them to say he gave me my mornings back. Not that I got fixed in one
  visit, nobody honest promises that. I want them telling their friend they used
  to plan their whole day around their back, and now they just live. That we
  taught them how their own body actually works, in plain language, and gave them
  small boring habits that stuck. And honestly, I want them to say: he told me
  the truth, even when the truth was that I didn't need another appointment."
- **q_enemy** (live: "What's the one thing in your industry that drives you crazy —
  the thing patients keep falling for before they find you?"): "The quick-fix
  promise. People walk in here having already spent a fortune somewhere that sold
  them a thirty-visit plan on day one, or some gadget of the month. The
  crack-and-bill model. Anyone who tells you one visit undoes ten years of habits
  is selling you the weather forecast, not the voyage. It drives me crazy because
  it burns people's trust before they ever reach someone who will level with them."
- **q_tribe** (live: "Describe your favorite patient — the one you wish you had 100
  more of. Who are they, what does their life look like?"): "A working parent,
  somewhere in their late thirties or forties. Desk job or a trade, carries the
  toddler on the same hip every time, weekends are sports and yard work. They
  don't want a lecture and they don't want magic, they want to get back to their
  life with less friction. And when you give them two small things to do at home,
  they actually do them. That person, I could see a hundred of them a week and
  never get tired of it."
- **q_line** (live: "What do you refuse to compromise on, even when it costs you?"):
  "Time with each patient, and telling the truth about what they need. I measure
  before I touch, every visit, and if the measurements say someone doesn't need
  me anymore, I say so and send them home. That costs me real money, always has.
  I cut my own schedule rather than run an assembly line. Maintenance beats
  rescue, every time, and I refuse to sell rescue to someone who needs habits."
- **q_moments** (live: "two or three short TRUE stories — a mistake you fixed, a
  lesson that cost you something, a moment you're proud of; no patient details"):
  "Early on I overbooked myself so badly I was adjusting people like an assembly
  line, and one afternoon I caught myself not remembering who was on the table. I
  cut my schedule by a third the next week and never went back. It cost me real
  money for a year, and it is the best decision I ever made. Second one: I once
  spent months and a small fortune on a fancy decompression machine because a
  conference salesman was better at his job than I was at mine. It gathered dust.
  Taught me that hands, time, and attention beat gadgets, and I have bought
  almost nothing since. And the proud one: a few years back a father told me his
  kid asked why dad could suddenly play on the floor again. Nobody claps for
  maintenance, but that one stayed with me."
  (Feeds BrandSettings.storyBeats — the story-arc generator's authenticity pool,
  so these three beats will surface in daily story posts. Deliberately concrete,
  no patient details, matches the persona.)
- **q_proof** (live: "walk me through what actually happens in a patient's first
  visit and first month with you."): "First visit is about forty-five minutes and
  most of it is listening and measuring. Full history, how you sit, how you move,
  where the day loads your spine. Then I explain what I found in plain language,
  no scary posters, and if I don't think we're the right fit I say so on day one.
  If we are, the first month is usually two short visits a week tapering down,
  plus two or three small home habits, nothing heroic. At week four we re-measure
  and have an honest conversation about what changed, and the plan follows the
  measurements, not the other way around."

## Prepared content for the FORM steps (no content existed for these before)

- **booking_url** (free text, format-checked only): `https://simonchirocenter.com/book`
  (page doesn't need to exist for the test).
- **pms** (choice): pick **ChiroTouch** (US-typical; capture-only, no integration).
- **cta** (choice): the one-tap **'Comment "SPINE" → we DM the free Spine Check'**
  (per the verification section above).
- **offers / logo_confirm / brand_profile_confirm / template_reveal** (confirm
  cards): review + approve; edit one seasonal offer's wording so the edit path
  gets exercised once.
- **photo**: have a headshot file ready on the machine before starting (any
  portrait works for the test).
- **front_desk form** (powers the chat assistant KB — fill like this):
  - Insurance: funds = "Blue Cross Blue Shield of Arizona, Aetna, Cigna,
    UnitedHealthcare, Medicare"; workers' comp YES; motor accident YES; leave the
    AU-specific toggles (HICAPS, Medicare care plans) OFF.
  - First visit: duration "45 minutes"; description "Mostly listening and
    measuring: full history, movement assessment, and a plain-language
    explanation of findings before anything else."; bring "Photo ID, insurance
    card, comfortable clothes you can move in."
  - Free assessment: OFFERED, terms "Free 10-minute posture screen for new
    patients. One per person, no obligation, and it is a screen, not a full
    examination." (terms are REQUIRED when offered — advertising-rules gate,
    also exercises the C3-tested boundary).
  - Pricing: share ON; standard "New patient first visit $150 including
    examination; standard adjustment visit $85."; discounts "10% for seniors,
    military, and first responders."
  - Booking: how "Online at simonchirocenter.com/book or call the front desk.";
    cancellation "24 hours notice, no fee; late cancels may be charged $40."
  - Practitioners: Dr. Simon — USE THE EXACT NAME ON THE SITE (male, Mon–Fri);
    plus invented associate "Dr. Elena Ruiz" (female, Tue + Thu) — she exists to
    exercise the female-practitioner FAQ the builder generates.
  - Treats: children YES, pregnancy YES, seniors YES; age note "infants from 6
    months".
  - Referrals: "No referral needed — book directly."
  - Payment: card, cash, HSA/FSA.
  - Access: "Free parking on site; ground floor, wheelchair accessible."
  - Languages: "English and Spanish."
  - After hours: "Leave a voicemail and we return calls the next business
    morning. For anything urgent, go to urgent care or call 911."
- **kb_review**: check the form answers won over crawl-derived duplicates, then
  approve.
- **toggles** (monthly auto-run on payment): pick **"I'll trigger each month
  myself"** for THIS demo account — 'fully automatic' would generate a full
  paid content month on every billing cycle of a permanent demo account. (Real
  clients: auto is the pitch.)

## Post-test teardown

- [ ] USER: block the site from public access entirely (after WP publish verified).
- [ ] USER: delete any social test posts.
- [ ] ME: mark E2E result in this file; if green → merge staging → main (pre-launch).
