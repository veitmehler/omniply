# GHL Snapshot Specification — Chiropractic Practice CRM

The definitive enable/disable + prebuild spec for the client subaccount snapshot
(finalized 2026-07-15). Design principle: **the owner only sees surfaces where they act**
— everything infrastructural exists but stays out of their face. International launch:
no PMS integration, GHL never owns booking (see the PMS strategy in
`.plans/pms-connector-framework.implementation-plan.md`).

## A. Feature toggles

### KEEP — our platform depends on these
| Feature | Why |
|---|---|
| Marketing → Social Planner | The entire social publishing path + onboarding social-connect step |
| Marketing → Email campaigns | Newsletter sends + promo emails (API-created campaigns) |
| Contacts + Tags | Lead-gen captures, promo audiences, every automation trigger |
| Automation (Workflows) | Review webhook + nurture sequences (pre-built below; owner rarely opens) |
| Conversations (email + social DMs) | Patient replies to newsletters/promos; future review responses |
| Media Storage | Social Planner attachment dependency (invisible in practice) |
| Our marketplace app (Custom Page) | Onboarding chat + Lead Magnets review + embedded surface |

### KEEP — core clinic value
| Feature | Configuration |
|---|---|
| Calendars/Booking | Template built but **hidden by default** — clinics book through their PMS (`bookingUrl` CTA field). Enable per-client only for PMS-less practices (rare) |
| Reputation | ON — review requests are the #1 local-SEO lever; pairs with the QR review card + future GBP review mining |
| Opportunities | ONE pre-built pipeline only: "New Patient: Lead → Booked → Showed → Active". Nothing else |

### OFF / HIDDEN — with reasons
| Feature | Reason |
|---|---|
| **Content AI / AI Employee / all GHL AI writing** | Competes with the platform; bypasses every guard (AHPRA, brand voice, de-AI). The most important disable on this list |
| Sites / Funnels / GHL Blogs | 85% WordPress; we publish there. Second website builder = fragmented presence + confusion |
| Payments (client-facing menus) | Clinics bill via PMS (health-fund claiming GHL can't do). SaaS billing keeps working underneath — hide the client-facing surface only |
| Memberships / Courses / Communities / Certificates | Not a chiro business model |
| Affiliate Manager / Ad Manager | Not used |
| App Marketplace (client access) | No random installs into a supported environment |
| Launchpad | Hide post-setup (nags about deliberately disabled features) |
| Reporting (beyond basic dashboard) | Analyst-grade UI answering questions owners aren't asking |

### DEFERRED — per-client opt-in (runbook, not snapshot)
- **SMS / LC Phone**: powerful (reminders, review requests) but duplicates PMS reminders,
  adds per-message cost, and needs per-client sender registration (A2P in US, alpha-tag AU).
  Conversations launches with email + social DMs; SMS activates per client on request.
  Revisit as default once the review-request workflow proves demand.

## B. Prebuild checklist (the snapshot's content)

1. **Billing workflows: NONE** (superseded 2026-07-24). Billing is Stripe-central:
   the platform's Stripe webhook receiver (`/api/stripe/events`) handles payment
   succeeded/failed/paused/resumed/cancelled directly — nothing billing-related lives in
   the snapshot or any subaccount, so nothing an end user can break. The old
   per-subaccount workflow receiver remains deployed as a fallback only.
2. **Custom Value**: `omniply_review_token` only (billing value dropped with
   Stripe-central). Intended to be auto-set at provisioning; the current app grant has
   customValues READONLY, so until a scope bump the runbook step is: paste the full
   review-webhook URL (from `POST /api/admin/accounts/:id/review-token`) into the custom
   value once per client. Create the custom value (empty placeholder) in the snapshot so
   workflow 7c can reference it.
3. **Tag taxonomy** (pre-created so workflows reference them from day one):
   - `leadgen-<template-slug>` per starter lead magnet
   - `appointment-completed`, `first-visit-completed` (dormant until the PMS connector or
     manual front-desk tagging supplies them)
   - `newsletter-subscriber` (marketing consent — NEVER auto-applied by any sync)
   - Service-communication vs marketing tags kept strictly separate (privacy posture in
     every jurisdiction)
4. **ONE nurture workflow** (simplified 2026-07-28): trigger = Contact Tag Added with
   ALL five `leadgen-*` tags as OR-filters → 2 generic follow-up emails → create
   Opportunity in the New Patient pipeline. The emails NEVER link the document —
   delivery happens BEFORE the tag exists (Drive access-proposal flow auto-grants,
   then pushes contact+tag), so copy assumes the lead already has their guide.
   CTAs use the `omniply-booking` trigger link (7b) + built-in location merge fields
   ({{location.name}} etc.) — NO per-clinic edits, NO per-document custom values.
   Per-magnet copy personalization = optional later refinement.
5. **Review-request workflow** — trigger: `appointment-completed` tag → delay → review ask
   (email; SMS variant added when SMS activates). Pre-built and DORMANT until a tag source
   exists; the QR counter card covers review velocity meanwhile.
6. **New Patient pipeline** (the one in section A).
7. **Booking calendar template: NOT in v1.0** (deferred 2026-07-28). Plan feature stays
   enabled (free option value); the rare PMS-less clinic gets a calendar created
   per-client in minutes (runbook), not a snapshot asset nobody may ever use.
7b. **Trigger links `omniply-review` + `omniply-booking`** (placeholder destinations;
   decided 2026-07-28) — provisioning repoints BOTH per clinic via API: review → the
   Google review deep link (QR card encodes it; review-request email uses it),
   booking → brandSettings.bookingUrl (nurture email CTAs use it). Trigger links over
   custom values here: click tracking in GHL + SMS-ready later + one repoint pass.
7c. **Review Received workflow → Custom Webhook** with URL
   `{{custom_values.omniply_review_token}}` (full URL auto-set at provisioning) — feeds review mining
   (google-reviews-acquisition plan Tier 3). Requires the clinic's Google connection in
   GHL Reputation (runbook step).
7d. **Native Reviews QR: do NOT create / disable where possible** (user decision —
   our branded QR card + trigger link replaces it; avoids two competing QR codes).
8. NOT in the snapshot but part of client provisioning around it:
   SaaS Configurator settings (auto-suspend ON, auto-cancel OFF, 30-day cycle). Private
   Integration keys are OBSOLETE for new clinics — zero-touch OAuth provisioning mints
   location tokens automatically at app install. The marketplace app AUTO-INSTALLS via
   the SaaS plan (bundled 2026-07-25 — private white-label app, distribution
   Agency & Sub-Account, FREE — pricing tiers dropped 2026-07-25; auto-install fires for
   NEW subaccounts created under the plan; existing subaccounts need the install link
   once). Billing lifecycle: Stripe webhook endpoint configured once at the platform
   level (LIVE since 2026-07-25) — no per-client billing setup at all.

## C. Decisions this spec encodes (from the 2026-07-15 brainstorm)

- Booking stays in the clinic's PMS forever; `bookingUrl` (new onboarding field) is the
  universal CTA destination. GHL calendar = fallback for PMS-less clinics only.
- PMS dropdown in onboarding = data capture only; connector framework parked until cohort
  data picks the first integration (Cliniko presumptive).
- Review velocity at launch = newsletter/promo ask-blocks (our templates) + the branded
  QR counter card (lead-gen starter library) — automation joins when a connector lands.
- Content AI disabled everywhere — one AI writes for the clinic, and it's ours.

---

## Social DM & Comment Automation (added 2026-08-07 — DM responder plan)

Transport verified end-to-end on the Azavea location (FB + IG inbound to
Conversations, outbound API replies 201 on both). Requires the marketplace
app's four conversations scopes (bumped + re-granted 2026-08-07).

### Workflow 1 — "AI DM Responder" (spec updated 2026-09-09 to builder reality)
- Trigger: **Customer Replied** (the builder offers NO per-channel filter —
  fire on everything; the server filters to FB/IG and ignores the rest).
- Condition: contact does NOT have tag `ai-off` (the builder allows only ONE
  tag exclusion; the server also enforces `in comment reply workflow`
  suppression, so one condition here is sufficient).
- Action: **Webhook POST** to `{{custom_values.omniply_dm_webhook}}` with
  customData fields (the builder offers no message type/direction fields —
  the server derives the channel via the Conversations API):
  - `contact_id` = `{{contact.id}}`
  - `message_body` = `{{message.body}}`
- No headers needed — auth is the token in the URL.
- The endpoint (`/api/agent/ghl-dm/<token>`) enqueues and returns instantly;
  the agent replies on the same channel. Payload parsing is tolerant — after
  snapshot import, send one test DM and check api logs for `[agent-dm]
  webhook` status `enqueued` (a `unparseable` status means the customData
  keys need adjusting to match this list).

### Workflow 2 — "Human Takeover Notify"
- Trigger: **Tag added** = `ai-off`.
- Actions: internal notification (SMS/email to assigned user): "🙋 Visitor
  asked for a human — AI paused. Open the conversation." The agent applies
  the tag itself via the `request_human` action (plus `human-requested`) and
  leaves a summary note on the contact.
- Manual takeover: front desk can add `ai-off` to any contact at any time;
  remove the tag to resume the AI.

### Workflows 3–9 — comment keywords (one per lead asset)
- Trigger: **Facebook - Comment(s) on Post** / **Instagram - Comment(s) on
  Post**, filter: comment text contains keyword (case-insensitive).
- Actions: (1) send DM with the asset's **trigger link** (the same
  per-location trigger links the email drip uses — attribution unified),
  (2) public comment reply: "Just sent it to your DMs! 📩".
- Keyword vocabulary (user-locked 2026-08-07):

| Keyword | Asset |
|---|---|
| SPINE | 2-Minute Spine Check |
| FIRST VISIT | First Visit Guide |
| DESKTOP | Desktop Setup Guide |
| SLEEP | Sleep Guide |
| PAIN | Pain Signal Guide |
| MORNING | Morning Routine Guide |
| XRAY | Practice X-Ray (Azavea only) |

- Caption side: the social CTA preset `dm_keyword` (custom text
  `KEYWORD|asset description`) makes captions invite the comment. LinkedIn
  has NO comment/DM automation (platform API restriction) — Azavea LinkedIn
  posts use direct links instead.

### Instagram connection checklist (cost a full debug session — do not skip)
1. IG must be a Professional account linked to the location's Facebook page.
2. In the IG app: Settings → Messages → **Allow access to messages** ON.
3. In GHL Integrations, messaging rides the **"via Facebook page"** IG row —
   enable messaging+automation there and REMOVE any "Direct Instagram"
   connection (conflicts).
4. If DMs still don't arrive: **Reconnect the Facebook integration** (re-
   grants instagram_manage_messages + re-subscribes webhooks).
5. Non-follower DMs sit in IG's **Requests folder**, invisible to tools until
   accepted — acceptance unlocks FUTURE messages only. Front desk should
   check Requests weekly.

## Callback notification merge fields (voice-sms build, 2026-09-10)

The Chat Callback Request workflow's front-desk SMS/email can now merge:
- `{{contact.chat_summary}}` — reason + 2-3 sentence chat summary (existing)
- `{{contact.callback_preferred_time}}` — the caller's requested time,
  verbatim ("around 10:30 AM"); set only when the caller named one.
Both custom fields are find-or-created by the platform on first use — no
snapshot change required, but adding the time to the notification template
is recommended: "Call {{contact.first_name}} back {{contact.callback_preferred_time}}".
