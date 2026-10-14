# Direct Agent Booking (MCP) — Implementation Plan

Status: PLANNED 2026-10-14. Priority: MUST (the sales video claims AI
assistants can talk to the practice and book — today that is only true for
browser-driving agents via the widget; this makes it true by protocol).
Validated demand: a third-party AI (Claude Cowork) already booked through
the widget UI on 2026-10-13 — this is the same capability without a browser.

## Thesis

Expose each clinic's existing, battle-tested booking executors as a
per-clinic **MCP server** (Model Context Protocol — the standard Claude,
ChatGPT and Gemini-class agents speak), plus a **discovery trail** on the
clinic's website so agents can find it. No new booking logic: an MCP-shaped
façade over `agent/actions.ts`.

## Architecture

### Endpoint & auth
- `POST https://svc.omniply.io/mcp/{agentMcpToken}` — MCP Streamable HTTP
  (JSON-RPC: `initialize`, `tools/list`, `tools/call`; notifications
  minimal). One endpoint per clinic, resolved by token → account.
- **New column `accounts.agentMcpToken`** (random, like agentWidgetToken but
  SEPARATE so it is revocable independently). Minted at agent provisioning +
  backfilled for existing accounts.
- Trust model = the public widget's: booking is a public front-desk
  capability; patient agents must not need OAuth. Mitigations instead of
  identity: per-token+IP rate limits (new limiter, tight: e.g. 10 calls/min,
  3 bookings/hour/IP), E.164 phone validation, slot re-validation (below),
  audit trail, env kill-switch `AGENT_MCP_ENABLED=0`.

### Tools (all mapping to EXISTING executors — no new side-effect code)
| Tool | Maps to | Notes |
|---|---|---|
| `get_clinic_info` | known.ts / KB (hours, services, address, booking policy) | read-only; lets the agent answer prerequisites |
| `get_availability` | the chat agent's availability source (booking provider + cache) | returns the same slot list the chat agent offers |
| `book_appointment {name, phone, slotStart, email?}` | `executeBookAppointment` (actions.ts) — contact upsert, tags, provider.book, agentAppointment row, booking_time field, note | **slot re-validation added**: `slotStart` MUST be in the current availability set (the chat flow guarantees this socially; a protocol client must be checked server-side) |
| `request_callback {name, phone, preferredTime?, reason?}` | existing callback executor | the path for phone-only clinics and no-slot cases |

- **Mode gating** mirrors chat: `isDirectMode(agentBookingMode)` → all four
  tools; phone-only clinics → info + callback only (tools/list reflects it,
  so agents see an honest capability surface).
- Booking contact tagging: reuse `appointment-booked` (+ new `mcp-agent-lead`
  alongside `chat-agent-lead`) so all snapshot workflows (confirmation
  email/SMS — just fixed) fire identically. Contact note says "booked by an
  AI assistant via direct agent connection".

### Observability & hygiene
- Create an `agent_conversations` row with **channel='mcp'** per MCP session
  (Mcp-Session-Id header), tool calls logged as messages → admin surfaces,
  CONFIRMED-BOOKINGS context, and the **demo nightly sweep work unchanged**
  (agentAppointment rows are the same table).
- Structured logs per call; error-rate alert via sendFailureAlert after N
  consecutive failures; bookings-by-channel visible in admin.
- No LLM in this path → zero marginal AI cost; GHL/provider API calls only.

### Discovery trail (the half that makes the claim real)
1. **Omniply Connect plugin head push** (surface already exists and is
   automatic since 2026-10-09): add
   `<link rel="mcp-server" href="https://svc.omniply.io/mcp/{token}">` +
   `<meta name="ai-agent-booking" content="...">` to every page's head.
2. **`/.well-known/omniply-agent.json`** served by the plugin on the
   clinic's own domain: `{ mcp: {endpoint}, capabilities: [...], clinic:
   {name, phone, booking_page} }` — agents probing well-known paths find it.
3. **Schema extension**: the published MedicalClinic entity's
   `potentialAction` (ReserveAction, already live) gains the MCP endpoint as
   an `EntryPoint` alongside the human booking page.
4. (Stretch, backlog) `llms.txt` generation; A2A bridge; NLWeb manifest.

## Phases

**Phase 1 — Core server (~1 day):** `src/mcp/` module (minimal spec-correct
JSON-RPC handler or official TS SDK — decide at build start; SDK preferred
if its HTTP transport mounts cleanly on Fastify), 4 tools, token auth,
rate limits, slot re-validation, channel='mcp' logging, kill-switch.
Enabled for the DEMO account only.

**Phase 2 — Discovery (~0.5 day):** `agentMcpToken` column + mint/backfill,
plugin head tags + well-known endpoint, schema EntryPoint, public
"For AI agents" page on omniply.io documenting the protocol (doubles as
marketing proof).

**Phase 3 — Proof + rollout (~0.5 day):** live E2E: Claude (claude mcp add)
books a demo appointment end-to-end, screenshots/recording for marketing;
then flip on for all clinics; help-doc article ("Your practice speaks to AI
assistants directly"); sales-video claim now literally true two ways
(browser agents via widget — proven 2026-10-13 — and protocol agents via MCP).

## Risks / decisions
- **Spam bookings**: rate limits + E.164 + slot validation + the demo sweep;
  if abused in the wild, add a per-clinic toggle + optional "agent bookings
  land as callback requests" soft mode (config exists: agentBookingConfig).
- **GHL API quota**: availability calls cached (existing cache); limiter
  bounds the rest.
- **Token in public head**: same exposure class as agentWidgetToken (already
  public); separate token keeps revocation surgical.
- **Spec drift**: MCP Streamable HTTP is the 2025+ stable transport; pin to
  it, skip legacy SSE.

## Explicitly out of scope (backlog)
A2A protocol bridge, NLWeb, llms.txt, multi-language tool descriptions,
rescheduling/cancellation tools (needs identity — design later with
confirmation-code auth), EHR/PMS write-through beyond the existing booking
provider abstraction.
