import { describe, it, expect } from 'vitest'
import { detectSelfIdentifiedBot, normalizeForRepeat } from '../bot-guard'

describe('detectSelfIdentifiedBot', () => {
  it('matches the Silpo Pack opener (Spanish)', () => {
    expect(
      detectSelfIdentifiedBot(
        '¡Hola! Soy tu asistente virtual de Silpo Pack y mi función es ayudarte con información sobre tus envíos.',
      ),
    ).toBe(true)
  })

  it('matches English self-identification variants', () => {
    expect(detectSelfIdentifiedBot("Hi! I'm the virtual assistant for Acme Logistics.")).toBe(true)
    expect(detectSelfIdentifiedBot('I am a chatbot designed to help with tracking numbers.')).toBe(true)
    expect(detectSelfIdentifiedBot('This is an automated message. Do not reply to this message.')).toBe(true)
  })

  it('matches German, French and Portuguese variants', () => {
    expect(detectSelfIdentifiedBot('Ich bin ein virtueller Assistent von DHL.')).toBe(true)
    expect(detectSelfIdentifiedBot('Je suis votre assistant virtuel pour vos colis.')).toBe(true)
    expect(detectSelfIdentifiedBot('Sou o assistente virtual da transportadora.')).toBe(true)
    expect(detectSelfIdentifiedBot('Automatische Nachricht: Ihre Lieferung ist unterwegs.')).toBe(true)
  })

  it('does NOT match ordinary patient messages', () => {
    expect(detectSelfIdentifiedBot('Hi, can I book a massage for Friday?')).toBe(false)
    expect(detectSelfIdentifiedBot('I am a runner and my knee hurts after long runs.')).toBe(false)
    expect(detectSelfIdentifiedBot('Do you have availability tomorrow morning?')).toBe(false)
    expect(detectSelfIdentifiedBot('My assistant will call you to arrange the details.')).toBe(false)
    expect(detectSelfIdentifiedBot('I feel like a robot after this work week, I need to unwind.')).toBe(false)
  })
})

describe('normalizeForRepeat', () => {
  it('treats verbatim loop repeats as identical despite punctuation/case', () => {
    const a = '¡Gracias! Entendido que estás aquí para ayudar con Whealth Recovery Center.'
    const b = 'gracias entendido que estás aquí   para ayudar con whealth recovery center'
    expect(normalizeForRepeat(a)).toBe(normalizeForRepeat(b))
  })

  it('distinguishes genuinely different messages', () => {
    expect(normalizeForRepeat('Can I book for Friday?')).not.toBe(normalizeForRepeat('Can I book for Monday?'))
  })
})

// ── Owner-number mute (2026-10-29) ──────────────────────────────────────────
import { phonesMatch } from '../bot-guard'

describe('phonesMatch', () => {
  it('matches across formatting and country-code variants', () => {
    expect(phonesMatch('+1 809-348-4444', '8093484444')).toBe(true)
    expect(phonesMatch('(809) 348 4444', '+18093484444')).toBe(true)
    expect(phonesMatch('+1 210 960 8070', '210-960-8070')).toBe(true)
  })
  it('rejects different numbers and too-short inputs', () => {
    expect(phonesMatch('+1 809-348-4444', '+1 809-348-4445')).toBe(false)
    expect(phonesMatch('4444', '4444')).toBe(false)
    expect(phonesMatch(null, '+18093484444')).toBe(false)
    expect(phonesMatch('+18093484444', undefined)).toBe(false)
  })
})
