# Pre-Launch Waitlist — implementation plan

**Status: CODE SIDE IMPLEMENTED + DEPLOYED both envs 2026-08-07 (c525d43/ef5264e): P1 gate, P2 block+endpoints (live-verified: join ok, tags applied), P3 promo enabled on Azavea (tag gWUF1AO8a7tPalVjzOcu, from 'Veit @ Omniply' <azavea@azavea.ai>, azavea step-32 override seeded). REMAINING: P4 GHL workflows (user, copy below), azavea.ai sending-domain verification (user), spot count decision. Original decisions:** (1) founding cohort =
Do It WITH You concierge onboarding + locked founders price; (2) HARD gate on
checkout until launch; (3) weekly nurture = the existing per-article promo
email machinery pointed at the waitlist tag.**

Launch date: **September 22, 2026** (FINAL — moved from Sept 8→15→22; last sweep 2026-09-10) (single source of truth: `LAUNCH_DATE`
env, default `2026-09-22T14:00:00Z` ≈ 9am ET; flipping the date flips every
gate — no deploy-day scramble).

---

## P1 · Launch gate (code, small)

Date-based, no flag infrastructure: a shared `isPrelaunch()` helper in the
marketing components reads `LAUNCH_DATE` (env override for slips). Applied
to:

- **/chiropractors**: every checkout CTA swaps to the founding-list CTA; a
  slim banner above the pricing section: "Doors open September 22. The
  founding cohort list is open now." Price stays visible (anchoring works
  pre-launch).
- **/home** pricing mentions: same CTA swap.
- **X-Ray report surface**: the post-quiz CTA becomes the waitlist block
  (P2).

Post-launch: the date passes, checkout returns automatically.

## P2 · Quiz-results waitlist block (code, small)

We already hold the email at report time — the join must be ONE CLICK, no
form:

- Results/report page block (under the leak number):
  > **Omniply opens September 22.**
  > Your X-Ray just showed you the leaks. The founding cohort gets them
  > fixed first: we onboard your practice WITH you, live and step by step,
  > and your founders price is locked in from day one. Limited spots, then
  > the doors close until launch.
  > **[Reserve my founding spot]**
  > One click. We already have your report on file.
- Button → `POST /api/marketing/waitlist` (new endpoint next to the contact
  one): applies tags `prelaunch-waitlist` + `founding-cohort` to the
  existing Azavea-location contact (upsert by email as fallback). Honeypot +
  rate limit like the contact endpoint.
- The report **email** gains the same CTA paragraph + link (deep link that
  triggers the same join, token-signed so it's one click from email too).

## P3 · Nurture = the machine we already run (config + one vertical prompt)

- Enable **promo emails** on the Azavea account (`promoEmailEnabled`,
  `promoEmailTagName: prelaunch-waitlist`, from `Veit from Azavea
  <team@azavea.ai>`) → every published cadence article automatically sends
  a promo email to the waitlist. Zero new pipeline.
- Add an **azavea-vertical override** for the promo-email prompt (the
  vertical system exists for exactly this): B2B tone, practice-owner
  framing, one line of founders-cohort reinforcement in the footer.
- Cadence note: MWF articles = 3 emails/week. For a warm founders list over
  a single month that intensity is defensible; if it feels hot, the
  fallback is a Mondays-only gate (small azavea-gated condition where promo
  enqueues). Start at 3/week, watch unsubscribes.

## P4 · GHL workflows (Azavea location only, ~30 min user config)

- **W1 "Waitlist Confirmation"** — trigger: tag `prelaunch-waitlist` added →
  send email:
  - Subject: `You're on the founding list`
  - Body:
    > Hi {{contact.first_name}},
    >
    > You're in. Here's what that means.
    >
    > When Omniply opens on September 22, you go first. We onboard your
    > practice WITH you... a live working session where we set up your
    > voice, your calendar and your first month of content together. You
    > learn the system while it's being built for you, and nothing ships
    > without your approval.
    >
    > Your founders price is locked from day one, for as long as you stay.
    >
    > Between now and launch, about once a week you'll get the best of what
    > our own marketing engine publishes. It's the same engine you'll be
    > getting. Judge us by it.
    >
    > Veit
    > Azavea Inc. ... the team behind Omniply
- **W2 "Launch Blast"** — built now, kept OFF until Sept 22. Three emails:
  1. Sept 22: "Doors are open" + personal checkout link + founders terms
     restated.
  2. Sept 24: "Your founding spot is still held" reminder w/ scarcity count.
  3. Sept 26: final call, spots close.
- Comment-funnel touch (5 min): append to "Send Info 1" copy:
  > One thing to know: doors open September 22. The founding cohort gets
  > onboarded personally and keeps the founders price. The page explains
  > how to reserve a spot.

## P5 · Docs + timeline

- `pre-launch-todos.md`: Sept 22 = launch day → implies freeze week ≈ Sept 15
  to 5 — **user must sanity-check against the vacation plan before the date
  appears in public copy.**
- Founders-cohort spot count: recommend committing to a number publicly
  (e.g. 20, matched to concierge capacity) — scarcity that is true. USER
  DECISION before copy finalizes; plan uses "limited spots" until then.

## P6 · Test checklist

1. Quiz → report → one-click join → tags on contact → W1 email arrives.
2. Email deep-link join works from a cold client.
3. /chiropractors shows gate + founding CTA; with `LAUNCH_DATE` overridden
   to the past, checkout returns.
4. Publish next cadence article → promo email reaches a waitlist test
   contact, tone correct (vertical override active).
5. Funnel "Send Info" branch lands on the gated page coherently.

## Build order

1. P1 gate + P2 block/endpoint (one session, deploy both envs).
2. P3 promo enable + vertical prompt override (config + seed row).
3. P4 workflows (user, from this doc's copy).
4. P6 tests, then social promotion can start safely.

Open items: spot count (user), freeze-week/vacation date check (user),
sending-domain verification for team@azavea.ai (shared with the comment
funnel's email step).
