# Wellness nurture: drag-and-drop paste sheet

The six nurture emails, final copy (resilience rework 2026-10-26: new
guide titles + the Body Resilience Score), laid out block-by-block to
match Veit's approved sample ("DND probe (delete me)" layout: greeting,
context line, link line, closing lines, signature).

**Build procedure** (API cloning of drag-and-drop templates is impossible,
internal scope): in the email builder, duplicate the approved sample 5
times (three dots > Duplicate), rename all six as below, paste each
template's text into its blocks, then attach the trigger link to each
"Click here" line (select the text > link tool > Trigger Links). Finally
DELETE the six old HTML templates ("Guide delivery - ..." and
"Nurture day ...") so the library has exactly one set.

The four delivery emails reuse Veit's sample copy verbatim with only the
guide title swapped. Days 1 and 4 use the same layout with the copy below.

---

## 1. Guide delivery: Bounce Back Stronger
- Template name: `Guide delivery - Bounce Back Stronger`
- Subject: `Your guide is here, {{contact.first_name}}`
- Preview: `Bounce Back Stronger, picked for your weakest input.`
- Trigger link on "Click here <-- to access the guide":
  `omniply-guide-everyday-strength-guide`
- Trigger link on "Click here <-- to schedule an appointment":
  `omniply-booking`
- Body: Veit's sample verbatim, guide title: **Bounce Back Stronger**

## 2. Guide delivery: The Sleep Upgrade
- Template name: `Guide delivery - The Sleep Upgrade`
- Subject: `Your guide is here, {{contact.first_name}}`
- Preview: `The Sleep Upgrade, picked for your weakest input.`
- Guide trigger link: `omniply-guide-better-sleep-guide`
- Booking trigger link: `omniply-booking`
- Body: sample verbatim, guide title: **The Sleep Upgrade**

## 3. Guide delivery: The Deep Rest Protocol
- Template name: `Guide delivery - The Deep Rest Protocol`
- Subject: `Your guide is here, {{contact.first_name}}`
- Preview: `The Deep Rest Protocol, picked for your weakest input.`
- Guide trigger link: `omniply-guide-switch-off-guide`
- Booking trigger link: `omniply-booking`
- Body: sample verbatim, guide title: **The Deep Rest Protocol**

## 4. Guide delivery: The Invisible Fuel Layer
- Template name: `Guide delivery - The Invisible Fuel Layer`
- Subject: `Your guide is here, {{contact.first_name}}`
- Preview: `The Invisible Fuel Layer, picked for your weakest input.`
- Guide trigger link: `omniply-guide-everyday-fuel-guide`
- Booking trigger link: `omniply-booking`
- Body: sample verbatim, guide title: **The Invisible Fuel Layer**

---

## 5. Nurture day 1
- Template name: `Nurture day 1 - Did your guide land`
- Subject: `Did your guide land, {{contact.first_name}}?`
- Preview: `One small change this week beats ten intentions.`
- Send: 1 day after the delivery email
- ONE trigger link only, on the schedule line: `omniply-booking`
  (never link the guide here; the lead already has it)

Body blocks:

> Hi {{contact.first_name}},
>
> Yesterday you got your Body Resilience Score and one of our guides.
> Quick question: did you get a chance to open it yet?
>
> If not, no guilt. It is sitting in your inbox, and it will still be
> there tonight. Here is the one thing we would point you to: skip
> straight to the section about your weakest input, and pick a single
> change from it. Not the whole guide. One change, for one week.
>
> That is genuinely how this works. The people whose scores climb month
> after month almost never overhauled their lives. They changed one
> small thing, kept it, and then changed the next one.
>
> And if you would rather have someone map that first change with you,
> that is exactly what we do all day:
>
> Click here <-- to schedule a visit.
>
> Talk soon,
>
> {{user.email_signature}}

## 6. Nurture day 4
- Template name: `Nurture day 4 - The input most people pick wrong`
- Subject: `The input most people pick wrong`
- Preview: `Your Score already told you where to start.`
- Send: 3 days after day 1 (day 4 overall)
- ONE trigger link only: `omniply-booking`

Body blocks:

> Hi {{contact.first_name}},
>
> A pattern we see all the time: someone gets their Body Resilience
> Score, sees their weakest input, and then starts working on a
> different one. The runner with the ragged sleep schedule signs up for
> more running. The exhausted professional with zero downtime buys new
> running shoes.
>
> It makes sense. We all prefer the input we are already good at.
>
> But the biggest gains almost always hide in the input you have been
> avoiding, and the first step there is usually smaller than you think.
> One recovery session. A fixed wake time. One protected evening. A
> real test instead of another supplement.
>
> If you want a second pair of eyes on it, bring your Score to us:
>
> Click here <-- to schedule a visit.
>
> We will walk through your week as it actually is, and build the
> smallest routine that moves your weakest input. No overhauls, no
> lectures.
>
> Whenever you are ready,
>
> {{user.email_signature}}
>
> P.S. You can simply reply to this email with a question. A real
> person reads these.

---

## Workflow wiring reminder (checklist Edit 4)
- Trigger: Contact Tag Added, OR across the four `leadgen-*-guide` tags;
  branch on which tag; one delivery template per branch.
- Waits: 1 day to the day-1 email, 3 more days to day 4.
- End: Opportunity in "New Client" / "New lead", source "Resilience
  Score". Exits: appointment tag / stage moved.
