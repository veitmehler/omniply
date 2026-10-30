# Wellness X-Ray Drip — Workflow Paste Sheet

2026-10-30 (wellness-sales-funnel Phase 5). The 11 wellness nurture emails
are LIVE as HTML templates in the marketing location (HsevyaesOdFid7b8KC9q),
created via API from `.documentation/marketing/xray-nurture-sequence-wellness.md`
(built by `email-template/build-emails.js wellness`). This sheet is everything
to wire Veit's duplicated wellness drip workflow in the GHL UI.

## Mechanics (mirror the chiro drip)

- Entry: wellness X-Ray capture (tags `xray-lead` + `vertical - wellness`).
- Exit on purchase: tag `omniply-client` → remove from workflow.
- SMS steps only if phone on file; quiet hours 9:00–19:00 contact-local.
- Every email CTA already points at `omniply.io/walkthrough?v=wellness` —
  nothing to edit inside the templates.

## Email steps — template · subject · preview

| Day | Template (pick in the email step) | Subject | Preview |
|---|---|---|---|
| 0 | Wellness X-Ray Nurture 01 · Day 0 — Your results | `Your X-Ray results ({{contact.first_name}}, the number is inside)` | `Your score, your leak, and the debrief inside.` |
| 1 | Wellness X-Ray Nurture 02 · Day 1 — Clients fade | `Clients don't leave. They fade.` | `The silent leak that drains your center... in one page.` |
| 3 | Wellness X-Ray Nurture 03 · Day 3 — 78% book first answer | `132 million clients just changed how they find you` | `Can an AI assistant even find your center? Plus the wave still hitting your phones.` |
| 5 | Wellness X-Ray Nurture 04 · Day 5 — Saved electricians | `How many electricians are saved in your phone?` | `Likely many, so you always have one to call in an emergency...` |
| 7 | Wellness X-Ray Nurture 05 · Day 7 — The arithmetic | `the arithmetic ($397 vs. one client)` | `No projections. Your numbers.` |
| 10 | Wellness X-Ray Nurture 06 · Day 10 — Robotic? (FAQ) | `"won't AI content sound... robotic?"` | `The three questions every center owner asks me.` |
| 13 | Wellness X-Ray Nurture 07 · Day 13 — Ninety days in | `ninety days in` | `What actually changes.` |
| 17 | Wellness X-Ray Nurture 08 · Day 17 — Review gap compounds | `the review gap compounds (like interest)` | `Who owns the Map Pack... and the AI's answer... owns the town.` |
| 21 | Wellness X-Ray Nurture 09 · Day 21 — Three weeks ago | `three weeks ago: ${{contact.xray_total_leak}}/month` | `Leaks don't pause while we think about them.` |
| 26 | Wellness X-Ray Nurture 10 · Day 26 — Boring questions | `the boring questions (answered straight)` | `Booking systems, cancellation, your time, your data.` |
| 30 | Wellness X-Ray Nurture 11 · Day 30 — Closing your file | `closing your file` | `No hard feelings... one last thing.` |

## SMS steps — paste these bodies

**SMS 1 · Day 1, morning**
```
Veit here (Omniply). Your X-Ray report: {{contact.xray_report_url}}
Worth 3 quiet minutes. The drift number is the one to look at.
```

**SMS 2 · Day 8, midday**
```
Quick question {{contact.first_name}} — did the ${{contact.xray_total_leak}}/mo
number in your X-Ray surprise you? (I read replies) — Veit
```

**SMS 3 · Day 22, midday**
```
No call, no pressure: omniply.io/walkthrough?v=wellness — the system that
plugs the leak your X-Ray found, on screen... including the receptionist
that answers at 2am. — Veit
```

## After wiring

Smoke it: re-send the sample webhook (or run a real wellness X-Ray at
omniply.io/x-ray?v=wellness with a test email) and confirm the Day-0 email
arrives with the right template, subject and working report link.
