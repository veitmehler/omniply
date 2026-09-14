import { describe, it, expect } from 'vitest'
import {
  checkRedFlags,
  checkReply,
  emergencyNumberFor,
  redFlagReply,
  safeFallbackReply,
  stripPunctuationDashes,
} from '../guardrails'
import { computeOpenStatus } from '../hours'
import { validateAction } from '../tools'
import type { PlacePeriod } from '../../lib/google/places'

// ---------------------------------------------------------------------------
// Red-flag interception (pre-model)
// ---------------------------------------------------------------------------

describe('red-flag lexicon', () => {
  const MUST_CATCH: [string, string][] = [
    ['I have chest pain and my back hurts', 'cardiac'],
    ["I can't breathe properly since yesterday", 'breathing'],
    ['shortness of breath when I lie down', 'breathing'],
    ['numbness in my groin area', 'cauda-equina'],
    ['both legs are numb this morning', 'cauda-equina'],
    ['I lost bladder control last night', 'cauda-equina'],
    ["I can't pee since my back went out", 'cauda-equina'],
    ['I was in a car accident an hour ago', 'trauma'],
    ['fell off a ladder onto my back', 'trauma'],
    ['this is the worst headache of my life', 'headache'],
    ['sudden severe headache out of nowhere', 'headache'],
    ['I think my dad is having a stroke', 'stroke'],
    ['my face is drooping on one side', 'stroke'],
    ['one side of my body feels numb', 'stroke'],
    ['I passed out twice today', 'collapse'],
    ['my son had a seizure', 'seizure'],
    ['back pain with unexplained weight loss', 'cancer-sign'],
    ['I have been having suicidal thoughts', 'self-harm'],
    ['I want to hurt myself', 'self-harm'],
  ]
  it.each(MUST_CATCH)('catches: %s', (text, label) => {
    expect(checkRedFlags(text)).toBe(label)
  })

  it('catches fever + stiff neck together, neither alone', () => {
    expect(checkRedFlags('I have a fever and a really stiff neck')).toBe('infection')
    expect(checkRedFlags('I have a fever')).toBeNull()
    expect(checkRedFlags('my neck is stiff after sleeping badly')).toBeNull()
  })

  const MUST_PASS = [
    'my lower back hurts after gardening',
    'I get headaches at my desk',
    'do you treat neck pain?',
    'my leg has been tingling a bit',
    'how much is a first visit?',
    'are you open on Saturday?',
    'I strained my chest muscles at the gym', // muscles, not chest pain
    'the crash course on posture you posted was great',
  ]
  it.each(MUST_PASS)('passes benign: %s', (text) => {
    expect(checkRedFlags(text)).toBeNull()
  })
})

describe('emergency numbers', () => {
  it('maps launch-market countries', () => {
    expect(emergencyNumberFor('US')).toBe('911')
    expect(emergencyNumberFor('au')).toBe('000')
    expect(emergencyNumberFor('NZ')).toBe('111')
    expect(emergencyNumberFor('GB')).toBe('999')
    expect(emergencyNumberFor('DE')).toBe('112')
    expect(emergencyNumberFor('XX')).toBeNull()
    expect(emergencyNumberFor(null)).toBeNull()
  })

  it('reply carries the local number and a generic fallback', () => {
    expect(redFlagReply('cardiac', 'AU')).toContain('000')
    expect(redFlagReply('cardiac', null)).toContain('your local emergency number')
  })

  it('self-harm gets crisis wording, not urgent-care wording', () => {
    const reply = redFlagReply('self-harm', 'US')
    expect(reply).toContain('crisis')
    expect(reply).not.toContain('urgent care')
  })
})

// ---------------------------------------------------------------------------
// Reply post-filter (post-model)
// ---------------------------------------------------------------------------

describe('reply post-filter', () => {
  const MUST_BLOCK: [string, string][] = [
    ['It sounds like you have sciatica.', 'diagnosis'],
    ['You probably have a herniated disc.', 'diagnosis'],
    ['My diagnosis would be a pinched nerve.', 'diagnosis'],
    ['You should take ibuprofen before bed.', 'treatment-advice'],
    ['Try taking 400 mg every four hours.', 'treatment-advice'],
    ['Adjustments will cure your back pain.', 'outcome-promise'],
    ['We guarantee results within three visits.', 'outcome-promise'],
    ['This will fix your posture for good.', 'outcome-promise'],
    ['Mention this chat for a discount!', 'inducement'],
    ['We can offer you 20% off your first visit.', 'inducement'],
    ['Ask about our free adjustment for new patients.', 'inducement'],
    ["I'm a chiropractor, so trust me on this.", 'identity-claim'],
    ['We are the best clinic in town.', 'superlative'],
  ]
  it.each(MUST_BLOCK)('blocks: %s', (reply, reason) => {
    const verdict = checkReply(reply)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe(reason)
  })

  const MUST_ALLOW = [
    "I can't diagnose anything over chat, but the first visit is exactly how the team works out what's going on. Want me to help you book?",
    'Many patients come to us with exactly that. Whether care is right for you is what the first visit is for.',
    "We're open now until 6:00 PM — here's the booking page.",
    'The front desk can confirm pricing — would you like a callback?',
    "I'm an AI assistant, not a clinician, so I'll leave that one to the team.",
    'A standard first visit runs about 45 minutes, per the practice FAQ.',
    'No guarantees I can make on scheduling, but Tuesday looks like your best bet to call.',
  ]
  it.each(MUST_ALLOW)('allows: %s', (reply) => {
    expect(checkReply(reply).ok).toBe(true)
  })

  it('safe fallback includes the phone only when present', () => {
    expect(safeFallbackReply('Coast Chiro', '07 5555 1234')).toContain('07 5555 1234')
    expect(safeFallbackReply('Coast Chiro', null)).not.toContain('call on')
  })
})

// ---------------------------------------------------------------------------
// Open-now computation
// ---------------------------------------------------------------------------

describe('open-now computation', () => {
  // Mon–Fri 8:00–18:00 (day 1..5), Places day 0=Sunday, times HHMM.
  const WEEKDAYS: PlacePeriod[] = [1, 2, 3, 4, 5].map((day) => ({
    open: { day, time: '0800' },
    close: { day, time: '1800' },
  }))
  const WEEKDAY_TEXT = [
    'Monday: 8:00 AM – 6:00 PM',
    'Tuesday: 8:00 AM – 6:00 PM',
    'Wednesday: 8:00 AM – 6:00 PM',
    'Thursday: 8:00 AM – 6:00 PM',
    'Friday: 8:00 AM – 6:00 PM',
    'Saturday: Closed',
    'Sunday: Closed',
  ].join('\n')
  // Brisbane-ish offset +600. 2026-08-04 is a Tuesday.
  const TUE_2PM_LOCAL = new Date('2026-08-04T04:00:00Z') // 14:00 local at +600
  const TUE_7PM_LOCAL = new Date('2026-08-04T09:00:00Z') // 19:00 local
  const SAT_NOON_LOCAL = new Date('2026-08-08T02:00:00Z') // Saturday 12:00 local

  it('open mid-period with closing time', () => {
    const s = computeOpenStatus(WEEKDAYS, 600, WEEKDAY_TEXT, TUE_2PM_LOCAL)
    expect(s.known).toBe(true)
    expect(s.openNow).toBe(true)
    expect(s.verdict).toBe('Open now — closes at 6:00 PM.')
    expect(s.todayLine).toContain('Tuesday')
    expect(s.localTime).toBe('Tuesday 2:00 PM')
  })

  it('closed evening → opens tomorrow', () => {
    const s = computeOpenStatus(WEEKDAYS, 600, WEEKDAY_TEXT, TUE_7PM_LOCAL)
    expect(s.openNow).toBe(false)
    expect(s.verdict).toBe('Closed now — opens tomorrow at 8:00 AM.')
  })

  it('closed Saturday → opens Monday (named day)', () => {
    const s = computeOpenStatus(WEEKDAYS, 600, WEEKDAY_TEXT, SAT_NOON_LOCAL)
    expect(s.openNow).toBe(false)
    expect(s.verdict).toBe('Closed now — opens Monday at 8:00 AM.')
  })

  it('handles overnight periods across the week wrap', () => {
    // Sat 20:00 → Sun 02:00
    const overnight: PlacePeriod[] = [{ open: { day: 6, time: '2000' }, close: { day: 0, time: '0200' } }]
    const satNight = new Date('2026-08-08T13:00:00Z') // Sat 23:00 at +600
    const s = computeOpenStatus(overnight, 600, null, satNight)
    expect(s.openNow).toBe(true)
  })

  it('24/7 place', () => {
    const s = computeOpenStatus([{ open: { day: 0, time: '0000' } }], 600, null, TUE_2PM_LOCAL)
    expect(s.openNow).toBe(true)
    expect(s.verdict).toBe('Open 24 hours.')
  })

  it('negative UTC offsets (US) compute local day correctly', () => {
    // 2026-08-05T02:00Z = Tue 21:00 in Chicago (-300) → closed, opens tomorrow.
    const s = computeOpenStatus(WEEKDAYS, -300, WEEKDAY_TEXT, new Date('2026-08-05T02:00:00Z'))
    expect(s.openNow).toBe(false)
    expect(s.verdict).toBe('Closed now — opens tomorrow at 8:00 AM.')
    expect(s.localTime).toContain('Tuesday')
  })

  it('unknown without periods or offset', () => {
    expect(computeOpenStatus(undefined, 600, null).known).toBe(false)
    expect(computeOpenStatus(WEEKDAYS, undefined, null).known).toBe(false)
    expect(computeOpenStatus([], 600, null).known).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Action whitelist validation
// ---------------------------------------------------------------------------

describe('action validation', () => {
  const CTX = { guideSlugs: ['desk-workers-survival-guide', 'better-sleep-without-pills'], bookingAvailable: true, hasContact: false }

  it('booking link only when booking is available', () => {
    expect(validateAction({ type: 'send_booking_link' }, CTX)).toEqual({ type: 'send_booking_link', phone: null })
    expect(validateAction({ type: 'send_booking_link' }, { ...CTX, bookingAvailable: false })).toBeNull()
  })

  it('guide offers only for live slugs', () => {
    expect(validateAction({ type: 'offer_guide', slug: 'desk-workers-survival-guide' }, CTX)).toEqual({
      type: 'offer_guide',
      slug: 'desk-workers-survival-guide',
    })
    expect(validateAction({ type: 'offer_guide', slug: 'made-up-guide' }, CTX)).toBeNull()
  })

  it('capture requires a valid email; name is optional; junk fields degrade to null', () => {
    const a = validateAction(
      { type: 'capture_contact', name: ' Sam ', email: 'Sam@Example.com', phone: '123', guideSlug: 'nope' },
      CTX,
    )
    expect(a).toEqual({ type: 'capture_contact', name: 'Sam', email: 'sam@example.com', phone: null, guideSlug: null })
    // Email-only capture is valid (the guide must still be delivered — a
    // missing name silently killed real captures before; name backfills via
    // known-details reconciliation).
    expect(validateAction({ type: 'capture_contact', name: '', email: 'sam@example.com' }, CTX)).toEqual({
      type: 'capture_contact',
      name: null,
      email: 'sam@example.com',
      phone: null,
      guideSlug: null,
    })
    expect(validateAction({ type: 'capture_contact', name: 'Sam', email: 'not-an-email' }, CTX)).toBeNull()
  })

  it('callback requires name + plausible phone', () => {
    expect(validateAction({ type: 'request_callback', name: 'Sam', phone: '+61 400 111 222', reason: 'pricing' }, CTX)).toEqual({
      type: 'request_callback',
      name: 'Sam',
      phone: '+61 400 111 222',
      reason: 'pricing',
      preferredTime: null,
    })
    expect(validateAction({ type: 'request_callback', name: 'Sam', phone: '123', reason: 'x' }, CTX)).toBeNull()
  })

  it('send_guide_link only for live slugs (decline-email fallback)', () => {
    expect(validateAction({ type: 'send_guide_link', slug: 'desk-workers-survival-guide' }, CTX)).toEqual({
      type: 'send_guide_link',
      slug: 'desk-workers-survival-guide',
      phone: null,
    })
    expect(validateAction({ type: 'send_guide_link', slug: 'unknown' }, CTX)).toBeNull()
  })

  it('add_contact_email only fires once the conversation has a contact', () => {
    expect(validateAction({ type: 'add_contact_email', email: 'sam@example.com' }, CTX)).toBeNull()
    expect(validateAction({ type: 'add_contact_email', email: 'Sam@Example.com' }, { ...CTX, hasContact: true })).toEqual({
      type: 'add_contact_email',
      email: 'sam@example.com',
    })
    expect(validateAction({ type: 'add_contact_email', email: 'junk' }, { ...CTX, hasContact: true })).toBeNull()
  })

  it('rejects unknown types, injection-shaped and non-object input', () => {
    expect(validateAction({ type: 'delete_all_data' }, CTX)).toBeNull()
    expect(validateAction({ type: 'send_booking_link; DROP TABLE' }, CTX)).toBeNull()
    expect(validateAction('send_booking_link', CTX)).toBeNull()
    expect(validateAction(null, CTX)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Widget surfaces
// ---------------------------------------------------------------------------

import { AGENT_LOADER_JS, buildAgentPanelHtml } from '../widget'

describe('widget surfaces', () => {
  it('panel embeds the token and talks same-origin', () => {
    const html = buildAgentPanelHtml('tok_ABC123456789012345')
    expect(html).toContain("var TOKEN = 'tok_ABC123456789012345'")
    expect(html).toContain("var API = '/api/agent'")
    expect(html).toContain('noindex')
    expect(html).toContain('op-agent-close')
  })

  it('loader validates the token shape and namespaces once', () => {
    expect(AGENT_LOADER_JS).toContain('/^[A-Za-z0-9_-]{16,64}$/')
    expect(AGENT_LOADER_JS).toContain('__opAgentLoaded')
    expect(AGENT_LOADER_JS).toContain("'/api/agent/w/'")
  })
})

describe('stripPunctuationDashes', () => {
  it('replaces em/en dashes and spaced hyphens with commas', () => {
    expect(stripPunctuationDashes('We open at 8 — closed Sundays')).toBe('We open at 8, closed Sundays')
    expect(stripPunctuationDashes('Great question – the team can help')).toBe('Great question, the team can help')
    expect(stripPunctuationDashes('Book a visit - it takes a minute')).toBe('Book a visit, it takes a minute')
  })

  it('leaves word-internal hyphens intact', () => {
    expect(stripPunctuationDashes('X-ray and well-being checks')).toBe('X-ray and well-being checks')
    expect(stripPunctuationDashes('a walk-in on a drop-off day')).toBe('a walk-in on a drop-off day')
  })

  it('cleans up doubled punctuation from replacements', () => {
    expect(stripPunctuationDashes('Sure! — the front desk can help')).toBe('Sure! the front desk can help')
    expect(stripPunctuationDashes('open now, — until 6pm')).toBe('open now, until 6pm')
  })
})
