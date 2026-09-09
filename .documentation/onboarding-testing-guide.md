# Onboarding E2E Testing Guide — Marketplace App Build + Full Walkthrough

Everything needed to test the GHL-embedded chat onboarding end to end (Phase 8 of
`.plans/ghl-onboarding.implementation-plan.md`). Code state: Phases 0–7 + UI polish +
non-ElevenLabs carousel conversion are implemented and deployed to STAGING (through
`ac83835`). Nothing onboarding-related is on prod yet — this test now runs against
PROD (batch 7400e96 shipped 2026-07-25; no customers).

---

## Part A — Build the private marketplace app (one-time, ~20 min)

Portal: **[marketplace.gohighlevel.com](https://marketplace.gohighlevel.com)** → sign in
with the agency account → My Apps → **Create App**.

1. **Identity**
   - [ ] Name: the whitelabel-facing name (clients see it in their sidebar), e.g.
     "Omniply Content Engine"
   - [ ] App type / target: **Sub-Account** (it must surface inside subaccounts, not the
     agency view — our session exchange rejects agency-context opens by design)
   - [ ] Distribution: **Private** (agency-only; no GHL review queue)

2. **Scopes — deliberately minimal.** Our design needs NO OAuth data scopes: all API data
   access rides the per-client **Private Integration key** (Part C), and identity comes
   from SSO, not OAuth tokens. If the portal forces at least one scope to save, pick
   `locations.readonly` only. Do NOT mirror the Private Integration's scopes here — the
   app never exchanges its OAuth code.

3. **Redirect / OAuth URL** (if the form requires one):
   - [ ] `https://svc.omniply.io/api/embed/oauth-callback`
   - This is a live acknowledgment stub ("App installed ✓") — installs can't dead-end.
     Expect one of two behaviors at install time: GHL either skips OAuth entirely for
     SSO-only custom-page apps, or bounces through this URL once. Both are fine.

4. **Custom Page module**
   - [ ] Add a Custom Page pointing at: **`https://chiro.omniply.io/embed`** (PROD — the
     2026-07-25 batch shipped everything; testing runs directly on prod, no customers).
     Staging variant (only if ever needed): `https://staging.chiro.omniply.io/embed?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=samesitenone`
   - [ ] Sidebar label + icon (client-facing)

5. **SSO key (the critical piece)**
   - [ ] App → Advanced Settings → **Auth** → generate the **Shared Secret / SSO Key**
   - [ ] Copy it — it becomes `GHL_SSO_SECRET` in Part B. Without it every session
     exchange returns 503 (deliberate).

6. **Install to the test subaccount**
   - [ ] Agency view → Marketplace/My Apps → install the app to the test subaccount
   - [ ] 📝 Note for the runbook: record whether the install could ride the snapshot or
     was an agency-side click — that answer finalizes the per-client onboarding runbook.

---

## Part B — Environment wiring (10 min, split between us)

**Staging droplet** (`/opt/socioply-staging/.env.staging`):
- [ ] Append `GHL_SSO_SECRET=<the SSO key from A5>` — then recreate the api container
  (`docker compose up -d api`) or let the next staging deploy pick it up.
  (I can do this if you paste me the key, same as the billing secret.)

**Vercel — staging web project:**
- [ ] `NEXT_PUBLIC_API_URL=https://staging-svc.omniply.io` must be set. ⚠️ If unset,
  the embed page calls the PROD API, where the onboarding endpoints don't exist yet —
  the symptom would be 404s right after "Connecting to your workspace…".
- [ ] If the whitelabel portal domain is not `*.gohighlevel.com`: add it to
  `EMBED_FRAME_ANCESTORS` (space-separated origins, e.g.
  `https://portal.yourwhitelabel.com`) — otherwise the iframe renders blank there.
  Opening via app.gohighlevel.com needs nothing.

**Prod** (later, at rollout — not for this test): same two values on
`/opt/socioply/.env.production` + the prod Vercel project, Custom Page URL swapped.

---

## Part C — Provision the test account (admin side, ~10 min)

The embed session maps SSO `activeLocation` → the account whose **GhlSettings.ghlLocationId**
matches. No match = the friendly "provisioning pending" screen (also worth seeing once).

- [ ] **Private Integration key** in the test subaccount (Settings → Private Integrations)
  with the scopes the content engine actually uses:
  - View Locations (business-profile prefill)
  - Social Planner: view + edit/post (account pickup + publishing)
  - Tags: view (promo-email tag selection)
  - Email Marketing / Campaigns: create + schedule (promo emails, newsletter sends)
  - Contacts: view (campaign audience resolution)
- [ ] **DB rows** (I run this — say the word): owner User + Account (status `active`,
  fresh `paidThrough`), GhlSettings row with the integration key (encrypted),
  `ghlLocationId` = the test subaccount's location id, `ghlUserId` = a team member id.
  **No BrandSettings / Settings content** — onboarding must fill everything; that's the test.
- [ ] **Calendars must exist for routing**: staging already has the chiro article +
  newsletter calendars (specialization × hemisphere). The website's detected
  specialization must map to one (family_care etc. exist). If your test website detects
  something exotic, the profile card lets you correct it.
- [ ] Optional (not needed for onboarding itself): billing token + the three billing
  workflows — that's the payments checklist, testable independently.

**Fill the GHL Business Profile properly first** (Settings → Business Profile): name,
email, phone, address, country=AU, timezone, **website URL** (drives the crawl!), and the
social links if present. The richer this is, the better the prefill demo.

---

## Part D — The walkthrough (you click, I verify; ~20 min)

Before you start, tell me — I'll tail the staging logs live. Expected step-by-step:

| # | Step | What you should see | What I verify server-side |
|---|---|---|---|
| 1 | Open sidebar app | "Connecting…" → welcome bubble, **no login** | SSO decrypt, user row created (`ghl:` clerkId), account mapped |
| 2 | Welcome → business card | Form prefilled from Business Profile | ghlPrefill contents; crawl job enqueued the moment state loads |
| 3 | Confirm business | Advances to Question 1 | brandSettings basics + timezone written |
| 4 | Q1–Q6 by **voice** (incl. q_moments → storyBeats) | Record → transcript appears → correct → confirm | S3 audio objects land; transcript quality (AU accent!) |
| 5 | Logo confirm | Candidate grid from your site | crawl results; light/dark variants generated on confirm |
| 6 | Brand profile | Synthesized profile, editable | synthesis job output; profile fields written on confirm |
| 7 | Writing sample | Paste an article (or "skip") | writingStyle written (transcripts + article blend) |
| 8 | **Template reveal** | Your newsletter, live color swatches | nl* fields written; offer generation kicks off |
| 9 | Offers | 14 drafts, month-labeled, editable | NewsletterOffer rows on save |
| 10 | CTA | 3 generated options + custom | socialCallToAction written |
| 11 | WordPress | Form (URL prefilled) or skip | live verify hits your WP; connection row (encrypted) or declined flag |
| 12 | Socials | Instructions → "I've connected" | Social Planner accounts pulled into ghlSettings.accountIds |
| 14 | Toggles | auto vs manual monthly | socialAutomationEnabled + autoGenerateNextCycle |
| 15 | **Finale** | "Start generating my first month" | validator green → calendars routed → onboardingCompletedAt → **real burst starts** |

⚠️ **The finale button starts REAL generation** (~$3–5, ~40 min of staging worker time).
Fine on staging — just don't be surprised. The burst respects the in-flight deploy gate.

**Known risks + built-in fallbacks (all non-blocking):**
- **Microphone in the iframe**: GHL controls the iframe's `allow` attribute. If it doesn't
  grant `microphone`, recording is blocked by the browser → the "Prefer to type?" fallback
  keeps the flow moving, and we know to add an open-in-new-tab affordance for voice. This
  is the single most likely hiccup — please note what happens.
- **Crawl/logo/palette misses** on your real site → the cards degrade to manual
  (paste logo URL, default palette swatches). Note anything that looked wrong — that's
  exactly the extraction-quality data the skipped bench test would have produced.
- **Resume check** (worth doing deliberately): close the tab mid-questions, reopen from
  the sidebar — it must resume exactly where you left off.
- **Out-of-sync check** (optional): two tabs open → answering in both should 409 politely
  in one, not double-commit.

**After the walkthrough**, I run the wrap-up verification: full `generationReadiness`
report, all 19 rows green; spot-check the generated content uses the onboarded voice/brand;
non-EL path — if you chose "later" at step 13, the burst's social days must contain ZERO
video slots and accent-tinted carousels instead (the conversion's first live test).

---

## Part E — Prod rollout (after the test passes)

- [ ] Batch-deploy staging → main (carries onboarding + non-EL conversion + everything
  since `dc42163`); migrations ride automatically
- [ ] `GHL_SSO_SECRET` into `/opt/socioply/.env.production` BEFORE the deploy (container
  recreation picks it up)
- [ ] Prod Vercel: confirm `NEXT_PUBLIC_API_URL` (or rely on the default
  `https://svc.omniply.io`) + `EMBED_FRAME_ANCESTORS` for the whitelabel domain
- [ ] Marketplace app Custom Page URL → `https://chiro.omniply.io/embed`
- [ ] The per-client onboarding runbook (provisioning + billing token + workflows + app
  install) gets finalized with whatever Part A/6 taught us about snapshot installs
