# Wellness snapshot: lead nurture workflow + copy

The wellness vertical's mirror of the chiro snapshot's ONE nurture workflow
(ghl-snapshot-guide.md item 4, simplified 2026-07-28). Same hard rules:

- **Trigger:** Contact Tag Added, OR-filtered across the four wellness guide
  tags: `leadgen-everyday-strength-guide`, `leadgen-better-sleep-guide`,
  `leadgen-switch-off-guide`, `leadgen-everyday-fuel-guide`.
  (The Age Check capture applies the matched guide tag + `age-check-lead`;
  the guide tag is the drip selector, exactly like `spine-check-lead`.)
- **Email 0 DELIVERS the guide** via the per-guide `omniply-guide-<slug>`
  trigger link (the 2026-07-29 trigger-link design: compile repoints these at
  every regeneration, so drip links survive rotation and clicks are tracked).
  The workflow branches on WHICH guide tag landed, one delivery email per
  branch. (Note: the chiro snapshot guide's older "emails never link the
  document" line was superseded by this trigger-link swap — corrected here.)
- **Follow-up emails (1 and 2) never link the document** — by then the lead
  has it; their CTAs use the `omniply-booking` trigger link (repointed per
  clinic at provisioning) + built-in location merge fields only. NO
  per-clinic edits, NO per-document custom values.
- **End step:** create Opportunity in the New Client pipeline (wellness
  naming: "New Client", not "New Patient").
- **Timing:** Email 1 after a 1-day delay, Email 2 after a further 3 days.
- De-AI rule applies: no em/en dashes anywhere in subjects or bodies.
- Claims policy applies: recovery/wellness SUPPORT language, no outcome
  promises, no condition claims.

---

## Email 0 — guide delivery (send immediately on tag)

One branch per guide tag; the four bodies are identical except the guide
name and trigger link. Template below; per-branch values in the table.

**Subject:** Your guide is here, {{contact.first_name}}

**Preview text:** {{GUIDE TITLE}}, picked for your weakest pillar.

**Body:**

Hi {{contact.first_name}},

Thanks for taking the Biological Age Check. Based on your answers, the
pillar with the most easy ground to gain is the one this guide covers, so
here it is:

[Read {{GUIDE TITLE}}] <- omniply-guide-{{slug}} trigger link

It is a short, practical read: no rules you will hate, just the handful of
habits that move this pillar, and the smallest version of each one.

If anything in it raises a question, just reply to this email. A real
person at {{location.name}} reads these.

Enjoy the read,
The team at {{location.name}}

| Branch tag | {{GUIDE TITLE}} | Trigger link |
|---|---|---|
| leadgen-everyday-strength-guide | Everyday Strength | omniply-guide-everyday-strength-guide |
| leadgen-better-sleep-guide | Better Sleep, Night After Night | omniply-guide-better-sleep-guide |
| leadgen-switch-off-guide | The Art of Switching Off | omniply-guide-switch-off-guide |
| leadgen-everyday-fuel-guide | Everyday Fuel | omniply-guide-everyday-fuel-guide |

---

## Comment-keyword vocabulary (workflows 3+, mirrors chiro's keyword table)

DM replies send the asset's trigger link; public reply: "Just sent it to
your DMs!"

| Keyword | Asset | Trigger link |
|---|---|---|
| AGE | Biological Age Check | omniply-spine-check (quiz link; vertical-aware repoint) |
| STRONG | Everyday Strength | omniply-guide-everyday-strength-guide |
| SLEEP | Better Sleep, Night After Night | omniply-guide-better-sleep-guide |
| UNWIND | The Art of Switching Off | omniply-guide-switch-off-guide |
| FUEL | Everyday Fuel | omniply-guide-everyday-fuel-guide |

---

## Email 1 — send day 1 (24h after tag)

**Subject:** Did your guide land, {{contact.first_name}}?

**Preview text:** One small habit this week beats ten intentions.

**Body:**

Hi {{contact.first_name}},

Yesterday you took the Biological Age Check and picked up one of our guides.
Quick question: did you get a chance to open it yet?

If not, no guilt. It is sitting in your inbox from us, and it will still be
there tonight. Here is the one thing we would point you to: skip straight to
the section that matched your weakest pillar, and pick a single habit from
it. Not the whole guide. One habit, for one week.

That is genuinely how this works. The people we see feeling better month
after month almost never overhauled their lives. They changed one small
thing, kept it, and then changed the next one.

And if you would rather have someone map that first step with you, that is
exactly what we do all day at {{location.name}}. A first visit is relaxed:
we talk through how you move, sleep, unwind and fuel up, and you leave with
a plan that fits your actual week.

[Book your visit] <- omniply-booking trigger link

Talk soon,
The team at {{location.name}}

---

## Email 2 — send day 4

**Subject:** The pillar most people pick wrong

**Preview text:** Your result already told you where to start.

**Body:**

Hi {{contact.first_name}},

A pattern we see all the time: someone takes the Biological Age Check,
sees their weakest pillar, and then starts working on a different one. The
runner with the ragged sleep schedule signs up for more running. The
exhausted professional with zero downtime buys a new mattress.

It makes sense. We all prefer the pillar we are already good at.

But the biggest gains almost always hide in the pillar you have been
avoiding, and the first step there is usually smaller than you think. Ten
minutes of strength. A fixed wake time. One protected evening. A real
lunch away from the screen.

If you want a second pair of eyes on it, bring your result to us. At
{{location.name}} we will walk through your week as it actually is, not as
an app thinks it should be, and build the smallest routine that moves your
weakest pillar. No overhauls, no lectures.

[Book your visit] <- omniply-booking trigger link

Whenever you are ready,
The team at {{location.name}}

P.S. You can simply reply to this email with a question. A real person
reads these.

---

## Workflow end

- Add Opportunity: pipeline "New Client", stage "New lead", source
  "Age Check".
- Exit on: appointment booked (appointment tag) or opportunity stage moved,
  mirroring the chiro workflow's exit behavior.
