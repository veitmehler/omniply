# Wellness Sales Funnel — Implementation Plan

2026-10-29, locked with Veit. Goal: a self-serve sales funnel for the
**wellness vertical** plus a warm-pipeline one-pager, reusing the proven
chiro machinery. Decisions already made:

- **Naming:** "Wellness & Longevity Centers" (never "recovery" as the
  category — reads as rehab in the US; "clinic" avoided as headline word —
  medical-claims adjacency). Enumeration line covers self-identification:
  HBOT/IV lounges, cold-plunge & sauna studios, massage & bodywork,
  longevity clinics.
- **Angle hierarchy unchanged:** AI-booking first, missed calls second,
  reviews-as-AI-visibility third. WhatsApp/multilingual = feature bullet,
  NOT the lead (US market is not WhatsApp-heavy).
- **Pricing:** $397/month, same as chiro.
- **Demo video:** reuse the chiro walkthrough as-is (process is the same).
- **Homepage:** full rewrite to a niche-agnostic overview (no chiro pitch —
  chiro traffic is sent straight to /chiropractors anyway).
- **X-Ray:** ONE entry with a segmentation question (nav links to the X-Ray,
  so separate per-vertical entry links don't work).
- **Primary market:** US.

X-Ray audit result (2026-10-29): `xray-math.ts` and `xray-report.ts` carry
ZERO chiro wording — the engine is vertical-neutral. All chiro copy sits in
`xray-debrief-template.ts` (9 chiro mentions in 503 lines, in the pitch
sections ~312–496, plus 24× "patient") and in the marketing pages. This is
a parameterization job, not a duplication.

---

## Phase 0 — Prerequisites (Veit, GHL UI — can run parallel to all builds)

- Wellness SaaS plan: points at the refreshed wellness snapshot, priced
  $397/month (replaces the $10/30d pilot config). Capture the plan's
  checkout/payment link — it is the funnel's terminus and Phase 2/5 need it.
- Glance at the chiro plan → snapshot link while in there.
- (Independent, already tracked: Dasha domain fix, PDF approvals, funnel
  E2E — blockers for *selling with proof*, not for building.)

## Phase 1 — Warm-pipeline one-pager (first deliverable; placeholder NOW)

- A single forwardable page for named owners in Dasha's network: her story,
  three result slots (PLACEHOLDER until pilot metrics accumulate: after-hours
  conversations answered, appointments booked by the assistant, languages
  served), what Omniply does (angle order), $397/month, two CTAs: book a
  15-min demo call + direct checkout.
- Format now: hosted artifact page (private link, placeholder metrics marked).
  Later: omniply.io-hosted page or PDF export once copy stabilizes.
- OPEN: whose calendar takes the demo-call booking (Veit link TBD); checkout
  link lands when Phase 0 does; Dasha's sign-off to be named + screenshot
  permission.
- Placeholder copy: see Appendix A (drafted 2026-10-29, artifact published).

## Phase 2 — X-Ray vertical parameterization (apps/api + apps/web)

1. **Entry question** on the X-Ray form: "What kind of practice do you run?"
   → `chiropractic` | `wellness` ("Wellness & longevity center") | `other`
   (with a free-text "tell us what you do" field).
2. **Thread `vertical`** through scan request → `routes/xray-report.ts` →
   `xray-debrief-template.ts`: tokenize the ~9 chiro pitch lines +
   patient→client/guest wording ({practiceType}, {peopleWord}, conditional
   pitch paragraphs). `xray-math.ts` untouched.
3. **Chiro regression guard:** snapshot the chiro debrief output BEFORE the
   refactor; assert byte-identical AFTER (unit test fixture).
4. **`other` path:** neutral wording variant of the debrief; store the free
   text; tag `xray-other` — this is the vertical-#3 demand-signal list.
5. **Drip tag:** the GHL contact created by the X-Ray gets `xray-chiro` /
   `xray-wellness` / `xray-other` (today's tag stays for chiro backward-compat
   if the drip keys on it — verify before renaming anything).
6. **Checkout routing:** debrief CTA + drip merge fields resolve the
   vertical-correct SaaS payment link (new config: wellness checkout URL
   beside the existing chiro one). Same $397 price masks this from the buyer;
   the plan→snapshot linkage makes it provisioning-critical.
7. Static X-Ray PDF (outreach asset): wellness variant deferred to Phase 6
   unless trivial after tokenization.

## Phase 3 — /wellness landing page (apps/web)

- New route `/wellness`: "Omniply for Wellness & Longevity Centers".
  Same angle hierarchy as /chiropractors; enumeration line under the hero;
  multilingual receptionist as a secondary feature bullet ("serves
  international guests in five languages"); chiro walkthrough video embedded
  as-is; X-Ray CTA with `vertical=wellness` preselected; $397 pricing block →
  wellness checkout.
- Wording register: clients/guests, sessions, studios — never patients.
- Screenshots: demo-account captures to start; swap to Whealth captures when
  Dasha approves (whitelabel rule applies: no GHL naming/URL bars).
- SEO: title/meta/OG, sitemap entry.

## Phase 4 — Homepage rewrite (niche-agnostic overview)

- Hero: category-agnostic promise on the same angle (AI receptionist that
  books real appointments + done-for-you content, for appointment-based
  health & wellness businesses). No chiro pitch anywhere above the fold.
- Two vertical cards: "For Chiropractors" → /chiropractors, "For Wellness &
  Longevity Centers" → /wellness, each with one vertical-true proof point.
- Keep: walkthrough video, X-Ray CTA (now → segmented entry), $397 pricing,
  LAUNCH_TS gating behavior, founding/notify component decision (OPEN:
  does "founding member" framing extend to wellness?).
- HARD CONSTRAINTS: every URL/anchor referenced by the live chiro nurture
  drip and nav keeps working (inventory the drip links before touching
  anchors); /chiropractors absorbs any chiro-specific homepage copy worth
  keeping; no SEO regressions on the home route.

## Phase 5 — Wellness 30-day nurture drip (marketing GHL)

- Re-skin the chiro X-Ray drip (11 emails + 3 SMS, days 0–30, purchase-exit)
  on the same angle with wellness wording and the wellness checkout link.
- Generation via the proven template API pipeline (as with the lead-gen
  emails); import into the marketing GHL location as a parallel workflow
  keyed on `xray-wellness` (or one workflow with a vertical branch — Veit's
  call in the GHL UI).
- Veit UI: wire templates to steps, set entry trigger, activate.

## Phase 6 — US outreach kit

- Target-list criteria + sourcing: Places/Maps categories (wellness center,
  IV therapy, cryotherapy, hyperbaric, cold plunge, longevity clinic);
  US metros + tourist markets first.
- Cold email/DM copy on the angle, linking the X-Ray with wellness
  preselected; static PDF variant if Phase 2 made it cheap.
- Dasha warm-intro motion: one-pager + a 3-sentence intro script she can
  paste.

## Phase 7 — Verification

- Chiro regression: homepage conversion path click-through, chiro X-Ray
  debrief byte-identical, chiro drip untouched, all drip-referenced URLs 200.
- Wellness E2E: /wellness → X-Ray (wellness) → debrief wording → `xray-wellness`
  tag → drip entry → checkout link opens the WELLNESS SaaS plan.
  Full test purchase on the wellness plan = optional capstone (Elena-pattern
  test clinic) once Phase 0 pricing is set.
- Other-path: free text stored, `xray-other` tagged, neutral debrief renders.

## Sequence & effort

1 (one-pager placeholder, done with this plan) → 2 (X-Ray param, ~1 day) →
3 (/wellness page, ~1 day) → 4 (homepage, ~1 day careful) → 5 (drip,
~1 day + Veit GHL session) → 6 (outreach kit, ~half day) → 7 (verification,
~half day). Phase 0 parallel (Veit). Total ≈ one working week.

## Decisions (resolved 2026-10-29 unless noted)

- Demo-call booking link: RESOLVED 2026-10-29 — the /walkthrough page's
  "Book a 15-minute consultation" popover already embeds a live GHL calendar:
  **https://links.omniply.io/widget/booking/71yY77QNTMNPtHYvqAXl** (marketing
  location HsevyaesOdFid7b8KC9q; deep link /walkthrough?consult=1 auto-opens
  the modal). A reported "not loading" turned out to be a client-side
  connectivity blip — widget, DNS and embed verified healthy. One-pager CTA
  wired to the widget URL.
- Dasha case study/screenshots/referral terms: Veit discusses at their
  meeting (OPEN until then; one-pager placeholders stay).
- "Founding member" framing: YES, extends to wellness — /wellness and the
  homepage keep the founding component; one-pager may reference founding
  terms once wording is confirmed.
- Drip import: via API (the proven template pipeline), not manual.

---

## Appendix A — One-pager placeholder copy (v0, 2026-10-29)

Headline: **Your front desk never sleeps.**
Sub: Omniply gives wellness & longevity centers an AI receptionist that
books real appointments around the clock — plus done-for-you articles,
newsletters and social content that keep your calendar full.

Body blocks:
1. "Recommended to you by someone who runs on it." — referral framing line.
2. What you get: 24/7 AI receptionist on your real calendars (chat + phone);
   missed calls answered and booked; weekly articles + newsletters + social,
   written for your services; a reviews engine that builds the reputation AI
   assistants recommend.
3. Case study slot (PLACEHOLDER): "At Whealth Recovery Center in Cabarete,
   the assistant answered {N} conversations outside opening hours and booked
   {N} sessions in its first {N} weeks — in {5} languages." [replace with
   panel metrics; Dasha sign-off required]
4. How it starts: one 15-minute call → we build everything within a week →
   it runs itself, you approve content from your phone.
5. Pricing: $397/month. No contracts. [confirm terms wording]
6. CTAs: **Book a 15-minute demo** [LINK TBD] · **Start today** [wellness
   checkout link, Phase 0].
Footer: omniply.io · built for wellness & longevity centers.
(Whitelabel rule: never name GoHighLevel anywhere on this page.)
