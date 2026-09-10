'use client'

/**
 * Pre-launch notify pitch (prelaunch-waitlist plan; format user-locked
 * 2026-08-08): centered accent heading, 30px-padded pitch, centered button
 * "Please notify me when it goes live", small centered under-text.
 * One-click join when the visitor's X-Ray lead is in localStorage (same
 * origin as /x-ray); otherwise routes to the quiz first.
 */
import { useEffect, useState } from 'react'
import { TOKENS } from './Marketing'

const LAUNCH_TS = Date.parse('2026-09-22T14:00:00Z')
const JOINED_KEY = 'omniply-founding-joined'
const LEAD_KEY = 'omniply-xray-v1'

const PITCH =
  'Your X-Ray just showed you where patients quietly slip away. When Omniply goes live, the first twelve practices receive concierge onboarding: we build your entire system together in a live working session... your voice, your calendar, your first month of content... so you learn it while it takes shape. Those twelve also keep their monthly rate locked from day one, for as long as they stay. Once the twelve places are filled, the doors close while we get them up and running.'

function storedLead(): { name?: string; email?: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LEAD_KEY) ?? 'null') as { lead?: { name?: string; email?: string } } | null
    return saved?.lead ?? null
  } catch {
    return null
  }
}

export function FoundingNotify() {
  const [state, setState] = useState<'idle' | 'form' | 'busy' | 'joined'>('idle')
  const [email, setEmail] = useState('')
  useEffect(() => {
    try {
      if (localStorage.getItem(JOINED_KEY)) setState('joined')
    } catch {
      /* noop */
    }
  }, [])

  if (Date.now() >= LAUNCH_TS) return null

  async function joinWith(joinEmail: string, name?: string) {
    setState('busy')
    try {
      const api = /^staging\./.test(window.location.hostname) ? 'https://staging-svc.omniply.io' : 'https://svc.omniply.io'
      const res = await fetch(`${api}/api/marketing/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name ?? '', email: joinEmail }),
      })
      if (!res.ok) throw new Error(`http ${res.status}`)
      try {
        localStorage.setItem(JOINED_KEY, '1')
      } catch {
        /* noop */
      }
      setState('joined')
    } catch {
      setState('idle')
    }
  }

  function join() {
    const lead = storedLead()
    if (lead?.email) void joinWith(lead.email, lead.name)
    else setState('form') // no email on file: inline opt-in, never a dead end
  }

  return (
    <div
      className="my-10 rounded-2xl px-6 py-10 md:px-10"
      style={{ background: `linear-gradient(180deg, ${TOKENS.ink}, ${TOKENS.inkDeep})`, color: '#fff' }}
    >
      <div className="text-center text-3xl font-bold md:text-4xl" style={{ color: TOKENS.lime }}>
        Omniply opens September&nbsp;22
      </div>
      <p className="text-center text-[18px] leading-relaxed md:text-[20px]" style={{ padding: '30px 0', color: '#fff' }}>
        {PITCH}
      </p>
      <div className="flex flex-col items-center gap-3">
        {state === 'joined' ? (
          <div className="rounded-xl px-10 py-5 text-lg font-bold" style={{ background: 'rgba(195,244,59,0.12)', color: TOKENS.lime }}>
            You&apos;re on the list ✓
          </div>
        ) : state === 'form' ? (
          <form
            className="w-full max-w-sm"
            onSubmit={(e) => {
              e.preventDefault()
              if (email.trim()) void joinWith(email.trim())
            }}
          >
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your best email"
              autoComplete="email"
              className="w-full border-0 border-b bg-transparent py-3 text-center text-[17px] text-white outline-none placeholder:opacity-40 focus:border-[#C3F43B]"
              style={{ borderColor: 'rgba(255,255,255,0.35)' }}
            />
            <button
              type="submit"
              className="mx-auto mt-4 block rounded-xl px-10 py-4 text-lg font-bold shadow-lg transition-transform hover:scale-[1.02]"
              style={{ background: TOKENS.lime, color: '#0B0B0C' }}
            >
              Please notify me when it goes live
            </button>
          </form>
        ) : (
          <button
            onClick={join}
            disabled={state === 'busy'}
            className="rounded-xl px-10 py-5 text-lg font-bold shadow-lg transition-transform hover:scale-[1.02] disabled:opacity-60"
            style={{ background: TOKENS.lime, color: '#0B0B0C' }}
          >
            {state === 'busy' ? 'One moment…' : 'Please notify me when it goes live'}
          </button>
        )}
        <p className="text-center text-sm opacity-70">
          {state === 'joined'
            ? 'We will email you the moment the doors open.'
            : 'No spam. One email when the doors open.'}
        </p>
      </div>
    </div>
  )
}
