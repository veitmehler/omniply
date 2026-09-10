# Voice Agent — ElevenLabs Conversational AI (post-launch)

> Companion plan: .plans/voice-rescue-agent.implementation-plan.md —
> failed-transfer recovery via a second message-taking agent (caller-leg
> redirect out of the dead conference; designed 2026-09-10, not yet built).

Status: V1 + V2 CODE COMPLETE on staging 2026-09-09 (user pulled the build
forward). Shipped: voice channel in the engine (spoken-register overlay,
filter-then-stream), OpenAI-compatible custom-LLM endpoint
/api/agent/voice/:secret/(v1/)chat/completions (SSE, request_human →
transfer_to_number tool call, safe-fallback on engine failure), migration
(Account.voiceAgentSecret/voiceAgentDismissedAt + voice_agent_configs),
provisioning orchestrator (clinic key → IVC clone from onboarding S3 audio →
ConvAI agent create/update → Twilio subaccount + number buy + ElevenLabs
import), authed /voice-assistant/* routes, Settings stepper section
(#voice-assistant anchor) + dashboard nudge card with "not yet" dismissal.
NOT YET DONE: Twilio master env (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN — user
must create the Twilio account), V3 safety gate (voice C3 battery + live
phone E2E + ConvAI field-shape verification: custom_llm_extra_body,
built_in_tools nesting, transfer no-answer semantics), consent/recording
line per state. NOT enabled for any clinic until V3 passes.

## Decisions locked with the user (2026-09-09)

- **Vendor**: ElevenLabs Conversational AI (their Agents platform), NOT GHL
  Voice AI. Reasons: (1) GHL's voice agent is a second, unvalidated brain —
  none of our red-teamed prompt, deterministic guardrails, emergency
  deflection, or action validation applies to it; unacceptable for a
  compliance-first medical-adjacent product. (2) GHL AI surfaces are
  deliberately OFF so they can't fight our DM responder/takeover
  architecture. (3) One brain across all three transports (widget, DM, phone)
  is the product story — KB edits reach the phone agent instantly.
- **Per-clinic ElevenLabs accounts + API keys** (user decision): clinics pay
  ElevenLabs directly and clone THEIR OWN voice in their own account. We
  provision agents/numbers *through their key*. Benefits: zero voice cost to
  us, cleanest consent posture (they clone their own voice under their own
  ToS acceptance), personal-voice differentiator no GHL bot can match.
- **Tier guidance**: Creator ($22/mo) is the recommended standard tier —
  includes Professional Voice Cloning eligibility and ~250 conversation
  min/mo; Starter ($5) is the bare minimum (Instant clone + agents, ~50 min);
  Pro ($99, ~1,100 min) for high-volume practices. ⚠️ VERIFY minute
  quotas/concurrency/native-number availability against the live ElevenLabs
  pricing page at build time before printing any tier in sales copy.
- **Voice cloning ladder**: onboarding voice answers (~1–3 min audio) are
  enough for an INSTANT clone on day one. A PROFESSIONAL clone needs ~30+ min
  of clean audio plus a speaker identity-verification step the clinic owner
  must perform personally in their ElevenLabs account — offer as a
  concierge/guide step later, never a launch blocker.
- **NOT an onboarding step** (user 2026-09-09): setup requires the clinic to
  sign up at ElevenLabs themselves, so it can never sit inside the purchase
  walkthrough. Instead: a persistent DASHBOARD NOTIFICATION card ("Add your
  AI voice receptionist") that opens a guided integration wizard. The card
  has a "I don't want an AI voice agent yet" dismissal — dismissing hides
  the card (persisted per account), but the full setup remains available on
  the Settings → Voice Assistant page at any time.
- **Two usage modes, the clinic's explicit choice, BOTH offered** (user
  2026-09-09), selected in the wizard and changeable in Settings:
  - **Overflow mode**: keep publishing their existing number; conditional
    forwarding sends calls to the AI number after too many rings / after
    hours (we show carrier/phone-system forwarding instructions).
  - **Direct mode**: publish the AI number itself on their website, GBP, and
    social profiles — callers reach the AI receptionist first, every time.
- **Human hand-off** (user 2026-09-09): when a caller asks for a human, the
  AI transfers the live call to the clinic's real number. If the clinic
  doesn't answer within 25 seconds (~5 rings — PRODUCTION value, user
  decision 2026-09-10; supersedes the earlier ~10-ring idea), the watchdog
  pulls the caller back and the rescue flow offers a callback message.
- **Recording disclosure** (user wording 2026-09-10, live): the greeting is
  "Thanks for calling {practice}! I'm the practice's AI assistant, and
  calls are recorded for quality assurance. How can I help you today?" —
  ElevenLabs stores call audio + we keep transcripts; all-party-consent
  states require the up-front line. (Engineering-conservative default; a
  counsel sanity-check before launch is still recommended.)
- **Disclosure is non-negotiable**: the cloned voice must introduce itself as
  the practice's AI assistant up front (impersonating the practitioner with
  their cloned voice = deceptive + legally risky in two-party-consent
  states). The validated agent prompt already carries the AI disclosure —
  voice inherits it; never soften it for the phone channel.

## Architecture

ElevenLabs owns ears/mouth/timing (ASR, VAD, barge-in, TTS); our engine stays
the only brain via their **custom LLM** integration (their platform calls an
OpenAI-compatible chat-completions endpoint we host). Every reply passes
through the same system prompt, guardrails, post-filters, and GHL tools that
C3 validated.

```
caller → clinic number → conditional forward (no answer / after hours)
      → clinic's ElevenLabs number → ElevenLabs agent (their account)
      → custom-LLM webhook → svc.omniply.io/api/agent/voice/:secret
      → runAgentTurn (same engine, voice transport) → streamed reply text
      → ElevenLabs TTS in the clinic's cloned voice → caller
actions (request_callback, add_contact_email, send_guide_link→SMS) → GHL
```

## Phase V1 — engine façade (apps/api)

1. `POST /api/agent/voice/:secret` — OpenAI-compatible chat-completions
   endpoint (streaming SSE). `:secret` = per-account voice secret (new
   `Account.voiceAgentSecret`, minted like agentWidgetToken) — it is the
   auth AND the account resolver, same pattern as the DM webhook token.
2. Adapter: map the OpenAI messages array → our conversation state; call
   `runAgentTurn` with a new transport tag `'voice'`. Reuse the existing
   conversation persistence (transcripts appear in the same admin view,
   flagged-first).
3. **Streaming vs post-filters**: post-filters (outcome-promise etc.) run on
   complete replies today. V1 = generate the full reply, run ALL filters,
   then stream the filtered text to ElevenLabs sentence-by-sentence
   (accepting ~1s added latency). Do NOT invent per-sentence filtering in V1.
4. Voice-specific prompt overlay (agent_system stays shared; overlay injected
   for transport==='voice'): shorter replies (target ≤2 sentences per turn),
   spoken-language style (no bullet lists, no URLs read aloud — say "I'll
   text you the link" and use send_guide_link→SMS), numbers read naturally,
   opening line = practice AI-assistant disclosure, recording/consent line
   where required.
5. Actions over voice: request_callback and add_contact_* work verbatim.
   send_guide_link becomes "I'll text it to you" → SMS via GHL (new small
   action mapping; the guide trigger links already exist).
6. **Human transfer**: wire ElevenLabs' call-transfer system tool
   (transfer-to-number) with the clinic's real number and a ~50s (≈10 rings)
   answer timeout. Prompt rule: transfer on ANY request for a human — never
   argue, announce the transfer first. On transfer failure/no-answer the
   caller returns to the agent, which must acknowledge ("the team can't pick
   up right now") and offer request_callback. ⚠️ Build-time verification:
   confirm ElevenLabs' transfer tool supports a ring/answer timeout AND
   return-to-agent on no-answer; if return-on-failure isn't supported,
   fallback design = announce before transferring ("if they don't pick up,
   call us back and I'll take a message") and treat the timeout question as
   a vendor ticket before V3 sign-off.

## Phase V2 — provisioning (their key)

1. Re-arm the dormant ElevenLabs key storage (encrypted ApiKey rows +
   commitElevenLabs pattern) as a Settings panel field, NOT an onboarding
   step (voice is an add-on tier).
2. `provisionVoiceAgent(userId)` via THEIR key:
   - create/refresh the ElevenLabs agent (custom-LLM URL + our voice secret,
     system prompt stub — the real prompt lives on OUR side; their prompt
     field gets only the transport handshake),
   - create the Instant voice clone from the stored onboarding voice
     recordings (they already live in our storage; ~1–3 min is sufficient),
   - buy/attach a phone number in their account (native ElevenLabs numbers;
     fall back to guiding a Twilio import if native is unavailable in their
     country),
   - store agent id / voice id / number on the account.
   Idempotent, loud logging, same ethos as installOmniplyConnect.
3. **Dashboard notification card + integration wizard** (the ONLY entry
   point besides Settings; never an onboarding step):
   - Card on the dashboard for voice-eligible accounts without a configured
     voice agent: "Add your AI voice receptionist" → opens the wizard.
   - Dismissal option "I don't want an AI voice agent yet" → persists a flag
     (e.g. Account.voiceAgentDismissedAt) and hides the card; Settings →
     Voice Assistant still offers full setup (and un-dismisses on
     completion).
   - Wizard steps: (1) create your ElevenLabs account (recommend Creator
     $22/mo, link + what to click), (2) paste your API key (validated live),
     (3) we clone your voice from your onboarding recordings + preview
     player, (4) we buy your AI number in your account, (5) MODE CHOICE —
     "forward missed calls to it" (carrier forwarding instructions for their
     phone setup) OR "use it as your published number" (checklist: website,
     GBP, social profiles; direct-mode copy), (6) enter the clinic's real
     number for human transfer + confirm, (7) test call.
4. Settings → "Voice Assistant" section: everything the wizard sets, editable
   — key entry, voice preview/re-clone button, the assigned number, mode
   switch (overflow ⇄ direct, re-showing the matching instructions), human
   transfer number, usage meter.
5. Usage monitoring: read their subscription/usage via their key; dashboard
   warning at 80% of included minutes (prevents overage surprises).

## Phase V3 — safety + verification (gate for enabling on any real clinic)

1. Voice C3: rerun the 27-case battery through the voice endpoint (text-level
   — drive the custom-LLM endpoint directly; no audio needed for the safety
   claims) + voice-specific cases: emergency mid-call (deflect to local
   emergency number IMMEDIATELY, offer to end call), caller asks "am I
   talking to a real person" (honest disclosure), voicemail-style dead air,
   caller reads back a wrong phone number (the C3 correction rule).
2. Live phone E2E on Azavea or the test clinic: real call, clone voice,
   barge-in, callback executed in GHL, transcript lands flagged-first.
   Must include the transfer matrix: human-transfer answered; human-transfer
   unanswered (~10 rings) → return to AI → callback offer → request_callback
   lands in GHL; and both usage modes (a forwarded call and a direct call).
3. Two-party-consent handling: recording disclosure line gated on
   `organizationCountryCode`/state; confirm ElevenLabs' own call-recording
   settings per agent.

## Effort + sequence

V1 ≈ 3–4 days, V2 ≈ 4–5 days (wizard + dashboard card added), V3 ≈ 2–3 days
→ ~2–2.5 weeks elapsed. Sequence AFTER: launch, first pilots stable.
Prerequisite check at build start: ElevenLabs current pricing/quotas,
custom-LLM streaming contract, native number countries (US + AU — target
market is US + international), transfer-tool timeout/return-on-no-answer
semantics, and whether agents can be created via API on Starter/Creator
keys.

## Out of scope (explicitly)

- GHL Voice AI (rejected — see decisions).
- Professional Voice Clone automation (manual concierge path only).
- Outbound calling of any kind (inbound + missed-call recovery only).
- Building our own ASR/telephony pipeline (Twilio Media Streams etc.).
