/**
 * Minimal Twilio REST client — voice-agent number supply
 * (.plans/voice-agent-elevenlabs.implementation-plan.md V2).
 *
 * ElevenLabs does not sell numbers (import-only), so WE supply them: one
 * Twilio SUBACCOUNT per clinic under our master account (scoped credentials
 * — importing a subaccount sid/token into the clinic's ElevenLabs workspace
 * never exposes the master account), one local voice number bought inside
 * it (~$1.15/mo, priced into the voice add-on).
 *
 * Master credentials: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN env. Absent env
 * degrades to a thrown, readable error the provisioner stores as lastError.
 */
import { withTimeout } from './net/with-timeout'

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
}

function masterAuth(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Twilio master credentials not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)')
  return { sid, token }
}

async function twilioFetch<T>(
  auth: { sid: string; token: string },
  path: string,
  init?: { method?: string; form?: Record<string, string> },
): Promise<T> {
  const res = await withTimeout(
    (signal) =>
      fetch(`${TWILIO_BASE}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${auth.sid}:${auth.token}`).toString('base64')}`,
          ...(init?.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(init?.form ? { body: new URLSearchParams(init.form).toString() } : {}),
        signal,
      }),
    30_000,
    `twilio ${path}`,
  )
  const data = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok) throw new Error(`Twilio ${path} failed (${res.status}): ${data.message ?? 'no details'}`)
  return data
}

/** Create (or reuse by friendly name would need a list — we store the sid) a subaccount. */
export async function createTwilioSubaccount(friendlyName: string): Promise<{ sid: string; authToken: string }> {
  const data = await twilioFetch<{ sid: string; auth_token: string }>(masterAuth(), '/Accounts.json', {
    method: 'POST',
    form: { FriendlyName: friendlyName },
  })
  return { sid: data.sid, authToken: data.auth_token }
}

/** Fetch a subaccount's auth token (needed again at ElevenLabs import time). */
export async function getTwilioSubaccountToken(subSid: string): Promise<string> {
  const data = await twilioFetch<{ auth_token: string }>(masterAuth(), `/Accounts/${subSid}.json`)
  return data.auth_token
}

export interface TwilioCallInfo {
  sid: string
  status: string
  to: string
  from?: string
  direction: string
  date_created: string
}

/** Recent calls in a subaccount (both directions; filter in code — the API's
 *  Status filter takes only one value). */
export async function listSubaccountCalls(sub: { sid: string; token: string }): Promise<TwilioCallInfo[]> {
  const data = await twilioFetch<{ calls?: TwilioCallInfo[] }>(sub, `/Accounts/${sub.sid}/Calls.json?PageSize=20`)
  return data.calls ?? []
}

/** Terminate one call leg (voice-transfer watchdog: kill a still-ringing dial). */
export async function endTwilioCall(sub: { sid: string; token: string }, callSid: string): Promise<void> {
  await twilioFetch<unknown>(sub, `/Accounts/${sub.sid}/Calls/${callSid}.json`, {
    method: 'POST',
    form: { Status: 'completed' },
  })
}

export interface TwilioConference {
  sid: string
  status: string
}

export interface TwilioParticipant {
  call_sid: string
}

/** In-progress conferences in the subaccount (voice-rescue caller discovery). */
export async function listConferences(sub: { sid: string; token: string }): Promise<TwilioConference[]> {
  const data = await twilioFetch<{ conferences?: TwilioConference[] }>(
    sub,
    `/Accounts/${sub.sid}/Conferences.json?Status=in-progress&PageSize=20`,
  )
  return data.conferences ?? []
}

export async function listConferenceParticipants(
  sub: { sid: string; token: string },
  conferenceSid: string,
): Promise<TwilioParticipant[]> {
  const data = await twilioFetch<{ participants?: TwilioParticipant[] }>(
    sub,
    `/Accounts/${sub.sid}/Conferences/${conferenceSid}/Participants.json`,
  )
  return data.participants ?? []
}

/** Live-call redirect: point an in-progress leg at new TwiML. */
export async function redirectTwilioCall(
  sub: { sid: string; token: string },
  callSid: string,
  url: string,
): Promise<void> {
  await twilioFetch<unknown>(sub, `/Accounts/${sub.sid}/Calls/${callSid}.json`, {
    method: 'POST',
    form: { Url: url, Method: 'POST' },
  })
}

export interface TwilioAddress {
  customerName: string
  street: string
  city: string
  region: string
  postalCode: string
  isoCountry: string
}

/** Create an Address resource in the subaccount (regulatory requirement for
 *  many countries incl. AU — verified live 2026-09-09: purchase 400s without it). */
export async function createTwilioAddress(sub: { sid: string; token: string }, addr: TwilioAddress): Promise<string> {
  const data = await twilioFetch<{ sid: string }>(sub, `/Accounts/${sub.sid}/Addresses.json`, {
    method: 'POST',
    form: {
      CustomerName: addr.customerName.slice(0, 100),
      Street: addr.street.slice(0, 100),
      City: addr.city.slice(0, 100),
      Region: addr.region.slice(0, 100),
      PostalCode: addr.postalCode.slice(0, 20),
      IsoCountry: addr.isoCountry,
    },
  })
  return data.sid
}

/**
 * Buy one voice-capable local number inside the subaccount. Country from the
 * clinic's brand country code (US default; AU supported — target market).
 * Countries with an address requirement (AU among them) get the clinic's own
 * address registered first; without address data the purchase error surfaces
 * as the stored lastError.
 */
export async function buyVoiceNumber(
  sub: { sid: string; token: string },
  countryCode: string,
  address?: TwilioAddress | null,
): Promise<{ phoneNumber: string; numberSid: string }> {
  const country = /^[A-Z]{2}$/.test(countryCode) ? countryCode : 'US'
  const avail = await twilioFetch<{ available_phone_numbers?: { phone_number: string }[] }>(
    sub,
    `/Accounts/${sub.sid}/AvailablePhoneNumbers/${country}/Local.json?VoiceEnabled=true&PageSize=1`,
  )
  const candidate = avail.available_phone_numbers?.[0]?.phone_number
  if (!candidate) throw new Error(`Twilio has no available local voice numbers for ${country}`)

  const buy = (form: Record<string, string>) =>
    twilioFetch<{ sid: string; phone_number: string }>(sub, `/Accounts/${sub.sid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      form,
    })

  try {
    const bought = await buy({ PhoneNumber: candidate })
    return { phoneNumber: bought.phone_number, numberSid: bought.sid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/address/i.test(msg) || !address) throw err
    const addressSid = await createTwilioAddress(sub, { ...address, isoCountry: country })
    const bought = await buy({ PhoneNumber: candidate, AddressSid: addressSid })
    return { phoneNumber: bought.phone_number, numberSid: bought.sid }
  }
}
