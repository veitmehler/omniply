'use client'

/**
 * Marketing contact form (brand design system: boxed fields on a light page).
 * Posts through /api/marketing-contact (same-origin proxy) so the inquiry
 * lands in Azavea's GHL Conversations inbox.
 */
import { useState } from 'react'
import { Btn, Callout } from '@/components/marketing/Marketing'

export function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/marketing-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Something went wrong.')
      }
      setState('sent')
      form.reset()
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (state === 'sent') {
    return (
      <Callout inset>
        <p className="om-p">
          <strong>Message sent.</strong> We read every message and reply within one business day.
        </p>
      </Callout>
    )
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 24 }}>
      <div className="om-grid cols-2">
        <label className="om-field">
          <span>Name</span>
          <input name="name" required maxLength={100} placeholder="Dr. Jane Miller" className="om-input" />
        </label>
        <label className="om-field">
          <span>Email</span>
          <input name="email" type="email" required maxLength={254} placeholder="you@yourpractice.com" className="om-input" />
        </label>
      </div>
      <label className="om-field">
        <span>Practice (optional)</span>
        <input name="practice" maxLength={150} placeholder="Your practice name and city" className="om-input" />
      </label>
      <label className="om-field">
        <span>Message</span>
        <textarea name="message" required maxLength={4000} rows={5} placeholder="What would you like to know?" className="om-input" />
      </label>
      {/* Honeypot: hidden from humans, filled by naive bots */}
      <input name="website" tabIndex={-1} autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
      {state === 'error' && <p className="om-p" style={{ color: '#b3261e' }}>{error}</p>}
      <div>
        <Btn type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send message'}
        </Btn>
      </div>
    </form>
  )
}
