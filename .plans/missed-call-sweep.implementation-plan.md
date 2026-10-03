# Missed-Call Sweep: X-Ray + Funnel Repositioning Around the AI Front Desk

**Status: PLANNED — 2026-10-03. User decisions locked: (1) missed-call count
is DERIVED from existing inputs, no new quiz question; (2) sales hero leads
with "How many patient calls did your practice miss this week?"; (3) demo
line on the X-Ray results page = YES, extended to REAL bookings via GHL
calendar integration (today voice only takes callback requests); (4) math
defaults unchanged — quote the study + basis for the numbers on the sales
page. This plan ABSORBS the two deferred pre-launch-todos sweep items
(minute-claim sweep + AI-hook pass, approved 2026-09-25) so the funnel is
touched once, not twice.**

**Thesis.** Every chiro is pitched "AI content" weekly; nobody shows them
the calls they missed this week and answers the next one live. Lead every
surface with the missed-call leak and the AI front desk as its named fix;
the content engine becomes the compounding layer (retention + AI-search
visibility), not the headline.

**What already exists (do not rebuild):** the X-Ray computes a response
leak (inquiries/week × 4.33 × missed-share 5–35% from b1/b2 × 0.6
no-callback loss × 0.6 would-convert × visit fee × 12) in
`apps/web/public/x-ray/index.html` (canonical) + `apps/api/src/marketing/
xray-math.ts` (server port, CI parity test). The results page already has
the "Check our math — adjust any assumption" panel and the
estimates-not-guarantees footer. b1's top answer already names an AI
answering the phone.

---

## Part 1 · X-Ray: surface the call count, reorder the story
**✅ BUILT + DEPLOYED 2026-10-03** — derived `missedCallsWeekly` in both math
implementations (parity-tested), results card leads with the call count +
reframe/softener, HBR basis line in "Check our math", debrief PDF reordered
to match (TEMPLATE_VERSION 4), §2 technology-force AI-search extension,
P14 CTA made minute-AGNOSTIC (no runtime claim to re-sweep later), P15
HBR source line carries the 7×/60× qualification stats. The results CTA
itself had no minute claim. Email rebuild + GHL import still pending at
the end of Parts 1–3 per sequencing.

1. **Derived count** (both math implementations + parity test):
   `missedCallsWeekly = inquiriesWeekly × missedShare(b1,b2)` — display
   `≈ N` (round half-up; `<1` renders "about 1 call most weeks" rather
   than zero — a 5% share still means the occasional lost patient).
   Add to `XrayResult` + the copy builders.
2. **Results page reorder**: lead block becomes the call count, visceral
   and personal ("≈ 6 calls a week nobody answers live"), THEN its dollar
   leak, THEN drift as "and it compounds." Keep the weakest-axis
   personalization, but the money section always opens with calls.
   Softener for strong practices (b1=b2=10): "You're tight — here's what
   the last gap is worth."
3. **Underestimate reframe** (user decision 1): one line under the count —
   "Sound low? Most owners only ever see the missed calls that leave a
   voicemail." Turns self-report skepticism into persuasion.
4. **Citation + basis line** in the "Check our math" panel (see Part 5 for
   exact wording — fact-checkable, no invented stats).
5. **Debrief PDF** (`xray-debrief-template.ts` + static print HTML): same
   reorder + count + citation; **TEMPLATE_VERSION bump**; then the one
   email rebuild + single GHL import (the pre-existing checklist mechanics).
6. **Report §2 technology-force extension** (the deferred AI-hook item):
   the AI-search/GEO force paragraph — same framing as the video's hook.
7. Minute-claims in the X-Ray results CTA (from the absorbed sweep list).

## Part 2 · Sales pages: hero + loop reorder + named fix
**✅ BUILT 2026-10-03** — both heroes lead with the missed-call question
(home generalized to "client calls"), Loop reordered Response→Proof→
Presence→Recall on both pages with the concrete AI-front-desk copy (two
rings, timed callback, 200 voice minutes) + the "not another AI content
tool" contrast, AI-search layer added to the technology force, shared
StatBand source line now carries the full HBR 2011 attribution (7×/60×)
+ adjustable-assumptions basis note, all 12-minute claims made
minute-agnostic (both pages, /walkthrough hero+metadata, master pitch §7,
launch-day restore doc updated so restoration can't revert the sweep —
incl. the punch-line note: ONE render site now, paintLeakCard).

Files: `apps/web/src/app/home/page.tsx`, `apps/web/src/app/chiropractors/
page.tsx`, shared pieces in `components/marketing/Marketing.tsx`.

1. **Hero** (user decision 2): "How many patient calls did your practice
   miss this week?" → sub: each one is a patient someone else booked →
   primary CTA stays the Practice X-Ray ("find your number in 2 minutes").
   Drift narrative ("patients don't leave, they fade") moves to the forces
   section — it remains the umbrella problem, calls become its sharpest
   drain.
2. **Omniply Loop reorder**: Speed-to-Lead/AI front desk first (money this
   week) → Reviews (Maps) → Content/GEO (AI-search visibility — video-hook
   consistent) → Retention (compounding).
3. **Name the fix**: the AI front desk section says what it does in
   concrete terms — answers in two rings, after close and mid-adjustment,
   takes the booking (Part 4) or a timed callback, 200 voice minutes
   included. Explicitly contrast: "not another AI content tool — the
   content engine is what keeps them coming back once the phone is
   answered."
4. **Citation block** (user decision 4): "The basis for our numbers" —
   near the hero claim or X-Ray bridge (exact copy in Part 5).
5. Minute-claim sweep across both pages + pitch §7 + /walkthrough
   hero+metadata (absorbed checklist list).

## Part 3 · Funnel assets (absorbed deferred sweep, re-aimed)

- Nurture email 3: two-wave teach (deferred AI-hook item) reframed to
  missed-calls-now / AI-search-soon.
- Nurture email 7: AI-front-desk bullet.
- Nurture emails 5/6/9/10 + SMS 3: minute-claim corrections.
- X-Ray results-page bridge line → sales page: carries the call-count
  number forward ("your ≈N calls" personalization where the data flows).
- Outreach: stays on the leak hook per earlier decision — adopt the
  call-sharpened wording, no strategy change.
- One GHL email rebuild + import at the END of Parts 1–3 (single import,
  per checklist mechanics).

## Part 4 · Demo line with REAL bookings (product work, user decision 3)

Today: voice takes `request_callback` and texts the booking link. For the
results-page demo line to be the differentiator ("call it — it books you"),
the demo instance books into a GHL calendar live.

**4a · GHL calendar booking capability** (~2–3 days, the substantial piece)
1. `lib/ghl/client.ts`: add Calendars API — `listCalendars`,
   `getFreeSlots(calendarId, range, tz)`, `createAppointment(calendarId,
   contactId, slot)`.
2. New agent action `book_appointment` (voice channel first): engine flow —
   caller asks to book → agent fetches 2–3 nearest free slots (server
   injects them as plain facts, model never invents times) → caller picks →
   confirm name + number (existing known.ts machinery) → action handler
   upserts contact + creates the appointment + confirms aloud.
   Deterministic guard: reject `book_appointment` without a slot-id that
   was actually offered that turn.
3. Config: `agentBookingCalendarId` on the account (Settings field later;
   DB-set for the demo now). Unset → behavior unchanged (callback flow).
4. **Demo hardening**: "Demo Practice" GHL calendar with synthetic
   availability; nightly cleanup cron deletes demo appointments + their
   contacts; per-caller frequency cap + max call duration + daily spend
   alert on the demo account (public phone number on a marketing page WILL
   get abused; EL stays on the demo's own key per standing rule — watch
   its balance).
5. **Google Calendar: via GHL native sync, NOT a direct integration**
   (user decision 2026-10-03). A clinic on Google Calendar connects it to
   their Omniply CRM calendar (GHL's built-in two-way sync) and our single
   GHL booking path covers them — contact record, confirmation SMS,
   workflows, dashboard all intact; no Google OAuth sensitive-scope
   verification tax; consistent with the earlier call that GCal is unfit
   as a PMS/availability layer (one-way, hours-stale iCal). Two additions
   in its place:
   - **Verify item (build gate):** test that `getFreeSlots` actually
     respects synced-Google-Calendar busy times with conflict-checking on
     — it's the linchpin of the "connection for free" claim; test, don't
     assume.
   - **Runbook line:** onboarding docs get "run your schedule in Google
     Calendar? Connect it to your Omniply calendar here" so the path is
     discoverable. Revisit a direct integration only if a real pilot runs
     bookings on raw GCal and refuses the sync.
6. This is also the real product feature ("books them on the spot" becomes
   literal) — client rollout (Settings UI, per-clinic calendars, E2E on a
   pilot) is explicitly POST-demo-line, tracked as its own follow-up.

**4b · Results-page demo block** (~0.25 day, after 4a)
Under their leak number: "Don't take our word — call our demo practice and
watch the AI book you: (555) …" with the number styled as the proof moment.
Page works fine if the line is down (block is static copy).

## Part 5 · The citation (exact, fact-checkable wording)

Quote ONE solid study; everything else is labeled assumption (legal-citation
discipline — no "78% of customers…" orphan stats):

> "A Harvard Business Review study of 1.25 million sales leads found that
> firms contacting a lead within one hour were nearly seven times as
> likely to qualify it as those that waited even an hour longer — and more
> than sixty times as likely as those that waited a day." — Oldroyd,
> McElheran & Elkington, "The Short Life of Online Sales Leads," Harvard
> Business Review, March 2011.

Basis line beneath: "Every other number in this estimate is a stated,
conservative assumption — and you can adjust each one in 'Check our math.'"
Run the fact-checker over the final copy before shipping (same bar as
article citations).

## Non-changes

Quiz questions and order; math defaults (REALIZATION 0.5, NO_CALLBACK_LOSS
0.6, WOULD_CONVERT 0.6, missed-share bands); outreach strategy; the demo
video (its GEO-first hook is consistent — content force stays third in the
loop, exactly where the video deepens it).

## Sequencing

| Order | Work | Size | Gate |
|---|---|---|---|
| 1 | Part 1 (X-Ray math surface + reorder + PDF + version bump) | ~1 day | parity test green |
| 2 | Part 2 + 3 copy (sales pages, nurtures, minute-claims) | ~1 day | fact-check pass on citation copy |
| 3 | Email rebuild + single GHL import | ops, once | after 1–2 |
| 4 | Part 4a booking capability + demo hardening | ~2–3 days | demo E2E call books successfully |
| 5 | Part 4b demo block on results page | ~0.25 day | after 4a |

Interplay with filming: Part 4a touches the demo voice instance — land it
AFTER the Scene 11 call is recorded (or film first; the callback flow being
replaced by booking on the demo is exactly the kind of mid-filming change
that burned us before). Sales-page changes sit behind the launch gate until
the flip; the X-Ray funnel is live, so Parts 1/3 ship when ready.
