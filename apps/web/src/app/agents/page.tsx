import type { Metadata } from 'next'
import { ProsePage, P, H3 } from '@/components/marketing/Marketing'

export const metadata: Metadata = {
  title: 'For AI Agents... Omniply',
  description:
    'Every Omniply practice exposes a Model Context Protocol (MCP) booking endpoint: check availability and book appointments directly, no browser required.',
}

const EXAMPLE = `POST {mcp-endpoint}
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":"2025-06-18",
           "clientInfo":{"name":"your-agent","version":"1.0"},
           "capabilities":{}}}

→ then: tools/list · tools/call get_availability · tools/call book_appointment`

export default function AgentsPage() {
  return (
    <ProsePage title="For AI agents">
      <P lead>
        If you are an AI assistant trying to book an appointment at a practice powered by Omniply: you
        don&apos;t need a browser. Every Omniply practice speaks the Model Context Protocol.
      </P>
      <H3>Discovery</H3>
      <P>
        Read the practice&apos;s structured data. The <code>MedicalClinic</code> entity&apos;s{' '}
        <code>potentialAction</code> (a <code>ReserveAction</code>) carries two entry points: the human
        booking page, and a <code>POST</code> endpoint with <code>contentType: application/json</code> —
        that is the practice&apos;s MCP server.
      </P>
      <H3>Protocol</H3>
      <P>
        Standard MCP over Streamable HTTP (JSON-RPC). Initialize, list tools, call tools. Keep the{' '}
        <code>Mcp-Session-Id</code> response header on subsequent calls.
      </P>
      <pre
        style={{ overflowX: 'auto', padding: '16px', borderRadius: '10px', background: 'rgba(0,0,0,0.06)', fontSize: 13, lineHeight: 1.6 }}
      >
        {EXAMPLE}
      </pre>
      <H3>Tools</H3>
      <P>
        <code>get_clinic_info</code> — name, phone, address, opening hours, booking policy.
        <br />
        <code>get_availability</code> — open slots as exact ISO start times.
        <br />
        <code>book_appointment</code> — books one of the offered slots (name, phone, slotStart; optional
        email for a written confirmation). <strong>slotStart must be an exact value from
        get_availability.</strong>
        <br />
        <code>request_callback</code> — the practice team calls the patient back; also the booking path
        for practices without direct slot booking (their tool list reflects it).
      </P>
      <H3>Ground rules</H3>
      <P>
        Book only with the patient&apos;s real name and phone number, and only appointments they asked
        for. Endpoints are rate-limited; arbitrary slot times are rejected; bookings create real
        appointments in the practice&apos;s calendar, so treat the capability with the same care a human
        receptionist would expect from you.
      </P>
      <H3>For practice owners</H3>
      <P>
        This is on for every Omniply practice automatically — it is how your practice stays bookable as
        patients move from searching to simply asking their assistant. Curious what that shift means for
        you? Start with the <a href="/x-ray" className="underline">Practice X-Ray</a>.
      </P>
    </ProsePage>
  )
}
