import { describe, it, expect } from 'vitest'
import { nextDraw, AUTHORITY_TYPES, type AuthorityBagState } from '../generators/authority-rotation'

/** Deterministic LCG so the shuffle is reproducible in tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function drawMany(count: number, seed: number): string[] {
  const rand = seededRand(seed)
  let state: AuthorityBagState = { bag: [], lastDrawn: null }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const r = nextDraw(state, rand)
    out.push(r.drawn)
    state = r.state
  }
  return out
}

describe('authority rotation (shuffled bag)', () => {
  it('never draws the same type twice in a row, across bag boundaries', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const seq = drawMany(60, seed)
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i], `seed ${seed} position ${i}`).not.toBe(seq[i - 1])
      }
    }
  })

  it('every bag of 5 contains all five types exactly once', () => {
    const seq = drawMany(50, 42)
    for (let bagStart = 0; bagStart < seq.length; bagStart += 5) {
      const bag = seq.slice(bagStart, bagStart + 5)
      expect([...bag].sort()).toEqual([...AUTHORITY_TYPES].sort())
    }
  })

  it('does not settle into one repeating 5-type sequence', () => {
    // With random shuffles the chance of 10 consecutive identical bags is
    // (1/5!)^9 — if all bags match, the shuffle is broken.
    const seq = drawMany(50, 7)
    const bags = []
    for (let i = 0; i < 50; i += 5) bags.push(seq.slice(i, i + 5).join(','))
    expect(new Set(bags).size).toBeGreaterThan(1)
  })

  it('recovers a corrupt/empty persisted state', () => {
    const r = nextDraw({ bag: [], lastDrawn: null }, seededRand(1))
    expect(AUTHORITY_TYPES).toContain(r.drawn)
    expect(r.state.bag).toHaveLength(4)
    expect(r.state.lastDrawn).toBe(r.drawn)
  })
})

import { parseState, authorityRegisterEligible, parsePools } from '../generators/authority-rotation'
import { buildFigureCorpus, stripUnsupportedFigureSentences } from '../generators/beat-figure-gate'

describe('chiro port: enabled flag + pools', () => {
  it('preserves enabled across draws', () => {
    const r = nextDraw({ bag: [], lastDrawn: null, enabled: true }, seededRand(3))
    expect(r.state.enabled).toBe(true)
  })

  it('parseState keeps enabled only when strictly true', () => {
    expect(parseState({ bag: [], lastDrawn: null, enabled: true }).enabled).toBe(true)
    expect(parseState({ bag: [], lastDrawn: null, enabled: 'yes' }).enabled).toBeUndefined()
  })

  it('eligibility: azavea always, clinics only when enabled', () => {
    expect(authorityRegisterEligible('azavea', null)).toBe(true)
    expect(authorityRegisterEligible('chiro', null)).toBe(false)
    expect(authorityRegisterEligible('chiro', { bag: [], lastDrawn: null, enabled: true })).toBe(true)
  })

  it('parsePools returns only non-empty string arrays', () => {
    expect(parsePools({ opinion: ['a'], proof: [], junk: ['x'] })).toEqual({ opinion: ['a'] })
    expect(parsePools({ proof: [] })).toBeNull()
    expect(parsePools(null)).toBeNull()
  })
})

describe('beat figure gate', () => {
  const logCtx = { runId: 'r', userId: 'u' }
  const corpus = buildFigureCorpus([
    'Healthcare practices miss 29% of inbound calls. The leak compounds to roughly $125,280 annually at $1,200 first-year value.',
    'Comment "XRAY" for the free 2-minute Practice X-Ray.',
  ])

  it('drops the sentence with the invented $72,000 (the live regression case)', () => {
    const beat =
      'The phone rang into silence.\nHere is the math nobody runs: 3 missed calls a day at $1,200 value. That is $72,000 annually walking out the door.\nTonight: the structural reason.'
    const out = stripUnsupportedFigureSentences(beat, corpus, logCtx, 'test')
    expect(out).not.toContain('$72,000')
    expect(out).toContain('phone rang into silence')
    expect(out).toContain('Tonight: the structural reason.')
  })

  it('keeps supported figures, complements, and CTA figures', () => {
    const beat = '71% of calls get answered. The rest leak $125,280 annually. Take the 2-minute test.'
    expect(stripUnsupportedFigureSentences(beat, corpus, logCtx, 'test')).toBe(beat)
  })

  it('accepts formatting variants of corpus figures', () => {
    const beat = 'That is $1200 per patient in year one.'
    expect(stripUnsupportedFigureSentences(beat, corpus, logCtx, 'test')).toBe(beat)
  })

  it('leaves digit-free text untouched', () => {
    const beat = 'No numbers here.\n\nJust a story.'
    expect(stripUnsupportedFigureSentences(beat, corpus, logCtx, 'test')).toBe(beat)
  })
})
