# Voice Rescue Agent — failed-transfer recovery via a second message-taking agent

Status: BUILT (one-number redesign) 2026-09-10. Companion to
.plans/voice-agent-elevenlabs.implementation-plan.md.

## ⚠️ REDESIGN 2026-09-10 — ONE-NUMBER ARCHITECTURE (supersedes the
## second-agent/second-number sections below)

User raised: a second DID costs $6–12/mo outside the US. Research proved a
better mechanism — the ElevenLabs CONVERSATION-INITIATION WEBHOOK fires on
every inbound Twilio call BEFORE the agent speaks (payload: caller_id,
called_number, call_sid, agent_id, conversation_id) and the response can
override first_message. The docs claim UI-only config; EMPIRICALLY FALSE —
all three settings PATCH via API (live-verified):
  platform_settings.workspace_overrides.conversation_initiation_client_data_webhook {url, request_headers}
  platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook
  platform_settings.overrides.conversation_config_override.agent.first_message
(Bonus found: platform_settings.overrides.custom_llm_extra_body — the
extra-body flag hunted earlier lives HERE, not in the LLM config.)

Shipped shape:
- NO second agent, NO second number (schema columns rescueAgentId/
  rescueNumber/… remain, unused).
- Rescue TwiML dials the clinic's OWN number back (fresh CallSid; default
  <Dial> caller-id presents the original caller — the link key).
- POST /api/agent/voice-init/:secret = the initiation webhook: rescue
  stamp/phone matched → prepareRescueConversation PRE-CREATES the
  conversation row (visitorKeyForElConversation(conversation_id), shared
  helper keeps webhook+shim keys in sync) with rescueSourceId/rescueContext/
  seeded ghlContactId + returns the apology first_message override; normal
  calls → empty override, standard greeting, ~sub-second round-trip inside
  the connection window.
- Engine derives message mode from conversation.rescueSourceId (TurnResult
  .messageMode; route gates transfers on it). Everything else from the
  original design carries over unchanged: watchdog kill+stamp+redirect,
  no-ambiguity linking, consume-once stamps, context persisted on the row,
  GHL convergence + deterministic unanswered-transfer note.
- Floor: no phoneNumber on file → TwiML <Say> apology + hangup.

Live-verify remaining (V3.2): webhook actually fires on the redialed leg with
the original caller-id; failure behavior when our endpoint is slow (keep it
trivial); full rescue call E2E.

## Problem (live-verified 2026-09-09/10)

A conference transfer nobody answers maroons the caller in Twilio hold music
forever: ElevenLabs REMOVES the agent from the call at transfer start and
never returns (documented vendor limitation; call screening fixes it but is
feature-gated per ElevenLabs workspace — unusable as a foundation when every
clinic owns their own account). Our 25s watchdog already kills the ringing
dial leg (verified live), but the caller stays alone in the conference —
killing the leg is necessary, not sufficient.

## Agreed design (user decisions 2026-09-10)

Option A + context carry-over + full KB:
- A SECOND per-clinic ElevenLabs agent ("message agent") answers a SECOND,
  internal, never-published Twilio number in the clinic's subaccount.
- After killing the dial leg, the watchdog REDIRECTS the caller's own leg to
  TwiML that dials the internal number → fresh call, fresh CallSid (avoids
  the EL same-CallSid unknown), rescue agent answers with a contextual
  apology and takes the callback message.
- The rescue agent runs on the SAME engine with the FULL account knowledge
  base and all tools (user requirement: callers may keep asking questions) —
  only the opening posture differs (mode overlay).
- The prior conversation's transcript is injected as per-conversation
  reference context, with a strict no-ambiguity rule (user requirement:
  never guess which call the rescue belongs to).
- GHL convergence: the rescue call's callback lands on the SAME contact as
  the first call — only when the link is unambiguous.
- Fallback floor when the rescue agent isn't provisioned: TwiML plays an
  apology (<Say>, later optionally a cloned-voice MP3) and hangs up.

## Linking rules (privacy-critical)

Cross-contamination (caller A's transcript reaching caller B) is a patient-
data leak and must be IMPOSSIBLE, not merely unlikely:

1. Primary key: caller phone number. Twilio's <Dial> from the redirected leg
   presents the ORIGINAL caller's number by default (⚠️ verify live, see
   Risks), and both agents' stub prompts carry CALLER={{system__caller_id}}.
   The shim parses it; the first call stores it on its conversation row; the
   rescue call matches exactly.
2. Secondary: the watchdog stamps the exact conversation it rescued
   (rescuePendingAt), TTL 3 minutes, consumed on first use. If the rescue
   call's caller id is missing/anonymous AND exactly ONE unconsumed
   in-TTL stamp exists for the account → that one.
3. Ambiguity (≥2 candidates and no phone match) → INJECT NOTHING. The rescue
   agent still works (full KB, plain message-taking); the failure mode is
   reduced convenience, never wrong data. GHL contact convergence follows
   the same rule: no unambiguous link → new contact, no merge.

## Implementation

### 1. Schema (migration `voice_rescue`)

- VoiceAgentConfig: `rescueAgentId String?`, `rescueNumber String?`,
  `rescueNumberSid String?` (Twilio), `rescueNumberId String?` (EL import id).
- AgentConversation: `callerPhone String?` (E.164, voice calls, parsed from
  CALLER=), `rescuePendingAt DateTime?`, `rescueConsumedAt DateTime?`,
  `rescueSourceId String?` (set on the RESCUE conversation → source id).

### 2. Provisioning (lib/voice-agent/provision.ts — idempotent like all steps)

After the main agent + number:
- Create rescue agent (skip when config.rescueAgentId):
  - name: `${practice} — Omniply message agent`
  - first_message: "Sorry about that — the team couldn't pick up just now.
    I can take a message so they call you back. What's your name and the
    best number to reach you?"
  - custom_llm url: `${base}/api/agent/voice/${secret}/message` (mode as a
    PATH segment — ElevenLabs appends /chat/completions to the base url)
  - same cloned voiceId; NO transfer tool (a rescue call never re-transfers)
  - persist rescueAgentId immediately.
- Buy internal number (skip when config.rescueNumber): same
  buyVoiceNumber + address path; label "… message line (internal)"; persist.
- Import into the clinic's EL workspace bound to rescueAgentId; persist id.
- Status stays 'ready' even if rescue provisioning degrades (notes + the
  TwiML <Say> floor cover it) — but log loudly.

### 3. Voice route (routes/voice-agent.ts)

- Register `/agent/voice/:secret/message/chat/completions` (+ `/v1/` form)
  → same handler with mode='message'.
- mode='message':
  - never emit the transfer tool (independent of open hours / config);
    request_human → "the team is unavailable right now" + callback pivot.
  - resolve rescue context BEFORE the engine turn (new lib
    agent/voice-rescue.ts):
    `resolveRescueContext(accountId, callerPhone)` implements the linking
    rules; returns { sourceId, ghlContactId, transcriptBlock } | null and
    consumes the stamp transactionally (updateMany guard on
    rescueConsumedAt=null so two simultaneous rescues can't both claim one).
  - transcriptBlock: last 10 messages of the source conversation, capped
    ~1500 chars, formatted "EARLIER IN THIS CALL (before the transfer
    attempt — reference only): …".
- Shim: parse `CALLER=(+?digits)` from the system message alongside CALL_ID;
  expose on the turn; anonymous/absent → null.

### 4. Engine (agent/engine.ts — minimal additive TurnInput fields)

- `voiceMode?: 'standard' | 'message'` → message-mode channelStyle overlay:
  apologize once, confirm KNOWN details instead of re-asking (name/number
  from the injected context), capture request_callback, then answer any
  further questions normally with the full KB; never offer a transfer;
  never re-greet.
- `seedKnownBlock?: string` → appended to the knownDetails prompt var (NOT
  the cached account knowledge — per-conversation layer).
- `seedGhlContactId?: string` + `rescueSourceId?: string` → applied when the
  conversation row is CREATED (convergence + audit link).
- `callerPhone?: string` → stored on conversation create (voice only).

### 5. Watchdog (handlers/voice-transfer-watchdog.ts)

Job data += `conversationId` (the route knows it when arming).
New sequence (order matters — fetch before kill):
1. Find the stuck dial leg (existing pickStuckTransferLeg).
2. BEFORE killing: list in-progress conferences in the subaccount, find the
   conference whose participants include the stuck leg's callSid → the OTHER
   participant is the caller's leg sid (deterministic even with concurrent
   calls — no time-window guessing).
3. Kill the dial leg (existing).
4. Stamp the source conversation rescuePendingAt=now.
5. Redirect the caller leg: POST Calls/{callerSid} with
   Url=`${base}/api/agent/voice-rescue-twiml/${secret}` — caller leaves the
   conference, Twilio fetches our TwiML.
6. Every step logged; any failure leaves loud logs (worst case = today's
   behavior, never worse).
New twilio.ts helpers: `listConferences`, `listConferenceParticipants`,
`redirectCall` — plus a pure `findCallerLeg(conferences, participantsBySid,
stuckSid)` for tests.

### 6. TwiML endpoint (routes/voice-agent.ts)

`POST|GET /agent/voice-rescue-twiml/:secret` (Twilio webhooks may use either)
→ validate secret → config.rescueNumber:
- present: `<Response><Dial>{rescueNumber}</Dial></Response>` (text/xml).
  Do NOT set callerId — Twilio's default presents the original caller's
  number, which is exactly what the linking needs.
- absent (floor): `<Response><Say>…apology…</Say><Hangup/></Response>`.

### 7. GHL note context

executeCallback: when the conversation has rescueSourceId, prepend
"⚠️ Live transfer went unanswered before this callback was taken." to the
contact note (deterministic — not left to the model).

### 8. Tests

- voice-rescue resolver: exact phone match; single-candidate fallback;
  ambiguity → null; TTL expiry; consumed-stamp exclusion; concurrent-claim
  race (updateMany guard).
- shim: CALLER parsing (present, +prefixed, anonymous, template-uninterpolated).
- watchdog: findCallerLeg pure fn (conference matching incl. concurrent
  conferences); ordering documented.
- TwiML endpoint: xml shapes, secret validation, floor fallback.
- engine: message-mode overlay + seeded fields on conversation create.

### 9. Live verification (V3.2 — gates the feature)

1. Re-provision Coast → verify rescueAgentId + rescueNumber stored, agent
   visible in EL, number in subaccount.
2. Call → give name+number → ask for human → don't answer → 25s music →
   EXPECT: short ring → rescue agent apologizes, CONFIRMS the earlier
   name/number, callback lands on the SAME GHL contact, note carries the
   unanswered-transfer line, rescue conversation row has rescueSourceId.
3. Ask the rescue agent an FAQ (parking/hours) → full-KB answer.
4. Anonymous-caller variant (#31#/caller-id off) → single-stamp fallback
   still links.
5. Control: normal call an hour later → NO stale context (TTL/consume).
6. Capture the <Dial> caller-id presentation from the logs (Risk 1).

## Risks / verify-at-build

1. <Dial> caller-id default presenting the original From — believed default,
   MUST be confirmed in verification step 6; if wrong, linking relies on the
   single-stamp fallback (still safe, slightly weaker) or we set callerId to
   the clinic's AI number and match purely by stamp.
2. Twilio Conference resources shape (participant listing) — first live run
   confirms; pure-fn design isolates the parsing.
3. EL answering the internal number promptly — it's a normal inbound call to
   an imported number; no reason to differ from the main line.
4. Redirect race: caller hangs up during music before the watchdog fires →
   redirect 404s on a completed call → log + done (no-op, correct).

## Cost / effort

Per clinic: +1 Twilio number (~$1.15–3/mo, ours), +1 EL agent (free), rescue
minutes on the clinic's EL plan like any call. Build ≈ 1 day + the live test
cycle. No prompt-row (DB) changes — everything rides in code-side overlay
vars, so no prod prompt push is added by this feature.
