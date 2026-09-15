import { describe, it, expect } from 'vitest'
import { numericTokensMatch, rewriteWithinGuards } from '../compile'

describe('leadgen rewrite guards', () => {
  it('numeric tokens must survive verbatim', () => {
    expect(numericTokensMatch('3 visits over 2 weeks, 80% report', '80% report after 3 visits across 2 weeks')).toBe(true)
    expect(numericTokensMatch('3 visits over 2 weeks', '4 visits over 2 weeks')).toBe(false)
    expect(numericTokensMatch('80% of patients', '80 percent of patients')).toBe(false) // % token dropped
  })

  it('length ratio bounds enforced', () => {
    const original = 'a'.repeat(100)
    expect(rewriteWithinGuards(original, 'b'.repeat(90))).toBe(true)
    expect(rewriteWithinGuards(original, 'b'.repeat(60))).toBe(false) // too short
    expect(rewriteWithinGuards(original, 'b'.repeat(150))).toBe(false) // too long
  })

  it('maxChars cap enforced when set', () => {
    const original = 'a'.repeat(100)
    expect(rewriteWithinGuards(original, 'b'.repeat(120), 110)).toBe(false)
    expect(rewriteWithinGuards(original, 'b'.repeat(105), 110)).toBe(true)
  })

  it('em/en dashes are rejected (digit ranges stay legal)', () => {
    const original = 'Take breaks every 1 to 2 hours during long drives to stay comfortable.'
    expect(rewriteWithinGuards(original, 'Take breaks — every 1 to 2 hours on long drives, stay comfortable.')).toBe(false)
    expect(rewriteWithinGuards(original, 'Take a break every 1–2 hours on long drives so you stay comfortable.')).toBe(true)
  })
})

describe('list markers are structure, not facts (live E2E 2026-09-15)', () => {
  it('added numbered-list markers do not fail the numeric guard', () => {
    expect(numericTokensMatch('Move and wait. Then decide.', '1. Move.\n2. Wait.\n3. Decide.')).toBe(true)
  })

  it('real added numbers still fail', () => {
    expect(numericTokensMatch('Move and wait.', '1. Move for 20 minutes.\n2. Wait.')).toBe(false)
  })

  it('a list-styled rewrite of a factless passage passes full guards', () => {
    const original = 'Most back pain improves with movement and time. This guide helps you tell the difference.'
    const rewritten = "Here's the thing:\n1. Most back pain improves with movement and time.\n2. This guide helps you tell the difference."
    expect(rewriteWithinGuards(original, rewritten)).toBe(true)
  })
})
