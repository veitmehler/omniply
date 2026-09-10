# Voice SMS Delivery — "I'll text you the link" made real (via GHL)

Status: BUILT on staging 2026-09-10. Implementation notes vs plan:
- sendGhlConversationMessage (existing, type SMS) reused — no new client fn.
- Capability probe = ATTEMPT-AND-LATCH: voiceSmsAvailable defaults true and
  latches false on the first failed send (flag sms-failed:*, loud log);
  overlays branch on it per call. No clean GHL pre-probe exists.
- Guide link = the guide's driveLink (same link the DM/web transports
  deliver) — consistent across channels; trigger links stay with the
  comment funnel.
- preferredTime shipped for ALL transports (agent_system CALLBACK FLOW
  step 5 + voice overlays); "Callback Preferred Time" custom field
  find-or-create; note line; snapshot guide documents the merge field.
LIVE VERIFICATION (plan §7) still pending — needs an SMS-capable location
(dev/snapshot location may lack LeadConnector phone; Azavea or the
simonchiro location are the candidates). Companion to .plans/voice-agent-elevenlabs and
voice-rescue-agent plans.

## Problem (live call 2026-09-10)

The voice agent promised "I'll text you our booking number", then spelled a
phone number aloud — because NO SMS pipe exists on the voice transport. The
interim truthfulness fix (shipped same day) forbids text promises entirely:
guides go by email (capture_contact — working pipe), booking by phone number
or callback. This plan builds the real thing, because "text me the link" is
the natural phone-call expectation and the best conversion path.

## Design principles

- Delivery rides on the CLINIC's GHL location (LeadConnector SMS) — the
  channel their patients already receive practice SMS from, no new vendor,
  no per-message cost to us. NOT Twilio-direct from our subaccount: the AI
  number should never become an unmonitored SMS thread, and GHL keeps every
  message visible to the front desk in the conversation stream.
- Reuse the existing artifacts: guide TRIGGER LINKS (built for the DM
  funnel — tracked, rotating, already per-account) and bookingUrl. The SMS
  body is deterministic (template), never model-authored.
- The engine stays the brain: the model attaches the SAME actions
  (send_guide_link / send_booking_link); only the EXECUTION layer grows a
  voice branch. All guardrails/validation unchanged.

## Caller-number handling (the consent moment)

1. Caller-ID present (AgentConversation.callerPhone, live since the rescue
   build): the agent CONFIRMS, never assumes silently — "I'll text it to the
   number you're calling from, ending in <last 3 digits> — okay?" On yes →
   action; on "use another number" → digit read-back flow (existing rule).
2. No caller-ID (anonymous): ask for the mobile, read back digit by digit
   (existing rule), then attach.
3. The action's phone field: extend send_guide_link / send_booking_link with
   an optional `phone` argument for the voice channel (tools.ts validation:
   digits length ≥6; normalized via normalizePhoneE164 with the clinic
   country — the +1074… lesson).

## Implementation

### 1. GHL SMS sender (lib/ghl/client.ts)

`sendGhlSms(apiKey, contactId, body)` → POST /conversations/messages
{ type: 'SMS', contactId, message } (same API family as the DM sender; SMS
type verified at build start — first task, one curl against the dev
location). Failure = loud log + flag `sms-failed:<action>` on the
conversation (never silent).

### 2. Action execution voice branch (agent/actions.ts)

For channel 'voice' with a phone on the action (or conversation.callerPhone):
- Converge/create the GHL contact by phone (existing upsert path).
- send_guide_link → SMS template:
  "<Practice>: here is your <guide title> — <trigger link URL>. Reply STOP
  to opt out." (trigger links already resolve per account; the STOP line is
  carrier compliance).
- send_booking_link → SMS template with bookingUrl. Only offered when
  bookingUrl exists (knowledge line already gates this).
- Tag `sms-sent` + note on the contact (front-desk visibility).

### 3. Engine prompt (voice overlays)

Replace the shipped "never promise texts" rules with capability-aware ones:
- "When the caller wants the guide or booking link, offer to TEXT it: if
  CALLER KNOWN, confirm the calling number first; otherwise ask for their
  mobile and read it back. Attach the action WITH the confirmed number.
  Email remains the alternative if they prefer."
- Message-mode overlay: same, after the callback is captured.

### 4. Rate/abuse guards

- Max 3 SMS per conversation (deterministic counter on the conversation).
- Only to numbers confirmed in-conversation (action-supplied or caller-ID
  confirmed verbally — the transcript is the audit trail).
- Never SMS when the clinic's GHL location lacks SMS capability: probe once
  at provisioning (send capability check), store voiceSmsAvailable on
  VoiceAgentConfig; overlay falls back to the email rules when false.

### 5. Structured callback time (folded in 2026-09-10, user request)

Live V3 call proved the model already captures a requested time — but only
inside the free-text reason ("Parking question; prefers callback around
10:30 AM"). Make it structured so GHL automation can act on it:
- tools.ts: `request_callback` gains optional `preferredTime` (string, the
  caller's words verbatim — "around 10:30 AM", "tomorrow morning"; NO
  server-side date parsing in v1, it's for humans and merge fields).
- Engine prompts (voice overlays + agent_system callback flow): when the
  caller names a time, put it in preferredTime AND read it back with the
  number confirmation.
- executeCallback: write it to a "Callback Preferred Time" custom field
  (find-or-create, same pattern as Chat Summary) + its own note line
  ("Preferred time: …") — so the snapshot's Chat Callback Request workflow
  can merge {{contact.callback_preferred_time}} into the front-desk SMS.
- Snapshot guide update: mention the new merge field for the notification
  template (user maintains the snapshot workflows).

### 6. Tests

- tools.ts: phone arg validation on both actions (voice-only, normalized).
- actions: voice branch → sendGhlSms called with template + trigger link;
  sms-failed flagging; 3-per-conversation cap.
- engine overlay: capability-aware text (string assertions).
- Template purity: no model text in SMS bodies.

### 7. Live verification

1. Widget/DM regression: actions unchanged off-voice.
2. Voice call: ask for the guide → confirm calling number → SMS arrives with
   working trigger link; GHL shows the message + tag on the contact.
3. Anonymous call: agent asks for mobile, read-back, SMS arrives.
4. Decline the text → email path still offered (capture_contact).
5. Booking link variant on an account WITH bookingUrl.
6. Callback with a named time → preferredTime in the action, custom field
   set, note line present, merge field renders in the notification.

## Effort

~half a day + verification. Prereq check at build start: GHL SMS message
type + the dev location's SMS capability (it's a snapshot location — may
have no phone; use Azavea or wait for simonchiro's location if needed).
