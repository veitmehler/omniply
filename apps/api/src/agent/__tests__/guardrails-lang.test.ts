import { describe, expect, it } from 'vitest'
import { detectVisitorLanguage, redFlagReply, safeFallbackReply } from '../guardrails'

describe('detectVisitorLanguage', () => {
  it('detects Russian via Cyrillic', () => {
    expect(detectVisitorLanguage('У меня сильно болит грудь и тяжело дышать')).toBe('ru')
    expect(detectVisitorLanguage('Дадите скидку?')).toBe('ru')
  })

  it('detects Spanish', () => {
    expect(detectVisitorLanguage('Hola! Duermo muy mal desde hace semanas, que me recomiendan?')).toBe('es')
    expect(detectVisitorLanguage('¿Cuánto cuesta un masaje?')).toBe('es')
    expect(detectVisitorLanguage('Tengo marcapasos, puedo hacer PEMF?')).toBe('es')
  })

  it('detects German', () => {
    expect(detectVisitorLanguage('Hallo! Ich bin nach dem Kitesurfen völlig erledigt, was habt ihr für Recovery?')).toBe('de')
    expect(detectVisitorLanguage('Was kostet eine NAD+ Infusion? Ungefähr reicht mir.')).toBe('de')
    expect(detectVisitorLanguage('Ich habe starke Schmerzen in der Brust und mir ist schwindelig.')).toBe('de')
  })

  it('detects French', () => {
    expect(detectVisitorLanguage('Bonjour, je suis stressé et épuisé, que proposez-vous ?')).toBe('fr')
    expect(detectVisitorLanguage('Combien coute une perfusion IV ? Juste une fourchette.')).toBe('fr')
  })

  it('defaults to English for English and ambiguous input', () => {
    expect(detectVisitorLanguage('Hi, I would like to book a PEMF session for tomorrow morning please.')).toBe('en')
    expect(detectVisitorLanguage('I have chest pain and trouble breathing')).toBe('en')
    expect(detectVisitorLanguage('PEMF?')).toBe('en')
    expect(detectVisitorLanguage('ok')).toBe('en')
    expect(detectVisitorLanguage('10am works')).toBe('en')
  })
})

describe('localized hard-coded replies', () => {
  it('urgent reply follows the visitor language and carries the emergency number', () => {
    expect(redFlagReply('cardiac', 'DO', 'es')).toContain('911')
    expect(redFlagReply('cardiac', 'DO', 'es')).toContain('atención médica')
    expect(redFlagReply('cardiac', 'DE', 'de')).toContain('112')
    expect(redFlagReply('cardiac', 'US', 'ru')).toContain('немедленной медицинской помощи')
    expect(redFlagReply('cardiac', 'FR', 'fr')).toContain('urgences')
  })

  it('self-harm reply is distinct and localized', () => {
    const es = redFlagReply('self-harm', 'DO', 'es')
    expect(es).toContain('línea de crisis')
    expect(es).not.toContain('atención médica ahora mismo')
    expect(redFlagReply('self-harm', 'US', 'en')).toContain('crisis line')
  })

  it('unknown country falls back to a localized "local emergency number"', () => {
    expect(redFlagReply('cardiac', 'XX', 'es')).toContain('tu número local de emergencias')
    expect(redFlagReply('cardiac', null, 'ru')).toContain('ваш местный номер')
  })

  it('safe fallback localizes and keeps the phone when present', () => {
    expect(safeFallbackReply('Whealth', '+1 809-348-4444', 'es')).toContain('recepción al +1 809-348-4444')
    expect(safeFallbackReply('Whealth', null, 'de')).toContain('einen Besuch zu buchen')
    expect(safeFallbackReply('Whealth', null, 'fr')).toContain("l'équipe de Whealth")
    expect(safeFallbackReply('Whealth', '+1 809-348-4444', 'ru')).toContain('+1 809-348-4444')
    // default stays byte-compatible English
    expect(safeFallbackReply('Whealth', null)).toContain('the team at Whealth')
  })

  it('no reply carries punctuation dashes', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'ru'] as const) {
      expect(redFlagReply('cardiac', 'DO', lang)).not.toMatch(/[—–]|\s-\s/)
      expect(redFlagReply('self-harm', 'DO', lang)).not.toMatch(/[—–]|\s-\s/)
      expect(safeFallbackReply('Whealth', '+1 809-348-4444', lang)).not.toMatch(/[—–]|\s-\s/)
    }
  })
})
