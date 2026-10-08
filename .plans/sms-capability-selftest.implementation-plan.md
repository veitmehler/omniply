# SMS Capability Self-Test + Text-a-Guide — Implementation Plan

**Status: PLANNED (post-launch build; design LOCKED with Veit 2026-10-08).**
Builds the automatic answer to "can this clinic actually deliver SMS?" and
unlocks the web-chat "text it or email it?" guide offer. Origin: C3 red-team
probe 16 discussion + the two live deliverability tests of 2026-10-08.

## The problem (proven empirically 2026-10-08)

- GHL's public API exposes NO Trust Center / A2P registration state.
- "A number exists" is NOT "SMS delivers": the demo line sent 201-accepted
  messages where the US-destined one FAILED with the explicit, machine-readable
  carrier error **30034 "Number not A2P compliant"**, while an international
  (+1-829 DR) send DELIVERED — A2P gates US-destined traffic only.
- Therefore the registration state is invisible but its EFFECT is perfectly
  observable via the messages API delivery status. We probe reality instead of
  modelling bureaucracy. (Same mechanism works for non-US clinics — the probe
  doesn't care WHY a message delivers or fails.)

## Locked design (Veit, 2026-10-08)

**Sink number: `+1 210-960-8070`** — our own inbound-capable number, the
single probe target for every clinic. CONFIRMED (Veit 2026-10-08): it is a
**Twilio number on the Twilio account we are already connected to**, so
receipts are read via the Twilio inbound-messages API (poll
`Messages.list({ to: sink })` after each probe, or a webhook later if volume
ever warrants it) using the existing Twilio credentials.

1. **Pre-gate:** location has no SMS-capable number at all (numbers API) →
   `smsAvailable = false`, no probing.
2. **Sink probe (the verification):** send one SMS from the clinic's number to
   the sink — body carries the accountId token
   (`Omniply self-test · <accountId>`) so receipts match to accounts. Verify by
   RECEIPT at the sink (stronger than the carrier's "delivered" ack); the
   delivery-status poll is the fallback check and the error diagnoser.
3. **Outcome handling:**
   - receipt/delivered → `smsAvailable = true`, STOP probing.
   - failed 30034 (A2P pending) → stay false, **re-probe daily** until clear
     (~1 SMS/day ≈ a cent while pending; zero at steady state).
   - other failure classes → stay false + alert for human look (unexpected).
4. **Owner confirmation (fire-and-forget, Veit's design):** the moment the
   flag flips true, send ONE message to the account owner's number on file:
   `"✓ - Texting is now live for your chat and voice AI assistants!"`
   Mobile → nice moment; landline → silent failure, deliberately unhandled.
   **MUST be exempt from the downgrade logic** (a landline error here must
   never flip the just-proven flag).
5. **Runtime self-healing:** only PATIENT-FACING sends, and only A2P-class
   errors (30034 family), downgrade `smsAvailable` to false + alert → clinic
   re-enters the daily probe loop. Celebration/test sends never downgrade.

## Storage + consumers

- Flag: promote the existing `voiceSmsAvailable` (voice config, manually set
  today) to the account-wide `smsAvailable` this loop maintains; keep a manual
  admin override for support situations.
- Consumers:
  - **Voice agent** (existing): texted booking links / guide links — stops
    needing the manual flag.
  - **Web chat (NEW — the probe-16 enhancement):** when `smsAvailable`, the
    guide-delivery prompt offers "I can text it or email it — which do you
    prefer?"; text path = existing `send_guide_link` with the phone field
    (action + validator already support it). Email path unchanged and remains
    the default when SMS is off: capture_contact → GHL contact + per-guide
    `ghlTagNames`/`leadgen-<slug>` tag → drip workflow + Drive grant-all.

## Build order (one deploy, small)

1. `smsAvailable` flag promotion + numbers-API pre-gate.
2. Probe job (pg-boss cron, daily tick over accounts where flag=false AND a
   number exists) + receipt reader for the sink + 30034 discrimination.
3. Flip-time owner confirmation send (exempted from downgrade).
4. Runtime downgrade hook on patient-facing send failures.
5. Web-chat prompt addition (text-or-email guide offer) gated on the flag.
6. Settings surface: read-only "Texting: live / pending registration" line in
   the chat/voice sections (no toggle needed — the loop is automatic).

## Verification

- Replay the 2026-10-08 scenario on the demo account: while A2P pending →
  probe fails 30034, flag stays off, web chat offers email only. After A2P
  approval → next daily probe flips the flag, owner text arrives, chat offers
  both channels. (The manual test scripts from 2026-10-08 are the prototype:
  scratchpad `sms-test.mjs`.)
- Landline owner number: flag stays true, no downgrade, no error surfaced.

## Explicitly out of scope

- Reading A2P registration status directly (no public API).
- Per-country sender-ID modelling (the probe covers all countries uniformly).
- Any launch-week changes: this whole plan is POST-LAUNCH by decision
  (2026-10-08) — email guide delivery already works and captures the lead.
