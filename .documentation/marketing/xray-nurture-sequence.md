# X-Ray Nurture Sequence — 30-Day Follow-Up (Copy Master)

**Status: DRAFT v1 for review — 2026-08-05**

Fletcher-style follow-up: ONE offer (watch the walkthrough → start), many angles,
tapering cadence. 11 emails + 3 SMS over 30 days. Voice = the locked master
pitch (`practice-treatment-plan-master-pitch.md`): short lines, ellipses, no
fake scarcity, no income claims. Sender: **Veit @ Omniply**.

## Mechanics (build these into the GHL workflow)

- **Entry**: after the X-Ray capture workflow (tag `xray-lead`).
- **Exit on purchase**: buying adds tag `omniply-client` → remove from this
  workflow immediately (goal/exit condition). Nobody who bought gets email 4.
- **SMS branch**: SMS steps only fire if contact has a phone. Quiet hours
  9:00–19:00 contact-local; GHL's default queue handles this.
- **Links are TEXT LINKS, never buttons.** The `**[anchor →]** (url)` lines
  render as underlined text links with that anchor text. Report links with no
  surrounding anchor use "Click here".
- **Merge-field notes**:
  - Money fields are RAW numbers (`5600`, no commas) — copy always prefixes `$`.
  - `{{contact.xray_weakest_axis}}` is stored for segmentation only — never
    used in copy or links (the walkthrough is watched start to finish).
  - Report link: `{{contact.xray_report_url}}` (S3 short link).
- **CTA URL**: `https://omniply.io/walkthrough` — always plain, no chapter jumps.
- **Prerequisites before first send**: GHL dedicated sending domain configured;
  `veit@omniply.io` replies routed (Cloudflare email routing task); LC Phone
  number + A2P registration for SMS.

---

## EMAIL 1 · Day 0 (minutes after capture) · type: delivery

**Subject:** Your X-Ray results ({{contact.first_name}}, the number is inside)
**Preview:** Your score, your leak, and the debrief inside.

{{contact.first_name}} —

Your Practice X-Ray came back. Two numbers matter:

**Your Practice Omniply Score: {{contact.xray_total_score}}/100.**
**Your estimated monthly leak: ${{contact.xray_total_leak}}.**

The full report is here... your four system scores, the two leaks behind that
number, and the treatment plan for each one:

**[Read your X-Ray Debrief →]** ({{contact.xray_report_url}})

An X-ray doesn't lie. It doesn't flatter either. Read it the way you'd want a
patient to read theirs: not as entertainment... that's the difference between
managing a problem and living with one.

— Veit @ Omniply

P.S. This is your comprehensive diagnosis, in writing. Plus, we'll show you
how you can fix it easily... so check it out now:

**[Click here for your X-Ray results →]** ({{contact.xray_report_url}})

---

## SMS 1 · Day 1, morning (only if phone on file)

Veit here (Omniply). Your Practice X-Ray report: {{contact.xray_report_url}}
Worth 3 quiet minutes. The drift number is the one to look at.

---

## EMAIL 2 · Day 1 · type: splinter (drift)

**Subject:** Patients don't leave. They fade.
**Preview:** The silent leak that drains your practice... in one page.

A patient finishes their care plan. They feel good... which means your care
*worked*.

Then nothing happens. No contact, no content, no reason to think of you.

Eight months later their back flares up. In a city full of clinics that
answer faster than you, who will they call?

The top listing in the Google Maps pack that answers fastest.

Your X-Ray put a number on this: **${{contact.xray_drift_leak}} a month**,
walking out the quiet way.

Because they couldn't remember your name when it mattered the most, so they
just called someone else they could find fast.

Patients don't leave. They fade. And fading is invisible in the appointment
book until the quarter is already soft.

The fix isn't discipline. It's a system that never lets go of a patient:

**[Watch how Recall works... 3 minutes →]** (https://omniply.io/walkthrough)

— Veit

P.S. "My front desk handles follow-up." They handle the ones they remember...
at 9-to-5 speed. Plug this leak, and your quarter picks up.

**[Click here to save more appointments →]** (https://omniply.io/walkthrough)

---

## EMAIL 3 · Day 3 · type: teach (the new physics)

**Subject:** 132 million patients just changed how they find you
**Preview:** Can an AI assistant even find your practice? Plus the wave still hitting your phones.

132 million Americans now use AI assistants to research and compare before
they book. So when a patient asks one about a chiro in your town... can it
even find you?

If you don't know the answer... probably not. The engines recommend
practices they can read: reviews, real content, fast answers. And if an AI
assistant can't understand your website, or talk to it, it simply books the
next practice down the road. A practice it can't read never even comes up.

That's the new wave. The old one is still hitting your phones:

**78%** of customers buy from whoever answers first.

Reach an inquiry inside five minutes and you're **100×** more likely to even
get them on the line than half an hour later. The average business takes
**two days**. Every missed or slow-answered call quietly books somewhere
else... Amazon trained your patients, Uber trained them, a decade of instant
everything finished the job.

Your X-Ray scored your practice **{{contact.xray_total_score}}/100** against
both waves... and flagged the one system doing the most damage. I recorded
the exact fix for it:

**[Click here to become the practice they find →]** (https://omniply.io/walkthrough)

— Veit

P.S. "We already post on social media." Posting isn't the test. Being the
practice the AI names is... and answering at 2am when it sends someone your
way.


---

## EMAIL 4 · Day 5 · type: story (the electrician)

**Subject:** How many electricians are saved in your phone?
**Preview:** Likely many, so you always have one to call in an emergency...

Quick question...

How many electricians do you have stored in your phone for emergencies?

Most people have multiple options for an emergency.

And when the lights go out at 9pm, and no one answers you, you'll call the
first one on Google Maps that responds... correct?

What do you think your clients do when their back goes out at 9pm?

Exactly.

That's precisely how your next patient chooses a chiropractor. Fast beats
familiar. Every time.

Which is why the practice that answers in seconds, at 2pm while the doctor
is adjusting, or at 2am while everyone's asleep, quietly wins a city.

**[Click here to book patients any time of day →]** (https://omniply.io/walkthrough)

— Veit

P.S. "AI will sound robotic... my patients will notice." They'll notice a
human who never answers more... and the chiro with automated booking systems
wins every single day. 

**[Click here to see how it works →]** (https://omniply.io/walkthrough)

---

## EMAIL 5 · Day 7 · type: direct ask #1 (one-patient math)

**Subject:** the arithmetic ($397 vs. one patient)
**Preview:** No projections. Your numbers.

Take your average visit fee. A typical patient's first year is worth roughly
twelve visits of it.

The whole system costs $397 a month.

**Recovering one patient a month pays for the entire system. The second one
is profit.**

And your X-Ray said the leak is bigger than two: **${{contact.xray_total_leak}}
a month.** That's the entire business case... your own numbers, doing
arithmetic you can check... every assumption is in
**[your report →]** ({{contact.xray_report_url}}).

The actual system on screen, then decide like a doctor
decides... based on the evidence:

**[Watch the walkthrough →]** (https://omniply.io/walkthrough)

— Veit

P.S. "How much of MY time does this take?" Onboarding reads your website,
your brand, your specialties... the system starts producing in hours. Your
job is roughly: approve things.

---

## EMAIL 6 · Day 10 · type: FAQ #1 (the three questions everyone asks)

**Subject:** "won't AI content sound... robotic?"
**Preview:** The three questions every practice owner asks me.

The three questions I hear most, answered straight:

**"Won't AI content sound robotic? My patients will notice."**

It's trained on YOUR practice: your website, your voice, your specialties.

The content engine knows the difference between a subluxation and a slogan...
and you approve everything before it goes out. What patients actually notice
is a practice that goes quiet for three months.

**"We already have someone doing our socials."**

Good, that's one part of one loop. Posting doesn't answer the 2am call,
doesn't request the review, doesn't notice the patient who faded in March.

The leak isn't in the posting... your X-Ray showed you where it is.

Plus, wouldn't you prefer to do something better with your time than posting
to social media... especially when the content going out on autopilot is
well-researched, factual, and fact-checked?

**"My patients are older. They're not online."**

Their children are. And when Mom's back seizes, the kids do what kids do:
google, read reviews, message three clinics... and book whichever answers first.

Still the same next step, still no call:

**[Watch the walkthrough →]** (https://omniply.io/walkthrough)

— Veit

---

## EMAIL 7 · Day 13 · type: prognosis (benefits)

**Subject:** ninety days into treatment
**Preview:** What actually changes.

Here's what a practice looks like ninety days into treatment:

**+** The 2am back-spasm call answered, and booked, while you're asleep... so
Monday's schedule fills itself before your competitor's front desk even gets in.
**+** A newsletter your patients actually open... written, designed and sent
every week, without you typing a word of it.
**+** Fresh Google reviews arriving quietly every week... the compounding kind
your competitors can't fake and can't catch up to.
**+** Your name coming up when patients ask an AI assistant who they should
see... because the engines finally have something of yours to read.
**+** Patients who "felt fine and faded" getting a reason to come back before
the flare-up... not after they've already googled someone else.
**+** Your name showing up between visits, so when the pain hits, there's no
search... just "call my chiro."
**+** And the one nobody puts on a features list: your evenings back.

**[See it running →]** (https://omniply.io/walkthrough)

— Veit

P.S. Cancel anytime. No setup fees, no lock-in, no salesperson. The prognosis
only holds while the system runs... but that's your call to make monthly, not
a contract's.

---

## EMAIL 8 · Day 17 · type: proof (reviews compound)

**Subject:** the review gap compounds (like interest)
**Preview:** Who owns the Map Pack... and the AI's answer... owns the town.

Reviews compound like interest: invisible week to week, undeniable year to
year.

And fresh reviews are one of the strongest signals that decide who ranks
first and gets the top spot in Google's Map Pack... which is where your next
hundred patients will make their choice. The same board now gets read twice:
when a patient asks an AI assistant instead, it weighs the same reviews to
decide which practice to name. One signal, two juries.

Here's the uncomfortable part: the clinic above you isn't better than you.
It's louder. Every week you ask for reviews "when you remember," their engine
asks every single happy patient... automatically.

That gap doesn't close by itself. It compounds, in one direction or the
other.

**[Watch the Review Engine work →]** (https://omniply.io/walkthrough)

— Veit

P.S. "Do I have to change my booking system?" No. Everything, the AI, the
content, the recall, promotes the booking link you already use.

---

## EMAIL 9 · Day 21 · type: direct ask #2 (cost of waiting)

**Subject:** three weeks ago: ${{contact.xray_total_leak}}/month
**Preview:** Leaks don't pause while we think about them.

Three weeks ago your X-Ray estimated **${{contact.xray_total_leak}} a month**
leaking out of your practice.

Leaks don't pause while we think about them... call it three-quarters of that
number, gone since. Not because you did anything wrong. Because nothing
changed.

The system that changes it sets up in hours, not weeks... and costs less than
recovering one patient:

**[Watch the walkthrough →]** (https://omniply.io/walkthrough)

— Veit

P.S. No contracts, cancel anytime. The only thing that compounds around here
is the leak... or the reviews. Your pick.

---

## SMS 2 · Day 8, midday (only if phone on file)

Quick question {{contact.first_name}} — did the ${{contact.xray_total_leak}}/mo
number in your X-Ray surprise you? (I read replies) — Veit

---

## SMS 3 · Day 22, midday (only if phone on file)

No call, no pressure: omniply.io/walkthrough — the system that plugs the
leak your X-Ray found, on screen... including the receptionist that answers
at 2am. — Veit

---

## EMAIL 10 · Day 26 · type: FAQ #2 (the boring questions)

**Subject:** the boring questions (answered straight)
**Preview:** Booking systems, cancellation, your time, your data.

The practical questions, no spin:

**"Do I have to move my booking or practice software?"**
No. Omniply promotes the booking link you already have. Your PMS stays put.

**"What if I cancel?"**
You cancel. Monthly, no lock-in, no exit fees. Your content stays yours.

**"How much time does it cost me?"**
Onboarding is a guided setup that reads your website and brand... the system
starts producing in hours. After that, your role is approving, not creating.

All in all, 2 hours for a whole month of content.

**"Is my patient data involved?"**
The marketing system runs on your public presence and your booking link. It
doesn't touch clinical records.

That's the fine print. The big print is still your X-Ray:
${{contact.xray_total_leak}} a month, and a $397 fix.

**[Watch the walkthrough →]** (https://omniply.io/walkthrough)

— Veit

---

## EMAIL 11 · Day 30 · type: breakup

**Subject:** closing your file
**Preview:** No hard feelings... one last thing.

{{contact.first_name}}, I'll stop emailing you about your X-Ray after today.

Maybe the timing's wrong. Maybe the leak feels survivable. Both are okay...
it's your practice.

Two things before I close the file:

Your report stays live **[right here →]** ({{contact.xray_report_url}}) — the
numbers in it don't expire. Unfortunately... neither does the leak.

And if a quarter from now the appointment book feels soft and you remember
why, the walkthrough is still there, still no salesperson:

**[Click here →]** (https://omniply.io/walkthrough)

Door's open.

— Veit @ Omniply

P.S. If you've already fixed the leak another way — genuinely, excellent. That was the point of the X-Ray.

---

## After Day 30

Drop to long-term list (monthly cadence, TBD — candidate: one "drift story +
one insight" email per month, same voice). Decision deferred.
