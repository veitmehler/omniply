# AI-Angle Copy Sweep + X-Ray AI-Inquiry Metric — Implementation Plan

Status: PLANNED 2026-10-09 (Friday). Implement: start Friday with Veit, finish Monday Oct 12. Freeze-safe: marketing surfaces only, no product code paths.

## The hierarchy (non-negotiable, runbook §angle)

1. **AI assistants will book appointments soon — be the practice they find** (THE lead everywhere)
2. Missed calls, quantified (second)
3. Google reviews = visibility to people AND AI (third)

**Big Idea, LOCKED VERBATIM (Veit 2026-10-09):**

> 132 million Americans now use AI assistants to research and compare before they book. So when a patient asks one about a chiro in your town... can it even find you? If you don't know the answer... probably not. And if an AI assistant can't understand your website, or talk to it, it will simply book the next practice down the road.

Ladder: **find → understand → talk → book** (maps 1:1 to product: Presence/Proof → schema+content → chat/voice agent → direct booking).

Citations (keep in source lines wherever stats render):
- Adyen Retail Report 2026 — 132M Americans; 42–51% of online shoppers research via AI
- Visa / Finextra — 25% use AI assistants daily, 72% have used them
- Existing triplet stays (HBR / InsideSales / Lead Connect: 78% / 100× / 2 days) — demoted to the missed-call section

## Part A — The X-Ray AI-inquiry metric

### Design decisions (confirm with Veit before implementing)

1. **No 13th question.** "12 questions · 2 minutes" is baked into the title tag, meta, chips, CTA subs, outreach, and nurture email 01. Instead, **derive AI-visibility from existing signals** — exactly what our own copy already claims: "the answer engines read the same signals: reviews, real content, responsiveness." Use the existing axis scores (reviews axis + content/presence axis, 0–10 each) to produce `aiVisibilityShare` (how much of AI-researched demand can even find/understand the practice).
2. **Separate projection, NOT folded into `totalLeak`.** The missed-call dollar is defensible arithmetic from the practice's own answers; the AI figure is a stated, adjustable projection. Folding them would let a skeptic discredit the whole number. Render it as its own line/card: "the AI-era projection", with its own adjustable slider and its own source line.

### Formula

```
AI_RESEARCH_SHARE = 0.22        // conservative default (Adyen 42–51% of shoppers, Visa 25% daily → we use ~22%), SLIDER-ADJUSTABLE 10–50%
aiResearchedWeekly = inquiriesWeekly × AI_RESEARCH_SHARE
aiInvisibleShare   = 1 − aiVisibilityShare(reviewsAxis, contentAxis)   // 0.85 at score 0 … 0.15 at score 20 (never 0/1 — honest bounds)
aiLeakMonthly      = aiResearchedWeekly × WEEKS_PER_MONTH × aiInvisibleShare × WOULD_CONVERT × firstYearValue
```

Reuses existing CONFIG (`WEEKS_PER_MONTH 4.33`, `WOULD_CONVERT 0.6`, `firstYearValue` from visitFee × FIRST_YEAR_VISITS). New constants: `AI_RESEARCH_SHARE: 0.22`, `AI_INVISIBLE_MAX: 0.85`, `AI_INVISIBLE_MIN: 0.15`.

Framing rule: ALWAYS "projection", "if the trend holds", adjustable — NEVER a measured fact. Copy pattern: "Of your ~N weekly inquiries, an estimated X now start inside an AI assistant. At your current visibility score, most of those never reach your phone at all — a projected **$Y/month** that no missed-call log will ever show you."

### Implementation sites (parity-tested pair + renderers)

| File | Change |
|---|---|
| `apps/web/public/x-ray/index.html` :374–488 math block | new constants + `aiLeak()` in `compute()`; keep inside `__XRAY_MATH_START__` markers |
| `apps/api/src/marketing/xray-math.ts` | identical port; extend `XrayResult` (+`aiResearchedWeekly`, `aiLeakMonthly`, `aiVisibilityShare`) |
| both parity tests (`xray-math.parity.test.ts`, web `xray-math.test.ts`) | new cases incl. bounds (score 0, score 20) |
| `index.html` `paintLeakCard`/`ASSUMPTIONS` (:817, :852) | AI projection line + "Patients who research via AI" slider + Adyen/Visa source line in the "Check our math" details |
| `index.html` `verdictText` + `xray-math.ts` `verdictHtml` | `reviews` verdict gains the AI-visibility sentence (both copies, identical strings) |
| `xray-debrief-template.ts` + `routes/xray-report.ts` | AI projection in P2 leak card; bump `TEMPLATE_VERSION` 4→5 |

## Part B — Copy sweep, surface by surface

Order of work: **master pitch doc first** (voice source of truth: `.documentation/marketing/practice-treatment-plan-master-pitch.md` §2 forces + :51–53 stat triplet), then downstream.

### Friday (with Veit, after test purchase)

1. **Master pitch doc** — re-order the three forces: AI layer becomes Force 01's opening (currently its tail); add 132M/Adyen/Visa to the stat block.
2. **Metric** (Part A complete, tests green).
3. **Both heroes:**
   - `home/page.tsx` — H1 derived from Big Idea (AI-booking lead); missed-call H1 "How many client calls…" demoted to section 2 lead-in; description/meta updated; Loop copy: Presence line leads with AI assistants.
   - `chiropractors/page.tsx` — same H1 treatment (Big Idea near-verbatim is the natural long-form open); the `{/* Hook: missed calls */}` comment block becomes `{/* Hook: AI booking }`; three-forces section re-ordered (AI first, verbatim ladder find→understand→talk→book); reviews section (:219 map-pack) gains "visible to people AND AI"; FAQ gains one AI-discoverability entry; CTA subs keep missed-calls mention but add "and whether an AI assistant can find you".
   - `Marketing.tsx` `StatBand` — add **132M** stat (Adyen) as the first stat, or a second two-stat AI band above the triplet; sources line extended.
4. **X-Ray landing** (`public/x-ray/index.html` :255–263) — keep the X-ray metaphor (funnel identity), weave the angle into tagline + add a chip or sub-line: the scan now also shows "whether AI assistants can find you". Results screen: AI projection card (Part A). Founding PITCH update if needed (×3 files, identical string).

### Monday Oct 12

5. **Debrief template** — Force 01 re-ordered (AI paragraph leads), leak card + projection, stat band gains 132M, sources updated, TEMPLATE_VERSION 5. Decide: regenerate or retire the stale `.documentation/marketing/xray-debrief-print.html` + `public/x-ray/X-Ray-Debrief.pdf` (Aug 4, pre-AI copy).
6. **Walkthrough page** — sub-copy echoes the hook ("the system that makes you the practice AI assistants can find, understand, talk to, and book"); **chapter order fixed** to match video v2: Speed-to-Lead/AI first if that's the video's order (confirm against final v2 edit before changing).
7. **Nurture emails** — edit `xray-nurture-sequence.md`: email 03 flips to AI-first (78% becomes its second beat); email 08 reviews gains AI-visibility framing; rebuild via `build-emails.js`; **re-push changed templates via fresh PI key (delete key after)** — template IDs in transcript, update-in-place via `/emails/builder/data`.
8. **About page** — four-systems order aligned (response → proof → presence → recall, AI mention in presence).
9. **`launch-day-copy-restore.md`** — re-base every verbatim snippet on the new copy (CRITICAL: Tuesday's launch commit applies these on top; stale snippets would revert the sweep).
10. **azavea.ai rebuild** — carries the angle natively (already scheduled Monday).
11. **Delete the stale orphan** `apps/web/src/app/page.tsx` (old Lever-Cast page, never served on marketing hosts) — confirm with Veit.

### Explicitly OUT of scope
- Spine Check + linktree (patient-facing, no angle copy — confirmed clean)
- Legal/data-security pages
- Outreach docs (`xray-outreach.md`) — launch-week rework per runbook
- Video script itself (video v2 is Veit's edit; chapters on the page follow it)

## Guardrails

- **Triplicated strings:** founding PITCH ×3 (FoundingNotify.tsx:19, x-ray :361, walkthrough :102); verdict/phrase builders ×2 (browser+server, parity-tested); Loop blurbs ×2 heroes + PDF + master pitch. Grep each string before and after editing.
- **LAUNCH_TS gates untouched** (x-ray :921, walkthrough :125, FoundingNotify :15 — stay 2099 until the Tuesday launch commit).
- **White-label:** no GHL/LeadConnector in any new copy (grep sweep before push).
- **"12 questions · 2 minutes" stays true** — no new quiz question.
- Math edits stay inside the `__XRAY_MATH_START__/END__` markers; parity tests must pass in both packages.
