# Launch Content — walkthrough demo video + help documentation

Status: PLANNED 2026-09-10 (user-named MAIN reason for the Sept 22 delay).
Critical path alongside the simonchiro E2E. Nothing here blocks code work;
everything here blocks launch.

## Principles (agreed in discussion)

- The simonchiro E2E is a TEST, not a film set: record it as raw insurance
  footage, but never depend on it for clean scenes.
- A dedicated DEMO ACCOUNT on staging gives unlimited retakes of every flow
  (onboarding chat, Settings, approval queue, widget, voice call) with
  polished brand data so generated content looks great on camera. Bonus: a
  free onboarding dry-run BEFORE simonchiro — bugs found while filming are
  free.
- Script first, screens second. One production effort feeds BOTH artifacts:
  per-scene clips = walkthrough sections = tutorial embeds; the demo
  account session also yields every docs screenshot.
- Voiceover = ElevenLabs clone of Veit's voice. Deciding argument:
  REVISABILITY — when a screen changes post-launch, regenerating one line
  is an API call, not a re-recording session with mic/room matching. Veit
  can re-record any single line that feels flat.
- Docs = markdown in the repo rendered at /help on the marketing site: one
  source of truth, versioned with the product (doc PR rides the feature's
  deploy), Google-indexable, later feedable to the AI assistants. No
  Notion/GitBook (drift) and no GHL-hosted pages.

## Division of labor

- Claude: demo-account setup, full video script (scene-by-scene, exact
  on-screen moments), all help-article drafts (from codebase knowledge —
  accurate to real UI copy), VO generation via the ElevenLabs API once the
  script is approved, /help page scaffolding.
- Veit: tone edits + sign-off on script and articles, screen recording
  (one sitting on the demo account covers video scenes AND docs
  screenshots), assembly, the one-shot purchase clip (capture during the
  E2E or mock), final QA watch-through.

## Phase 1 — Demo account (Claude, ~half day)

1. Create a staging account with a polished fictional clinic (name TBD by
   user — NOT a real practice; distinct from Coast and simonchiro):
   good logo, strong brand colors, realistic FAQs/hours/services, US
   address (launch market framing — per target-market rule, never
   AU-centric).
2. Run onboarding normally once (which IS the dry-run), then reset/replay
   pieces as needed for filming — onboarding sessions can be re-created on
   a throwaway account per retake.
3. Generate a content burst so the dashboard, content plan, and approval
   queue are FULL of good-looking content for the camera.
4. Provision chat widget + voice agent (cloned voice optional — the demo
   account can use Veit's clone for continuity with the VO).

## Phase 2 — Video script (Claude drafts, Veit approves, ~1 day incl. review)

Main walkthrough: 3–5 minutes, one scene per script paragraph, each scene
15–45s of screen activity. Scene list (draft — final at scripting):
 1. Cold open: the problem (30s, can be b-roll/slides over VO).
 2. Purchase + what you get (the one-shot GHL checkout clip).
 3. Onboarding chat: blog scrape + "I wrote this", the 6 voice questions,
    one-tap SPINE CTA — "15 minutes, once".
 4. The content engine: dashboard, 30-day content plan, what posts/articles
    look like (show the KT video + story posts — the differentiators).
 5. Review & approve: the human-in-the-loop moment.
 6. The lead funnel: comment "SPINE" → DM → Spine Check → follow-up (can
    be shown with the live pieces).
 7. AI chat widget on the clinic site (plugin auto-install mention).
 8. AI voice receptionist: missed call → answered in the clinic's own
    voice → callback in GHL (strongest close — record a REAL call).
 9. Close: founders offer + doors-open date (Sept 22 — date appears ONLY
    here and is easy to re-render).
Deliverables: `walkthrough-script.md` (scene / on-screen / narration
columns) + a shot list Veit can film top-to-bottom.

## Phase 3 — Production (Veit, ~1 day)

- Tooling: Screen Studio (recommended — auto-zoom/cursor polish, minimal
  editing skill needed); OBS as free fallback. 2560×1440 or 1080p capture,
  browser at 100% zoom, demo account logged in, notifications off.
- Record per scene, never one long take. Also capture stills for docs
  while on each screen (one pass, two outputs).
- VO: Claude generates per-scene MP3s from the approved script via the
  ElevenLabs API (Veit's clone); Veit re-records any line that feels off.
- Assembly: Screen Studio or Descript (text-based editing pairs well with
  scripted VO). Background music low or none.

## Phase 4 — Publish video (joint, ~half day)

- Host: self-host MP4 on the site or YouTube-unlisted embed (decide at
  publish; YouTube = free CDN + captions, self-host = no branding leak).
- Embed on /walkthrough (page exists, launch-gated) + the marketing page
  hero; per-scene clips saved for tutorial embeds.
- Captions/subtitles from the script (we have exact text — no transcription
  needed).

## Phase 5 — Help documentation (Claude drafts ~1 day, Veit reviews)

Repo shape: `apps/web/content/help/*.md` → rendered at `/help` +
`/help/[slug]` (simple Next.js static pages, marketing styling, sidebar
nav, search deferred post-launch).

Launch article set (12):
 1. getting-started — what Omniply is, what you need (GHL-purchase framing)
 2. onboarding-walkthrough — the chat setup, step by step (embed scene 3)
 3. connecting-social-accounts — FB/IG/LinkedIn via the Social Planner
 4. publishing-comment-workflows — assign FB page/IG account + PUBLISH the
    two comment workflows (THE manual client step; screenshots essential)
 5. reviewing-and-approving-content — queue, edits, what approval triggers
 6. your-content-plan — the 30-day plan, article days vs newsletter days
 7. chat-widget-install — WordPress plugin (auto-install + manual snippet
    fallback), what the assistant can/can't do
 8. chat-knowledge — Business Info & Chat Knowledge section incl. the
    "anything else" textarea; changes reach the assistant in seconds
 9. voice-assistant-setup — the Settings wizard: ElevenLabs account
    (Creator $22 recommended), API key, voice clone, number, overflow vs
    direct mode, transfer number (embed scene 8)
10. leads-and-callbacks — where leads land in GHL, tags, chat summary +
    preferred-time merge fields, the callback workflow
11. the-spine-check-funnel — how the quiz + guides funnel works, the
    trigger links, what to never rename
12. billing-and-account — plan, invoices via GHL, cancel/pause policy
Each article: ≤600 words, screenshots from the Phase-3 session, tutorial
clip embed where one exists, "common problems" footer.

## Phase 6 — QA + launch wiring (joint, ~half day)

- Full watch-through of the video at 1× (voice pacing, UI accuracy).
- Every article click-checked against the live staging UI.
- /help linked from marketing footer + app sidebar; /walkthrough link in
  the W1/W2 emails verified.
- Date-bearing content (scene 9) confirmed Sept 22.

## Timeline vs the Sept 22 launch (today = Wed Sept 10)

- Thu 11: Phase 1 (demo account) + Phase 2 script draft → Veit reviews.
- Fri 12: script approved → VO generated; Phase 5 article drafts begin.
  In parallel: simonchiro E2E when prerequisites land.
- Weekend 13–14: Veit films (Phase 3) + assembles; Claude finishes
  article drafts + /help scaffolding.
- Mon 15: Phase 4 publish + article review; buffer.
- Tue 16–Fri 19: buffer for E2E fixes, main merge, prod verification;
  final QA (Phase 6).
- Mon 21: everything frozen; Tue 22 launch.
The video + docs and the E2E run in PARALLEL tracks — neither waits for
the other; only Phase 6 needs both done.

## Out of scope (post-launch)

- Docs search, feedback widgets, versioned changelogs.
- Per-feature deep-dive videos beyond the per-scene clips.
- Feeding /help into the chat assistants' knowledge (natural follow-up).
- Localized/translated docs.
