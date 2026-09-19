import { describe, it, expect, vi } from 'vitest'

vi.mock('@omniply/shared', () => ({ prisma: {}, brandSettingsForUser: vi.fn() }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { validateDisclaimer, houseDisclaimer, buildDisclaimerPrompt } from '../article-disclaimer'

describe('validateDisclaimer — the legal-text gate', () => {
  const GOOD =
    'The information provided in this article is for educational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment. ' +
    'Always consult your physician or another qualified health provider with any questions about a medical condition, and never disregard professional advice because of something you read here. ' +
    'Individual results vary. If you believe you have a medical emergency, call your doctor or emergency services immediately.'

  it('accepts a complete YMYL disclaimer', () => {
    expect(validateDisclaimer(GOOD)).toBeNull()
  })

  it('rejects the truncation class that shipped to WordPress (short, no terminal punctuation)', () => {
    const truncated = GOOD.slice(0, 235)
    expect(validateDisclaimer(truncated)).toMatch(/too short|terminal/)
  })

  it('rejects mid-sentence endings even at valid length', () => {
    const midSentence = GOOD.replace(/\.$/, '') + ' and always remember to'
    expect(validateDisclaimer(midSentence)).toBe('does not end with terminal punctuation')
  })

  it('rejects punctuation dashes and markdown', () => {
    expect(validateDisclaimer(GOOD.replace('purposes only', 'purposes — only'))).toBe('contains punctuation dashes')
    expect(validateDisclaimer('```\n' + GOOD + '\n```')).toBe('contains markdown')
  })

  it('rejects text without the medical-advice clause', () => {
    const generic = 'This content is for information only. '.repeat(12).trim() + '.'
    expect(validateDisclaimer(generic)).toBe('missing the medical-advice clause')
  })
})

describe('houseDisclaimer — the deterministic fallback', () => {
  it('always passes its own validation gate', () => {
    expect(validateDisclaimer(houseDisclaimer('chiropractic care'))).toBeNull()
    expect(validateDisclaimer(houseDisclaimer(''))).toBeNull()
  })

  it('interpolates the industry', () => {
    expect(houseDisclaimer('chiropractic care')).toContain('chiropractic care professional')
  })
})

describe('buildDisclaimerPrompt', () => {
  it('demands generic, dash-free, name-free footer text', () => {
    const p = buildDisclaimerPrompt('chiropractic care', 'Family Care')
    expect(p).toContain('EVERY educational article')
    expect(p).toContain('fully generic')
    expect(p).toContain('NO dashes as punctuation')
    expect(p).toContain('No company or practice names')
    expect(p).toContain('focus on Family Care')
  })
})
