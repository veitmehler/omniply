# Voice Agent — ElevenLabs Conversational AI (post-launch)

Status: PLANNED (approved direction 2026-09-09). Build AFTER launch — nothing
here blocks Sep 18/22, and no schema/code prep is required in advance.

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
- **Positioning**: after-hours + missed-call AI receptionist (conditional
  call forwarding), NOT a front-desk replacement. Safer failure mode, easier
  sell, no number porting.
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
3. Settings → "Voice Assistant" section: key entry, voice preview/re-clone
   button, the assigned number + forwarding instructions ("in your phone
   system, forward after N rings / after hours to this number"), usage meter.
4. Usage monitoring: read their subscription/usage via their key; dashboard
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
3. Two-party-consent handling: recording disclosure line gated on
   `organizationCountryCode`/state; confirm ElevenLabs' own call-recording
   settings per agent.

## Effort + sequence

V1 ≈ 3–4 days, V2 ≈ 3–4 days, V3 ≈ 2–3 days → ~2 weeks elapsed. Sequence
AFTER: launch, first pilots stable. Prerequisite check at build start:
ElevenLabs current pricing/quotas, custom-LLM streaming contract, native
number countries (AU!), and whether agents can be created via API on
Starter/Creator keys.

## Out of scope (explicitly)

- GHL Voice AI (rejected — see decisions).
- Professional Voice Clone automation (manual concierge path only).
- Outbound calling of any kind (inbound + missed-call recovery only).
- Building our own ASR/telephony pipeline (Twilio Media Streams etc.).
